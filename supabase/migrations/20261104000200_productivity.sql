-- Tessera — Phase 2: daily productivity
-- Checklists & nested items, notifications, saved views, bookmarks, custom
-- fields, dependencies & links, attachments (private storage), time tracking,
-- recurrence, search, My Work, copy/duplicate helpers.

create or replace function public.try_uuid(p text) returns uuid
language plpgsql immutable as $$
begin
  return p::uuid;
exception when others then
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- Recurrence on cards
-- ---------------------------------------------------------------------------
alter table public.cards add column recurrence jsonb;
alter table public.cards add column recurrence_source_id uuid references public.cards (id) on delete set null;
-- Links into the project-control layer (foreign keys added with those tables)
alter table public.cards add column work_package_id uuid;
alter table public.cards add column milestone_id uuid;
create index cards_wp_idx on public.cards (work_package_id) where work_package_id is not null;

-- Next occurrence date for a recurrence rule (see src/domain/recurrence.ts).
-- byweekday uses 0 = Monday … 6 = Sunday.
create or replace function public.next_occurrence(p_from date, p_rule jsonb) returns date
language plpgsql immutable as $$
declare
  v_freq text := coalesce(p_rule ->> 'freq', 'weekly');
  v_interval int := greatest(1, coalesce((p_rule ->> 'interval')::int, 1));
  v_days int[];
  v_next date;
  v_until date := nullif(p_rule ->> 'until', '')::date;
  i int;
begin
  if p_from is null then return null; end if;
  if v_freq = 'daily' then
    v_next := p_from + v_interval;
  elsif v_freq = 'weekly' then
    select array_agg(x::int order by x::int) into v_days from jsonb_array_elements_text(coalesce(p_rule -> 'byweekday', '[]'::jsonb)) x;
    if v_days is null or array_length(v_days, 1) is null then
      v_next := p_from + 7 * v_interval;
    else
      v_next := null;
      -- later weekday in the same week
      for i in 1 .. 6 loop
        if ((extract(isodow from p_from)::int - 1 + i) <= 6) and ((extract(isodow from p_from)::int - 1 + i) = any (v_days)) then
          v_next := p_from + i;
          exit;
        end if;
      end loop;
      if v_next is null then
        -- first chosen weekday of the week `interval` weeks later
        v_next := (p_from - (extract(isodow from p_from)::int - 1)) + 7 * v_interval + v_days[1];
      end if;
    end if;
  elsif v_freq = 'monthly' then
    v_next := (p_from + make_interval(months => v_interval))::date;
  elsif v_freq = 'yearly' then
    v_next := (p_from + make_interval(years => v_interval))::date;
  else
    return null;
  end if;
  if v_until is not null and v_next > v_until then return null; end if;
  return v_next;
end $$;

-- ---------------------------------------------------------------------------
-- Checklists
-- ---------------------------------------------------------------------------
create table public.checklists (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.cards (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null default 'Checklist',
  position text collate "C" not null default 'a0',
  hide_done boolean not null default false,
  created_at timestamptz not null default now(),
  constraint checklists_title_len check (char_length(trim(title)) between 1 and 200)
);
create index checklists_card_idx on public.checklists (card_id);
create trigger checklists_set_project before insert on public.checklists
  for each row execute function public.card_child_set_project();

create table public.checklist_items (
  id uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references public.checklists (id) on delete cascade,
  card_id uuid not null references public.cards (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  parent_item_id uuid references public.checklist_items (id) on delete cascade,
  title text not null,
  done boolean not null default false,
  done_at timestamptz,
  done_by uuid references auth.users (id) on delete set null,
  assignee_id uuid references auth.users (id) on delete set null,
  due_date date,
  position text collate "C" not null default 'a0',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint checklist_items_title_len check (char_length(trim(title)) between 1 and 1000)
);
create index checklist_items_checklist_idx on public.checklist_items (checklist_id, position);
create index checklist_items_card_idx on public.checklist_items (card_id);
create index checklist_items_assignee_idx on public.checklist_items (assignee_id) where assignee_id is not null;

create or replace function public.checklist_items_prepare() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select card_id, project_id into new.card_id, new.project_id from public.checklists where id = new.checklist_id;
  if new.card_id is null then raise exception 'Checklist not found'; end if;
  if new.parent_item_id is not null and not exists (
    select 1 from public.checklist_items where id = new.parent_item_id and checklist_id = new.checklist_id) then
    raise exception 'Parent item must be in the same checklist';
  end if;
  if tg_op = 'INSERT' or new.done is distinct from old.done then
    if new.done then new.done_at := now(); new.done_by := auth.uid();
    else new.done_at := null; new.done_by := null; end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger checklist_items_prepare before insert or update on public.checklist_items
  for each row execute function public.checklist_items_prepare();

-- Completing a parent item completes its sub-items; reopening a sub-item reopens the parent.
create or replace function public.checklist_items_cascade() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.done is distinct from old.done then
    if new.done then
      update public.checklist_items set done = true where parent_item_id = new.id and not done;
    elsif new.parent_item_id is not null then
      update public.checklist_items set done = false where id = new.parent_item_id and done;
    end if;
  end if;
  return null;
end $$;
create trigger checklist_items_cascade after update of done on public.checklist_items
  for each row when (pg_trigger_depth() < 8) execute function public.checklist_items_cascade();

-- ---------------------------------------------------------------------------
-- Custom fields
-- ---------------------------------------------------------------------------
create table public.custom_fields (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null,
  type text not null check (type in ('text','number','date','select','checkbox','url')),
  options jsonb not null default '[]'::jsonb,
  position text collate "C" not null default 'a0',
  show_on_card boolean not null default false,
  created_at timestamptz not null default now(),
  constraint custom_fields_name_len check (char_length(trim(name)) between 1 and 100)
);
create index custom_fields_board_idx on public.custom_fields (board_id);
create trigger custom_fields_set_ids before insert or update of board_id on public.custom_fields
  for each row execute function public.lists_set_ids();

create table public.card_field_values (
  card_id uuid not null references public.cards (id) on delete cascade,
  field_id uuid not null references public.custom_fields (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  value jsonb,
  updated_at timestamptz not null default now(),
  primary key (card_id, field_id)
);
create trigger card_field_values_set_project before insert on public.card_field_values
  for each row execute function public.card_child_set_project();

create or replace function public.card_field_values_check() returns trigger
language plpgsql security definer set search_path = public as $$
declare f public.custom_fields;
begin
  select * into f from public.custom_fields where id = new.field_id;
  if not exists (select 1 from public.cards c where c.id = new.card_id and c.board_id = f.board_id) then
    raise exception 'Field does not belong to the card''s board';
  end if;
  if new.value is not null and new.value <> 'null'::jsonb then
    if f.type = 'number' and jsonb_typeof(new.value) <> 'number' then raise exception 'Value must be a number'; end if;
    if f.type = 'checkbox' and jsonb_typeof(new.value) <> 'boolean' then raise exception 'Value must be true or false'; end if;
    if f.type = 'date' and (jsonb_typeof(new.value) <> 'string' or (new.value #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$') then
      raise exception 'Value must be a date';
    end if;
    if f.type = 'select' and not (f.options @> jsonb_build_array(new.value #>> '{}')) then
      raise exception 'Value is not one of the options';
    end if;
    if f.type = 'url' and (new.value #>> '{}') !~* '^https?://' then raise exception 'Value must be a web address'; end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger card_field_values_check before insert or update on public.card_field_values
  for each row execute function public.card_field_values_check();

-- ---------------------------------------------------------------------------
-- Dependencies and links between cards
-- ---------------------------------------------------------------------------
create table public.card_dependencies (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  predecessor_id uuid not null references public.cards (id) on delete cascade,
  successor_id uuid not null references public.cards (id) on delete cascade,
  kind text not null default 'finish_to_start'
    check (kind in ('finish_to_start','start_to_start','finish_to_finish')),
  lag_days integer not null default 0,
  created_at timestamptz not null default now(),
  unique (predecessor_id, successor_id),
  constraint card_dependencies_distinct check (predecessor_id <> successor_id)
);
create index card_dependencies_succ_idx on public.card_dependencies (successor_id);

create or replace function public.card_dependencies_check() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_p uuid; v_s uuid;
begin
  select project_id into v_p from public.cards where id = new.predecessor_id;
  select project_id into v_s from public.cards where id = new.successor_id;
  if v_p is null or v_s is null or v_p <> v_s then
    raise exception 'Dependencies must link tasks in the same project';
  end if;
  new.project_id := v_p;
  -- reject cycles: successor must not (transitively) precede predecessor
  if exists (
    with recursive chain(id) as (
      select successor_id from public.card_dependencies where predecessor_id = new.successor_id
      union
      select d.successor_id from public.card_dependencies d join chain c on d.predecessor_id = c.id
    ) select 1 from chain where id = new.predecessor_id
  ) or new.successor_id = new.predecessor_id then
    raise exception 'This dependency would create a cycle';
  end if;
  return new;
end $$;
create trigger card_dependencies_check before insert or update on public.card_dependencies
  for each row execute function public.card_dependencies_check();

create table public.card_links (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  card_id uuid not null references public.cards (id) on delete cascade,
  linked_card_id uuid not null references public.cards (id) on delete cascade,
  relation text not null default 'relates' check (relation in ('relates','duplicates','follows_up')),
  created_at timestamptz not null default now(),
  unique (card_id, linked_card_id),
  constraint card_links_distinct check (card_id <> linked_card_id)
);
create trigger card_links_set_project before insert on public.card_links
  for each row execute function public.card_child_set_project();

-- ---------------------------------------------------------------------------
-- Attachments (files in private storage, or external links)
-- ---------------------------------------------------------------------------
create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  card_id uuid references public.cards (id) on delete cascade,
  entity_type text not null default 'card'
    check (entity_type in ('card','project','milestone','kpi','expense','meeting','risk','evidence','work_package')),
  entity_id uuid,
  kind text not null check (kind in ('file','link')),
  name text not null,
  url text,
  storage_path text,
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  is_finance boolean not null default false,
  uploaded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint attachments_name_len check (char_length(trim(name)) between 1 and 300),
  constraint attachments_kind_fields check (
    (kind = 'link' and url ~* '^https?://' and storage_path is null) or
    (kind = 'file' and storage_path is not null))
);
create index attachments_card_idx on public.attachments (card_id);
create index attachments_entity_idx on public.attachments (entity_type, entity_id);
create index attachments_project_idx on public.attachments (project_id);

create or replace function public.attachments_prepare() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.card_id is not null then
    select project_id into new.project_id from public.cards where id = new.card_id;
    new.entity_type := 'card';
    new.entity_id := new.card_id;
  end if;
  if tg_op = 'INSERT' then new.uploaded_by := auth.uid(); end if;
  if new.entity_type = 'expense' then new.is_finance := true; end if;
  -- files must live under the project's folder (and finance files under /finance/)
  if new.kind = 'file' then
    if split_part(new.storage_path, '/', 1) <> new.project_id::text then
      raise exception 'File path must start with the project id';
    end if;
    if new.is_finance and split_part(new.storage_path, '/', 2) <> 'finance' then
      raise exception 'Financial evidence must be stored in the finance folder';
    end if;
  end if;
  return new;
end $$;
create trigger attachments_prepare before insert or update on public.attachments
  for each row execute function public.attachments_prepare();

insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 52428800)
on conflict (id) do nothing;

create policy tessera_attachments_read on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and public.can_read_project(public.try_uuid((storage.foldername(name))[1]))
         and (coalesce((storage.foldername(name))[2], '') <> 'finance'
              or public.can_read_finance(public.try_uuid((storage.foldername(name))[1]))));
create policy tessera_attachments_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and public.can_edit_project(public.try_uuid((storage.foldername(name))[1]))
         and (coalesce((storage.foldername(name))[2], '') <> 'finance'
              or public.can_edit_finance(public.try_uuid((storage.foldername(name))[1]))));
create policy tessera_attachments_delete on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and public.can_edit_project(public.try_uuid((storage.foldername(name))[1]))
         and (coalesce((storage.foldername(name))[2], '') <> 'finance'
              or public.can_edit_finance(public.try_uuid((storage.foldername(name))[1]))));

-- ---------------------------------------------------------------------------
-- Time tracking
-- ---------------------------------------------------------------------------
create table public.time_entries (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  card_id uuid references public.cards (id) on delete set null,
  user_id uuid not null references auth.users (id) on delete cascade,
  entry_date date not null default current_date,
  started_at timestamptz,
  ended_at timestamptz,
  minutes integer check (minutes is null or minutes between 0 and 1440),
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint time_entries_range check (ended_at is null or started_at is null or ended_at >= started_at)
);
create index time_entries_user_idx on public.time_entries (user_id, entry_date);
create index time_entries_project_idx on public.time_entries (project_id, entry_date);
create unique index time_entries_one_running on public.time_entries (user_id) where started_at is not null and ended_at is null;

create or replace function public.time_entries_prepare() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.card_id is not null then
    select project_id into new.project_id from public.cards where id = new.card_id;
  end if;
  if tg_op = 'INSERT' then new.user_id := coalesce(auth.uid(), new.user_id); end if;
  if new.started_at is not null and new.ended_at is not null then
    new.minutes := greatest(0, least(1440, round(extract(epoch from (new.ended_at - new.started_at)) / 60)::int));
    new.entry_date := (new.started_at at time zone 'UTC')::date;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger time_entries_prepare before insert or update on public.time_entries
  for each row execute function public.time_entries_prepare();

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
  card_id uuid references public.cards (id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null default '',
  link text,
  actor_id uuid references auth.users (id) on delete set null,
  dedupe_key text,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  emailed_at timestamptz
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create unique index notifications_dedupe on public.notifications (user_id, dedupe_key) where dedupe_key is not null;

-- Central notification writer; honours per-user preferences and dedupes.
create or replace function public.notify(
  p_user uuid, p_kind text, p_title text, p_body text, p_project uuid, p_card uuid,
  p_link text default null, p_dedupe text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_pref jsonb;
begin
  if p_user is null or p_user = auth.uid() then return; end if;
  select preferences -> 'notifyOn' into v_pref from public.profiles where id = p_user;
  if v_pref is not null then
    if (p_kind = 'assigned' and (v_pref ->> 'assigned') = 'false')
       or (p_kind = 'mentioned' and (v_pref ->> 'mentioned') = 'false')
       or (p_kind in ('due_soon','overdue') and (v_pref ->> 'due') = 'false')
       or (p_kind in ('comment','status') and (v_pref ->> 'watching') = 'false') then
      return;
    end if;
  end if;
  if p_project is not null and not exists (
      select 1 from public.projects p
      left join public.workspace_members wm on wm.workspace_id = p.workspace_id and wm.user_id = p_user
      left join public.project_members pm on pm.project_id = p.id and pm.user_id = p_user
      where p.id = p_project and (pm.user_id is not null or wm.role in ('owner','admin')
            or (wm.role = 'member' and p.visibility = 'workspace'))) then
    return; -- never leak notifications to people without access
  end if;
  insert into public.notifications (user_id, project_id, card_id, kind, title, body, link, actor_id, dedupe_key)
  values (p_user, p_project, p_card, p_kind, left(p_title, 300), left(coalesce(p_body, ''), 1000), p_link, auth.uid(), p_dedupe)
  on conflict do nothing;
end $$;
revoke execute on function public.notify(uuid, text, text, text, uuid, uuid, text, text) from public, anon, authenticated;

create or replace function public.actor_name() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select display_name from public.profiles where id = auth.uid()), 'Someone')
$$;

create or replace function public.notify_assignment() returns trigger
language plpgsql security definer set search_path = public as $$
declare c public.cards;
begin
  select * into c from public.cards where id = new.card_id;
  insert into public.card_watchers (card_id, user_id, project_id)
  values (new.card_id, new.user_id, new.project_id) on conflict do nothing;
  perform public.notify(new.user_id, 'assigned', public.actor_name() || ' assigned you to “' || c.title || '”', '',
    c.project_id, c.id, null, null);
  return null;
end $$;
create trigger card_assignees_notify after insert on public.card_assignees
  for each row execute function public.notify_assignment();

create or replace function public.notify_comment() returns trigger
language plpgsql security definer set search_path = public as $$
declare c public.cards; u uuid;
begin
  select * into c from public.cards where id = new.card_id;
  -- commenters follow the card
  insert into public.card_watchers (card_id, user_id, project_id)
  values (new.card_id, new.author_id, new.project_id) on conflict do nothing;
  foreach u in array coalesce(new.mentions, '{}') loop
    perform public.notify(u, 'mentioned', public.actor_name() || ' mentioned you on “' || c.title || '”',
      left(new.body, 400), c.project_id, c.id, null, 'mention:' || new.id || ':' || u);
  end loop;
  for u in select w.user_id from public.card_watchers w
           where w.card_id = new.card_id and not (w.user_id = any (coalesce(new.mentions, '{}'))) loop
    perform public.notify(u, 'comment', public.actor_name() || ' commented on “' || c.title || '”',
      left(new.body, 400), c.project_id, c.id, null, 'comment:' || new.id || ':' || u);
  end loop;
  return null;
end $$;
create trigger comments_notify after insert on public.comments
  for each row execute function public.notify_comment();

create or replace function public.cards_after_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare u uuid; v_next date; v_start date; v_new uuid; v_list uuid;
begin
  if tg_op = 'INSERT' then
    if new.created_by is not null then
      insert into public.card_watchers (card_id, user_id, project_id)
      values (new.id, new.created_by, new.project_id) on conflict do nothing;
    end if;
    return null;
  end if;
  if new.status = 'done' and old.status <> 'done' then
    for u in select user_id from public.card_watchers where card_id = new.id loop
      perform public.notify(u, 'status', public.actor_name() || ' completed “' || new.title || '”', '',
        new.project_id, new.id, null, 'done:' || new.id || ':' || new.version || ':' || u);
    end loop;
    -- recurring tasks: create the next occurrence on completion
    if new.recurrence is not null and coalesce(new.recurrence ->> 'mode', 'on_complete') = 'on_complete' then
      v_next := public.next_occurrence(coalesce(new.due_date, current_date), new.recurrence);
      if v_next is not null and not exists (
          select 1 from public.cards where recurrence_source_id = new.id and due_date = v_next) then
        v_start := case when new.start_date is not null and new.due_date is not null
                        then v_next - (new.due_date - new.start_date) end;
        select id into v_list from public.lists where board_id = new.board_id and archived_at is null
          order by position limit 1;
        insert into public.cards (board_id, list_id, project_id, parent_id, title, description, position, priority,
                                  start_date, due_date, due_time, recurrence, recurrence_source_id, estimate_minutes,
                                  work_package_id, created_by)
        values (new.board_id, coalesce(v_list, new.list_id), new.project_id, new.parent_id, new.title, new.description,
                new.position, new.priority, v_start, v_next, new.due_time, new.recurrence, new.id, new.estimate_minutes,
                new.work_package_id, new.created_by)
        returning id into v_new;
        insert into public.card_assignees (card_id, user_id, project_id)
          select v_new, user_id, project_id from public.card_assignees where card_id = new.id;
        insert into public.card_labels (card_id, label_id, project_id)
          select v_new, label_id, project_id from public.card_labels where card_id = new.id;
        perform public.copy_checklists(new.id, v_new);
      end if;
    end if;
  end if;
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- Saved views and bookmarks
-- ---------------------------------------------------------------------------
create table public.saved_views (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  workspace_id uuid references public.workspaces (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
  board_id uuid references public.boards (id) on delete cascade,
  name text not null,
  view text not null check (view in ('board','table','calendar','timeline','dashboard','map','mywork','workspace')),
  config jsonb not null default '{}'::jsonb,
  shared boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint saved_views_name_len check (char_length(trim(name)) between 1 and 100)
);
create index saved_views_user_idx on public.saved_views (user_id);
create index saved_views_project_idx on public.saved_views (project_id);
create trigger saved_views_touch before update on public.saved_views
  for each row execute function public.touch_updated_at();
create or replace function public.saved_views_prepare() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then new.user_id := coalesce(auth.uid(), new.user_id); else new.user_id := old.user_id; end if;
  return new;
end $$;
create trigger saved_views_prepare before insert or update on public.saved_views
  for each row execute function public.saved_views_prepare();

create table public.bookmarks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('board','project','card','view','url')),
  target_id uuid,
  project_id uuid references public.projects (id) on delete cascade,
  url text check (url is null or url ~* '^https?://'),
  label text not null default '',
  position text collate "C" not null default 'a0',
  created_at timestamptz not null default now(),
  unique (user_id, kind, target_id)
);
create or replace function public.bookmarks_prepare() returns trigger
language plpgsql as $$
begin
  new.user_id := coalesce(auth.uid(), new.user_id);
  return new;
end $$;
create trigger bookmarks_prepare before insert on public.bookmarks
  for each row execute function public.bookmarks_prepare();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.checklists enable row level security;
alter table public.checklist_items enable row level security;
alter table public.custom_fields enable row level security;
alter table public.card_field_values enable row level security;
alter table public.card_dependencies enable row level security;
alter table public.card_links enable row level security;
alter table public.attachments enable row level security;
alter table public.time_entries enable row level security;
alter table public.notifications enable row level security;
alter table public.saved_views enable row level security;
alter table public.bookmarks enable row level security;

do $$
declare t text;
begin
  foreach t in array array['checklists','checklist_items','custom_fields','card_field_values','card_dependencies','card_links'] loop
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (public.can_read_project(project_id))', t);
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.can_edit_project(project_id))', t);
    execute format('create policy %1$s_update on public.%1$s for update to authenticated using (public.can_edit_project(project_id)) with check (public.can_edit_project(project_id))', t);
    execute format('create policy %1$s_delete on public.%1$s for delete to authenticated using (public.can_edit_project(project_id))', t);
  end loop;
end $$;

create policy attachments_select on public.attachments for select to authenticated
  using (public.can_read_project(project_id) and (not is_finance or public.can_read_finance(project_id)));
create policy attachments_insert on public.attachments for insert to authenticated
  with check (public.can_edit_project(project_id) and (not is_finance or public.can_edit_finance(project_id)));
create policy attachments_update on public.attachments for update to authenticated
  using (public.can_edit_project(project_id) and (not is_finance or public.can_edit_finance(project_id)))
  with check (public.can_edit_project(project_id) and (not is_finance or public.can_edit_finance(project_id)));
create policy attachments_delete on public.attachments for delete to authenticated
  using (public.can_edit_project(project_id) and (not is_finance or public.can_edit_finance(project_id)));

create policy time_entries_select on public.time_entries for select to authenticated
  using (user_id = auth.uid() or public.can_read_project(project_id));
create policy time_entries_insert on public.time_entries for insert to authenticated
  with check (user_id = auth.uid() and public.can_read_project(project_id)
              and coalesce(public.project_role(project_id), 'viewer') <> 'viewer');
create policy time_entries_update on public.time_entries for update to authenticated
  using (user_id = auth.uid() or public.can_manage_project(project_id))
  with check (user_id = auth.uid() or public.can_manage_project(project_id));
create policy time_entries_delete on public.time_entries for delete to authenticated
  using (user_id = auth.uid() or public.can_manage_project(project_id));

create policy notifications_select on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notifications_delete on public.notifications for delete to authenticated using (user_id = auth.uid());

create policy saved_views_select on public.saved_views for select to authenticated
  using (user_id = auth.uid() or (shared and project_id is not null and public.can_read_project(project_id))
         or (shared and project_id is null and workspace_id is not null and public.is_ws_member(workspace_id)));
create policy saved_views_insert on public.saved_views for insert to authenticated
  with check (user_id = auth.uid() and (project_id is null or public.can_read_project(project_id)));
create policy saved_views_update on public.saved_views for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy saved_views_delete on public.saved_views for delete to authenticated using (user_id = auth.uid());

create policy bookmarks_all on public.bookmarks for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- change feed + activity for the new tables
create trigger checklists_change after insert or update or delete on public.checklists for each row execute function public.emit_change();
create trigger checklist_items_change after insert or update or delete on public.checklist_items for each row execute function public.emit_change();
create trigger custom_fields_change after insert or update or delete on public.custom_fields for each row execute function public.emit_change();
create trigger card_field_values_change after insert or update or delete on public.card_field_values for each row execute function public.emit_change();
create trigger card_dependencies_change after insert or update or delete on public.card_dependencies for each row execute function public.emit_change();
create trigger card_links_change after insert or delete on public.card_links for each row execute function public.emit_change();
create trigger attachments_change after insert or update or delete on public.attachments for each row execute function public.emit_change();
create trigger time_entries_change after insert or update or delete on public.time_entries for each row execute function public.emit_change();
create trigger checklists_activity after insert or delete on public.checklists
  for each row execute function public.simple_activity('checklist');
create trigger attachments_activity after insert on public.attachments
  for each row execute function public.simple_activity('attachment');

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Copy / duplicate helpers (SECURITY INVOKER: RLS applies to every write)
-- ---------------------------------------------------------------------------
create or replace function public.copy_checklists(p_from uuid, p_to uuid) returns void
language plpgsql as $$
declare cl record; v_new uuid; it record; v_map jsonb := '{}'::jsonb; v_item uuid;
begin
  for cl in select * from public.checklists where card_id = p_from order by position loop
    insert into public.checklists (card_id, project_id, title, position, hide_done)
    values (p_to, cl.project_id, cl.title, cl.position, cl.hide_done) returning id into v_new;
    -- parents before children
    for it in
      with recursive tree as (
        select i.*, 0 as depth from public.checklist_items i where i.checklist_id = cl.id and i.parent_item_id is null
        union all
        select i.*, t.depth + 1 from public.checklist_items i join tree t on i.parent_item_id = t.id
      ) select * from tree order by depth, position
    loop
      insert into public.checklist_items (checklist_id, card_id, project_id, parent_item_id, title, position, assignee_id)
      values (v_new, p_to, it.project_id, (v_map ->> it.parent_item_id::text)::uuid, it.title, it.position, it.assignee_id)
      returning id into v_item;
      v_map := v_map || jsonb_build_object(it.id::text, v_item);
    end loop;
  end loop;
end $$;

create trigger cards_after_change after insert or update of status on public.cards
  for each row execute function public.cards_after_change();

create or replace function public.copy_card(
  p_card uuid, p_list uuid, p_title text default null, p_checklists boolean default true,
  p_labels boolean default true, p_members boolean default true, p_as_template boolean default false
) returns uuid
language plpgsql as $$
declare c public.cards; v_new uuid; v_board uuid; v_pos text;
begin
  select * into c from public.cards where id = p_card;
  if not found then raise exception 'Card not found'; end if;
  select board_id into v_board from public.lists where id = p_list;
  select coalesce(max(position) || 'V', 'a0') into v_pos from public.cards where list_id = p_list;
  insert into public.cards (board_id, list_id, project_id, title, description, position, priority, start_date, due_date,
                            due_time, cover_color, lat, lng, location_label, estimate_minutes, recurrence,
                            responsible_text, schedule, is_template)
  values (v_board, p_list, c.project_id, coalesce(nullif(trim(p_title), ''), c.title), c.description, v_pos, c.priority,
          c.start_date, c.due_date, c.due_time, c.cover_color, c.lat, c.lng, c.location_label, c.estimate_minutes,
          c.recurrence, c.responsible_text, c.schedule, p_as_template)
  returning id into v_new;
  if p_checklists then perform public.copy_checklists(p_card, v_new); end if;
  if p_labels and v_board = c.board_id then
    insert into public.card_labels (card_id, label_id, project_id)
      select v_new, label_id, project_id from public.card_labels where card_id = p_card;
  end if;
  if p_members then
    insert into public.card_assignees (card_id, user_id, project_id)
      select v_new, a.user_id, a.project_id from public.card_assignees a where a.card_id = p_card
      on conflict do nothing;
  end if;
  insert into public.card_field_values (card_id, field_id, project_id, value)
    select v_new, v.field_id, v.project_id, v.value from public.card_field_values v
    join public.custom_fields f on f.id = v.field_id and f.board_id = v_board
    where v.card_id = p_card;
  return v_new;
end $$;

create or replace function public.duplicate_board(p_board uuid, p_name text, p_include_cards boolean default true)
returns uuid
language plpgsql as $$
declare b public.boards; v_new uuid; l record; v_list uuid; v_label_map jsonb := '{}'::jsonb; v_field_map jsonb := '{}'::jsonb;
        lb record; f record; c record; v_card uuid; v_newlbl uuid; v_newfield uuid;
begin
  select * into b from public.boards where id = p_board;
  if not found then raise exception 'Board not found'; end if;
  insert into public.boards (project_id, workspace_id, name, description, background, position, settings)
  values (b.project_id, b.workspace_id, coalesce(nullif(trim(p_name), ''), b.name || ' (copy)'), b.description,
          b.background, b.position || 'V', b.settings)
  returning id into v_new;
  for lb in select * from public.labels where board_id = p_board loop
    insert into public.labels (board_id, project_id, name, color) values (v_new, b.project_id, lb.name, lb.color)
    returning id into v_newlbl;
    v_label_map := v_label_map || jsonb_build_object(lb.id::text, v_newlbl);
  end loop;
  for f in select * from public.custom_fields where board_id = p_board loop
    insert into public.custom_fields (board_id, project_id, name, type, options, position, show_on_card)
    values (v_new, b.project_id, f.name, f.type, f.options, f.position, f.show_on_card) returning id into v_newfield;
    v_field_map := v_field_map || jsonb_build_object(f.id::text, v_newfield);
  end loop;
  for l in select * from public.lists where board_id = p_board and archived_at is null order by position loop
    insert into public.lists (board_id, project_id, name, position, wip_limit, color)
    values (v_new, b.project_id, l.name, l.position, l.wip_limit, l.color) returning id into v_list;
    if p_include_cards then
      for c in select * from public.cards where list_id = l.id and archived_at is null and deleted_at is null order by position loop
        insert into public.cards (board_id, list_id, project_id, title, description, position, priority, status,
                                  start_date, due_date, due_time, cover_color, lat, lng, location_label,
                                  estimate_minutes, recurrence, responsible_text, schedule, is_template)
        values (v_new, v_list, c.project_id, c.title, c.description, c.position, c.priority, c.status, c.start_date,
                c.due_date, c.due_time, c.cover_color, c.lat, c.lng, c.location_label, c.estimate_minutes,
                c.recurrence, c.responsible_text, c.schedule, c.is_template)
        returning id into v_card;
        perform public.copy_checklists(c.id, v_card);
        insert into public.card_labels (card_id, label_id, project_id)
          select v_card, (v_label_map ->> label_id::text)::uuid, project_id from public.card_labels where card_id = c.id;
        insert into public.card_assignees (card_id, user_id, project_id)
          select v_card, user_id, project_id from public.card_assignees where card_id = c.id;
        insert into public.card_field_values (card_id, field_id, project_id, value)
          select v_card, (v_field_map ->> field_id::text)::uuid, project_id, value from public.card_field_values where card_id = c.id;
      end loop;
    end if;
  end loop;
  return v_new;
end $$;

create or replace function public.move_list_to_board(p_list uuid, p_board uuid) returns void
language plpgsql as $$
declare l public.lists; v_project uuid;
begin
  select * into l from public.lists where id = p_list;
  select project_id into v_project from public.boards where id = p_board;
  if l.id is null or v_project is null then raise exception 'Not found'; end if;
  if v_project <> l.project_id then raise exception 'Lists can only move between boards of the same project'; end if;
  delete from public.card_labels cl using public.cards c where cl.card_id = c.id and c.list_id = p_list;
  delete from public.card_field_values v using public.cards c where v.card_id = c.id and c.list_id = p_list;
  update public.lists set board_id = p_board, position = (select coalesce(max(position) || 'V', 'a0') from public.lists where board_id = p_board)
   where id = p_list;
  update public.cards set list_id = list_id where list_id = p_list;
end $$;

-- ---------------------------------------------------------------------------
-- Search and My Work (SECURITY INVOKER — RLS limits results)
-- ---------------------------------------------------------------------------
create or replace function public.search_all(p_query text, p_limit int default 40)
returns table (kind text, id uuid, title text, snippet text, project_id uuid, board_id uuid, card_id uuid, rank real)
language sql stable as $$
  with q as (
    select websearch_to_tsquery('simple', p_query) as tsq, '%' || replace(replace(trim(p_query), '%', '\%'), '_', '\_') || '%' as pat
  )
  select * from (
    select 'card'::text, c.id, c.title, left(c.description, 160), c.project_id, c.board_id, c.id,
           (ts_rank(c.search, q.tsq) + case when c.title ilike q.pat then 1 else 0 end)::real
    from public.cards c, q
    where c.deleted_at is null and c.is_template = false
      and (c.search @@ q.tsq or c.title ilike q.pat)
    union all
    select 'project', p.id, p.name, left(p.description, 160), p.id, null, null,
           (case when p.name ilike q.pat then 2 else 0.5 end)::real
    from public.projects p, q
    where p.deleted_at is null and (p.name ilike q.pat or p.acronym ilike q.pat or p.description ilike q.pat)
    union all
    select 'board', b.id, b.name, left(b.description, 160), b.project_id, b.id, null,
           (case when b.name ilike q.pat then 1.5 else 0.4 end)::real
    from public.boards b, q
    where b.deleted_at is null and (b.name ilike q.pat or b.description ilike q.pat)
    union all
    select 'comment', cm.id, c.title, left(cm.body, 160), cm.project_id, c.board_id, c.id, 0.3::real
    from public.comments cm join public.cards c on c.id = cm.card_id, q
    where cm.deleted_at is null and cm.body ilike q.pat
  ) r
  order by 8 desc
  limit greatest(1, least(p_limit, 100))
$$;

create or replace function public.my_work(p_include_done boolean default false)
returns table (
  card_id uuid, title text, status text, priority text, start_date date, due_date date, due_time time,
  completed_at timestamptz, project_id uuid, project_name text, project_color text, board_id uuid,
  board_name text, list_name text, parent_id uuid, estimate_minutes int, version int, source text,
  checklist_item_id uuid
)
language sql stable as $$
  select c.id, c.title, c.status, c.priority, c.start_date, c.due_date, c.due_time, c.completed_at, c.project_id,
         p.name, p.color, c.board_id, b.name, l.name, c.parent_id, c.estimate_minutes, c.version, 'card'::text, null::uuid
  from public.card_assignees a
  join public.cards c on c.id = a.card_id
  join public.projects p on p.id = c.project_id
  join public.boards b on b.id = c.board_id
  join public.lists l on l.id = c.list_id
  where a.user_id = auth.uid() and c.archived_at is null and c.deleted_at is null and c.is_template = false
    and p.deleted_at is null and p.archived_at is null and b.deleted_at is null and b.archived_at is null
    and (p_include_done or c.status <> 'done')
  union all
  select c.id, i.title, case when i.done then 'done' else 'open' end, 'none', null, i.due_date, null, i.done_at,
         c.project_id, p.name, p.color, c.board_id, b.name, c.title, c.id, null, c.version, 'checklist_item', i.id
  from public.checklist_items i
  join public.cards c on c.id = i.card_id
  join public.projects p on p.id = c.project_id
  join public.boards b on b.id = c.board_id
  where i.assignee_id = auth.uid() and c.archived_at is null and c.deleted_at is null and p.deleted_at is null
    and (p_include_done or not i.done)
$$;

-- Due-date reminders (run periodically by the scheduler; see automation migration)
create or replace function public.generate_due_notifications() returns integer
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in
    select c.id, c.title, c.project_id, c.due_date, a.user_id,
           coalesce((pr.preferences ->> 'reminderDays')::int, 1) as days
    from public.cards c
    join public.card_assignees a on a.card_id = c.id
    join public.profiles pr on pr.id = a.user_id
    join public.projects p on p.id = c.project_id
    where c.due_date is not null and c.status <> 'done' and c.archived_at is null and c.deleted_at is null
      and p.deleted_at is null and p.archived_at is null
      and c.due_date <= current_date + coalesce((pr.preferences ->> 'reminderDays')::int, 1)
      and c.due_date >= current_date - 30
  loop
    if r.due_date < current_date then
      perform public.notify(r.user_id, 'overdue', '“' || r.title || '” is overdue',
        'It was due ' || to_char(r.due_date, 'DD Mon YYYY') || '.', r.project_id, r.id, null,
        'overdue:' || r.id || ':' || r.due_date);
    else
      perform public.notify(r.user_id, 'due_soon', '“' || r.title || '” is due ' ||
        case when r.due_date = current_date then 'today' when r.due_date = current_date + 1 then 'tomorrow'
             else to_char(r.due_date, 'DD Mon') end, '', r.project_id, r.id, null,
        'due:' || r.id || ':' || r.due_date);
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.generate_due_notifications() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Personal inbox: a private project per user per workspace for quick capture
-- ---------------------------------------------------------------------------
alter table public.projects add column personal_owner uuid references auth.users (id) on delete cascade;
create unique index projects_personal_unique on public.projects (workspace_id, personal_owner) where personal_owner is not null;

create or replace function public.ensure_personal_inbox(p_workspace uuid)
returns table (project_id uuid, board_id uuid, list_id uuid)
language plpgsql security definer set search_path = public as $$
declare v_project uuid; v_board uuid; v_list uuid;
begin
  if auth.uid() is null or not public.is_ws_member(p_workspace) then raise exception 'Not allowed'; end if;
  select id into v_project from public.projects where workspace_id = p_workspace and personal_owner = auth.uid();
  if v_project is null then
    insert into public.projects (workspace_id, name, description, visibility, personal_owner, created_by, modules)
    values (p_workspace, 'Personal', 'Your private tasks and quick captures.', 'private', auth.uid(), auth.uid(),
            array['board','table','calendar','timeline']::text[])
    returning id into v_project;
    insert into public.project_members (project_id, user_id, role, finance_access) values (v_project, auth.uid(), 'manager', 'edit');
  end if;
  select id into v_board from public.boards where projects_personal_board(v_project, id) limit 1;
  if v_board is null then
    insert into public.boards (project_id, workspace_id, name, settings)
    values (v_project, p_workspace, 'Inbox', '{"personalInbox": true}'::jsonb) returning id into v_board;
    insert into public.lists (board_id, project_id, name, position) values
      (v_board, v_project, 'Inbox', 'a0'), (v_board, v_project, 'Today', 'a1'),
      (v_board, v_project, 'This week', 'a2'), (v_board, v_project, 'Later', 'a3'), (v_board, v_project, 'Done', 'a4');
  end if;
  select id into v_list from public.lists where lists.board_id = v_board and archived_at is null order by position limit 1;
  return query select v_project, v_board, v_list;
end $$;

create or replace function public.projects_personal_board(p_project uuid, p_board uuid) returns boolean
language sql stable as $$
  select exists (select 1 from public.boards b where b.id = p_board and b.project_id = p_project
                 and (b.settings ->> 'personalInbox')::boolean and b.deleted_at is null)
$$;

-- Personal projects stay private: nobody else can be added.
create or replace function public.personal_project_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.projects where id = new.project_id and personal_owner is not null and personal_owner <> new.user_id) then
    raise exception 'Personal projects cannot be shared';
  end if;
  return new;
end $$;
create trigger project_members_personal_guard before insert or update on public.project_members
  for each row execute function public.personal_project_guard();

-- Personal projects are invisible to workspace administrators too.
create or replace function public.project_role(p_project uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when p.personal_owner is not null then case when p.personal_owner = auth.uid() then 'manager' end
    when pm.role is not null then
      case when wm.role in ('owner','admin') then 'manager' else pm.role end
    when wm.role in ('owner','admin') then 'manager'
    when wm.role = 'member' and p.visibility = 'workspace' then 'member'
    else null
  end
  from public.projects p
  left join public.workspace_members wm
    on wm.workspace_id = p.workspace_id and wm.user_id = auth.uid()
  left join public.project_members pm
    on pm.project_id = p.id and pm.user_id = auth.uid()
  where p.id = p_project
$$;

-- Moving a task to another board drops labels and custom-field values that
-- belong to the previous board (they are board-specific).
create or replace function public.cards_board_changed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.board_id is distinct from old.board_id then
    delete from public.card_labels cl using public.labels l
      where cl.card_id = new.id and l.id = cl.label_id and l.board_id <> new.board_id;
    delete from public.card_field_values v using public.custom_fields f
      where v.card_id = new.id and f.id = v.field_id and f.board_id <> new.board_id;
  end if;
  return null;
end $$;
create trigger cards_board_changed after update of board_id on public.cards
  for each row execute function public.cards_board_changed();
