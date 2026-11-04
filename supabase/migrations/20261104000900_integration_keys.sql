-- Personal access keys for outside tools (the Obsidian plugin).
--
-- A key acts as its owner: whatever the person may do in Tessera, the key may
-- do, and nothing more. Only a SHA-256 hash is stored; the key itself is shown
-- once, when it is created. The tool calls the obsidian_* functions below with
-- the key as an argument. Each function resolves the key to a person, then
-- runs with that person's identity, so every existing permission check and
-- activity record applies exactly as if they had used the app.

create table public.integration_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  token_hash text not null unique,
  hint text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  constraint integration_tokens_name_len check (char_length(trim(name)) between 1 and 80)
);
create index integration_tokens_user_idx on public.integration_tokens (user_id);

alter table public.integration_tokens enable row level security;
-- People can list and delete (= revoke) their own keys. Keys are created only
-- through create_integration_token, so the hash is never chosen by a client.
create policy it_select on public.integration_tokens for select to authenticated using (user_id = auth.uid());
create policy it_delete on public.integration_tokens for delete to authenticated using (user_id = auth.uid());
revoke insert, update on public.integration_tokens from anon, authenticated;
revoke all on public.integration_tokens from anon;

create or replace function public.create_integration_token(p_name text) returns text
language plpgsql security definer set search_path = public as $$
declare v_token text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if char_length(trim(coalesce(p_name, ''))) = 0 then raise exception 'Give the key a name'; end if;
  if (select count(*) from public.integration_tokens where user_id = auth.uid()) >= 10 then
    raise exception 'You can have at most 10 access keys. Delete one you no longer use.';
  end if;
  v_token := 'tsr_' || replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.integration_tokens (user_id, name, token_hash, hint)
  values (auth.uid(), left(trim(p_name), 80), encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), right(v_token, 4));
  return v_token;
end $$;
revoke execute on function public.create_integration_token(text) from public, anon;
grant execute on function public.create_integration_token(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Internal: resolve a key and act as its owner for the rest of the call
-- ---------------------------------------------------------------------------

create or replace function public.integration_auth(p_token text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_hash text; v_user uuid;
begin
  v_hash := encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
  select user_id into v_user from public.integration_tokens where token_hash = v_hash;
  if v_user is null then
    raise exception 'This access key is not valid. It may have been deleted in Tessera.' using errcode = '28000';
  end if;
  update public.integration_tokens set last_used_at = now()
   where token_hash = v_hash and (last_used_at is null or last_used_at < now() - interval '1 minute');
  -- Local to this transaction: auth.uid() now answers with the key's owner.
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_user::text, true);
  return v_user;
end $$;
revoke execute on function public.integration_auth(text) from public, anon, authenticated;

-- Keys for positions: strings that sort after `p_last`, in the same format the
-- app uses (fractional-indexing: a lowercase head letter gives the length of
-- the integer part, then base-62 digits). Used to append tasks to a list.
create or replace function public.append_keys(p_last text, p_count int) returns text[]
language plpgsql immutable as $$
declare
  digits constant text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  cur text := p_last;
  head text; n int; ip text; i int; d int; carry boolean; nh text;
  keys text[] := '{}';
begin
  for k in 1..p_count loop
    if cur is null then
      cur := 'a0';
    else
      head := left(cur, 1);
      n := case when head between 'a' and 'z' then ascii(head) - ascii('a') + 2 else 0 end;
      if n = 0 or length(cur) < n then
        cur := cur || 'V';
      else
        ip := left(cur, n);
        -- increment the integer part
        carry := true;
        i := length(ip);
        while carry and i >= 2 loop
          d := position(substr(ip, i, 1) in digits) - 1 + 1;
          if d = 62 then
            ip := left(ip, i - 1) || '0' || substr(ip, i + 1);
            i := i - 1;
          else
            ip := left(ip, i - 1) || substr(digits, d + 1, 1) || substr(ip, i + 1);
            carry := false;
          end if;
        end loop;
        if carry then
          if head = 'z' then
            cur := cur || 'V';
          else
            nh := chr(ascii(head) + 1);
            cur := nh || substr(ip, 2) || '0';
          end if;
        else
          cur := ip;
        end if;
      end if;
    end if;
    keys := keys || cur;
  end loop;
  return keys;
end $$;
revoke execute on function public.append_keys(text, int) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- What the plugin can see: projects the key's owner may edit, with boards and lists
-- ---------------------------------------------------------------------------

create or replace function public.obsidian_context(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_user uuid := public.integration_auth(p_token);
begin
  return jsonb_build_object(
    'user', (select display_name from public.profiles where id = v_user),
    'workspaces', coalesce((
      select jsonb_agg(jsonb_build_object('id', w.id, 'name', w.name, 'can_create', wm.role <> 'guest') order by w.name)
        from public.workspaces w
        join public.workspace_members wm on wm.workspace_id = w.id and wm.user_id = v_user
       where w.archived_at is null), '[]'::jsonb),
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', p.id, 'name', p.name, 'workspace_id', p.workspace_id,
          'personal', p.personal_owner is not null,
          'boards', coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', b.id, 'name', b.name,
                'lists', coalesce((
                  select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name) order by l.position)
                    from public.lists l where l.board_id = b.id and l.archived_at is null), '[]'::jsonb))
              order by b.position)
              from public.boards b
             where b.project_id = p.id and b.deleted_at is null and b.archived_at is null and not b.is_template), '[]'::jsonb))
        order by p.name)
        from public.projects p
       where p.deleted_at is null and p.archived_at is null and not p.is_template
         and public.can_edit_project(p.id)), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------------------
-- New project from a note: a project with one board (To do, Doing, Done)
-- ---------------------------------------------------------------------------

create or replace function public.obsidian_create_project(p_token text, p_workspace uuid, p_name text, p_description text default '')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := public.integration_auth(p_token);
  v_project uuid; v_board uuid;
  v_lists jsonb := '[]'::jsonb;
  v_name text; v_id uuid; v_pos text[];
begin
  v_project := public.create_project(p_workspace, p_name, coalesce(p_description, ''));
  insert into public.boards (project_id, workspace_id, name, position, created_by)
  values (v_project, p_workspace, 'Tasks', 'a0', v_user) returning id into v_board;
  insert into public.labels (board_id, project_id, name, color)
  select v_board, v_project, '', c from unnest(array['moss','ochre','terracotta','red','mauve','indigo']) as c;
  v_pos := public.append_keys(null, 3);
  for i in 1..3 loop
    v_name := (array['To do','Doing','Done'])[i];
    insert into public.lists (board_id, project_id, name, position) values (v_board, v_project, v_name, v_pos[i]) returning id into v_id;
    v_lists := v_lists || jsonb_build_object('id', v_id, 'name', v_name);
  end loop;
  return jsonb_build_object('project_id', v_project, 'board_id', v_board, 'lists', v_lists);
end $$;

-- ---------------------------------------------------------------------------
-- Send tasks: create new ones, update ones sent before (identified by card_id)
--   p_tasks: [{ref, card_id?, title, description?, due?, start?, priority?, done?}]
-- ---------------------------------------------------------------------------

create or replace function public.obsidian_send_tasks(p_token text, p_project uuid, p_list uuid, p_tasks jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := public.integration_auth(p_token);
  v_board uuid;
  v_last text;
  v_new int := 0;
  v_keys text[];
  t jsonb;
  v_card uuid;
  v_status text;
  v_prio text;
  v_out jsonb := '[]'::jsonb;
  v_key_i int := 0;
  v_existing boolean;
begin
  if jsonb_typeof(p_tasks) <> 'array' then raise exception 'Expected a list of tasks'; end if;
  if jsonb_array_length(p_tasks) > 200 then raise exception 'Send at most 200 tasks at a time'; end if;
  if not public.can_edit_project(p_project) then raise exception 'You cannot add tasks to this project'; end if;
  select board_id into v_board from public.lists where id = p_list and project_id = p_project and archived_at is null;
  if v_board is null then raise exception 'That list was not found in the project'; end if;

  select position into v_last from public.cards where list_id = p_list order by position desc limit 1;
  -- count how many positions are needed (tasks without an existing card)
  select count(*) into v_new from jsonb_array_elements(p_tasks) e
   where not exists (select 1 from public.cards c
                      where c.id = nullif(e ->> 'card_id', '')::uuid and c.project_id = p_project and c.deleted_at is null);
  v_keys := public.append_keys(v_last, v_new);

  for t in select * from jsonb_array_elements(p_tasks) loop
    if char_length(trim(coalesce(t ->> 'title', ''))) = 0 then continue; end if;
    v_status := case when coalesce((t ->> 'done')::boolean, false) then 'done' else null end;
    v_prio := nullif(t ->> 'priority', '');
    if v_prio is not null and v_prio not in ('none','low','medium','high','urgent') then v_prio := null; end if;
    v_card := nullif(t ->> 'card_id', '')::uuid;
    v_existing := false;
    if v_card is not null then
      select true into v_existing from public.cards where id = v_card and project_id = p_project and deleted_at is null;
    end if;

    if v_existing then
      update public.cards set
        title = left(trim(t ->> 'title'), 500),
        due_date = case when t ? 'due' then nullif(t ->> 'due', '')::date else due_date end,
        start_date = case when t ? 'start' then nullif(t ->> 'start', '')::date else start_date end,
        priority = coalesce(v_prio, priority),
        status = case
          when (t ->> 'done')::boolean is true then 'done'
          when (t ->> 'done')::boolean is false and status = 'done' then 'open'
          else status end
       where id = v_card;
      v_out := v_out || jsonb_build_object('ref', t ->> 'ref', 'card_id', v_card, 'created', false);
    else
      v_key_i := v_key_i + 1;
      insert into public.cards (project_id, board_id, list_id, title, description, position, status, priority, due_date, start_date, created_by)
      values (p_project, v_board, p_list, left(trim(t ->> 'title'), 500), coalesce(t ->> 'description', ''), v_keys[v_key_i],
              coalesce(v_status, 'open'), coalesce(v_prio, 'none'),
              nullif(t ->> 'due', '')::date, nullif(t ->> 'start', '')::date, v_user)
      returning id into v_card;
      v_out := v_out || jsonb_build_object('ref', t ->> 'ref', 'card_id', v_card, 'created', true);
    end if;
  end loop;
  return v_out;
end $$;

-- ---------------------------------------------------------------------------
-- Current state of tasks sent earlier (to tick boxes in the note)
-- ---------------------------------------------------------------------------

create or replace function public.obsidian_card_status(p_token text, p_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_user uuid := public.integration_auth(p_token);
begin
  if coalesce(array_length(p_ids, 1), 0) > 500 then raise exception 'Ask for at most 500 tasks at a time'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', c.id, 'status', c.status, 'title', c.title, 'due_date', c.due_date))
      from public.cards c
     where c.id = any (p_ids) and c.deleted_at is null and public.can_read_project(c.project_id)), '[]'::jsonb);
end $$;

-- The plugin runs outside the app, so these are callable without a session;
-- the access key is the credential.
revoke execute on function public.obsidian_context(text) from public;
revoke execute on function public.obsidian_create_project(text, uuid, text, text) from public;
revoke execute on function public.obsidian_send_tasks(text, uuid, uuid, jsonb) from public;
revoke execute on function public.obsidian_card_status(text, uuid[]) from public;
grant execute on function public.obsidian_context(text) to anon, authenticated;
grant execute on function public.obsidian_create_project(text, uuid, text, text) to anon, authenticated;
grant execute on function public.obsidian_send_tasks(text, uuid, uuid, jsonb) to anon, authenticated;
grant execute on function public.obsidian_card_status(text, uuid[]) to anon, authenticated;
