-- Tessera — Phase 1: collaborative core
-- Workspaces → Projects → Boards → Lists → Cards, membership, permissions,
-- comments, activity history, change feed for realtime synchronisation.
--
-- Conventions
--  * Every tenant table carries the ids needed for Row Level Security
--    (workspace_id and/or project_id). Triggers keep these denormalised ids
--    consistent so clients cannot smuggle rows into foreign projects.
--  * Ordering uses fractional-index keys stored as text with the "C" collation.
--  * Mutable rows carry a `version` integer used for optimistic concurrency.
--  * Soft deletion via archived_at / deleted_at keeps operations recoverable.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Utility functions
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function public.bump_version() returns trigger
language plpgsql as $$
begin
  new.version := coalesce(old.version, 0) + 1;
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text not null default '',
  avatar_color text not null default 'teal',
  timezone text not null default 'UTC',
  preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_name_len check (char_length(display_name) <= 120)
);

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Private per-user secrets (calendar feed token) readable only by the owner.
create table public.user_secrets (
  user_id uuid primary key references auth.users (id) on delete cascade,
  calendar_token uuid not null default gen_random_uuid() unique,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_name text;
  v_colors text[] := array['teal','terracotta','indigo','ochre','mauve','moss'];
begin
  v_name := coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
                     nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
                     split_part(coalesce(new.email, 'user'), '@', 1));
  insert into public.profiles (id, email, display_name, avatar_color)
  values (new.id, lower(new.email), left(v_name, 120),
          v_colors[1 + (abs(hashtext(new.id::text)) % 6)])
  on conflict (id) do nothing;
  insert into public.user_secrets (user_id) values (new.id) on conflict do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.current_user_email() returns text
language sql stable security definer set search_path = public as $$
  select lower(email) from auth.users where id = auth.uid()
$$;

-- ---------------------------------------------------------------------------
-- Workspaces and membership
-- ---------------------------------------------------------------------------

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  settings jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  version integer not null default 1,
  constraint workspaces_name_len check (char_length(trim(name)) between 1 and 120)
);

create trigger workspaces_version before update on public.workspaces
  for each row execute function public.bump_version();

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  short_name text not null default '',
  country text not null default '',
  kind text not null default 'other'
    check (kind in ('university','company','research','public','ngo','other')),
  website text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizations_name_len check (char_length(trim(name)) between 1 and 200)
);
create index organizations_ws_idx on public.organizations (workspace_id);
create trigger organizations_touch before update on public.organizations
  for each row execute function public.touch_updated_at();

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner','admin','member','guest')),
  organization_id uuid references public.organizations (id) on delete set null,
  joined_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_idx on public.workspace_members (user_id);

-- ---------------------------------------------------------------------------
-- Projects and project membership
-- ---------------------------------------------------------------------------

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  acronym text not null default '',
  description text not null default '',
  status text not null default 'active'
    check (status in ('planning','active','on_hold','completed','cancelled')),
  visibility text not null default 'workspace' check (visibility in ('workspace','private')),
  start_date date,
  end_date date,
  color text not null default 'teal'
    check (color in ('teal','terracotta','indigo','ochre','mauve','moss')),
  modules text[] not null default array['board','table','calendar','timeline','files','activity']::text[],
  objectives text not null default '',
  outcomes text not null default '',
  funding jsonb not null default '{}'::jsonb,
  currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  is_template boolean not null default false,
  template_category text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  deleted_at timestamptz,
  version integer not null default 1,
  constraint projects_name_len check (char_length(trim(name)) between 1 and 200),
  constraint projects_dates check (end_date is null or start_date is null or end_date >= start_date)
);
create index projects_ws_idx on public.projects (workspace_id);
create trigger projects_version before update on public.projects
  for each row execute function public.bump_version();

create table public.project_members (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member'
    check (role in ('manager','member','collaborator','viewer')),
  finance_access text not null default 'none' check (finance_access in ('none','view','edit')),
  organization_id uuid references public.organizations (id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index project_members_user_idx on public.project_members (user_id);

-- ---------------------------------------------------------------------------
-- Permission helpers (SECURITY DEFINER so policies do not recurse)
-- ---------------------------------------------------------------------------

create or replace function public.ws_role(p_workspace uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from public.workspace_members
  where workspace_id = p_workspace and user_id = auth.uid()
$$;

create or replace function public.is_ws_member(p_workspace uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.workspace_members
                 where workspace_id = p_workspace and user_id = auth.uid())
$$;

create or replace function public.is_ws_admin(p_workspace uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.workspace_members
                 where workspace_id = p_workspace and user_id = auth.uid()
                   and role in ('owner','admin'))
$$;

-- Effective project role:
--   explicit project membership wins;
--   workspace owners/admins manage every project in their workspace;
--   other non-guest workspace members may work in workspace-visible projects.
create or replace function public.project_role(p_project uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
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

create or replace function public.can_read_project(p_project uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.project_role(p_project) is not null
$$;

create or replace function public.can_edit_project(p_project uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.project_role(p_project) in ('manager','member','collaborator'), false)
$$;

create or replace function public.can_manage_project(p_project uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.project_role(p_project) = 'manager', false)
$$;

-- Financial data uses a narrower permission than tasks.
create or replace function public.finance_access(p_project uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when public.project_role(p_project) = 'manager' then 'edit'
    when public.project_role(p_project) is null then 'none'
    else coalesce((select pm.finance_access from public.project_members pm
                    where pm.project_id = p_project and pm.user_id = auth.uid()), 'none')
  end
$$;

create or replace function public.can_read_finance(p_project uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.finance_access(p_project) in ('view','edit')
$$;

create or replace function public.can_edit_finance(p_project uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.finance_access(p_project) = 'edit'
$$;

create or replace function public.shares_workspace(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_user = auth.uid() or exists (
    select 1 from public.workspace_members a
    join public.workspace_members b on a.workspace_id = b.workspace_id
    where a.user_id = auth.uid() and b.user_id = p_user)
$$;

-- ---------------------------------------------------------------------------
-- Boards, lists, labels, cards
-- ---------------------------------------------------------------------------

create table public.boards (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  description text not null default '',
  background text not null default 'plain',
  position text collate "C" not null default 'a0',
  settings jsonb not null default '{}'::jsonb,
  is_template boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  deleted_at timestamptz,
  version integer not null default 1,
  constraint boards_name_len check (char_length(trim(name)) between 1 and 200)
);
create index boards_project_idx on public.boards (project_id);
create trigger boards_version before update on public.boards
  for each row execute function public.bump_version();

create table public.lists (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null,
  position text collate "C" not null default 'a0',
  wip_limit integer check (wip_limit is null or wip_limit > 0),
  color text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  version integer not null default 1,
  constraint lists_name_len check (char_length(trim(name)) between 1 and 200)
);
create index lists_board_idx on public.lists (board_id, position);
create trigger lists_version before update on public.lists
  for each row execute function public.bump_version();

create table public.labels (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null default '',
  color text not null default 'teal'
    check (color in ('teal','terracotta','indigo','ochre','mauve','moss','grey')),
  created_at timestamptz not null default now()
);
create index labels_board_idx on public.labels (board_id);

create table public.cards (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards (id) on delete cascade,
  list_id uuid not null references public.lists (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  parent_id uuid references public.cards (id) on delete cascade,
  title text not null,
  description text not null default '',
  position text collate "C" not null default 'a0',
  status text not null default 'open' check (status in ('open','in_progress','blocked','done')),
  priority text not null default 'none' check (priority in ('none','low','medium','high','urgent')),
  start_date date,
  due_date date,
  due_time time,
  completed_at timestamptz,
  cover_color text,
  lat double precision check (lat is null or lat between -90 and 90),
  lng double precision check (lng is null or lng between -180 and 180),
  location_label text,
  estimate_minutes integer check (estimate_minutes is null or estimate_minutes >= 0),
  responsible_text text not null default '',
  schedule jsonb,
  is_template boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  deleted_at timestamptz,
  version integer not null default 1,
  search tsvector generated always as
    (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description, ''))) stored,
  constraint cards_title_len check (char_length(trim(title)) between 1 and 500),
  constraint cards_desc_len check (char_length(description) <= 100000),
  constraint cards_dates check (due_date is null or start_date is null or due_date >= start_date),
  constraint cards_not_own_parent check (parent_id is null or parent_id <> id)
);
create index cards_list_idx on public.cards (list_id, position);
create index cards_board_idx on public.cards (board_id);
create index cards_project_idx on public.cards (project_id);
create index cards_parent_idx on public.cards (parent_id);
create index cards_due_idx on public.cards (due_date) where due_date is not null and completed_at is null;
create index cards_search_idx on public.cards using gin (search);

create trigger cards_version before update on public.cards
  for each row execute function public.bump_version();

create table public.card_assignees (
  card_id uuid not null references public.cards (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (card_id, user_id)
);
create index card_assignees_user_idx on public.card_assignees (user_id);

create table public.card_labels (
  card_id uuid not null references public.cards (id) on delete cascade,
  label_id uuid not null references public.labels (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  primary key (card_id, label_id)
);

create table public.card_watchers (
  card_id uuid not null references public.cards (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  primary key (card_id, user_id)
);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.cards (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  author_id uuid references auth.users (id) on delete set null,
  body text not null,
  mentions uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  constraint comments_body_len check (char_length(trim(body)) between 1 and 20000)
);
create index comments_card_idx on public.comments (card_id, created_at);
create trigger comments_touch before update on public.comments
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Denormalised-id integrity: derive project/workspace ids from parents
-- ---------------------------------------------------------------------------

create or replace function public.boards_set_ids() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select workspace_id into new.workspace_id from public.projects where id = new.project_id;
  if new.workspace_id is null then raise exception 'Project not found'; end if;
  return new;
end $$;
create trigger boards_set_ids before insert or update of project_id on public.boards
  for each row execute function public.boards_set_ids();

create or replace function public.lists_set_ids() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select project_id into new.project_id from public.boards where id = new.board_id;
  if new.project_id is null then raise exception 'Board not found'; end if;
  return new;
end $$;
create trigger lists_set_ids before insert or update of board_id on public.lists
  for each row execute function public.lists_set_ids();

create trigger labels_set_ids before insert or update of board_id on public.labels
  for each row execute function public.lists_set_ids();

create or replace function public.cards_set_ids() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_board uuid;
begin
  select board_id into v_board from public.lists where id = new.list_id;
  if v_board is null then raise exception 'List not found'; end if;
  new.board_id := v_board;
  select project_id into new.project_id from public.boards where id = v_board;
  if new.parent_id is not null and not exists (
      select 1 from public.cards where id = new.parent_id and project_id = new.project_id) then
    raise exception 'Parent card must belong to the same project';
  end if;
  -- keep completion timestamp in step with status
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    if new.status = 'done' and new.completed_at is null then new.completed_at := now(); end if;
    if new.status <> 'done' then new.completed_at := null; end if;
  end if;
  return new;
end $$;
create trigger cards_set_ids before insert or update of list_id, status, parent_id on public.cards
  for each row execute function public.cards_set_ids();

-- Junction tables: take project_id from the card, and verify the other side
create or replace function public.card_child_set_project() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select project_id into new.project_id from public.cards where id = new.card_id;
  if new.project_id is null then raise exception 'Card not found'; end if;
  return new;
end $$;

create trigger card_assignees_set_project before insert on public.card_assignees
  for each row execute function public.card_child_set_project();
create trigger card_watchers_set_project before insert on public.card_watchers
  for each row execute function public.card_child_set_project();
create trigger card_labels_set_project before insert on public.card_labels
  for each row execute function public.card_child_set_project();
create trigger comments_set_project before insert on public.comments
  for each row execute function public.card_child_set_project();

create or replace function public.card_labels_check() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.labels l join public.cards c on c.board_id = l.board_id
                 where l.id = new.label_id and c.id = new.card_id) then
    raise exception 'Label does not belong to the card''s board';
  end if;
  return new;
end $$;
create trigger card_labels_check before insert on public.card_labels
  for each row execute function public.card_labels_check();

-- Assignees / watchers must be able to see the project
create or replace function public.check_user_in_project() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_ok boolean;
begin
  select exists (
    select 1 from public.project_members pm where pm.project_id = new.project_id and pm.user_id = new.user_id
    union all
    select 1 from public.projects p join public.workspace_members wm
      on wm.workspace_id = p.workspace_id and wm.user_id = new.user_id
     where p.id = new.project_id and (wm.role in ('owner','admin') or (wm.role = 'member' and p.visibility = 'workspace'))
  ) into v_ok;
  if not v_ok then raise exception 'User is not a member of this project'; end if;
  return new;
end $$;
create trigger card_assignees_check_user after insert on public.card_assignees
  for each row execute function public.check_user_in_project();
create trigger card_watchers_check_user after insert on public.card_watchers
  for each row execute function public.check_user_in_project();

-- Comments: author is always the caller; mentions limited to project members
create or replace function public.comments_prepare() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.author_id := auth.uid();
  else
    new.author_id := old.author_id;
    if new.body is distinct from old.body then new.edited_at := now(); end if;
  end if;
  return new;
end $$;
create trigger comments_prepare before insert or update on public.comments
  for each row execute function public.comments_prepare();

create or replace function public.cards_prepare() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then new.created_by := coalesce(auth.uid(), new.created_by); end if;
  return new;
end $$;
create trigger cards_prepare before insert on public.cards
  for each row execute function public.cards_prepare();

-- ---------------------------------------------------------------------------
-- Activity log (audit trail) and change feed (realtime sync)
-- ---------------------------------------------------------------------------

create table public.activity_log (
  id bigint generated always as identity primary key,
  workspace_id uuid references public.workspaces (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
  board_id uuid,
  card_id uuid,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  summary text not null default '',
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index activity_project_idx on public.activity_log (project_id, created_at desc);
create index activity_card_idx on public.activity_log (card_id, created_at desc);
create index activity_ws_idx on public.activity_log (workspace_id, created_at desc);

create table public.change_feed (
  id bigint generated always as identity primary key,
  project_id uuid not null,
  board_id uuid,
  entity text not null,
  entity_id uuid,
  op text not null,
  actor_id uuid,
  created_at timestamptz not null default now()
);
create index change_feed_created_idx on public.change_feed (created_at);

create or replace function public.emit_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_project uuid;
  v_board uuid;
  v_id uuid;
  j jsonb;
begin
  if tg_op = 'DELETE' then j := to_jsonb(old); else j := to_jsonb(new); end if;
  v_project := (j ->> 'project_id')::uuid;
  v_board := case when tg_table_name = 'boards' then (j ->> 'id')::uuid
                  else nullif(j ->> 'board_id', '')::uuid end;
  if v_board is null and j ? 'card_id' then
    select board_id into v_board from public.cards where id = (j ->> 'card_id')::uuid;
  end if;
  if tg_table_name = 'projects' then v_project := (j ->> 'id')::uuid; end if;
  v_id := coalesce(nullif(j ->> 'id', ''), nullif(j ->> 'card_id', ''))::uuid;
  if v_project is null then return null; end if;
  -- Skip if the project itself is being deleted in the same statement
  if not exists (select 1 from public.projects where id = v_project) then return null; end if;
  insert into public.change_feed (project_id, board_id, entity, entity_id, op, actor_id)
  values (v_project, v_board, tg_table_name, v_id, lower(tg_op), auth.uid());
  return null;
end $$;

create or replace function public.log_activity(
  p_project uuid, p_board uuid, p_card uuid, p_action text, p_entity_type text,
  p_entity_id uuid, p_summary text, p_data jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = public as $$
declare v_ws uuid;
begin
  select workspace_id into v_ws from public.projects where id = p_project;
  if v_ws is null then return; end if;
  insert into public.activity_log
    (workspace_id, project_id, board_id, card_id, actor_id, action, entity_type, entity_id, summary, data)
  values (v_ws, p_project, p_board, p_card, auth.uid(), p_action, p_entity_type, p_entity_id, p_summary, p_data);
end $$;
revoke execute on function public.log_activity(uuid, uuid, uuid, text, text, uuid, text, jsonb) from public, anon, authenticated;

create or replace function public.cards_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_from text; v_to text;
begin
  if tg_op = 'INSERT' then
    perform public.log_activity(new.project_id, new.board_id, new.id, 'created', 'card', new.id,
      'created card “' || new.title || '”');
    return null;
  end if;
  if tg_op = 'DELETE' then
    perform public.log_activity(old.project_id, old.board_id, null, 'deleted', 'card', old.id,
      'permanently deleted card “' || old.title || '”');
    return null;
  end if;
  if new.list_id is distinct from old.list_id then
    select name into v_from from public.lists where id = old.list_id;
    select name into v_to from public.lists where id = new.list_id;
    perform public.log_activity(new.project_id, new.board_id, new.id, 'moved', 'card', new.id,
      'moved “' || new.title || '” from ' || coalesce(v_from, '?') || ' to ' || coalesce(v_to, '?'),
      jsonb_build_object('from_list', old.list_id, 'to_list', new.list_id));
  end if;
  if new.title is distinct from old.title then
    perform public.log_activity(new.project_id, new.board_id, new.id, 'renamed', 'card', new.id,
      'renamed “' || old.title || '” to “' || new.title || '”');
  end if;
  if new.status is distinct from old.status then
    perform public.log_activity(new.project_id, new.board_id, new.id,
      case when new.status = 'done' then 'completed' else 'status' end, 'card', new.id,
      case when new.status = 'done' then 'completed “' || new.title || '”'
           else 'set status of “' || new.title || '” to ' || replace(new.status, '_', ' ') end,
      jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  if new.due_date is distinct from old.due_date then
    perform public.log_activity(new.project_id, new.board_id, new.id, 'due_changed', 'card', new.id,
      case when new.due_date is null then 'removed the due date of “' || new.title || '”'
           else 'set “' || new.title || '” due ' || to_char(new.due_date, 'DD Mon YYYY') end,
      jsonb_build_object('from', old.due_date, 'to', new.due_date));
  end if;
  if new.archived_at is distinct from old.archived_at then
    perform public.log_activity(new.project_id, new.board_id, new.id,
      case when new.archived_at is null then 'restored' else 'archived' end, 'card', new.id,
      case when new.archived_at is null then 'restored “' else 'archived “' end || new.title || '”');
  end if;
  if new.deleted_at is distinct from old.deleted_at then
    perform public.log_activity(new.project_id, new.board_id, new.id,
      case when new.deleted_at is null then 'restored' else 'trashed' end, 'card', new.id,
      case when new.deleted_at is null then 'restored “' else 'moved to trash “' end || new.title || '”');
  end if;
  if new.description is distinct from old.description then
    perform public.log_activity(new.project_id, new.board_id, new.id, 'edited', 'card', new.id,
      'edited the description of “' || new.title || '”');
  end if;
  return null;
end $$;
create trigger cards_activity after insert or update or delete on public.cards
  for each row execute function public.cards_activity();

create or replace function public.simple_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  j jsonb; o jsonb; v_project uuid; v_board uuid; v_card uuid; v_name text; v_summary text;
  v_entity text := tg_argv[0];
begin
  if tg_op = 'DELETE' then j := to_jsonb(old); else j := to_jsonb(new); end if;
  if tg_op = 'UPDATE' then o := to_jsonb(old); end if;
  v_project := coalesce((j ->> 'project_id')::uuid, case when tg_table_name = 'projects' then (j ->> 'id')::uuid end);
  if tg_table_name = 'boards' then v_board := (j ->> 'id')::uuid; else v_board := nullif(j ->> 'board_id', '')::uuid; end if;
  v_card := nullif(j ->> 'card_id', '')::uuid;
  v_name := coalesce(j ->> 'name', j ->> 'title', '');
  if v_card is not null then
    select board_id, title into v_board, v_name from public.cards where id = v_card;
  end if;
  if tg_op = 'INSERT' then
    v_summary := case v_entity
      when 'comment' then 'commented on “' || coalesce(v_name, '') || '”'
      when 'assignee' then 'assigned someone to “' || coalesce(v_name, '') || '”'
      else 'created ' || v_entity || ' “' || v_name || '”' end;
  elsif tg_op = 'DELETE' then
    v_summary := case v_entity
      when 'assignee' then 'unassigned someone from “' || coalesce(v_name, '') || '”'
      when 'comment' then 'deleted a comment on “' || coalesce(v_name, '') || '”'
      else 'deleted ' || v_entity || ' “' || v_name || '”' end;
  else
    if (o ->> 'archived_at') is distinct from (j ->> 'archived_at') then
      v_summary := case when j ->> 'archived_at' is null then 'restored ' else 'archived ' end || v_entity || ' “' || v_name || '”';
    elsif (o ->> 'deleted_at') is distinct from (j ->> 'deleted_at') then
      v_summary := case when j ->> 'deleted_at' is null then 'restored ' else 'moved to trash ' end || v_entity || ' “' || v_name || '”';
    elsif coalesce(o ->> 'name', o ->> 'title') is distinct from coalesce(j ->> 'name', j ->> 'title') then
      v_summary := 'renamed ' || v_entity || ' “' || coalesce(o ->> 'name', o ->> 'title') || '” to “' || v_name || '”';
    elsif v_entity = 'comment' then
      v_summary := 'edited a comment on “' || coalesce(v_name, '') || '”';
    else
      return null; -- position-only and similar noise is not logged
    end if;
  end if;
  if v_project is null then return null; end if;
  if not exists (select 1 from public.projects where id = v_project) then return null; end if;
  perform public.log_activity(v_project, v_board, v_card, lower(tg_op), v_entity,
    coalesce(nullif(j ->> 'id', ''), j ->> 'card_id')::uuid, v_summary);
  return null;
end $$;

create trigger boards_activity after insert or update or delete on public.boards
  for each row execute function public.simple_activity('board');
create trigger lists_activity after insert or update or delete on public.lists
  for each row execute function public.simple_activity('list');
create trigger comments_activity after insert or update on public.comments
  for each row execute function public.simple_activity('comment');
create trigger assignees_activity after insert or delete on public.card_assignees
  for each row execute function public.simple_activity('assignee');
create trigger projects_activity after insert or update on public.projects
  for each row execute function public.simple_activity('project');

-- change feed triggers
create trigger projects_change after update on public.projects for each row execute function public.emit_change();
create trigger boards_change after insert or update or delete on public.boards for each row execute function public.emit_change();
create trigger lists_change after insert or update or delete on public.lists for each row execute function public.emit_change();
create trigger labels_change after insert or update or delete on public.labels for each row execute function public.emit_change();
create trigger cards_change after insert or update or delete on public.cards for each row execute function public.emit_change();
create trigger card_assignees_change after insert or delete on public.card_assignees for each row execute function public.emit_change();
create trigger card_labels_change after insert or delete on public.card_labels for each row execute function public.emit_change();
create trigger card_watchers_change after insert or delete on public.card_watchers for each row execute function public.emit_change();
create trigger comments_change after insert or update or delete on public.comments for each row execute function public.emit_change();
create trigger project_members_change after insert or update or delete on public.project_members for each row execute function public.emit_change();

-- ---------------------------------------------------------------------------
-- Invitations
-- ---------------------------------------------------------------------------

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role text not null default 'member' check (role in ('admin','member','guest')),
  project_role text check (project_role in ('manager','member','collaborator','viewer')),
  finance_access text not null default 'none' check (finance_access in ('none','view','edit')),
  token uuid not null default gen_random_uuid() unique,
  invited_by uuid references auth.users (id) on delete set null,
  message text not null default '',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz
);
create index invitations_ws_idx on public.invitations (workspace_id);
create index invitations_email_idx on public.invitations (lower(email));

create or replace function public.invitations_prepare() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.email := lower(trim(new.email));
  if tg_op = 'INSERT' then new.invited_by := auth.uid(); end if;
  if new.project_id is not null and not exists (
       select 1 from public.projects where id = new.project_id and workspace_id = new.workspace_id) then
    raise exception 'Project does not belong to workspace';
  end if;
  if new.project_id is not null and new.project_role is null then new.project_role := 'member'; end if;
  -- only workspace admins may invite admins
  if new.role = 'admin' and not public.is_ws_admin(new.workspace_id) then
    raise exception 'Only workspace administrators can invite administrators';
  end if;
  return new;
end $$;
create trigger invitations_prepare before insert or update on public.invitations
  for each row execute function public.invitations_prepare();

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

create or replace function public.create_workspace(p_name text, p_description text default '')
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  insert into public.workspaces (name, description, created_by)
  values (trim(p_name), coalesce(p_description, ''), auth.uid()) returning id into v_id;
  insert into public.workspace_members (workspace_id, user_id, role) values (v_id, auth.uid(), 'owner');
  return v_id;
end $$;

create or replace function public.create_project(
  p_workspace uuid, p_name text, p_description text default '',
  p_visibility text default 'workspace', p_start date default null, p_end date default null,
  p_modules text[] default null, p_acronym text default ''
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_board uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if coalesce(public.ws_role(p_workspace), 'guest') = 'guest' then
    raise exception 'Not allowed to create projects in this workspace';
  end if;
  insert into public.projects (workspace_id, name, description, visibility, start_date, end_date,
                               modules, acronym, created_by)
  values (p_workspace, trim(p_name), coalesce(p_description, ''), coalesce(p_visibility, 'workspace'),
          p_start, p_end,
          coalesce(p_modules, array['board','table','calendar','timeline','files','activity']::text[]),
          coalesce(p_acronym, ''), auth.uid())
  returning id into v_id;
  insert into public.project_members (project_id, user_id, role, finance_access)
  values (v_id, auth.uid(), 'manager', 'edit');
  return v_id;
end $$;

-- Accept an invitation: the signed-in user's email must match.
create or replace function public.accept_invitation(p_token uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare inv public.invitations; v_email text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select * into inv from public.invitations where token = p_token for update;
  if not found then raise exception 'Invitation not found'; end if;
  if inv.revoked_at is not null then raise exception 'Invitation has been revoked'; end if;
  if inv.accepted_at is not null and inv.accepted_by is distinct from auth.uid() then
    raise exception 'Invitation already used';
  end if;
  if inv.expires_at < now() then raise exception 'Invitation has expired'; end if;
  v_email := public.current_user_email();
  if v_email is distinct from lower(inv.email) then
    raise exception 'This invitation was sent to a different email address';
  end if;
  insert into public.workspace_members (workspace_id, user_id, role)
  values (inv.workspace_id, auth.uid(), inv.role)
  on conflict (workspace_id, user_id) do nothing;
  if inv.project_id is not null then
    insert into public.project_members (project_id, user_id, role, finance_access)
    values (inv.project_id, auth.uid(), inv.project_role, inv.finance_access)
    on conflict (project_id, user_id) do update
      set role = excluded.role, finance_access = excluded.finance_access;
  end if;
  update public.invitations set accepted_at = now(), accepted_by = auth.uid() where id = inv.id;
  perform public.log_activity(coalesce(inv.project_id, null), null, null, 'joined', 'member', auth.uid(),
    'joined via invitation');
  return inv.workspace_id;
end $$;

-- Pending invitations for the signed-in user (by email)
create or replace function public.my_invitations()
returns table (id uuid, token uuid, workspace_id uuid, workspace_name text, project_id uuid,
               project_name text, role text, project_role text, invited_by_name text, created_at timestamptz,
               expires_at timestamptz)
language sql stable security definer set search_path = public as $$
  select i.id, i.token, i.workspace_id, w.name, i.project_id, p.name, i.role, i.project_role,
         pr.display_name, i.created_at, i.expires_at
  from public.invitations i
  join public.workspaces w on w.id = i.workspace_id
  left join public.projects p on p.id = i.project_id
  left join public.profiles pr on pr.id = i.invited_by
  where lower(i.email) = public.current_user_email()
    and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
$$;

-- Prevent removing/downgrading the last owner of a workspace
create or replace function public.protect_last_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.role = 'owner' and (tg_op = 'DELETE' or new.role <> 'owner') then
    if not exists (select 1 from public.workspace_members
                   where workspace_id = old.workspace_id and role = 'owner' and user_id <> old.user_id) then
      if exists (select 1 from public.workspaces where id = old.workspace_id) then
        raise exception 'A workspace must keep at least one owner';
      end if;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger workspace_members_protect_owner before update or delete on public.workspace_members
  for each row execute function public.protect_last_owner();

-- Only owners may grant/revoke the owner role
create or replace function public.guard_owner_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.role = 'owner' or (tg_op = 'UPDATE' and old.role = 'owner'))
     and coalesce(public.ws_role(new.workspace_id), '') <> 'owner'
     and auth.uid() is not null
     -- bootstrap: the creator of a brand-new workspace becomes its first owner
     and exists (select 1 from public.workspace_members where workspace_id = new.workspace_id) then
    raise exception 'Only owners can change ownership';
  end if;
  return new;
end $$;
create trigger workspace_members_guard_owner before insert or update on public.workspace_members
  for each row execute function public.guard_owner_role();

-- Project-level: keep at least one manager
create or replace function public.protect_last_manager() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.role = 'manager' and (tg_op = 'DELETE' or new.role <> 'manager') then
    if exists (select 1 from public.projects where id = old.project_id)
       and not exists (select 1 from public.project_members
                       where project_id = old.project_id and role = 'manager' and user_id <> old.user_id) then
      raise exception 'A project must keep at least one manager';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger project_members_protect_manager before update or delete on public.project_members
  for each row execute function public.protect_last_manager();

-- Project members must belong to the workspace
create or replace function public.project_members_check() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.projects p join public.workspace_members wm
                   on wm.workspace_id = p.workspace_id and wm.user_id = new.user_id
                 where p.id = new.project_id) then
    raise exception 'User must be a workspace member first';
  end if;
  return new;
end $$;
create trigger project_members_check before insert or update on public.project_members
  for each row execute function public.project_members_check();

-- Join a workspace-visible project (non-guest members)
create or replace function public.join_project(p_project uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.project_role(p_project) is null then raise exception 'Not allowed'; end if;
  insert into public.project_members (project_id, user_id, role)
  values (p_project, auth.uid(), 'member') on conflict do nothing;
end $$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.user_secrets enable row level security;
alter table public.workspaces enable row level security;
alter table public.organizations enable row level security;
alter table public.workspace_members enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.boards enable row level security;
alter table public.lists enable row level security;
alter table public.labels enable row level security;
alter table public.cards enable row level security;
alter table public.card_assignees enable row level security;
alter table public.card_labels enable row level security;
alter table public.card_watchers enable row level security;
alter table public.comments enable row level security;
alter table public.activity_log enable row level security;
alter table public.change_feed enable row level security;
alter table public.invitations enable row level security;

-- profiles
create policy profiles_select on public.profiles for select to authenticated
  using (public.shares_workspace(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy user_secrets_select on public.user_secrets for select to authenticated
  using (user_id = auth.uid());
create policy user_secrets_update on public.user_secrets for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- workspaces
create policy workspaces_select on public.workspaces for select to authenticated
  using (public.is_ws_member(id));
create policy workspaces_update on public.workspaces for update to authenticated
  using (public.is_ws_admin(id)) with check (public.is_ws_admin(id));
create policy workspaces_delete on public.workspaces for delete to authenticated
  using (public.ws_role(id) = 'owner');

-- organizations
create policy organizations_select on public.organizations for select to authenticated
  using (public.is_ws_member(workspace_id));
create policy organizations_write on public.organizations for insert to authenticated
  with check (coalesce(public.ws_role(workspace_id), 'guest') <> 'guest');
create policy organizations_update on public.organizations for update to authenticated
  using (coalesce(public.ws_role(workspace_id), 'guest') <> 'guest')
  with check (coalesce(public.ws_role(workspace_id), 'guest') <> 'guest');
create policy organizations_delete on public.organizations for delete to authenticated
  using (public.is_ws_admin(workspace_id));

-- workspace members
create policy wm_select on public.workspace_members for select to authenticated
  using (public.is_ws_member(workspace_id));
create policy wm_insert on public.workspace_members for insert to authenticated
  with check (public.is_ws_admin(workspace_id));
create policy wm_update on public.workspace_members for update to authenticated
  using (public.is_ws_admin(workspace_id)) with check (public.is_ws_admin(workspace_id));
create policy wm_delete on public.workspace_members for delete to authenticated
  using (public.is_ws_admin(workspace_id) or user_id = auth.uid());

-- projects
create policy projects_select on public.projects for select to authenticated
  using (public.can_read_project(id));
create policy projects_update on public.projects for update to authenticated
  using (public.can_manage_project(id)) with check (public.can_manage_project(id));
create policy projects_delete on public.projects for delete to authenticated
  using (public.is_ws_admin(workspace_id) or public.can_manage_project(id));

-- project members
create policy pm_select on public.project_members for select to authenticated
  using (public.can_read_project(project_id));
create policy pm_insert on public.project_members for insert to authenticated
  with check (public.can_manage_project(project_id));
create policy pm_update on public.project_members for update to authenticated
  using (public.can_manage_project(project_id)) with check (public.can_manage_project(project_id));
create policy pm_delete on public.project_members for delete to authenticated
  using (public.can_manage_project(project_id) or user_id = auth.uid());

-- boards
create policy boards_select on public.boards for select to authenticated
  using (public.can_read_project(project_id));
create policy boards_insert on public.boards for insert to authenticated
  with check (public.can_edit_project(project_id));
create policy boards_update on public.boards for update to authenticated
  using (public.can_edit_project(project_id)) with check (public.can_edit_project(project_id));
create policy boards_delete on public.boards for delete to authenticated
  using (public.can_manage_project(project_id));

-- generic project-scoped content: lists, labels, cards, junctions
create policy lists_select on public.lists for select to authenticated using (public.can_read_project(project_id));
create policy lists_insert on public.lists for insert to authenticated with check (public.can_edit_project(project_id));
create policy lists_update on public.lists for update to authenticated
  using (public.can_edit_project(project_id)) with check (public.can_edit_project(project_id));
create policy lists_delete on public.lists for delete to authenticated using (public.can_edit_project(project_id));

create policy labels_select on public.labels for select to authenticated using (public.can_read_project(project_id));
create policy labels_insert on public.labels for insert to authenticated with check (public.can_edit_project(project_id));
create policy labels_update on public.labels for update to authenticated
  using (public.can_edit_project(project_id)) with check (public.can_edit_project(project_id));
create policy labels_delete on public.labels for delete to authenticated using (public.can_edit_project(project_id));

create policy cards_select on public.cards for select to authenticated using (public.can_read_project(project_id));
create policy cards_insert on public.cards for insert to authenticated with check (public.can_edit_project(project_id));
create policy cards_update on public.cards for update to authenticated
  using (public.can_edit_project(project_id)) with check (public.can_edit_project(project_id));
create policy cards_delete on public.cards for delete to authenticated using (public.can_edit_project(project_id));

create policy ca_select on public.card_assignees for select to authenticated using (public.can_read_project(project_id));
create policy ca_insert on public.card_assignees for insert to authenticated with check (public.can_edit_project(project_id));
create policy ca_delete on public.card_assignees for delete to authenticated using (public.can_edit_project(project_id));

create policy cl_select on public.card_labels for select to authenticated using (public.can_read_project(project_id));
create policy cl_insert on public.card_labels for insert to authenticated with check (public.can_edit_project(project_id));
create policy cl_delete on public.card_labels for delete to authenticated using (public.can_edit_project(project_id));

-- Watching is personal; viewers may watch too.
create policy cw_select on public.card_watchers for select to authenticated using (public.can_read_project(project_id));
create policy cw_insert on public.card_watchers for insert to authenticated
  with check (public.can_read_project(project_id) and (user_id = auth.uid() or public.can_edit_project(project_id)));
create policy cw_delete on public.card_watchers for delete to authenticated
  using (user_id = auth.uid() or public.can_edit_project(project_id));

-- comments: collaborators and members can comment; viewers can read
create policy comments_select on public.comments for select to authenticated using (public.can_read_project(project_id));
create policy comments_insert on public.comments for insert to authenticated
  with check (public.can_edit_project(project_id));
create policy comments_update on public.comments for update to authenticated
  using (author_id = auth.uid() or public.can_manage_project(project_id))
  with check (public.can_read_project(project_id));
create policy comments_delete on public.comments for delete to authenticated
  using (author_id = auth.uid() or public.can_manage_project(project_id));

-- activity & change feed: read-only for clients
create policy activity_select on public.activity_log for select to authenticated
  using ((project_id is not null and public.can_read_project(project_id))
         or (project_id is null and public.is_ws_member(workspace_id)));
create policy change_feed_select on public.change_feed for select to authenticated
  using (public.can_read_project(project_id));

-- invitations
create policy invitations_select on public.invitations for select to authenticated
  using (public.is_ws_admin(workspace_id)
         or (project_id is not null and public.can_manage_project(project_id))
         or invited_by = auth.uid());
create policy invitations_insert on public.invitations for insert to authenticated
  with check (public.is_ws_admin(workspace_id)
              or (project_id is not null and public.can_manage_project(project_id) and role in ('member','guest')));
create policy invitations_update on public.invitations for update to authenticated
  using (public.is_ws_admin(workspace_id) or invited_by = auth.uid())
  with check (public.is_ws_admin(workspace_id) or invited_by = auth.uid());
create policy invitations_delete on public.invitations for delete to authenticated
  using (public.is_ws_admin(workspace_id) or invited_by = auth.uid());

-- Execute rights for RPCs
revoke execute on function public.create_workspace(text, text) from anon;
revoke execute on function public.create_project(uuid, text, text, text, date, date, text[], text) from anon;
revoke execute on function public.accept_invitation(uuid) from anon;

-- ---------------------------------------------------------------------------
-- Realtime publication
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.change_feed;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- People lookups (effective access, with profile data)
-- ---------------------------------------------------------------------------

create or replace function public.project_people(p_project uuid)
returns table (user_id uuid, display_name text, email text, avatar_color text,
               role text, finance_access text, organization_id uuid, explicit boolean)
language sql stable security definer set search_path = public as $$
  with p as (select id, workspace_id, visibility from public.projects where id = p_project),
  eff as (
    select wm.user_id,
      case when wm.role in ('owner','admin') then 'manager' else coalesce(pm.role, 'member') end as role,
      case when wm.role in ('owner','admin') or pm.role = 'manager' then 'edit'
           else coalesce(pm.finance_access, 'none') end as finance_access,
      coalesce(pm.organization_id, wm.organization_id) as organization_id,
      pm.user_id is not null as explicit
    from p
    join public.workspace_members wm on wm.workspace_id = p.workspace_id
    left join public.project_members pm on pm.project_id = p.id and pm.user_id = wm.user_id
    where pm.user_id is not null
       or wm.role in ('owner','admin')
       or (wm.role = 'member' and p.visibility = 'workspace')
  )
  select e.user_id, pr.display_name, pr.email, pr.avatar_color, e.role, e.finance_access,
         e.organization_id, e.explicit
  from eff e join public.profiles pr on pr.id = e.user_id
  where public.can_read_project(p_project)
  order by pr.display_name
$$;

create or replace function public.workspace_people(p_workspace uuid)
returns table (user_id uuid, display_name text, email text, avatar_color text, role text,
               organization_id uuid, joined_at timestamptz)
language sql stable security definer set search_path = public as $$
  select wm.user_id, pr.display_name, pr.email, pr.avatar_color, wm.role, wm.organization_id, wm.joined_at
  from public.workspace_members wm join public.profiles pr on pr.id = wm.user_id
  where wm.workspace_id = p_workspace and public.is_ws_member(p_workspace)
  order by pr.display_name
$$;
