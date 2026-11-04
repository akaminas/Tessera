-- =============================================================================
-- Tessera — deleting a person
--
-- People are deleted through Supabase Auth (dashboard or admin API), which
-- removes the auth.users row and cascades to their memberships. The guards that
-- keep "at least one owner / manager" would otherwise block that cascade.
--
-- Before the row goes:
--   * each workspace the person solely owns passes to the most senior remaining
--     member (admin, then member, then guest; earliest joined first). A workspace
--     with no other members is deleted with its contents;
--   * each project the person solely manages passes to the most senior remaining
--     project member. With nobody left, workspace owners and admins still manage
--     it (see project_role), so the guard ignores memberships of deleted people.
-- Content the person wrote stays; author columns become empty (on delete set null).
-- =============================================================================

create or replace function public.handle_user_deleted() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_heir uuid;
begin
  for r in
    select wm.workspace_id from public.workspace_members wm
    where wm.user_id = old.id and wm.role = 'owner'
      and not exists (select 1 from public.workspace_members o
                      where o.workspace_id = wm.workspace_id and o.role = 'owner' and o.user_id <> old.id)
  loop
    select user_id into v_heir from public.workspace_members
    where workspace_id = r.workspace_id and user_id <> old.id
    order by case role when 'admin' then 0 when 'member' then 1 else 2 end, joined_at
    limit 1;
    if v_heir is null then
      delete from public.workspaces where id = r.workspace_id;
    else
      update public.workspace_members set role = 'owner' where workspace_id = r.workspace_id and user_id = v_heir;
    end if;
  end loop;

  for r in
    select pm.project_id from public.project_members pm
    join public.projects p on p.id = pm.project_id
    where pm.user_id = old.id and pm.role = 'manager' and p.personal_owner is null
      and not exists (select 1 from public.project_members o
                      where o.project_id = pm.project_id and o.role = 'manager' and o.user_id <> old.id)
  loop
    select user_id into v_heir from public.project_members
    where project_id = r.project_id and user_id <> old.id
    order by case role when 'member' then 0 when 'collaborator' then 1 else 2 end, added_at
    limit 1;
    if v_heir is not null then
      update public.project_members set role = 'manager' where project_id = r.project_id and user_id = v_heir;
    end if;
  end loop;

  return old;
end $$;

drop trigger if exists on_auth_user_deleted on auth.users;
create trigger on_auth_user_deleted before delete on auth.users
  for each row execute function public.handle_user_deleted();

-- The guards step aside only for memberships whose person no longer exists.
create or replace function public.protect_last_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.role = 'owner' and (tg_op = 'DELETE' or new.role <> 'owner')
     -- during an account deletion the auth row is already gone when memberships cascade
     and exists (select 1 from auth.users u where u.id = old.user_id) then
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

create or replace function public.protect_last_manager() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.role = 'manager' and (tg_op = 'DELETE' or new.role <> 'manager')
     -- during an account deletion the auth row is already gone when memberships cascade
     and exists (select 1 from auth.users u where u.id = old.user_id) then
    if exists (select 1 from public.projects where id = old.project_id)
       and not exists (select 1 from public.project_members
                       where project_id = old.project_id and role = 'manager' and user_id <> old.user_id) then
      raise exception 'A project must keep at least one manager';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
