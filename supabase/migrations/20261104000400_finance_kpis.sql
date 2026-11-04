-- Tessera — Phase 5: financial management and KPIs
-- All monetary tables are readable only by people with finance access
-- (project managers, workspace admins, or members granted finance view/edit).
-- Amounts use NUMERIC (exact decimal); computations in the app use big.js.

-- ---------------------------------------------------------------------------
-- Cost categories (configurable per project)
-- ---------------------------------------------------------------------------
create table public.cost_categories (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  code text not null default '',
  name text not null check (char_length(trim(name)) between 1 and 200),
  kind text not null default 'other'
    check (kind in ('personnel','subcontracting','travel','equipment','other','third_party','internal','other_direct')),
  indirect_base boolean not null default true,
  position text collate "C" not null default 'a0',
  created_at timestamptz not null default now(),
  unique (project_id, name)
);
select public.apply_project_rls('cost_categories', true);

-- ---------------------------------------------------------------------------
-- Partner financial attributes
-- ---------------------------------------------------------------------------
create table public.partner_finance (
  partner_id uuid primary key references public.project_partners (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  pm_rate numeric(14,2) check (pm_rate is null or pm_rate >= 0),
  funding_rate numeric(7,6) check (funding_rate is null or funding_rate between 0 and 1),
  indirect_rate numeric(7,6) check (indirect_rate is null or indirect_rate between 0 and 1),
  notes text not null default '',
  updated_at timestamptz not null default now()
);
create or replace function public.partner_child_set_project() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select project_id into new.project_id from public.project_partners where id = new.partner_id;
  if new.project_id is null then raise exception 'Partner not found'; end if;
  return new;
end $$;
create trigger partner_finance_set_project before insert or update on public.partner_finance
  for each row execute function public.partner_child_set_project();
select public.apply_project_rls('partner_finance', true);

-- ---------------------------------------------------------------------------
-- Budget lines (planned direct costs, optional person-months)
-- ---------------------------------------------------------------------------
create table public.budget_lines (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  partner_id uuid references public.project_partners (id) on delete restrict,
  work_package_id uuid references public.work_packages (id) on delete set null,
  category_id uuid not null references public.cost_categories (id) on delete restrict,
  financial_year int check (financial_year is null or financial_year between 1990 and 2200),
  reporting_period_id uuid references public.reporting_periods (id) on delete set null,
  description text not null default '',
  amount numeric(14,2) not null check (amount >= 0),
  person_months numeric(10,4) check (person_months is null or person_months >= 0),
  forecast_amount numeric(14,2) check (forecast_amount is null or forecast_amount >= 0),
  source text not null default 'manual' check (source in ('manual','import')),
  source_ref text not null default '',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);
create index budget_lines_project_idx on public.budget_lines (project_id);
create trigger budget_lines_version before update on public.budget_lines for each row execute function public.bump_version();
select public.apply_project_rls('budget_lines', true);

-- ---------------------------------------------------------------------------
-- Expenditures (committed and actual)
-- ---------------------------------------------------------------------------
create table public.expenditures (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  partner_id uuid references public.project_partners (id) on delete restrict,
  work_package_id uuid references public.work_packages (id) on delete set null,
  category_id uuid not null references public.cost_categories (id) on delete restrict,
  budget_line_id uuid references public.budget_lines (id) on delete set null,
  reporting_period_id uuid references public.reporting_periods (id) on delete set null,
  spent_on date not null,
  description text not null check (char_length(trim(description)) between 1 and 500),
  supplier text not null default '',
  invoice_ref text not null default '',
  amount numeric(14,2) not null check (amount >= 0),
  status text not null default 'actual' check (status in ('committed','actual')),
  person_months numeric(10,4) check (person_months is null or person_months >= 0),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1
);
create index expenditures_project_idx on public.expenditures (project_id, spent_on);
create trigger expenditures_version before update on public.expenditures for each row execute function public.bump_version();
select public.apply_project_rls('expenditures', true);

-- Consistency for finance rows: referenced partner/WP/category/line/period must be in the same project.
create or replace function public.finance_refs_check() returns trigger
language plpgsql security definer set search_path = public as $$
declare j jsonb := to_jsonb(new);
begin
  if j ? 'partner_id' and (j ->> 'partner_id') is not null and not exists (select 1 from public.project_partners where id = (j ->> 'partner_id')::uuid and project_id = new.project_id) then
    raise exception 'Partner belongs to another project';
  end if;
  if j ? 'work_package_id' and (j ->> 'work_package_id') is not null and not exists (select 1 from public.work_packages where id = (j ->> 'work_package_id')::uuid and project_id = new.project_id) then
    raise exception 'Work package belongs to another project';
  end if;
  if j ? 'category_id' and (j ->> 'category_id') is not null and not exists (select 1 from public.cost_categories where id = (j ->> 'category_id')::uuid and project_id = new.project_id) then
    raise exception 'Cost category belongs to another project';
  end if;
  if j ? 'budget_line_id' and (j ->> 'budget_line_id') is not null and not exists (select 1 from public.budget_lines where id = (j ->> 'budget_line_id')::uuid and project_id = new.project_id) then
    raise exception 'Budget line belongs to another project';
  end if;
  if j ? 'reporting_period_id' and (j ->> 'reporting_period_id') is not null and not exists (select 1 from public.reporting_periods where id = (j ->> 'reporting_period_id')::uuid and project_id = new.project_id) then
    raise exception 'Reporting period belongs to another project';
  end if;
  if tg_op = 'INSERT' and j ? 'created_by' then new := jsonb_populate_record(new, jsonb_build_object('created_by', auth.uid())); end if;
  return new;
end $$;
create trigger budget_lines_refs before insert or update on public.budget_lines for each row execute function public.finance_refs_check();
create trigger expenditures_refs before insert or update on public.expenditures for each row execute function public.finance_refs_check();

-- Financial audit trail (amounts are not written into the general activity log,
-- which non-finance members can read).
create table public.finance_audit (
  id bigint generated always as identity primary key,
  project_id uuid not null references public.projects (id) on delete cascade,
  table_name text not null,
  row_id uuid,
  op text not null,
  actor_id uuid,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);
create index finance_audit_project_idx on public.finance_audit (project_id, created_at desc);
alter table public.finance_audit enable row level security;
create policy finance_audit_select on public.finance_audit for select to authenticated using (public.can_read_finance(project_id));

create or replace function public.finance_audit_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_project uuid;
begin
  v_project := coalesce((to_jsonb(new) ->> 'project_id')::uuid, (to_jsonb(old) ->> 'project_id')::uuid);
  if not exists (select 1 from public.projects where id = v_project) then return null; end if;
  insert into public.finance_audit (project_id, table_name, row_id, op, actor_id, before, after)
  values (v_project, tg_table_name,
          coalesce((to_jsonb(new) ->> 'id')::uuid, (to_jsonb(old) ->> 'id')::uuid, (to_jsonb(new) ->> 'partner_id')::uuid, (to_jsonb(old) ->> 'partner_id')::uuid),
          lower(tg_op), auth.uid(),
          case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end);
  return null;
end $$;
create trigger budget_lines_audit after insert or update or delete on public.budget_lines for each row execute function public.finance_audit_trigger();
create trigger expenditures_audit after insert or update or delete on public.expenditures for each row execute function public.finance_audit_trigger();
create trigger partner_finance_audit after insert or update or delete on public.partner_finance for each row execute function public.finance_audit_trigger();
create trigger cost_categories_audit after insert or update or delete on public.cost_categories for each row execute function public.finance_audit_trigger();

-- ---------------------------------------------------------------------------
-- Personnel effort: planned allocations and reported actuals
-- ---------------------------------------------------------------------------
create table public.effort_allocations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  partner_id uuid references public.project_partners (id) on delete cascade,
  work_package_id uuid references public.work_packages (id) on delete set null,
  user_id uuid references auth.users (id) on delete set null,
  role_title text not null default '',
  financial_year int,
  reporting_period_id uuid references public.reporting_periods (id) on delete set null,
  planned_pm numeric(10,4) not null check (planned_pm >= 0),
  created_at timestamptz not null default now()
);
create trigger effort_allocations_refs before insert or update on public.effort_allocations for each row execute function public.finance_refs_check();
-- Effort (person-months) is visible to project members; costs are not.
select public.apply_project_rls('effort_allocations');

create table public.effort_reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  partner_id uuid references public.project_partners (id) on delete cascade,
  work_package_id uuid references public.work_packages (id) on delete set null,
  user_id uuid references auth.users (id) on delete set null,
  reporting_period_id uuid references public.reporting_periods (id) on delete set null,
  period_start date not null,
  period_end date not null,
  actual_pm numeric(10,4) not null check (actual_pm >= 0),
  note text not null default '',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint effort_reports_dates check (period_end >= period_start)
);
create trigger effort_reports_refs before insert or update on public.effort_reports for each row execute function public.finance_refs_check();
select public.apply_project_rls('effort_reports');

-- ---------------------------------------------------------------------------
-- KPIs
-- ---------------------------------------------------------------------------
create table public.kpis (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  work_package_id uuid references public.work_packages (id) on delete set null,
  code text not null default '',
  name text not null check (char_length(trim(name)) between 1 and 300),
  description text not null default '',
  unit text not null default '',
  direction text not null default 'increase' check (direction in ('increase','decrease','maintain')),
  baseline numeric(18,4),
  target numeric(18,4),
  target_date date,
  aggregation text not null default 'latest' check (aggregation in ('latest','sum','max')),
  frequency text not null default 'period' check (frequency in ('once','monthly','quarterly','period','annual')),
  verification text not null default '',
  evidence_required boolean not null default true,
  responsible_org_id uuid references public.organizations (id) on delete set null,
  owner_id uuid references auth.users (id) on delete set null,
  position text collate "C" not null default 'a0',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1
);
create trigger kpis_version before update on public.kpis for each row execute function public.bump_version();
create trigger kpis_refs before insert or update on public.kpis for each row execute function public.finance_refs_check();
select public.apply_project_rls('kpis');
create trigger kpis_activity after insert or update on public.kpis for each row execute function public.simple_activity('KPI');

create table public.kpi_measurements (
  id uuid primary key default gen_random_uuid(),
  kpi_id uuid not null references public.kpis (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  partner_id uuid references public.project_partners (id) on delete set null,
  reporting_period_id uuid references public.reporting_periods (id) on delete set null,
  measured_on date not null,
  value numeric(18,4) not null,
  note text not null default '',
  verification_status text not null default 'unverified' check (verification_status in ('unverified','verified','rejected')),
  verified_by uuid references auth.users (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index kpi_measurements_kpi_idx on public.kpi_measurements (kpi_id, measured_on);
create or replace function public.kpi_measurements_prepare() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select project_id into new.project_id from public.kpis where id = new.kpi_id;
  if new.project_id is null then raise exception 'KPI not found'; end if;
  if tg_op = 'INSERT' then new.created_by := auth.uid(); end if;
  if (tg_op = 'INSERT' and new.verification_status <> 'unverified') or (tg_op = 'UPDATE' and new.verification_status is distinct from old.verification_status) then
    if auth.uid() is not null and not public.can_manage_project(new.project_id) then
      raise exception 'Only project managers can verify measurements';
    end if;
    new.verified_by := auth.uid();
  end if;
  return new;
end $$;
create trigger kpi_measurements_prepare before insert or update on public.kpi_measurements for each row execute function public.kpi_measurements_prepare();
select public.apply_project_rls('kpi_measurements');
create trigger kpi_measurements_activity after insert on public.kpi_measurements
  for each row execute function public.simple_activity('KPI measurement');

-- KPI status (SECURITY INVOKER)
create or replace function public.kpi_status(p_project uuid)
returns table (kpi_id uuid, current_value numeric, last_measured date, measurements int, verified int,
               progress numeric, evidence_missing int)
language sql stable as $$
  select k.id,
    case k.aggregation
      when 'sum' then (select sum(value) from public.kpi_measurements m where m.kpi_id = k.id and m.verification_status <> 'rejected')
      when 'max' then (select max(value) from public.kpi_measurements m where m.kpi_id = k.id and m.verification_status <> 'rejected')
      else (select value from public.kpi_measurements m where m.kpi_id = k.id and m.verification_status <> 'rejected'
            order by measured_on desc, created_at desc limit 1) end,
    (select max(measured_on) from public.kpi_measurements m where m.kpi_id = k.id),
    (select count(*) from public.kpi_measurements m where m.kpi_id = k.id)::int,
    (select count(*) from public.kpi_measurements m where m.kpi_id = k.id and m.verification_status = 'verified')::int,
    null::numeric,
    (select count(*) from public.evidence_items e where e.entity_type = 'kpi' and e.entity_id = k.id and e.required and e.status in ('missing','rejected'))::int
  from public.kpis k
  where k.project_id = p_project and k.deleted_at is null
$$;

-- Workload extension: planned person-months per user (from allocations) in a workspace
create or replace function public.planned_effort(p_workspace uuid)
returns table (user_id uuid, project_id uuid, planned_pm numeric, reported_pm numeric)
language sql stable as $$
  select a.user_id, a.project_id, sum(a.planned_pm),
         coalesce((select sum(r.actual_pm) from public.effort_reports r where r.user_id = a.user_id and r.project_id = a.project_id), 0)
  from public.effort_allocations a join public.projects p on p.id = a.project_id
  where p.workspace_id = p_workspace and a.user_id is not null and p.deleted_at is null
  group by a.user_id, a.project_id
$$;
