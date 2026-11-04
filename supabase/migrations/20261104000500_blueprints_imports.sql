-- Tessera — templates (blueprints) and workbook imports.
-- All functions are SECURITY INVOKER: every row they write passes RLS for the
-- calling user, so imports cannot exceed the caller's permissions.

create or replace function public._bp_date(p_start date, p_day jsonb, p_month jsonb, p_end boolean) returns date
language sql immutable as $$
  select case
    when p_day is not null and jsonb_typeof(p_day) = 'number' then p_start + (p_day #>> '{}')::int
    when p_month is not null and jsonb_typeof(p_month) = 'number' then
      case when p_end then public.project_month_end(p_start, (p_month #>> '{}')::int)
           else public.project_month_start(p_start, (p_month #>> '{}')::int) end
    else null end
$$;

-- Insert one blueprint card (recursively for children). Returns the new id.
create or replace function public._bp_card(
  p_project uuid, p_board uuid, p_list uuid, p_parent uuid, p_card jsonb, p_start date, p_pos text, p_labels jsonb, p_wps jsonb
) returns uuid
language plpgsql as $$
declare
  v_id uuid; v_start date; v_due date; v_cl uuid; v_item text; v_i int := 0; v_child jsonb; v_lbl text; v_months jsonb;
  v_planned int[]; v_duem int[]; v_c int := 0;
begin
  v_months := p_card -> 'months';
  v_start := public._bp_date(p_start, p_card -> 'start_day', p_card -> 'start_month', false);
  v_due := public._bp_date(p_start, p_card -> 'due_day', p_card -> 'end_month', true);
  if v_months is not null then
    select array_agg(x::int) into v_planned from jsonb_array_elements_text(coalesce(v_months -> 'planned', '[]')) x;
    select array_agg(x::int) into v_duem from jsonb_array_elements_text(coalesce(v_months -> 'due', '[]')) x;
    if v_start is null then
      v_start := public.project_month_start(p_start, (select min(m) from unnest(coalesce(v_planned, '{}') || coalesce(v_duem, '{}')) m));
    end if;
    if v_due is null then
      v_due := public.project_month_end(p_start, (select max(m) from unnest(coalesce(v_planned, '{}') || coalesce(v_duem, '{}')) m));
    end if;
  end if;
  insert into public.cards (board_id, list_id, project_id, parent_id, title, description, position, priority,
                            start_date, due_date, recurrence, schedule, work_package_id)
  values (p_board, p_list, p_project, p_parent, left(p_card ->> 'title', 500), coalesce(p_card ->> 'description', ''), p_pos,
          coalesce(p_card ->> 'priority', 'none'), v_start, v_due,
          case when p_card ? 'recurrence' then (p_card -> 'recurrence') || '{"mode":"on_complete"}'::jsonb end,
          v_months, (p_wps ->> (p_card ->> 'wp'))::uuid)
  returning id into v_id;
  for v_lbl in select jsonb_array_elements_text(coalesce(p_card -> 'labels', '[]')) loop
    if p_labels ? v_lbl then
      insert into public.card_labels (card_id, label_id, project_id) values (v_id, (p_labels ->> v_lbl)::uuid, p_project);
    end if;
  end loop;
  if jsonb_array_length(coalesce(p_card -> 'checklist', '[]')) > 0 then
    insert into public.checklists (card_id, project_id, title) values (v_id, p_project, 'Checklist') returning id into v_cl;
    for v_item in select jsonb_array_elements_text(p_card -> 'checklist') loop
      v_i := v_i + 1;
      insert into public.checklist_items (checklist_id, card_id, project_id, title, position)
      values (v_cl, v_id, p_project, left(v_item, 1000), 'a' || lpad(v_i::text, 3, '0'));
    end loop;
  end if;
  for v_child in select * from jsonb_array_elements(coalesce(p_card -> 'children', '[]')) loop
    v_c := v_c + 1;
    perform public._bp_card(p_project, p_board, p_list, v_id, v_child, p_start, p_pos || lpad(v_c::text, 3, '0'), p_labels, p_wps);
  end loop;
  return v_id;
end $$;

create or replace function public.apply_blueprint(p_project uuid, p_blueprint jsonb, p_start date default null)
returns void
language plpgsql as $$
declare
  v_start date := coalesce(p_start, (select start_date from public.projects where id = p_project), current_date);
  v_wps jsonb := '{}'::jsonb; v_labels jsonb; v_board uuid; v_list uuid; b jsonb; l jsonb; c jsonb; w jsonb; m jsonb; r jsonb; k jsonb; cc jsonb; lb jsonb;
  v_id uuid; bi int := 0; li int; ci int; i int := 0;
begin
  if not public.can_manage_project(p_project) then raise exception 'Only project managers can apply templates'; end if;
  if coalesce((p_blueprint ->> 'version')::int, 0) <> 1 then raise exception 'Unsupported template version'; end if;

  if p_blueprint ? 'modules' then
    update public.projects set modules = array(select jsonb_array_elements_text(p_blueprint -> 'modules'))
     where id = p_project;
  end if;
  if p_blueprint ? 'funding' then
    update public.projects set funding = funding || (p_blueprint -> 'funding') where id = p_project;
  end if;

  for w in select * from jsonb_array_elements(coalesce(p_blueprint -> 'work_packages', '[]')) loop
    i := i + 1;
    insert into public.work_packages (project_id, code, name, description, start_date, end_date, position)
    values (p_project, w ->> 'code', w ->> 'name', coalesce(w ->> 'description', ''),
            public.project_month_start(v_start, coalesce((w ->> 'start_month')::int, 1)),
            public.project_month_end(v_start, coalesce((w ->> 'end_month')::int, 1)),
            'a' || lpad(i::text, 3, '0'))
    on conflict (project_id, code) do update set name = excluded.name
    returning id into v_id;
    v_wps := v_wps || jsonb_build_object(w ->> 'code', v_id);
  end loop;

  for b in select * from jsonb_array_elements(coalesce(p_blueprint -> 'boards', '[]')) loop
    bi := bi + 1;
    insert into public.boards (project_id, workspace_id, name, position)
    values (p_project, p_project, left(b ->> 'name', 200), 'a' || lpad(bi::text, 3, '0'))
    returning id into v_board;
    v_labels := '{}'::jsonb;
    for lb in select * from jsonb_array_elements(coalesce(p_blueprint -> 'labels', '[]')) loop
      insert into public.labels (board_id, project_id, name, color)
      values (v_board, p_project, lb ->> 'name', coalesce(lb ->> 'color', 'grey')) returning id into v_id;
      v_labels := v_labels || jsonb_build_object(lb ->> 'name', v_id);
    end loop;
    li := 0;
    for l in select * from jsonb_array_elements(coalesce(b -> 'lists', '[]')) loop
      li := li + 1;
      insert into public.lists (board_id, project_id, name, position)
      values (v_board, p_project, left(l ->> 'name', 200), 'a' || lpad(li::text, 3, '0')) returning id into v_list;
      ci := 0;
      for c in select * from jsonb_array_elements(coalesce(l -> 'cards', '[]')) loop
        ci := ci + 1;
        perform public._bp_card(p_project, v_board, v_list, null, c, v_start, 'a' || lpad(ci::text, 3, '0'), v_labels, v_wps);
      end loop;
    end loop;
  end loop;

  i := 0;
  for m in select * from jsonb_array_elements(coalesce(p_blueprint -> 'milestones', '[]')) loop
    i := i + 1;
    insert into public.milestones (project_id, work_package_id, code, title, kind, due_date, verification, evidence_required, position,
                                   approval_status)
    values (p_project, (v_wps ->> (m ->> 'wp'))::uuid, coalesce(m ->> 'code', ''), m ->> 'title', coalesce(m ->> 'kind', 'milestone'),
            public.project_month_end(v_start, coalesce((m ->> 'month')::int, 1)), coalesce(m ->> 'verification', ''),
            coalesce(m ->> 'verification', '') <> '', 'a' || lpad(i::text, 3, '0'),
            case when coalesce(m ->> 'kind', 'milestone') in ('deliverable','report') then 'not_submitted' else 'not_required' end);
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_blueprint -> 'risks', '[]')) loop
    insert into public.risks (project_id, title, probability, impact, mitigation, category)
    values (p_project, r ->> 'title', coalesce((r ->> 'probability')::int, 3), coalesce((r ->> 'impact')::int, 3),
            coalesce(r ->> 'mitigation', ''), coalesce(r ->> 'category', ''));
  end loop;

  i := 0;
  for k in select * from jsonb_array_elements(coalesce(p_blueprint -> 'kpis', '[]')) loop
    i := i + 1;
    insert into public.kpis (project_id, work_package_id, code, name, unit, target, baseline, position)
    values (p_project, (v_wps ->> (k ->> 'wp'))::uuid, coalesce(k ->> 'code', ''), k ->> 'name', coalesce(k ->> 'unit', ''),
            nullif(k ->> 'target', '')::numeric, nullif(k ->> 'baseline', '')::numeric, 'a' || lpad(i::text, 3, '0'));
  end loop;

  i := 0;
  for cc in select * from jsonb_array_elements(coalesce(p_blueprint -> 'cost_categories', '[]')) loop
    i := i + 1;
    insert into public.cost_categories (project_id, code, name, kind, indirect_base, position)
    values (p_project, coalesce(cc ->> 'code', ''), cc ->> 'name', coalesce(cc ->> 'kind', 'other'),
            coalesce((cc ->> 'indirect_base')::boolean, true), 'a' || lpad(i::text, 3, '0'))
    on conflict (project_id, name) do nothing;
  end loop;

  if (p_blueprint ->> 'reporting_period_months') is not null
     and exists (select 1 from public.projects where id = p_project and start_date is not null and end_date is not null) then
    perform public.generate_reporting_periods(p_project, (p_blueprint ->> 'reporting_period_months')::int);
  end if;
end $$;

-- Export a project's structure as a blueprint (no people, no money, no comments).
create or replace function public.project_to_blueprint(p_project uuid) returns jsonb
language plpgsql stable as $$
declare p public.projects; v_start date; v_boards jsonb := '[]'::jsonb; b record; l record; v_lists jsonb; v_cards jsonb;
begin
  select * into p from public.projects where id = p_project;
  if not found or not public.can_read_project(p_project) then raise exception 'Project not found'; end if;
  v_start := coalesce(p.start_date, current_date);
  for b in select * from public.boards where project_id = p_project and deleted_at is null and archived_at is null and not is_template order by position loop
    v_lists := '[]'::jsonb;
    for l in select * from public.lists where board_id = b.id and archived_at is null order by position loop
      select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'title', c.title,
               'description', nullif(c.description, ''),
               'start_day', case when c.start_date is not null then c.start_date - v_start end,
               'due_day', case when c.due_date is not null then c.due_date - v_start end,
               'priority', nullif(c.priority, 'none'),
               'months', c.schedule,
               'recurrence', c.recurrence,
               'wp', (select code from public.work_packages w where w.id = c.work_package_id),
               'labels', (select jsonb_agg(lb.name) from public.card_labels cl join public.labels lb on lb.id = cl.label_id where cl.card_id = c.id),
               'checklist', (select jsonb_agg(i.title order by cl2.position, i.position) from public.checklist_items i
                             join public.checklists cl2 on cl2.id = i.checklist_id where i.card_id = c.id and i.parent_item_id is null)
             )) order by c.position), '[]'::jsonb)
        into v_cards
        from public.cards c where c.list_id = l.id and c.archived_at is null and c.deleted_at is null and c.parent_id is null and not c.is_template;
      v_lists := v_lists || jsonb_build_array(jsonb_build_object('name', l.name, 'cards', v_cards));
    end loop;
    v_boards := v_boards || jsonb_build_array(jsonb_build_object('name', b.name, 'lists', v_lists));
  end loop;
  return jsonb_strip_nulls(jsonb_build_object(
    'version', 1,
    'modules', to_jsonb(p.modules),
    'duration_months', case when p.start_date is not null and p.end_date is not null then public.project_month_of(p.start_date, p.end_date) end,
    'labels', (select jsonb_agg(distinct jsonb_build_object('name', name, 'color', color)) from public.labels where project_id = p_project and name <> ''),
    'boards', v_boards,
    'work_packages', (select jsonb_agg(jsonb_build_object('code', code, 'name', name, 'description', description,
                        'start_month', coalesce(public.project_month_of(v_start, start_date), 1),
                        'end_month', coalesce(public.project_month_of(v_start, end_date), 1)) order by position)
                      from public.work_packages where project_id = p_project and deleted_at is null),
    'milestones', (select jsonb_agg(jsonb_build_object('code', m.code, 'title', m.title, 'kind', m.kind,
                     'month', coalesce(public.project_month_of(v_start, m.due_date), 1), 'verification', m.verification,
                     'wp', (select code from public.work_packages w where w.id = m.work_package_id)) order by m.due_date)
                   from public.milestones m where m.project_id = p_project and m.deleted_at is null),
    'risks', (select jsonb_agg(jsonb_build_object('title', title, 'probability', probability, 'impact', impact, 'mitigation', mitigation, 'category', category))
              from public.risks where project_id = p_project and deleted_at is null and kind = 'risk'),
    'kpis', (select jsonb_agg(jsonb_build_object('code', code, 'name', name, 'unit', unit,
               'wp', (select code from public.work_packages w where w.id = k.work_package_id)) order by k.position)
             from public.kpis k where k.project_id = p_project and k.deleted_at is null),
    'cost_categories', case when public.can_read_finance(p_project) then
      (select jsonb_agg(jsonb_build_object('code', code, 'name', name, 'kind', kind, 'indirect_base', indirect_base) order by position)
       from public.cost_categories where project_id = p_project) end
  ));
end $$;

-- ---------------------------------------------------------------------------
-- Planning workbook import (work packages, M1–Mn activity schedule, milestones)
-- Payload produced by the in-app importer after the user reviews the mapping.
-- ---------------------------------------------------------------------------
create or replace function public.import_plan(p_project uuid, p_payload jsonb) returns jsonb
language plpgsql as $$
declare
  p public.projects; v_start date; v_board uuid; v_list uuid; v_wps jsonb := '{}'::jsonb; v_lists jsonb := '{}'::jsonb;
  w jsonb; r jsonb; m jsonb; v_id uuid; v_parent uuid; v_last_task jsonb := '{}'::jsonb; v_org uuid; i int := 0;
  v_cards int := 0; v_ms int := 0; v_planned int[]; v_due int[]; v_done int[]; v_all int[]; v_status text; v_wp_key text;
begin
  if not public.can_manage_project(p_project) then raise exception 'Only project managers can import a plan'; end if;
  select * into p from public.projects where id = p_project;
  v_start := coalesce(nullif(p_payload ->> 'start_date', '')::date, p.start_date);
  if v_start is null then raise exception 'A project start date is required to place project months'; end if;
  if p.start_date is null then
    update public.projects set start_date = v_start,
      end_date = coalesce(end_date, public.project_month_end(v_start, greatest(1, coalesce((p_payload ->> 'months')::int, 12))))
      where id = p_project;
  end if;
  update public.projects set modules = array(select distinct unnest(modules || array['workpackages','milestones','timeline']::text[]))
   where id = p_project;

  insert into public.boards (project_id, workspace_id, name, position)
  values (p_project, p_project, coalesce(nullif(p_payload ->> 'board_name', ''), 'Work plan'), 'a' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISS'))
  returning id into v_board;

  for w in select * from jsonb_array_elements(coalesce(p_payload -> 'work_packages', '[]')) loop
    i := i + 1;
    v_org := null;
    if coalesce(w ->> 'lead', '') <> '' then
      select id into v_org from public.organizations
       where workspace_id = p.workspace_id and (lower(short_name) = lower(w ->> 'lead') or lower(name) = lower(w ->> 'lead')) limit 1;
    end if;
    insert into public.work_packages (project_id, code, name, lead_org_id, start_date, end_date, position)
    values (p_project, w ->> 'code', w ->> 'name', v_org,
            public.project_month_start(v_start, coalesce((w ->> 'start_month')::int, 1)),
            public.project_month_end(v_start, coalesce((w ->> 'end_month')::int, coalesce((p_payload ->> 'months')::int, 12))),
            'a' || lpad(i::text, 3, '0'))
    on conflict (project_id, code) do update set name = excluded.name, lead_org_id = coalesce(excluded.lead_org_id, public.work_packages.lead_org_id)
    returning id into v_id;
    v_wps := v_wps || jsonb_build_object(w ->> 'code', v_id);
    insert into public.lists (board_id, project_id, name, position)
    values (v_board, p_project, left((w ->> 'code') || ' ' || (w ->> 'name'), 200), 'a' || lpad(i::text, 3, '0'))
    returning id into v_list;
    v_lists := v_lists || jsonb_build_object(w ->> 'code', v_list);
  end loop;

  i := 0;
  for r in select * from jsonb_array_elements(coalesce(p_payload -> 'rows', '[]')) loop
    i := i + 1;
    v_wp_key := r ->> 'wp';
    if not (v_lists ? v_wp_key) then raise exception 'Row % refers to unknown work package %', i, v_wp_key; end if;
    select array_agg(x::int order by x::int) into v_planned from jsonb_array_elements_text(coalesce(r -> 'planned', '[]')) x;
    select array_agg(x::int order by x::int) into v_due from jsonb_array_elements_text(coalesce(r -> 'due', '[]')) x;
    select array_agg(x::int order by x::int) into v_done from jsonb_array_elements_text(coalesce(r -> 'done', '[]')) x;
    v_all := coalesce(v_planned, '{}') || coalesce(v_due, '{}') || coalesce(v_done, '{}');
    v_parent := case when (r ->> 'kind') = 'activity' then (v_last_task ->> v_wp_key)::uuid end;
    v_status := case
      when array_length(v_all, 1) is not null and coalesce(array_length(v_done, 1), 0) = array_length(v_all, 1) then 'done'
      when array_length(v_done, 1) is not null then 'in_progress' else 'open' end;
    insert into public.cards (board_id, list_id, project_id, parent_id, title, position, start_date, due_date, schedule,
                              responsible_text, work_package_id, status)
    values (v_board, (v_lists ->> v_wp_key)::uuid, p_project, v_parent, left(r ->> 'title', 500), 'a' || lpad(i::text, 4, '0'),
            case when array_length(v_all, 1) is not null then public.project_month_start(v_start, (select min(x) from unnest(v_all) x)) end,
            case when array_length(v_all, 1) is not null then public.project_month_end(v_start, (select max(x) from unnest(v_all) x)) end,
            jsonb_strip_nulls(jsonb_build_object('planned', to_jsonb(v_planned), 'due', to_jsonb(v_due), 'done', to_jsonb(v_done))),
            left(coalesce(r ->> 'responsible', ''), 300), (v_wps ->> v_wp_key)::uuid, v_status)
    returning id into v_id;
    if (r ->> 'kind') = 'task' then v_last_task := v_last_task || jsonb_build_object(v_wp_key, v_id); end if;
    v_cards := v_cards + 1;
  end loop;

  i := 0;
  for m in select * from jsonb_array_elements(coalesce(p_payload -> 'milestones', '[]')) loop
    i := i + 1;
    insert into public.milestones (project_id, work_package_id, code, title, kind, due_date, verification, status, notes,
                                   evidence_required, position, approval_status)
    values (p_project, (v_wps ->> (m ->> 'wp'))::uuid, coalesce(m ->> 'code', ''), left(m ->> 'title', 300),
            coalesce(nullif(m ->> 'kind', ''), 'milestone'), nullif(m ->> 'due_date', '')::date,
            coalesce(m ->> 'verification', ''), coalesce(nullif(m ->> 'status', ''), 'planned'), coalesce(m ->> 'notes', ''),
            coalesce(m ->> 'verification', '') <> '', 'a' || lpad(i::text, 3, '0'),
            case when coalesce(m ->> 'kind', '') in ('deliverable','report') then 'not_submitted' else 'not_required' end);
    v_ms := v_ms + 1;
  end loop;

  return jsonb_build_object('board_id', v_board, 'work_packages', (select count(*) from jsonb_object_keys(v_wps)), 'cards', v_cards, 'milestones', v_ms);
end $$;

-- ---------------------------------------------------------------------------
-- Budget workbook import (partners, categories, lines, person-months)
-- ---------------------------------------------------------------------------
create or replace function public.import_budget(p_project uuid, p_payload jsonb) returns jsonb
language plpgsql as $$
declare
  p public.projects; pt jsonb; c jsonb; ln jsonb; w jsonb; v_org uuid; v_partner uuid; v_cat uuid; v_wp uuid;
  v_partners jsonb := '{}'::jsonb; v_cats jsonb := '{}'::jsonb; v_wps jsonb := '{}'::jsonb; i int := 0; n int := 0;
begin
  if not public.can_edit_finance(p_project) then raise exception 'You need finance edit access to import a budget'; end if;
  select * into p from public.projects where id = p_project;
  update public.projects set modules = array(select distinct unnest(modules || array['budget','workpackages']::text[])),
    funding = funding || coalesce(p_payload -> 'settings', '{}'::jsonb)
   where id = p_project;

  if coalesce((p_payload ->> 'replace')::boolean, false) then
    delete from public.budget_lines where project_id = p_project and source = 'import';
  end if;

  for w in select * from jsonb_array_elements(coalesce(p_payload -> 'work_packages', '[]')) loop
    i := i + 1;
    insert into public.work_packages (project_id, code, name, position, start_date, end_date)
    values (p_project, w ->> 'code', coalesce(nullif(w ->> 'name', ''), w ->> 'code'), 'a' || lpad(i::text, 3, '0'), p.start_date, p.end_date)
    on conflict (project_id, code) do update set name = case when excluded.name <> excluded.code then excluded.name else public.work_packages.name end
    returning id into v_wp;
    v_wps := v_wps || jsonb_build_object(w ->> 'code', v_wp);
  end loop;

  i := 0;
  for pt in select * from jsonb_array_elements(coalesce(p_payload -> 'partners', '[]')) loop
    i := i + 1;
    select id into v_org from public.organizations where workspace_id = p.workspace_id and lower(name) = lower(pt ->> 'name') limit 1;
    if v_org is null then
      insert into public.organizations (workspace_id, name, short_name, country, kind)
      values (p.workspace_id, pt ->> 'name', coalesce(pt ->> 'short_name', ''), coalesce(pt ->> 'country', ''), coalesce(nullif(pt ->> 'kind', ''), 'other'))
      returning id into v_org;
    end if;
    insert into public.project_partners (project_id, organization_id, role, short_name, position)
    values (p_project, v_org, coalesce(nullif(pt ->> 'role', ''), 'partner'), coalesce(pt ->> 'short_name', ''), 'a' || lpad(i::text, 3, '0'))
    on conflict (project_id, organization_id) do update set short_name = case when excluded.short_name <> '' then excluded.short_name else public.project_partners.short_name end
    returning id into v_partner;
    insert into public.partner_finance (partner_id, project_id, pm_rate)
    values (v_partner, p_project, nullif(pt ->> 'pm_rate', '')::numeric)
    on conflict (partner_id) do update set pm_rate = coalesce(excluded.pm_rate, public.partner_finance.pm_rate), updated_at = now();
    v_partners := v_partners || jsonb_build_object(pt ->> 'key', v_partner);
  end loop;

  i := 0;
  for c in select * from jsonb_array_elements(coalesce(p_payload -> 'categories', '[]')) loop
    i := i + 1;
    insert into public.cost_categories (project_id, code, name, kind, indirect_base, position)
    values (p_project, coalesce(c ->> 'code', ''), c ->> 'name', coalesce(c ->> 'kind', 'other'), coalesce((c ->> 'indirect_base')::boolean, true),
            'a' || lpad(i::text, 3, '0'))
    on conflict (project_id, name) do update set kind = excluded.kind, indirect_base = excluded.indirect_base
    returning id into v_cat;
    v_cats := v_cats || jsonb_build_object(c ->> 'name', v_cat);
  end loop;

  for ln in select * from jsonb_array_elements(coalesce(p_payload -> 'lines', '[]')) loop
    if not (v_partners ? (ln ->> 'partner')) then raise exception 'Line refers to unknown partner %', ln ->> 'partner'; end if;
    if not (v_cats ? (ln ->> 'category')) then raise exception 'Line refers to unknown category %', ln ->> 'category'; end if;
    if (ln ->> 'amount')::numeric < 0 then raise exception 'Negative amount in %', ln ->> 'source_ref'; end if;
    insert into public.budget_lines (project_id, partner_id, work_package_id, category_id, financial_year, description, amount,
                                     person_months, source, source_ref)
    values (p_project, (v_partners ->> (ln ->> 'partner'))::uuid, (v_wps ->> (ln ->> 'wp'))::uuid, (v_cats ->> (ln ->> 'category'))::uuid,
            nullif(ln ->> 'year', '')::int, left(coalesce(ln ->> 'description', ''), 2000), round((ln ->> 'amount')::numeric, 2),
            nullif(ln ->> 'person_months', '')::numeric, 'import', left(coalesce(ln ->> 'source_ref', ''), 200));
    n := n + 1;
  end loop;

  return jsonb_build_object('partners', (select count(*) from jsonb_object_keys(v_partners)), 'categories', (select count(*) from jsonb_object_keys(v_cats)), 'lines', n,
                            'work_packages', (select count(*) from jsonb_object_keys(v_wps)));
end $$;
