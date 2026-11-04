-- Tessera — Phase 4: project controls
-- Partners, reporting periods, work packages, milestones & deliverables,
-- evidence, risks & issues, meetings (decisions, action items), progress.

-- ---------------------------------------------------------------------------
-- Generic helpers
-- ---------------------------------------------------------------------------

-- Project month m (1-based) → first and last day, relative to project start.
create or replace function public.project_month_start(p_start date, p_month int) returns date
language sql immutable as $$
  select (p_start + make_interval(months => p_month - 1))::date
$$;
create or replace function public.project_month_end(p_start date, p_month int) returns date
language sql immutable as $$
  select ((p_start + make_interval(months => p_month)) - interval '1 day')::date
$$;
-- Date → project month index (1-based); null if before start.
create or replace function public.project_month_of(p_start date, p_date date) returns int
language sql immutable as $$
  select case when p_start is null or p_date is null or p_date < p_start then null
         else ((extract(year from age(p_date, p_start)) * 12 + extract(month from age(p_date, p_start)))::int + 1) end
$$;

-- Generic project-child RLS
create or replace function public.apply_project_rls(p_table text, p_finance boolean default false) returns void
language plpgsql as $$
begin
  execute format('alter table public.%I enable row level security', p_table);
  if p_finance then
    execute format('create policy %1$s_select on public.%1$I for select to authenticated using (public.can_read_finance(project_id))', p_table);
    execute format('create policy %1$s_insert on public.%1$I for insert to authenticated with check (public.can_edit_finance(project_id))', p_table);
    execute format('create policy %1$s_update on public.%1$I for update to authenticated using (public.can_edit_finance(project_id)) with check (public.can_edit_finance(project_id))', p_table);
    execute format('create policy %1$s_delete on public.%1$I for delete to authenticated using (public.can_edit_finance(project_id))', p_table);
  else
    execute format('create policy %1$s_select on public.%1$I for select to authenticated using (public.can_read_project(project_id))', p_table);
    execute format('create policy %1$s_insert on public.%1$I for insert to authenticated with check (public.can_edit_project(project_id))', p_table);
    execute format('create policy %1$s_update on public.%1$I for update to authenticated using (public.can_edit_project(project_id)) with check (public.can_edit_project(project_id))', p_table);
    execute format('create policy %1$s_delete on public.%1$I for delete to authenticated using (public.can_edit_project(project_id))', p_table);
  end if;
  execute format('create trigger %1$s_change after insert or update or delete on public.%1$I for each row execute function public.emit_change()', p_table);
end $$;

-- ---------------------------------------------------------------------------
-- Partners (organisations taking part in a project)
-- ---------------------------------------------------------------------------
create table public.project_partners (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete restrict,
  role text not null default 'partner' check (role in ('coordinator','partner','associated','subcontractor','third_party')),
  short_name text not null default '',
  contact_user_id uuid references auth.users (id) on delete set null,
  position text collate "C" not null default 'a0',
  created_at timestamptz not null default now(),
  unique (project_id, organization_id)
);
create or replace function public.project_partners_check() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.organizations o join public.projects p on p.workspace_id = o.workspace_id
                 where o.id = new.organization_id and p.id = new.project_id) then
    raise exception 'Organisation must belong to the project''s workspace';
  end if;
  if new.short_name = '' then
    select coalesce(nullif(short_name, ''), left(name, 30)) into new.short_name from public.organizations where id = new.organization_id;
  end if;
  return new;
end $$;
create trigger project_partners_check before insert or update on public.project_partners
  for each row execute function public.project_partners_check();
select public.apply_project_rls('project_partners');
-- Financial attributes of partners (person-month rates, funding rates) live in the finance layer.

-- ---------------------------------------------------------------------------
-- Reporting periods
-- ---------------------------------------------------------------------------
create table public.reporting_periods (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  code text not null,
  name text not null default '',
  start_date date not null,
  end_date date not null,
  due_date date,
  status text not null default 'open' check (status in ('open','in_preparation','submitted','approved')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  constraint reporting_periods_dates check (end_date >= start_date),
  unique (project_id, code)
);
create index reporting_periods_project_idx on public.reporting_periods (project_id, start_date);
select public.apply_project_rls('reporting_periods');

-- Create periods every N months over the project duration (replaces none that exist).
create or replace function public.generate_reporting_periods(p_project uuid, p_months int, p_due_after_days int default 60)
returns int
language plpgsql as $$
declare p public.projects; i int := 0; s date; e date;
begin
  select * into p from public.projects where id = p_project;
  if p.start_date is null or p.end_date is null then raise exception 'Set the project start and end dates first'; end if;
  if p_months < 1 or p_months > 60 then raise exception 'Period length must be between 1 and 60 months'; end if;
  s := p.start_date;
  while s <= p.end_date loop
    i := i + 1;
    e := least(((s + make_interval(months => p_months)) - interval '1 day')::date, p.end_date);
    insert into public.reporting_periods (project_id, code, name, start_date, end_date, due_date)
    values (p_project, 'RP' || i,
            'M' || public.project_month_of(p.start_date, s) || '–M' || public.project_month_of(p.start_date, e),
            s, e, e + p_due_after_days)
    on conflict (project_id, code) do nothing;
    s := e + 1;
  end loop;
  return i;
end $$;

-- ---------------------------------------------------------------------------
-- Work packages
-- ---------------------------------------------------------------------------
create table public.work_packages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  code text not null,
  name text not null,
  description text not null default '',
  objectives text not null default '',
  lead_org_id uuid references public.organizations (id) on delete set null,
  start_date date,
  end_date date,
  status text not null default 'not_started' check (status in ('not_started','in_progress','completed','on_hold','cancelled')),
  progress_mode text not null default 'tasks' check (progress_mode in ('tasks','manual')),
  manual_progress numeric(5,2) check (manual_progress is null or manual_progress between 0 and 100),
  color text not null default 'teal',
  position text collate "C" not null default 'a0',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1,
  constraint work_packages_dates check (end_date is null or start_date is null or end_date >= start_date),
  constraint work_packages_code_len check (char_length(trim(code)) between 1 and 20),
  unique (project_id, code)
);
create trigger work_packages_version before update on public.work_packages for each row execute function public.bump_version();
select public.apply_project_rls('work_packages');
create trigger work_packages_activity after insert or update or delete on public.work_packages
  for each row execute function public.simple_activity('work package');

create table public.wp_members (
  work_package_id uuid not null references public.work_packages (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  role text not null default 'responsible' check (role in ('lead','responsible','contributor')),
  primary key (work_package_id, user_id)
);
create or replace function public.wp_child_set_project() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select project_id into new.project_id from public.work_packages where id = new.work_package_id;
  if new.project_id is null then raise exception 'Work package not found'; end if;
  return new;
end $$;
create trigger wp_members_set_project before insert on public.wp_members for each row execute function public.wp_child_set_project();
create trigger wp_members_check_user after insert on public.wp_members for each row execute function public.check_user_in_project();
select public.apply_project_rls('wp_members');

create table public.wp_dependencies (
  predecessor_id uuid not null references public.work_packages (id) on delete cascade,
  successor_id uuid not null references public.work_packages (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  primary key (predecessor_id, successor_id),
  constraint wp_dependencies_distinct check (predecessor_id <> successor_id)
);
create or replace function public.wp_dependencies_check() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select project_id into new.project_id from public.work_packages where id = new.predecessor_id;
  if not exists (select 1 from public.work_packages where id = new.successor_id and project_id = new.project_id) then
    raise exception 'Work packages must belong to the same project';
  end if;
  if exists (
    with recursive chain(id) as (
      select successor_id from public.wp_dependencies where predecessor_id = new.successor_id
      union select d.successor_id from public.wp_dependencies d join chain c on d.predecessor_id = c.id
    ) select 1 from chain where id = new.predecessor_id) then
    raise exception 'This dependency would create a cycle';
  end if;
  return new;
end $$;
create trigger wp_dependencies_check before insert on public.wp_dependencies for each row execute function public.wp_dependencies_check();
select public.apply_project_rls('wp_dependencies');

-- Cards → work packages (same project only)
alter table public.cards add constraint cards_wp_fk foreign key (work_package_id) references public.work_packages (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Milestones and deliverables
-- ---------------------------------------------------------------------------
create table public.milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  work_package_id uuid references public.work_packages (id) on delete set null,
  code text not null default '',
  title text not null,
  description text not null default '',
  kind text not null default 'milestone' check (kind in ('milestone','deliverable','report','event','control')),
  due_date date,
  actual_date date,
  status text not null default 'planned' check (status in ('planned','on_track','at_risk','delayed','done','cancelled')),
  approval_status text not null default 'not_required'
    check (approval_status in ('not_required','not_submitted','submitted','approved','rejected')),
  verification text not null default '',
  evidence_required boolean not null default false,
  responsible_org_id uuid references public.organizations (id) on delete set null,
  owner_id uuid references auth.users (id) on delete set null,
  dissemination text not null default '',
  notes text not null default '',
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  position text collate "C" not null default 'a0',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1,
  constraint milestones_title_len check (char_length(trim(title)) between 1 and 300)
);
create index milestones_project_idx on public.milestones (project_id, due_date);
create trigger milestones_version before update on public.milestones for each row execute function public.bump_version();
select public.apply_project_rls('milestones');

create or replace function public.milestones_prepare() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.work_package_id is not null and not exists (
      select 1 from public.work_packages where id = new.work_package_id and project_id = new.project_id) then
    raise exception 'Work package belongs to another project';
  end if;
  if new.status = 'done' and new.actual_date is null then new.actual_date := current_date; end if;
  if tg_op = 'UPDATE' and new.approval_status is distinct from old.approval_status then
    if new.approval_status in ('approved','rejected') then
      if not public.can_manage_project(new.project_id) and auth.uid() is not null then
        raise exception 'Only project managers can approve or reject';
      end if;
      new.approved_by := auth.uid();
      new.approved_at := now();
    end if;
  end if;
  return new;
end $$;
create trigger milestones_prepare before insert or update on public.milestones for each row execute function public.milestones_prepare();

create or replace function public.milestones_history() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_changes jsonb := '{}'::jsonb; v_text text := '';
begin
  if tg_op = 'INSERT' then
    perform public.log_activity(new.project_id, null, null, 'created', 'milestone', new.id,
      'created ' || new.kind || ' ' || coalesce(nullif(new.code, '') || ' ', '') || '“' || new.title || '”');
    return null;
  end if;
  if new.status is distinct from old.status then
    v_changes := v_changes || jsonb_build_object('status', jsonb_build_array(old.status, new.status));
    v_text := v_text || ' status ' || replace(old.status, '_', ' ') || ' → ' || replace(new.status, '_', ' ') || ';';
  end if;
  if new.due_date is distinct from old.due_date then
    v_changes := v_changes || jsonb_build_object('due_date', jsonb_build_array(old.due_date, new.due_date));
    v_text := v_text || ' due ' || coalesce(to_char(old.due_date, 'DD Mon YYYY'), 'none') || ' → ' || coalesce(to_char(new.due_date, 'DD Mon YYYY'), 'none') || ';';
  end if;
  if new.actual_date is distinct from old.actual_date then
    v_changes := v_changes || jsonb_build_object('actual_date', jsonb_build_array(old.actual_date, new.actual_date));
    v_text := v_text || ' completed ' || coalesce(to_char(new.actual_date, 'DD Mon YYYY'), 'cleared') || ';';
  end if;
  if new.approval_status is distinct from old.approval_status then
    v_changes := v_changes || jsonb_build_object('approval', jsonb_build_array(old.approval_status, new.approval_status));
    v_text := v_text || ' approval ' || replace(new.approval_status, '_', ' ') || ';';
  end if;
  if new.deleted_at is distinct from old.deleted_at then
    v_text := v_text || case when new.deleted_at is null then ' restored;' else ' moved to trash;' end;
  end if;
  if v_text <> '' then
    perform public.log_activity(new.project_id, null, null, 'updated', 'milestone', new.id,
      'updated ' || coalesce(nullif(new.code, '') || ' ', '') || '“' || new.title || '”:' || rtrim(v_text, ';'), v_changes);
  end if;
  return null;
end $$;
create trigger milestones_history after insert or update on public.milestones for each row execute function public.milestones_history();

create table public.milestone_dependencies (
  predecessor_id uuid not null references public.milestones (id) on delete cascade,
  successor_id uuid not null references public.milestones (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  primary key (predecessor_id, successor_id),
  constraint milestone_dependencies_distinct check (predecessor_id <> successor_id)
);
create or replace function public.milestone_dependencies_check() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select project_id into new.project_id from public.milestones where id = new.predecessor_id;
  if not exists (select 1 from public.milestones where id = new.successor_id and project_id = new.project_id) then
    raise exception 'Milestones must belong to the same project';
  end if;
  if exists (
    with recursive chain(id) as (
      select successor_id from public.milestone_dependencies where predecessor_id = new.successor_id
      union select d.successor_id from public.milestone_dependencies d join chain c on d.predecessor_id = c.id
    ) select 1 from chain where id = new.predecessor_id) then
    raise exception 'This dependency would create a cycle';
  end if;
  return new;
end $$;
create trigger milestone_dependencies_check before insert on public.milestone_dependencies for each row execute function public.milestone_dependencies_check();
select public.apply_project_rls('milestone_dependencies');

alter table public.cards add constraint cards_milestone_fk foreign key (milestone_id) references public.milestones (id) on delete set null;

create or replace function public.cards_links_check() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.work_package_id is not null and not exists (select 1 from public.work_packages where id = new.work_package_id and project_id = new.project_id) then
    raise exception 'Work package belongs to another project';
  end if;
  if new.milestone_id is not null and not exists (select 1 from public.milestones where id = new.milestone_id and project_id = new.project_id) then
    raise exception 'Milestone belongs to another project';
  end if;
  return new;
end $$;
create trigger cards_links_check before insert or update of work_package_id, milestone_id, project_id on public.cards
  for each row execute function public.cards_links_check();

-- ---------------------------------------------------------------------------
-- Evidence (documentary proof for milestones, KPIs, expenses, reports…)
-- ---------------------------------------------------------------------------
create table public.evidence_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  entity_type text not null check (entity_type in ('milestone','kpi','expense','work_package','reporting_period','meeting','risk')),
  entity_id uuid not null,
  title text not null,
  required boolean not null default true,
  status text not null default 'missing' check (status in ('missing','submitted','verified','rejected')),
  attachment_id uuid references public.attachments (id) on delete set null,
  url text check (url is null or url ~* '^https?://'),
  due_date date,
  note text not null default '',
  is_finance boolean not null default false,
  submitted_by uuid references auth.users (id) on delete set null,
  submitted_at timestamptz,
  verified_by uuid references auth.users (id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index evidence_entity_idx on public.evidence_items (entity_type, entity_id);
create index evidence_project_idx on public.evidence_items (project_id, status);

create or replace function public.evidence_prepare() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.entity_type = 'expense' then new.is_finance := true; end if;
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    if new.status = 'submitted' then new.submitted_by := auth.uid(); new.submitted_at := now(); end if;
    if new.status in ('verified','rejected') then
      if auth.uid() is not null and not public.can_manage_project(new.project_id)
         and not (new.is_finance and public.can_edit_finance(new.project_id)) then
        raise exception 'Only project managers can verify evidence';
      end if;
      new.verified_by := auth.uid(); new.verified_at := now();
    end if;
  end if;
  -- attaching something marks missing evidence as submitted
  if (new.attachment_id is not null or new.url is not null) and new.status = 'missing' then
    new.status := 'submitted'; new.submitted_by := auth.uid(); new.submitted_at := now();
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger evidence_prepare before insert or update on public.evidence_items for each row execute function public.evidence_prepare();

alter table public.evidence_items enable row level security;
create policy evidence_select on public.evidence_items for select to authenticated
  using (public.can_read_project(project_id) and (not is_finance or public.can_read_finance(project_id)));
create policy evidence_insert on public.evidence_items for insert to authenticated
  with check (public.can_edit_project(project_id) and (not is_finance or public.can_edit_finance(project_id)));
create policy evidence_update on public.evidence_items for update to authenticated
  using (public.can_edit_project(project_id) and (not is_finance or public.can_edit_finance(project_id)))
  with check (public.can_edit_project(project_id) and (not is_finance or public.can_edit_finance(project_id)));
create policy evidence_delete on public.evidence_items for delete to authenticated
  using (public.can_manage_project(project_id) or (is_finance and public.can_edit_finance(project_id)));
create trigger evidence_items_change after insert or update or delete on public.evidence_items for each row execute function public.emit_change();
create trigger evidence_items_activity after insert or update on public.evidence_items
  for each row execute function public.simple_activity('evidence');

-- ---------------------------------------------------------------------------
-- Risks and issues
-- ---------------------------------------------------------------------------
create table public.risks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  work_package_id uuid references public.work_packages (id) on delete set null,
  kind text not null default 'risk' check (kind in ('risk','issue')),
  code text not null default '',
  title text not null,
  description text not null default '',
  category text not null default '',
  probability smallint not null default 3 check (probability between 1 and 5),
  impact smallint not null default 3 check (impact between 1 and 5),
  score smallint generated always as (probability * impact) stored,
  mitigation text not null default '',
  contingency text not null default '',
  owner_id uuid references auth.users (id) on delete set null,
  status text not null default 'open' check (status in ('open','monitoring','mitigated','occurred','closed')),
  review_date date,
  raised_on date not null default current_date,
  resolved_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1,
  constraint risks_title_len check (char_length(trim(title)) between 1 and 300)
);
create index risks_project_idx on public.risks (project_id);
create trigger risks_version before update on public.risks for each row execute function public.bump_version();
select public.apply_project_rls('risks');
create trigger risks_activity after insert or update on public.risks for each row execute function public.simple_activity('risk');

-- ---------------------------------------------------------------------------
-- Meetings, decisions and action items
-- ---------------------------------------------------------------------------
create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text not null default '',
  online_url text check (online_url is null or online_url ~* '^https?://'),
  agenda text not null default '',
  minutes text not null default '',
  status text not null default 'planned' check (status in ('planned','held','cancelled')),
  attendees uuid[] not null default '{}',
  external_attendees text not null default '',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1,
  constraint meetings_title_len check (char_length(trim(title)) between 1 and 300),
  constraint meetings_times check (ends_at is null or ends_at >= starts_at)
);
create index meetings_project_idx on public.meetings (project_id, starts_at desc);
create trigger meetings_version before update on public.meetings for each row execute function public.bump_version();
select public.apply_project_rls('meetings');
create trigger meetings_activity after insert or update on public.meetings for each row execute function public.simple_activity('meeting');

create table public.meeting_decisions (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  text text not null check (char_length(trim(text)) between 1 and 4000),
  position text collate "C" not null default 'a0',
  created_at timestamptz not null default now()
);
create table public.meeting_actions (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 500),
  owner_id uuid references auth.users (id) on delete set null,
  due_date date,
  status text not null default 'open' check (status in ('open','done')),
  card_id uuid references public.cards (id) on delete set null,
  position text collate "C" not null default 'a0',
  created_at timestamptz not null default now()
);
create or replace function public.meeting_child_set_project() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select project_id into new.project_id from public.meetings where id = new.meeting_id;
  if new.project_id is null then raise exception 'Meeting not found'; end if;
  return new;
end $$;
create trigger meeting_decisions_set_project before insert on public.meeting_decisions for each row execute function public.meeting_child_set_project();
create trigger meeting_actions_set_project before insert on public.meeting_actions for each row execute function public.meeting_child_set_project();
select public.apply_project_rls('meeting_decisions');
select public.apply_project_rls('meeting_actions');

-- Keep an action item and its task in step
create or replace function public.cards_sync_meeting_action() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    update public.meeting_actions set status = case when new.status = 'done' then 'done' else 'open' end
     where card_id = new.id;
  end if;
  return null;
end $$;
create trigger cards_sync_meeting_action after update of status on public.cards
  for each row execute function public.cards_sync_meeting_action();

-- Turn an action item into an ordinary task (SECURITY INVOKER — RLS applies)
create or replace function public.action_to_card(p_action uuid, p_list uuid) returns uuid
language plpgsql as $$
declare a public.meeting_actions; m public.meetings; v_card uuid; v_board uuid; v_project uuid; v_pos text;
begin
  select * into a from public.meeting_actions where id = p_action;
  if not found then raise exception 'Action not found'; end if;
  if a.card_id is not null then return a.card_id; end if;
  select * into m from public.meetings where id = a.meeting_id;
  select board_id, project_id into v_board, v_project from public.lists where id = p_list;
  if v_project is distinct from a.project_id then raise exception 'Choose a list in the same project'; end if;
  select coalesce(max(position) || 'V', 'a0') into v_pos from public.cards where list_id = p_list;
  insert into public.cards (board_id, list_id, project_id, title, description, position, due_date)
  values (v_board, p_list, v_project, a.title,
          'Action from meeting “' || m.title || '” on ' || to_char(m.starts_at, 'DD Mon YYYY') || '.', v_pos, a.due_date)
  returning id into v_card;
  if a.owner_id is not null then
    insert into public.card_assignees (card_id, user_id, project_id) values (v_card, a.owner_id, v_project);
  end if;
  update public.meeting_actions set card_id = v_card where id = p_action;
  return v_card;
end $$;

-- ---------------------------------------------------------------------------
-- Progress (SECURITY INVOKER: computed from rows the caller may read)
-- ---------------------------------------------------------------------------
create or replace function public.work_package_progress(p_project uuid)
returns table (work_package_id uuid, tasks_total int, tasks_done int, tasks_overdue int,
               actual_progress numeric, planned_progress numeric, estimate_minutes bigint, logged_minutes bigint,
               milestones_total int, milestones_done int)
language sql stable as $$
  select wp.id,
    count(c.id)::int,
    count(c.id) filter (where c.status = 'done')::int,
    count(c.id) filter (where c.status <> 'done' and c.due_date < current_date)::int,
    case when wp.progress_mode = 'manual' then coalesce(wp.manual_progress, 0)
         when count(c.id) = 0 then 0
         else round(100.0 * count(c.id) filter (where c.status = 'done') / count(c.id), 1) end,
    case when wp.start_date is null or wp.end_date is null then null
         when current_date <= wp.start_date then 0
         when current_date >= wp.end_date then 100
         else round(100.0 * (current_date - wp.start_date) / greatest(1, wp.end_date - wp.start_date), 1) end,
    coalesce(sum(c.estimate_minutes), 0)::bigint,
    coalesce((select sum(t.minutes) from public.time_entries t join public.cards c2 on c2.id = t.card_id
              where c2.work_package_id = wp.id), 0)::bigint,
    (select count(*) from public.milestones m where m.work_package_id = wp.id and m.deleted_at is null)::int,
    (select count(*) from public.milestones m where m.work_package_id = wp.id and m.deleted_at is null and m.status = 'done')::int
  from public.work_packages wp
  left join public.cards c on c.work_package_id = wp.id and c.deleted_at is null and c.archived_at is null and c.is_template = false
  where wp.project_id = p_project and wp.deleted_at is null
  group by wp.id
$$;

-- Project health summary for dashboards and reports
create or replace function public.project_summary(p_project uuid)
returns table (tasks_total int, tasks_done int, tasks_overdue int, tasks_blocked int, tasks_unassigned int,
               milestones_total int, milestones_done int, milestones_overdue int, milestones_at_risk int,
               evidence_missing int, risks_open int, risks_high int, issues_open int)
language sql stable as $$
  select
    (select count(*) from public.cards where project_id = p_project and deleted_at is null and archived_at is null and is_template = false)::int,
    (select count(*) from public.cards where project_id = p_project and deleted_at is null and archived_at is null and is_template = false and status = 'done')::int,
    (select count(*) from public.cards where project_id = p_project and deleted_at is null and archived_at is null and is_template = false and status <> 'done' and due_date < current_date)::int,
    (select count(*) from public.cards where project_id = p_project and deleted_at is null and archived_at is null and is_template = false and status = 'blocked')::int,
    (select count(*) from public.cards c where c.project_id = p_project and c.deleted_at is null and c.archived_at is null and c.is_template = false and c.status <> 'done'
       and not exists (select 1 from public.card_assignees a where a.card_id = c.id))::int,
    (select count(*) from public.milestones where project_id = p_project and deleted_at is null)::int,
    (select count(*) from public.milestones where project_id = p_project and deleted_at is null and status = 'done')::int,
    (select count(*) from public.milestones where project_id = p_project and deleted_at is null and status not in ('done','cancelled') and due_date < current_date)::int,
    (select count(*) from public.milestones where project_id = p_project and deleted_at is null and status in ('at_risk','delayed'))::int,
    (select count(*) from public.evidence_items where project_id = p_project and required and status in ('missing','rejected'))::int,
    (select count(*) from public.risks where project_id = p_project and deleted_at is null and kind = 'risk' and status not in ('closed','mitigated'))::int,
    (select count(*) from public.risks where project_id = p_project and deleted_at is null and kind = 'risk' and status not in ('closed','mitigated') and score >= 15)::int,
    (select count(*) from public.risks where project_id = p_project and deleted_at is null and kind = 'issue' and status <> 'closed')::int
$$;

-- Workload: open work per person within a window, across projects the caller can see
create or replace function public.workload(p_workspace uuid, p_from date, p_to date)
returns table (user_id uuid, project_id uuid, open_tasks int, due_in_window int, overdue int,
               estimate_minutes bigint, logged_minutes bigint)
language sql stable as $$
  with base as (
    select a.user_id, c.project_id, c.id, c.status, c.due_date, c.estimate_minutes
    from public.card_assignees a
    join public.cards c on c.id = a.card_id
    join public.projects p on p.id = c.project_id
    where p.workspace_id = p_workspace and p.deleted_at is null and p.archived_at is null and p.personal_owner is null
      and c.deleted_at is null and c.archived_at is null and c.is_template = false
  )
  select b.user_id, b.project_id,
    count(*) filter (where b.status <> 'done')::int,
    count(*) filter (where b.status <> 'done' and b.due_date between p_from and p_to)::int,
    count(*) filter (where b.status <> 'done' and b.due_date < current_date)::int,
    coalesce(sum(b.estimate_minutes) filter (where b.status <> 'done' and (b.due_date is null or b.due_date <= p_to)), 0)::bigint,
    coalesce((select sum(t.minutes) from public.time_entries t where t.user_id = b.user_id and t.project_id = b.project_id
              and t.entry_date between p_from and p_to), 0)::bigint
  from base b
  group by b.user_id, b.project_id
$$;

-- ---------------------------------------------------------------------------
-- Saved project templates (blueprints) per workspace
-- ---------------------------------------------------------------------------
create table public.project_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 200),
  category text not null default 'Saved',
  description text not null default '',
  blueprint jsonb not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.project_templates enable row level security;
create policy project_templates_select on public.project_templates for select to authenticated using (public.is_ws_member(workspace_id));
create policy project_templates_insert on public.project_templates for insert to authenticated
  with check (coalesce(public.ws_role(workspace_id), 'guest') <> 'guest');
create policy project_templates_delete on public.project_templates for delete to authenticated
  using (created_by = auth.uid() or public.is_ws_admin(workspace_id));
create or replace function public.project_templates_prepare() returns trigger
language plpgsql as $$ begin new.created_by := auth.uid(); return new; end $$;
create trigger project_templates_prepare before insert on public.project_templates
  for each row execute function public.project_templates_prepare();
