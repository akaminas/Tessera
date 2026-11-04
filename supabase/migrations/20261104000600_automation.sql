-- Tessera — Phase 6: automation engine and integrations
--
-- Design
--  * Database triggers enqueue events (only when an enabled rule or webhook
--    could react). A server-side worker (process_automation_queue) evaluates
--    rules and executes actions as the database owner — never in the browser.
--  * Every run is logged (automation_runs). Failures are retried with backoff
--    (3 attempts). Loop protection: events caused by automations carry a depth;
--    nothing is enqueued beyond depth 3, and a rule fires at most 50 times per
--    minute per project.
--  * Scheduling: pg_cron calls run_scheduler() every minute when available
--    (hosted Supabase). Locally/tests call it directly.
--  * Outgoing webhooks (generic/Slack/Teams) are delivered with pg_net and
--    signed with HMAC-SHA256.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  board_id uuid references public.boards (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 200),
  kind text not null check (kind in ('rule','scheduled','due_date','card_button','board_button')),
  enabled boolean not null default true,
  trigger jsonb not null default '{}'::jsonb,
  conditions jsonb not null default '[]'::jsonb,
  actions jsonb not null default '[]'::jsonb,
  schedule jsonb,
  next_run_at timestamptz,
  last_run_at timestamptz,
  run_count integer not null default 0,
  failure_count integer not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint automation_rules_actions check (jsonb_typeof(actions) = 'array' and jsonb_array_length(actions) between 1 and 20),
  constraint automation_rules_conditions check (jsonb_typeof(conditions) = 'array')
);
create index automation_rules_project_idx on public.automation_rules (project_id) where enabled;
create trigger automation_rules_touch before update on public.automation_rules for each row execute function public.touch_updated_at();

create table public.automation_events (
  id bigint generated always as identity primary key,
  project_id uuid not null references public.projects (id) on delete cascade,
  rule_id uuid references public.automation_rules (id) on delete cascade,
  event_type text not null,
  card_id uuid,
  payload jsonb not null default '{}'::jsonb,
  depth smallint not null default 0,
  actor_id uuid,
  status text not null default 'pending' check (status in ('pending','done','failed','skipped')),
  attempts smallint not null default 0,
  next_attempt_at timestamptz not null default now(),
  error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create index automation_events_pending_idx on public.automation_events (next_attempt_at) where status = 'pending';

create table public.automation_runs (
  id bigint generated always as identity primary key,
  rule_id uuid references public.automation_rules (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  event_id bigint,
  card_id uuid,
  status text not null check (status in ('success','failed','skipped')),
  message text not null default '',
  actions_done smallint not null default 0,
  attempt smallint not null default 1,
  depth smallint not null default 0,
  dedupe_key text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index automation_runs_rule_idx on public.automation_runs (rule_id, started_at desc);
create index automation_runs_project_idx on public.automation_runs (project_id, started_at desc);
create unique index automation_runs_dedupe on public.automation_runs (rule_id, dedupe_key) where dedupe_key is not null;

create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  kind text not null check (kind in ('webhook','slack','teams')),
  name text not null check (char_length(trim(name)) between 1 and 200),
  url text not null check (url ~* '^https://'),
  secret text not null default encode(gen_random_bytes(24), 'hex'),
  events text[] not null default array['task.created','task.completed','task.moved','comment.added','milestone.updated']::text[],
  enabled boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.webhook_deliveries (
  id bigint generated always as identity primary key,
  integration_id uuid not null references public.integrations (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  event text not null,
  payload jsonb not null,
  signature text not null,
  status text not null default 'pending' check (status in ('pending','sent','delivered','failed')),
  attempts smallint not null default 0,
  request_id bigint,
  response_status int,
  error text,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  next_attempt_at timestamptz not null default now()
);
create index webhook_deliveries_pending_idx on public.webhook_deliveries (next_attempt_at) where status in ('pending','sent');

-- RLS: rules readable by project members, editable by editors; logs readable
-- by members; integrations (URLs + secrets) only by managers.
alter table public.automation_rules enable row level security;
create policy automation_rules_select on public.automation_rules for select to authenticated using (public.can_read_project(project_id));
create policy automation_rules_insert on public.automation_rules for insert to authenticated with check (public.can_edit_project(project_id));
create policy automation_rules_update on public.automation_rules for update to authenticated using (public.can_edit_project(project_id)) with check (public.can_edit_project(project_id));
create policy automation_rules_delete on public.automation_rules for delete to authenticated using (public.can_edit_project(project_id));
alter table public.automation_events enable row level security;
create policy automation_events_select on public.automation_events for select to authenticated using (public.can_manage_project(project_id));
alter table public.automation_runs enable row level security;
create policy automation_runs_select on public.automation_runs for select to authenticated using (public.can_read_project(project_id));
alter table public.integrations enable row level security;
create policy integrations_all on public.integrations for all to authenticated
  using (public.can_manage_project(project_id)) with check (public.can_manage_project(project_id));
alter table public.webhook_deliveries enable row level security;
create policy webhook_deliveries_select on public.webhook_deliveries for select to authenticated using (public.can_manage_project(project_id));

create trigger automation_rules_change after insert or update or delete on public.automation_rules for each row execute function public.emit_change();

create or replace function public.automation_rules_prepare() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then new.created_by := auth.uid(); end if;
  if new.board_id is not null and not exists (select 1 from public.boards where id = new.board_id and project_id = new.project_id) then
    raise exception 'Board belongs to another project';
  end if;
  if new.kind in ('scheduled','due_date') and (tg_op = 'INSERT' or new.schedule is distinct from old.schedule or new.enabled <> old.enabled) then
    new.next_run_at := public.automation_next_run(coalesce(new.schedule, '{"freq":"daily","time":"08:00"}'::jsonb), now());
  end if;
  return new;
end $$;

create or replace function public.integrations_prepare() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then new.created_by := auth.uid(); end if;
  return new;
end $$;
create trigger integrations_prepare before insert on public.integrations for each row execute function public.integrations_prepare();

-- ---------------------------------------------------------------------------
-- Scheduling helpers
-- ---------------------------------------------------------------------------
-- schedule: {"freq":"daily"|"weekly"|"monthly", "time":"HH:MM", "weekday":0-6 (0 = Monday), "monthday":1-28, "tz":"Europe/Athens"}
create or replace function public.automation_next_run(p_schedule jsonb, p_after timestamptz) returns timestamptz
language plpgsql stable as $$
declare
  v_tz text := coalesce(nullif(p_schedule ->> 'tz', ''), 'UTC');
  v_time time := coalesce(nullif(p_schedule ->> 'time', '')::time, '08:00');
  v_local timestamp := p_after at time zone v_tz;
  v_day date := v_local::date;
  v_candidate timestamp;
  v_freq text := coalesce(p_schedule ->> 'freq', 'daily');
  i int;
begin
  for i in 0 .. 62 loop
    v_candidate := (v_day + i) + v_time;
    if v_candidate <= v_local then continue; end if;
    if v_freq = 'daily'
       or (v_freq = 'weekly' and extract(isodow from v_day + i)::int - 1 = coalesce((p_schedule ->> 'weekday')::int, 0))
       or (v_freq = 'monthly' and extract(day from v_day + i)::int = least(28, coalesce((p_schedule ->> 'monthday')::int, 1))) then
      return v_candidate at time zone v_tz;
    end if;
  end loop;
  return null;
end $$;

create trigger automation_rules_prepare before insert or update on public.automation_rules for each row execute function public.automation_rules_prepare();

-- ---------------------------------------------------------------------------
-- Event capture
-- ---------------------------------------------------------------------------
create or replace function public.automation_depth() returns smallint
language sql stable as $$
  select coalesce(nullif(current_setting('tessera.automation_depth', true), ''), '0')::smallint
$$;

create or replace function public.enqueue_event(p_project uuid, p_type text, p_card uuid, p_payload jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_depth smallint := public.automation_depth();
begin
  if v_depth >= 3 then return; end if; -- loop protection
  if not exists (select 1 from public.automation_rules r where r.project_id = p_project and r.enabled and r.kind = 'rule'
                   and r.trigger ->> 'type' = p_type)
     and not exists (select 1 from public.integrations i where i.project_id = p_project and i.enabled
                       and public.integration_event_name(p_type) = any (i.events)) then
    return;
  end if;
  insert into public.automation_events (project_id, event_type, card_id, payload, depth, actor_id)
  values (p_project, p_type, p_card, p_payload, v_depth, auth.uid());
end $$;
revoke execute on function public.enqueue_event(uuid, text, uuid, jsonb) from public, anon, authenticated;

-- Map internal event types to public webhook event names
create or replace function public.integration_event_name(p_type text) returns text
language sql immutable as $$
  select case p_type
    when 'card.created' then 'task.created'
    when 'card.completed' then 'task.completed'
    when 'card.moved' then 'task.moved'
    when 'comment.added' then 'comment.added'
    when 'milestone.status_changed' then 'milestone.updated'
    else p_type end
$$;

create or replace function public.cards_events() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.enqueue_event(new.project_id, 'card.created', new.id, jsonb_build_object('list_id', new.list_id, 'title', new.title));
    return null;
  end if;
  if new.list_id is distinct from old.list_id then
    perform public.enqueue_event(new.project_id, 'card.moved', new.id,
      jsonb_build_object('from_list', old.list_id, 'to_list', new.list_id, 'title', new.title));
  end if;
  if new.status is distinct from old.status then
    perform public.enqueue_event(new.project_id, 'card.status_changed', new.id,
      jsonb_build_object('from', old.status, 'to', new.status, 'title', new.title));
    if new.status = 'done' then
      perform public.enqueue_event(new.project_id, 'card.completed', new.id, jsonb_build_object('title', new.title));
    end if;
  end if;
  if new.due_date is distinct from old.due_date then
    perform public.enqueue_event(new.project_id, 'card.due_changed', new.id, jsonb_build_object('from', old.due_date, 'to', new.due_date));
  end if;
  return null;
end $$;
create trigger cards_events after insert or update of list_id, status, due_date on public.cards
  for each row execute function public.cards_events();

create or replace function public.card_labels_events() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.enqueue_event(new.project_id, 'card.label_added', new.card_id, jsonb_build_object('label_id', new.label_id));
  return null;
end $$;
create trigger card_labels_events after insert on public.card_labels for each row execute function public.card_labels_events();

create or replace function public.card_assignees_events() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.enqueue_event(new.project_id, 'card.assigned', new.card_id, jsonb_build_object('user_id', new.user_id));
  return null;
end $$;
create trigger card_assignees_events after insert on public.card_assignees for each row execute function public.card_assignees_events();

create or replace function public.comments_events() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.enqueue_event(new.project_id, 'comment.added', new.card_id, jsonb_build_object('comment_id', new.id, 'body', left(new.body, 500)));
  return null;
end $$;
create trigger comments_events after insert on public.comments for each row execute function public.comments_events();

create or replace function public.checklist_events() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.done and not old.done
     and not exists (select 1 from public.checklist_items where checklist_id = new.checklist_id and not done) then
    perform public.enqueue_event(new.project_id, 'checklist.completed', new.card_id, jsonb_build_object('checklist_id', new.checklist_id));
  end if;
  return null;
end $$;
create trigger checklist_events after update of done on public.checklist_items for each row execute function public.checklist_events();

create or replace function public.milestones_events() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status or new.approval_status is distinct from old.approval_status then
    perform public.enqueue_event(new.project_id, 'milestone.status_changed', null,
      jsonb_build_object('milestone_id', new.id, 'title', new.title, 'from', old.status, 'to', new.status, 'approval', new.approval_status));
  end if;
  return null;
end $$;
create trigger milestones_events after update on public.milestones for each row execute function public.milestones_events();

-- ---------------------------------------------------------------------------
-- Condition evaluation
-- ---------------------------------------------------------------------------
create or replace function public.automation_conditions_met(p_conditions jsonb, p_card uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare c jsonb; v_card public.cards; v_ok boolean; v_val text; v_op text;
begin
  if p_conditions is null or jsonb_array_length(p_conditions) = 0 then return true; end if;
  if p_card is null then return false; end if;
  select * into v_card from public.cards where id = p_card;
  if not found then return false; end if;
  for c in select * from jsonb_array_elements(p_conditions) loop
    v_val := c ->> 'value';
    v_op := coalesce(c ->> 'op', 'is');
    v_ok := case c ->> 'field'
      when 'list' then (v_card.list_id::text = v_val)
      when 'status' then (v_card.status = v_val)
      when 'priority' then (v_card.priority = v_val)
      when 'label' then exists (select 1 from public.card_labels where card_id = p_card and label_id::text = v_val)
      when 'assignee' then case when v_val = 'none' then not exists (select 1 from public.card_assignees where card_id = p_card)
                                else exists (select 1 from public.card_assignees where card_id = p_card and user_id::text = v_val) end
      when 'has_assignee' then exists (select 1 from public.card_assignees where card_id = p_card)
      when 'title_contains' then position(lower(v_val) in lower(v_card.title)) > 0
      when 'work_package' then (v_card.work_package_id::text = v_val)
      when 'overdue' then (v_card.due_date < current_date and v_card.status <> 'done')
      when 'has_due' then (v_card.due_date is not null)
      when 'is_subtask' then (v_card.parent_id is not null)
      else false end;
    if v_op in ('is_not','not_has') then v_ok := not v_ok; end if;
    if not coalesce(v_ok, false) then return false; end if;
  end loop;
  return true;
end $$;

-- ---------------------------------------------------------------------------
-- Action execution (runs as owner; validates that targets belong to the rule's project)
-- ---------------------------------------------------------------------------
create or replace function public.automation_execute(p_rule public.automation_rules, p_card uuid, p_event public.automation_events)
returns int
language plpgsql security definer set search_path = public as $$
declare
  a jsonb; n int := 0; v_card public.cards; v_list uuid; v_pos text; v_user uuid; v_cl uuid; v_item text; i int; v_new uuid;
  v_project uuid := p_rule.project_id; v_ms public.milestones; v_text text; v_recipients uuid[]; u uuid; v_title text; v_body text;
  v_link text;
begin
  for a in select * from jsonb_array_elements(p_rule.actions) loop
    if p_card is not null then select * into v_card from public.cards where id = p_card; end if;
    case a ->> 'type'
    when 'move_to_list' then
      select id into v_list from public.lists where id = (a ->> 'list_id')::uuid and project_id = v_project;
      if v_list is null then raise exception 'Target list not found in this project'; end if;
      -- moved tasks go to the bottom of the target list
      select coalesce(max(position) || 'V', 'a0') into v_pos from public.cards where list_id = v_list;
      update public.cards set list_id = v_list, position = v_pos where id = p_card;
    when 'set_status' then
      update public.cards set status = a ->> 'status' where id = p_card;
    when 'set_priority' then
      update public.cards set priority = a ->> 'priority' where id = p_card;
    when 'complete' then
      update public.cards set status = 'done' where id = p_card;
    when 'archive' then
      update public.cards set archived_at = now() where id = p_card;
    when 'assign' then
      v_user := case a ->> 'user'
        when 'actor' then p_event.actor_id
        when 'creator' then v_card.created_by
        else (a ->> 'user')::uuid end;
      if v_user is not null then
        insert into public.card_assignees (card_id, user_id, project_id) values (p_card, v_user, v_project) on conflict do nothing;
      end if;
    when 'unassign_all' then
      delete from public.card_assignees where card_id = p_card;
    when 'add_label' then
      insert into public.card_labels (card_id, label_id, project_id) values (p_card, (a ->> 'label_id')::uuid, v_project) on conflict do nothing;
    when 'remove_label' then
      delete from public.card_labels where card_id = p_card and label_id = (a ->> 'label_id')::uuid;
    when 'set_due' then
      update public.cards set due_date = current_date + coalesce((a ->> 'days')::int, 0) where id = p_card;
    when 'clear_due' then
      update public.cards set due_date = null, due_time = null where id = p_card;
    when 'add_checklist' then
      insert into public.checklists (card_id, project_id, title) values (p_card, v_project, coalesce(a ->> 'title', 'Checklist')) returning id into v_cl;
      i := 0;
      for v_item in select jsonb_array_elements_text(coalesce(a -> 'items', '[]')) loop
        i := i + 1;
        insert into public.checklist_items (checklist_id, card_id, project_id, title, position) values (v_cl, p_card, v_project, v_item, 'a' || lpad(i::text, 3, '0'));
      end loop;
    when 'add_comment' then
      insert into public.comments (card_id, project_id, author_id, body) values (p_card, v_project, null, '🤖 ' || coalesce(a ->> 'text', ''));
    when 'complete_parent' then
      if v_card.parent_id is not null and not exists (
          select 1 from public.cards where parent_id = v_card.parent_id and status <> 'done' and deleted_at is null and archived_at is null) then
        update public.cards set status = 'done' where id = v_card.parent_id and status <> 'done';
      end if;
    when 'set_wp_status' then
      if v_card.work_package_id is not null then
        update public.work_packages w set status = case
            when not exists (select 1 from public.cards c where c.work_package_id = w.id and c.status <> 'done' and c.deleted_at is null and c.archived_at is null) then 'completed'
            else 'in_progress' end
         where w.id = v_card.work_package_id and w.status in ('not_started','in_progress','completed');
      end if;
    when 'create_card' then
      select id into v_list from public.lists where id = (a ->> 'list_id')::uuid and project_id = v_project;
      if v_list is null then raise exception 'Target list not found in this project'; end if;
      select coalesce(max(position) || 'V', 'a0') into v_pos from public.cards where list_id = v_list;
      insert into public.cards (board_id, list_id, project_id, title, description, position, due_date, created_by)
      select l.board_id, l.id, v_project,
             replace(coalesce(a ->> 'title', 'New task'), '{date}', to_char(current_date, 'DD Mon YYYY')),
             coalesce(a ->> 'description', ''), v_pos,
             case when a ? 'due_in_days' then current_date + (a ->> 'due_in_days')::int end, p_rule.created_by
      from public.lists l where l.id = v_list
      returning id into v_new;
      if (a ->> 'assign_to') is not null then
        insert into public.card_assignees (card_id, user_id, project_id) values (v_new, (a ->> 'assign_to')::uuid, v_project) on conflict do nothing;
      end if;
      if jsonb_array_length(coalesce(a -> 'checklist', '[]')) > 0 then
        insert into public.checklists (card_id, project_id) values (v_new, v_project) returning id into v_cl;
        i := 0;
        for v_item in select jsonb_array_elements_text(a -> 'checklist') loop
          i := i + 1;
          insert into public.checklist_items (checklist_id, card_id, project_id, title, position) values (v_cl, v_new, v_project, v_item, 'a' || lpad(i::text, 3, '0'));
        end loop;
      end if;
    when 'notify' then
      v_title := replace(replace(coalesce(a ->> 'title', p_rule.name), '{card}', coalesce(v_card.title, '')), '{rule}', p_rule.name);
      v_body := replace(coalesce(a ->> 'body', ''), '{card}', coalesce(v_card.title, ''));
      v_recipients := case a ->> 'to'
        when 'assignees' then array(select user_id from public.card_assignees where card_id = p_card)
        when 'watchers' then array(select user_id from public.card_watchers where card_id = p_card)
        when 'creator' then array[v_card.created_by]
        when 'managers' then array(select user_id from public.project_members where project_id = v_project and role = 'manager')
        when 'members' then array(select user_id from public.project_members where project_id = v_project)
        else array[(a ->> 'to')::uuid] end;
      foreach u in array coalesce(v_recipients, '{}') loop
        perform public.notify(u, 'automation', v_title, v_body, v_project, p_card, null,
          'auto:' || p_rule.id || ':' || coalesce(p_card::text, '') || ':' || coalesce(p_event.id::text, to_char(now(), 'YYYYMMDDHH24MI')) || ':' || u);
      end loop;
    when 'request_evidence' then
      select * into v_ms from public.milestones where id = (p_event.payload ->> 'milestone_id')::uuid and project_id = v_project;
      if v_ms.id is not null then
        if not exists (select 1 from public.evidence_items where entity_type = 'milestone' and entity_id = v_ms.id) then
          insert into public.evidence_items (project_id, entity_type, entity_id, title, due_date)
          values (v_project, 'milestone', v_ms.id, coalesce(nullif(v_ms.verification, ''), 'Evidence for ' || v_ms.title), v_ms.due_date);
        end if;
        v_recipients := array_remove(array[v_ms.owner_id] || array(select user_id from public.project_members where project_id = v_project and role = 'manager'), null);
        foreach u in array v_recipients loop
          perform public.notify(u, 'automation', 'Evidence needed for “' || v_ms.title || '”',
            'Due ' || to_char(v_ms.due_date, 'DD Mon YYYY') || '. Required: ' || coalesce(nullif(v_ms.verification, ''), 'supporting documents') || '.',
            v_project, null, null, 'evidence:' || v_ms.id || ':' || u);
        end loop;
      end if;
    when 'notify_missing_submissions' then
      select count(*) into i from public.evidence_items where project_id = v_project and required and status in ('missing','rejected');
      if i > 0 then
        for u in select user_id from public.project_members where project_id = v_project loop
          perform public.notify(u, 'automation', 'Reporting period ending: ' || i || ' required item' || case when i = 1 then '' else 's' end || ' still missing',
            coalesce(p_event.payload ->> 'period', ''), v_project, null, null,
            'period:' || coalesce(p_event.payload ->> 'period_id', '') || ':' || u);
        end loop;
      end if;
    when 'webhook' then
      perform public.queue_webhook((a ->> 'integration_id')::uuid, 'automation.' || p_rule.kind,
        jsonb_build_object('rule', p_rule.name, 'card_id', p_card, 'card', v_card.title, 'event', p_event.event_type));
    else
      raise exception 'Unknown action %', a ->> 'type';
    end case;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.automation_execute(public.automation_rules, uuid, public.automation_events) from public, anon, authenticated;

-- Does an event match a rule's trigger?
create or replace function public.automation_trigger_matches(p_trigger jsonb, p_event public.automation_events) returns boolean
language sql immutable as $$
  select (p_trigger ->> 'type') = p_event.event_type
    and (p_trigger ->> 'list_id' is null or p_trigger ->> 'list_id' = coalesce(p_event.payload ->> 'to_list', p_event.payload ->> 'list_id'))
    and (p_trigger ->> 'from_list' is null or p_trigger ->> 'from_list' = p_event.payload ->> 'from_list')
    and (p_trigger ->> 'label_id' is null or p_trigger ->> 'label_id' = p_event.payload ->> 'label_id')
    and (p_trigger ->> 'to' is null or p_trigger ->> 'to' = p_event.payload ->> 'to')
    and (p_trigger ->> 'user_id' is null or p_trigger ->> 'user_id' = p_event.payload ->> 'user_id')
$$;

-- ---------------------------------------------------------------------------
-- Webhooks
-- ---------------------------------------------------------------------------
create or replace function public.queue_webhook(p_integration uuid, p_event text, p_data jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare i public.integrations; v_payload jsonb; v_body text;
begin
  select * into i from public.integrations where id = p_integration and enabled;
  if not found then return; end if;
  v_payload := case i.kind
    when 'slack' then jsonb_build_object('text', public.webhook_text(p_event, p_data))
    when 'teams' then jsonb_build_object('text', public.webhook_text(p_event, p_data))
    else jsonb_build_object('event', p_event, 'project_id', i.project_id, 'sent_at', now(), 'data', p_data) end;
  v_body := v_payload::text;
  insert into public.webhook_deliveries (integration_id, project_id, event, payload, signature)
  values (i.id, i.project_id, p_event, v_payload, 'sha256=' || encode(hmac(v_body, i.secret, 'sha256'), 'hex'));
end $$;

create or replace function public.webhook_text(p_event text, p_data jsonb) returns text
language sql immutable as $$
  select case p_event
    when 'task.created' then 'New task: ' || coalesce(p_data ->> 'title', '')
    when 'task.completed' then 'Completed: ' || coalesce(p_data ->> 'title', '')
    when 'task.moved' then 'Moved: ' || coalesce(p_data ->> 'title', '')
    when 'comment.added' then 'New comment: ' || left(coalesce(p_data ->> 'body', ''), 200)
    when 'milestone.updated' then 'Milestone “' || coalesce(p_data ->> 'title', '') || '” is now ' || replace(coalesce(p_data ->> 'to', ''), '_', ' ')
    else coalesce(p_data ->> 'rule', p_event) || coalesce(': ' || (p_data ->> 'card'), '') end
$$;

-- Send pending deliveries via pg_net (when installed) and reconcile responses.
create or replace function public.deliver_webhooks(p_limit int default 50) returns int
language plpgsql security definer set search_path = public as $$
declare d record; v_req bigint; n int := 0; v_has_net boolean;
begin
  v_has_net := exists (select 1 from pg_extension where extname = 'pg_net');
  -- reconcile responses of previously sent requests
  if v_has_net then
    execute $q$
      update public.webhook_deliveries w set
        response_status = r.status_code,
        status = case when r.status_code between 200 and 299 then 'delivered'
                      when w.attempts >= 3 then 'failed' else 'pending' end,
        delivered_at = case when r.status_code between 200 and 299 then now() end,
        error = case when r.status_code between 200 and 299 then null else coalesce(r.error_msg, 'HTTP ' || r.status_code) end,
        next_attempt_at = now() + make_interval(mins => power(2, w.attempts)::int)
      from net._http_response r
      where w.status = 'sent' and w.request_id = r.id
    $q$;
  end if;
  for d in
    select w.*, i.url, i.kind from public.webhook_deliveries w join public.integrations i on i.id = w.integration_id
    where w.status = 'pending' and w.next_attempt_at <= now() and i.enabled
    order by w.id limit p_limit for update of w skip locked
  loop
    if not v_has_net then
      update public.webhook_deliveries set error = 'pg_net extension is not available on this database', attempts = attempts + 1,
        status = case when attempts + 1 >= 3 then 'failed' else 'pending' end, next_attempt_at = now() + interval '5 minutes'
       where id = d.id;
      continue;
    end if;
    execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 5000)'
      into v_req
      using d.url, d.payload,
            jsonb_build_object('Content-Type', 'application/json', 'X-Tessera-Event', d.event, 'X-Tessera-Signature', d.signature,
                               'User-Agent', 'Tessera-Webhooks/1');
    update public.webhook_deliveries set request_id = v_req, status = 'sent', attempts = attempts + 1 where id = d.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.deliver_webhooks(int) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Worker: process queued events
-- ---------------------------------------------------------------------------
create or replace function public.process_automation_queue(p_limit int default 100) returns int
language plpgsql security definer set search_path = public as $$
declare
  e public.automation_events; r public.automation_rules; v_done int; v_processed int := 0; v_err text; v_failed boolean;
  v_recent int; i public.integrations;
begin
  for e in
    select * from public.automation_events
    where status = 'pending' and next_attempt_at <= now()
    order by id limit p_limit for update skip locked
  loop
    v_failed := false;
    v_err := null;
    perform set_config('tessera.automation_depth', (e.depth + 1)::text, true);
    -- integrations subscribed to this event
    for i in select * from public.integrations where project_id = e.project_id and enabled
               and public.integration_event_name(e.event_type) = any (events) and e.rule_id is null loop
      perform public.queue_webhook(i.id, public.integration_event_name(e.event_type), e.payload || jsonb_build_object('card_id', e.card_id));
    end loop;
    for r in
      select * from public.automation_rules
      where enabled and project_id = e.project_id
        and ((e.rule_id is not null and id = e.rule_id) or (e.rule_id is null and kind = 'rule' and public.automation_trigger_matches(trigger, e)))
        and (board_id is null or e.card_id is null or board_id = (select board_id from public.cards where id = e.card_id))
    loop
      select count(*) into v_recent from public.automation_runs where rule_id = r.id and started_at > now() - interval '1 minute';
      if v_recent >= 50 then
        insert into public.automation_runs (rule_id, project_id, event_id, card_id, status, message, depth, finished_at)
        values (r.id, r.project_id, e.id, e.card_id, 'skipped', 'Rate limit reached (50 runs per minute); possible loop.', e.depth, now());
        continue;
      end if;
      if not public.automation_conditions_met(r.conditions, e.card_id) then
        continue;
      end if;
      begin
        v_done := public.automation_execute(r, e.card_id, e);
        insert into public.automation_runs (rule_id, project_id, event_id, card_id, status, message, actions_done, attempt, depth, finished_at)
        values (r.id, r.project_id, e.id, e.card_id, 'success', '', v_done, e.attempts + 1, e.depth, now());
        update public.automation_rules set run_count = run_count + 1, last_run_at = now() where id = r.id;
      exception when others then
        v_failed := true;
        v_err := sqlerrm;
        insert into public.automation_runs (rule_id, project_id, event_id, card_id, status, message, attempt, depth, finished_at)
        values (r.id, r.project_id, e.id, e.card_id, 'failed', left(sqlerrm, 500), e.attempts + 1, e.depth, now());
        update public.automation_rules set failure_count = failure_count + 1 where id = r.id;
      end;
    end loop;
    if v_failed and e.attempts + 1 < 3 then
      update public.automation_events set attempts = attempts + 1, error = v_err,
        next_attempt_at = now() + make_interval(mins => power(2, attempts + 1)::int) where id = e.id;
    else
      update public.automation_events set attempts = attempts + 1, status = case when v_failed then 'failed' else 'done' end,
        error = v_err, processed_at = now() where id = e.id;
    end if;
    perform set_config('tessera.automation_depth', '0', true);
    v_processed := v_processed + 1;
  end loop;
  return v_processed;
end $$;
revoke execute on function public.process_automation_queue(int) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Scheduled and due-date rules
-- ---------------------------------------------------------------------------
create or replace function public.run_time_rules(p_now timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare r public.automation_rules; c record; n int := 0; v_off int; v_scope text; m record; rp record; v_event public.automation_events;
begin
  for r in select * from public.automation_rules where enabled and kind in ('scheduled','due_date') and next_run_at <= p_now
           order by next_run_at for update skip locked loop
    perform set_config('tessera.automation_depth', '1', true);
    v_off := coalesce((r.trigger ->> 'offset_days')::int, 0);
    begin
      if r.kind = 'scheduled' then
        v_scope := coalesce(r.trigger ->> 'scope', 'once');
        if v_scope = 'cards' then
          for c in select id from public.cards where project_id = r.project_id and (r.board_id is null or board_id = r.board_id)
                     and deleted_at is null and archived_at is null and not is_template loop
            if public.automation_conditions_met(r.conditions, c.id) then
              v_event := row(null, r.project_id, r.id, 'scheduled', c.id, '{}'::jsonb, 1, null, 'done', 0, now(), null, now(), now())::public.automation_events;
              perform public.automation_execute(r, c.id, v_event);
              n := n + 1;
            end if;
          end loop;
        else
          v_event := row(null, r.project_id, r.id, 'scheduled', null, '{}'::jsonb, 1, null, 'done', 0, now(), null, now(), now())::public.automation_events;
          perform public.automation_execute(r, null, v_event);
          n := n + 1;
        end if;
        insert into public.automation_runs (rule_id, project_id, status, message, depth, finished_at)
        values (r.id, r.project_id, 'success', 'Scheduled run', 1, now());
      else
        -- due_date rules: trigger.target = 'cards' | 'milestones' | 'reporting_periods'
        if coalesce(r.trigger ->> 'target', 'cards') = 'cards' then
          for c in select id, due_date from public.cards where project_id = r.project_id and (r.board_id is null or board_id = r.board_id)
                     and deleted_at is null and archived_at is null and not is_template and status <> 'done'
                     and due_date = (p_now at time zone 'UTC')::date - v_off loop
            if public.automation_conditions_met(r.conditions, c.id) then
              begin
                insert into public.automation_runs (rule_id, project_id, card_id, status, message, depth, dedupe_key)
                values (r.id, r.project_id, c.id, 'success', 'Due-date rule', 1, c.id || ':' || c.due_date);
                v_event := row(null, r.project_id, r.id, 'due_date', c.id, '{}'::jsonb, 1, null, 'done', 0, now(), null, now(), now())::public.automation_events;
                perform public.automation_execute(r, c.id, v_event);
                n := n + 1;
              exception when unique_violation then null; -- already ran for this card and date
              end;
            end if;
          end loop;
        elsif r.trigger ->> 'target' = 'milestones' then
          for m in select id, title, due_date from public.milestones where project_id = r.project_id and deleted_at is null
                     and status not in ('done','cancelled') and due_date = (p_now at time zone 'UTC')::date - v_off loop
            begin
              insert into public.automation_runs (rule_id, project_id, status, message, depth, dedupe_key)
              values (r.id, r.project_id, 'success', 'Milestone deadline rule: ' || m.title, 1, m.id || ':' || m.due_date);
              v_event := row(null, r.project_id, r.id, 'milestone_due', null, jsonb_build_object('milestone_id', m.id, 'title', m.title),
                             1, null, 'done', 0, now(), null, now(), now())::public.automation_events;
              perform public.automation_execute(r, null, v_event);
              n := n + 1;
            exception when unique_violation then null;
            end;
          end loop;
        elsif r.trigger ->> 'target' = 'reporting_periods' then
          for rp in select id, code, name, end_date from public.reporting_periods where project_id = r.project_id
                      and end_date = (p_now at time zone 'UTC')::date - v_off loop
            begin
              insert into public.automation_runs (rule_id, project_id, status, message, depth, dedupe_key)
              values (r.id, r.project_id, 'success', 'Reporting period rule: ' || rp.code, 1, rp.id::text);
              v_event := row(null, r.project_id, r.id, 'period_end', null,
                             jsonb_build_object('period_id', rp.id, 'period', rp.code || ' ' || rp.name || ' ends ' || to_char(rp.end_date, 'DD Mon YYYY')),
                             1, null, 'done', 0, now(), null, now(), now())::public.automation_events;
              perform public.automation_execute(r, null, v_event);
              n := n + 1;
            exception when unique_violation then null;
            end;
          end loop;
        end if;
      end if;
      update public.automation_rules set last_run_at = p_now, run_count = run_count + 1,
        next_run_at = public.automation_next_run(coalesce(schedule, '{"freq":"daily","time":"08:00"}'::jsonb), p_now)
       where id = r.id;
    exception when others then
      insert into public.automation_runs (rule_id, project_id, status, message, depth, finished_at)
      values (r.id, r.project_id, 'failed', left(sqlerrm, 500), 1, now());
      update public.automation_rules set failure_count = failure_count + 1,
        next_run_at = p_now + interval '15 minutes' where id = r.id;
    end;
    perform set_config('tessera.automation_depth', '0', true);
  end loop;
  return n;
end $$;
revoke execute on function public.run_time_rules(timestamptz) from public, anon, authenticated;

-- Card and board buttons (run immediately, as the server)
create or replace function public.run_button(p_rule uuid, p_card uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.automation_rules; v_event public.automation_events; v_n int := 0; c record;
begin
  select * into r from public.automation_rules where id = p_rule and enabled and kind in ('card_button','board_button');
  if not found then raise exception 'Button not found or disabled'; end if;
  if not public.can_edit_project(r.project_id) then raise exception 'Not allowed'; end if;
  if p_card is not null and not exists (select 1 from public.cards where id = p_card and project_id = r.project_id) then
    raise exception 'Task belongs to another project';
  end if;
  perform set_config('tessera.automation_depth', '1', true);
  if r.kind = 'card_button' then
    if p_card is null then raise exception 'Choose a task'; end if;
    v_event := row(null, r.project_id, r.id, 'button', p_card, '{}'::jsonb, 1, auth.uid(), 'done', 0, now(), null, now(), now())::public.automation_events;
    v_n := public.automation_execute(r, p_card, v_event);
  else
    for c in select id from public.cards where project_id = r.project_id and (r.board_id is null or board_id = r.board_id)
               and deleted_at is null and archived_at is null and not is_template loop
      if public.automation_conditions_met(r.conditions, c.id) and jsonb_array_length(r.conditions) > 0 then
        v_event := row(null, r.project_id, r.id, 'button', c.id, '{}'::jsonb, 1, auth.uid(), 'done', 0, now(), null, now(), now())::public.automation_events;
        v_n := v_n + public.automation_execute(r, c.id, v_event);
      end if;
    end loop;
    if jsonb_array_length(r.conditions) = 0 then
      v_event := row(null, r.project_id, r.id, 'button', null, '{}'::jsonb, 1, auth.uid(), 'done', 0, now(), null, now(), now())::public.automation_events;
      v_n := public.automation_execute(r, null, v_event);
    end if;
  end if;
  insert into public.automation_runs (rule_id, project_id, card_id, status, message, actions_done, depth, finished_at)
  values (r.id, r.project_id, p_card, 'success', 'Button pressed', v_n, 1, now());
  update public.automation_rules set run_count = run_count + 1, last_run_at = now() where id = r.id;
  perform set_config('tessera.automation_depth', '0', true);
  -- process anything the button triggered right away
  perform public.process_automation_queue(50);
  return jsonb_build_object('actions', v_n);
end $$;

-- Run a scheduled rule now (from the UI "Run now" button)
create or replace function public.run_rule_now(p_rule uuid) returns int
language plpgsql security definer set search_path = public as $$
declare r public.automation_rules;
begin
  select * into r from public.automation_rules where id = p_rule;
  if not found or not public.can_edit_project(r.project_id) then raise exception 'Not allowed'; end if;
  if r.kind not in ('scheduled','due_date') then raise exception 'Only scheduled and due-date rules can be run now'; end if;
  update public.automation_rules set next_run_at = now() - interval '1 second' where id = p_rule;
  return public.run_time_rules(now());
end $$;

-- Process queued events promptly after a user action (so automations feel immediate);
-- the scheduler remains the safety net.
create or replace function public.kick_automations() returns int
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return 0; end if;
  return public.process_automation_queue(25);
end $$;

-- ---------------------------------------------------------------------------
-- Scheduler entry point and housekeeping
-- ---------------------------------------------------------------------------
create or replace function public.run_scheduler() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_events int; v_rules int; v_hooks int; v_due int := 0;
begin
  v_events := public.process_automation_queue(500);
  v_rules := public.run_time_rules(now());
  v_events := v_events + public.process_automation_queue(500);
  v_hooks := public.deliver_webhooks(100);
  if extract(minute from now()) = 0 then
    v_due := public.generate_due_notifications();
    delete from public.change_feed where created_at < now() - interval '2 days';
    delete from public.automation_events where status in ('done','skipped') and created_at < now() - interval '30 days';
  end if;
  return jsonb_build_object('events', v_events, 'rules', v_rules, 'webhooks', v_hooks, 'reminders', v_due);
end $$;
revoke execute on function public.run_scheduler() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('tessera-scheduler', '* * * * *', 'select public.run_scheduler()');
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
  end if;
exception when others then
  raise notice 'Scheduler setup skipped: %', sqlerrm;
end $$;

-- ---------------------------------------------------------------------------
-- Calendar feed support: events for a user identified by their secret token
-- (used by the ical Edge Function with the service role).
-- ---------------------------------------------------------------------------
create or replace function public.calendar_feed(p_token uuid)
returns table (uid text, title text, starts date, ends date, description text, url_path text)
language sql stable security definer set search_path = public as $$
  with u as (select user_id from public.user_secrets where calendar_token = p_token)
  select 'card-' || c.id, c.title, coalesce(c.start_date, c.due_date), c.due_date,
         p.name || ' · ' || coalesce((select name from public.lists where id = c.list_id), ''), 'c/' || c.id
  from u
  join public.card_assignees a on a.user_id = u.user_id
  join public.cards c on c.id = a.card_id
  join public.projects p on p.id = c.project_id
  where c.due_date is not null and c.deleted_at is null and c.archived_at is null and p.deleted_at is null
  union all
  select 'milestone-' || m.id, coalesce(nullif(m.code, '') || ' ', '') || m.title, m.due_date, m.due_date,
         p.name || ' · ' || m.kind, 'p/' || p.id || '/milestones'
  from u
  join public.project_members pm on pm.user_id = u.user_id
  join public.projects p on p.id = pm.project_id
  join public.milestones m on m.project_id = p.id
  where m.due_date is not null and m.deleted_at is null and p.deleted_at is null
$$;
revoke execute on function public.calendar_feed(uuid) from public, anon, authenticated;
