import { useQuery } from '@tanstack/react-query';
import { sb } from '@/lib/supabase';
import { must } from './errors';
import { qk, queryClient } from './queryClient';
import { safeUpdate, tableBackend } from './safeUpdate';

/* ------------------------------------------------------------------ types */

export interface CostCategory {
  id: string;
  project_id: string;
  code: string;
  name: string;
  kind: string;
  indirect_base: boolean;
  position: string;
}
export interface Partner {
  id: string;
  project_id: string;
  organization_id: string;
  role: string;
  short_name: string;
  position: string;
  organizations: { name: string; short_name: string; country: string } | null;
}
export interface PartnerFinance {
  partner_id: string;
  project_id: string;
  pm_rate: string | number | null;
  funding_rate: string | number | null;
  indirect_rate: string | number | null;
  notes: string;
}
export interface BudgetLine {
  id: string;
  project_id: string;
  partner_id: string | null;
  work_package_id: string | null;
  category_id: string;
  financial_year: number | null;
  reporting_period_id: string | null;
  description: string;
  amount: string | number;
  person_months: string | number | null;
  forecast_amount: string | number | null;
  source: string;
  source_ref: string;
  version: number;
}
export interface Expenditure {
  id: string;
  project_id: string;
  partner_id: string | null;
  work_package_id: string | null;
  category_id: string;
  budget_line_id: string | null;
  reporting_period_id: string | null;
  spent_on: string;
  description: string;
  supplier: string;
  invoice_ref: string;
  amount: string | number;
  status: 'committed' | 'actual';
  person_months: string | number | null;
  deleted_at: string | null;
  version: number;
}
export interface WpLite {
  id: string;
  code: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
}
export interface ReportingPeriod {
  id: string;
  project_id: string;
  code: string;
  name: string;
  start_date: string;
  end_date: string;
  due_date: string | null;
  status: string;
}

export interface FinanceData {
  categories: CostCategory[];
  partners: Partner[];
  partnerFinance: PartnerFinance[];
  lines: BudgetLine[];
  expenditures: Expenditure[];
  workPackages: WpLite[];
  periods: ReportingPeriod[];
}

const fkey = (projectId: string, ...rest: unknown[]) => qk.projectPart(projectId, 'finance', ...rest);
const invalidate = (projectId: string) => queryClient.invalidateQueries({ queryKey: qk.projectPart(projectId, 'finance') });

export function partnerLabel(p: Partner | undefined | null): string {
  if (!p) return 'Unassigned';
  return p.short_name || p.organizations?.short_name || p.organizations?.name || 'Partner';
}

/* --------------------------------------------------------------- shared */

export function usePartners(projectId: string) {
  return useQuery({
    queryKey: qk.projectPart(projectId, 'partners'),
    queryFn: async () =>
      must(await sb().from('project_partners').select('*, organizations(name, short_name, country)').eq('project_id', projectId).order('position')) as unknown as Partner[],
  });
}

export function useWorkPackagesBasic(projectId: string) {
  return useQuery({
    queryKey: qk.projectPart(projectId, 'wp-basic'),
    queryFn: async () =>
      must(await sb().from('work_packages').select('id, code, name, start_date, end_date').eq('project_id', projectId).is('deleted_at', null).order('position')) as WpLite[],
  });
}

export function useReportingPeriods(projectId: string | undefined) {
  return useQuery({
    queryKey: qk.projectPart(projectId ?? '', 'periods'),
    enabled: Boolean(projectId),
    queryFn: async () => must(await sb().from('reporting_periods').select('*').eq('project_id', projectId!).order('start_date')) as ReportingPeriod[],
  });
}

/** The reporting period containing `date` (default today), else the latest that has started. */
export function currentPeriod(periods: ReportingPeriod[], date = new Date().toISOString().slice(0, 10)): ReportingPeriod | null {
  return periods.find((p) => p.start_date <= date && p.end_date >= date) ?? [...periods].reverse().find((p) => p.start_date <= date) ?? null;
}

/* ---------------------------------------------------------------- budget */

export function useFinanceData(projectId: string, enabled = true) {
  return useQuery({
    queryKey: fkey(projectId, 'all'),
    enabled,
    queryFn: async (): Promise<FinanceData> => {
      const [categories, partners, partnerFinance, lines, expenditures, workPackages, periods] = await Promise.all([
        sb().from('cost_categories').select('*').eq('project_id', projectId).order('position'),
        sb().from('project_partners').select('*, organizations(name, short_name, country)').eq('project_id', projectId).order('position'),
        sb().from('partner_finance').select('*').eq('project_id', projectId),
        sb().from('budget_lines').select('*').eq('project_id', projectId).order('created_at'),
        sb().from('expenditures').select('*').eq('project_id', projectId).is('deleted_at', null).order('spent_on', { ascending: false }),
        sb().from('work_packages').select('id, code, name, start_date, end_date').eq('project_id', projectId).is('deleted_at', null).order('position'),
        sb().from('reporting_periods').select('*').eq('project_id', projectId).order('start_date'),
      ]);
      return {
        categories: must(categories) as CostCategory[],
        partners: must(partners) as unknown as Partner[],
        partnerFinance: must(partnerFinance) as PartnerFinance[],
        lines: must(lines) as BudgetLine[],
        expenditures: must(expenditures) as Expenditure[],
        workPackages: must(workPackages) as WpLite[],
        periods: must(periods) as ReportingPeriod[],
      };
    },
  });
}

type LineInput = Omit<BudgetLine, 'id' | 'version' | 'source' | 'source_ref'>;
export async function createLine(input: LineInput) {
  must(await sb().from('budget_lines').insert({ ...input, source: 'manual' }));
  invalidate(input.project_id);
}
export async function updateLine(line: BudgetLine, patch: Partial<BudgetLine>) {
  const res = await safeUpdate(tableBackend<BudgetLine>('budget_lines'), line, patch);
  invalidate(line.project_id);
  return res;
}
export async function deleteLine(line: BudgetLine) {
  must(await sb().from('budget_lines').delete().eq('id', line.id));
  invalidate(line.project_id);
}

type ExpInput = Omit<Expenditure, 'id' | 'version' | 'deleted_at'>;
export async function createExpenditure(input: ExpInput): Promise<string> {
  const row = must(await sb().from('expenditures').insert(input).select('id').single()) as { id: string };
  invalidate(input.project_id);
  return row.id;
}
export async function updateExpenditure(e: Expenditure, patch: Partial<Expenditure>) {
  const res = await safeUpdate(tableBackend<Expenditure>('expenditures'), e, patch);
  invalidate(e.project_id);
  return res;
}
export async function trashExpenditure(e: Expenditure, trashed: boolean) {
  const res = await safeUpdate(tableBackend<Expenditure>('expenditures'), e, { deleted_at: trashed ? new Date().toISOString() : null });
  invalidate(e.project_id);
  return res;
}

export async function savePartnerFinance(projectId: string, partnerId: string, patch: Partial<PartnerFinance>) {
  must(await sb().from('partner_finance').upsert({ partner_id: partnerId, project_id: projectId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'partner_id' }));
  invalidate(projectId);
}

export async function saveCategory(c: Partial<CostCategory> & { project_id: string }) {
  const { id, ...rest } = c;
  if (id) must(await sb().from('cost_categories').update(rest).eq('id', id));
  else must(await sb().from('cost_categories').insert(rest));
  invalidate(c.project_id);
}
export async function deleteCategory(c: CostCategory) {
  must(await sb().from('cost_categories').delete().eq('id', c.id));
  invalidate(c.project_id);
}

/* ----------------------------------------------------------------- audit */

export interface AuditRow {
  id: number;
  table_name: string;
  row_id: string | null;
  op: string;
  actor_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  created_at: string;
}
export function useFinanceAudit(projectId: string, limit: number) {
  return useQuery({
    queryKey: fkey(projectId, 'audit', limit),
    queryFn: async () =>
      must(await sb().from('finance_audit').select('*').eq('project_id', projectId).order('created_at', { ascending: false }).limit(limit)) as AuditRow[],
  });
}

/* ---------------------------------------------------------------- effort */

export interface Allocation {
  id: string;
  project_id: string;
  partner_id: string | null;
  work_package_id: string | null;
  user_id: string | null;
  role_title: string;
  financial_year: number | null;
  reporting_period_id: string | null;
  planned_pm: string | number;
}
export interface EffortReport {
  id: string;
  project_id: string;
  partner_id: string | null;
  work_package_id: string | null;
  user_id: string | null;
  reporting_period_id: string | null;
  period_start: string;
  period_end: string;
  actual_pm: string | number;
  note: string;
}
export interface TimeRow {
  user_id: string;
  minutes: number | null;
  entry_date: string;
  card_id: string | null;
  cards: { work_package_id: string | null } | null;
}

export function useEffortData(projectId: string) {
  return useQuery({
    queryKey: fkey(projectId, 'effort'),
    queryFn: async () => {
      const [allocations, reports, time] = await Promise.all([
        sb().from('effort_allocations').select('*').eq('project_id', projectId).order('created_at'),
        sb().from('effort_reports').select('*').eq('project_id', projectId).order('period_start', { ascending: false }),
        sb().from('time_entries').select('user_id, minutes, entry_date, card_id, cards(work_package_id)').eq('project_id', projectId).not('minutes', 'is', null),
      ]);
      return {
        allocations: must(allocations) as Allocation[],
        reports: must(reports) as EffortReport[],
        time: must(time) as unknown as TimeRow[],
      };
    },
  });
}

export async function saveAllocation(a: Partial<Allocation> & { project_id: string; planned_pm: string }) {
  const { id, ...rest } = a;
  if (id) must(await sb().from('effort_allocations').update(rest).eq('id', id));
  else must(await sb().from('effort_allocations').insert(rest));
  invalidate(a.project_id);
}
export async function deleteAllocation(a: Allocation) {
  must(await sb().from('effort_allocations').delete().eq('id', a.id));
  invalidate(a.project_id);
}
export async function saveEffortReport(r: Partial<EffortReport> & { project_id: string; period_start: string; period_end: string; actual_pm: string }) {
  const { id, ...rest } = r;
  if (id) must(await sb().from('effort_reports').update(rest).eq('id', id));
  else must(await sb().from('effort_reports').insert(rest));
  invalidate(r.project_id);
}
export async function deleteEffortReport(r: EffortReport) {
  must(await sb().from('effort_reports').delete().eq('id', r.id));
  invalidate(r.project_id);
}

/* -------------------------------------------------------------- evidence */

export interface EvidenceItem {
  id: string;
  project_id: string;
  entity_type: string;
  entity_id: string;
  title: string;
  required: boolean;
  status: 'missing' | 'submitted' | 'verified' | 'rejected';
  attachment_id: string | null;
  url: string | null;
  due_date: string | null;
  note: string;
  is_finance: boolean;
  submitted_at: string | null;
  verified_at: string | null;
}

export function useEvidence(projectId: string, entityType: string, entityId?: string) {
  return useQuery({
    queryKey: qk.projectPart(projectId, 'evidence', entityType, entityId ?? 'all'),
    queryFn: async () => {
      let q = sb().from('evidence_items').select('*').eq('project_id', projectId).eq('entity_type', entityType).order('created_at');
      if (entityId) q = q.eq('entity_id', entityId);
      return must(await q) as EvidenceItem[];
    },
  });
}
const invalidateEvidence = (projectId: string) => {
  queryClient.invalidateQueries({ queryKey: qk.projectPart(projectId, 'evidence') });
  queryClient.invalidateQueries({ queryKey: qk.projectPart(projectId, 'kpis') });
  queryClient.invalidateQueries({ queryKey: qk.projectPart(projectId, 'attachments') });
};
export async function addEvidence(input: { project_id: string; entity_type: string; entity_id: string; title: string; required?: boolean; url?: string | null; due_date?: string | null }) {
  must(await sb().from('evidence_items').insert({ required: true, ...input }));
  invalidateEvidence(input.project_id);
}
export async function updateEvidence(e: EvidenceItem, patch: Partial<EvidenceItem>) {
  must(await sb().from('evidence_items').update(patch).eq('id', e.id));
  invalidateEvidence(e.project_id);
}
export async function deleteEvidence(e: EvidenceItem) {
  must(await sb().from('evidence_items').delete().eq('id', e.id));
  invalidateEvidence(e.project_id);
}
/** Link the most recent attachment of an entity to an evidence item (after an upload). */
export async function linkLatestAttachment(e: EvidenceItem) {
  const att = must(
    await sb().from('attachments').select('id').eq('project_id', e.project_id).eq('entity_id', e.entity_id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ) as { id: string } | null;
  if (att) await updateEvidence(e, { attachment_id: att.id });
}

/* ------------------------------------------------------------------ KPIs */

export interface Kpi {
  id: string;
  project_id: string;
  work_package_id: string | null;
  code: string;
  name: string;
  description: string;
  unit: string;
  direction: 'increase' | 'decrease' | 'maintain';
  baseline: string | number | null;
  target: string | number | null;
  target_date: string | null;
  aggregation: 'latest' | 'sum' | 'max';
  frequency: 'once' | 'monthly' | 'quarterly' | 'period' | 'annual';
  verification: string;
  evidence_required: boolean;
  responsible_org_id: string | null;
  owner_id: string | null;
  position: string;
  deleted_at: string | null;
  version: number;
}
export interface KpiMeasurement {
  id: string;
  kpi_id: string;
  project_id: string;
  partner_id: string | null;
  reporting_period_id: string | null;
  measured_on: string;
  value: string | number;
  note: string;
  verification_status: 'unverified' | 'verified' | 'rejected';
  verified_by: string | null;
  created_by: string | null;
  created_at: string;
}
export interface KpiStatus {
  kpi_id: string;
  current_value: string | number | null;
  last_measured: string | null;
  measurements: number;
  verified: number;
  evidence_missing: number;
}

export function useKpis(projectId: string, enabled = true) {
  return useQuery({
    queryKey: qk.projectPart(projectId, 'kpis'),
    enabled,
    queryFn: async () => {
      const [kpis, measurements, status] = await Promise.all([
        sb().from('kpis').select('*').eq('project_id', projectId).is('deleted_at', null).order('position').order('code'),
        sb().from('kpi_measurements').select('*').eq('project_id', projectId).order('measured_on'),
        sb().rpc('kpi_status', { p_project: projectId }),
      ]);
      return { kpis: must(kpis) as Kpi[], measurements: must(measurements) as KpiMeasurement[], status: must(status) as KpiStatus[] };
    },
  });
}
const invalidateKpis = (projectId: string) => queryClient.invalidateQueries({ queryKey: qk.projectPart(projectId, 'kpis') });

export async function createKpi(input: Partial<Kpi> & { project_id: string; name: string }) {
  const row = must(await sb().from('kpis').insert(input).select('id').single()) as { id: string };
  invalidateKpis(input.project_id);
  return row.id;
}
export async function updateKpi(k: Kpi, patch: Partial<Kpi>) {
  const res = await safeUpdate(tableBackend<Kpi>('kpis'), k, patch);
  invalidateKpis(k.project_id);
  return res;
}
export async function addMeasurement(input: { kpi_id: string; project_id: string; measured_on: string; value: string; note?: string; reporting_period_id?: string | null; partner_id?: string | null }) {
  must(await sb().from('kpi_measurements').insert(input));
  invalidateKpis(input.project_id);
}
export async function setMeasurementStatus(m: KpiMeasurement, status: KpiMeasurement['verification_status']) {
  must(await sb().from('kpi_measurements').update({ verification_status: status }).eq('id', m.id));
  invalidateKpis(m.project_id);
}
export async function deleteMeasurement(m: KpiMeasurement) {
  must(await sb().from('kpi_measurements').delete().eq('id', m.id));
  invalidateKpis(m.project_id);
}

/* --------------------------------------------------------------- imports */

export async function importPlan(projectId: string, payload: unknown) {
  const res = must(await sb().rpc('import_plan', { p_project: projectId, p_payload: payload })) as { board_id: string; work_packages: number; cards: number; milestones: number };
  queryClient.invalidateQueries({ queryKey: qk.project(projectId) });
  queryClient.invalidateQueries({ queryKey: ['ws'] });
  return res;
}
export async function importBudget(projectId: string, payload: unknown) {
  const res = must(await sb().rpc('import_budget', { p_project: projectId, p_payload: payload })) as { partners: number; categories: number; lines: number; work_packages: number };
  queryClient.invalidateQueries({ queryKey: qk.project(projectId) });
  queryClient.invalidateQueries({ queryKey: ['ws'] });
  return res;
}

/** Everything needed to export the project plan in the office workbook layout. */
export async function fetchPlanForExport(projectId: string) {
  const [wps, cards, ms, orgs] = await Promise.all([
    sb().from('work_packages').select('id, code, name, lead_org_id, start_date, end_date').eq('project_id', projectId).is('deleted_at', null).order('position'),
    sb()
      .from('cards')
      .select('id, title, parent_id, work_package_id, responsible_text, schedule, start_date, due_date, status, position')
      .eq('project_id', projectId)
      .is('deleted_at', null)
      .is('archived_at', null)
      .eq('is_template', false)
      .not('work_package_id', 'is', null)
      .order('position'),
    sb().from('milestones').select('code, title, work_package_id, due_date, verification, status, notes').eq('project_id', projectId).is('deleted_at', null).order('due_date'),
    sb().from('organizations').select('id, name, short_name'),
  ]);
  return {
    workPackages: must(wps) as { id: string; code: string; name: string; lead_org_id: string | null; start_date: string | null; end_date: string | null }[],
    cards: must(cards) as {
      id: string;
      title: string;
      parent_id: string | null;
      work_package_id: string;
      responsible_text: string;
      schedule: { planned?: number[]; due?: number[]; done?: number[] } | null;
      start_date: string | null;
      due_date: string | null;
      status: string;
      position: string;
    }[],
    milestones: must(ms) as { code: string; title: string; work_package_id: string | null; due_date: string | null; verification: string; status: string; notes: string }[],
    orgs: must(orgs) as { id: string; name: string; short_name: string }[],
  };
}

/* --------------------------------------------------------------- reports */

export interface WpProgress {
  work_package_id: string;
  tasks_total: number;
  tasks_done: number;
  tasks_overdue: number;
  actual_progress: string | number;
  planned_progress: string | number | null;
  estimate_minutes: number;
  logged_minutes: number;
  milestones_total: number;
  milestones_done: number;
}
export interface ProjectSummary {
  tasks_total: number;
  tasks_done: number;
  tasks_overdue: number;
  tasks_blocked: number;
  tasks_unassigned: number;
  milestones_total: number;
  milestones_done: number;
  milestones_overdue: number;
  milestones_at_risk: number;
  evidence_missing: number;
  risks_open: number;
  risks_high: number;
  issues_open: number;
}
export interface MilestoneRow {
  id: string;
  code: string;
  title: string;
  kind: string;
  due_date: string | null;
  actual_date: string | null;
  status: string;
  approval_status: string;
  work_package_id: string | null;
  verification: string;
}
export interface RiskRow {
  id: string;
  kind: 'risk' | 'issue';
  code: string;
  title: string;
  probability: number;
  impact: number;
  score: number;
  status: string;
  mitigation: string;
  review_date: string | null;
  owner_id: string | null;
}

export function useReportData(projectId: string | undefined) {
  return useQuery({
    queryKey: qk.projectPart(projectId ?? '', 'report'),
    enabled: Boolean(projectId),
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const [summary, progress, wps, ms, risks, evidence, overdue] = await Promise.all([
        sb().rpc('project_summary', { p_project: projectId }),
        sb().rpc('work_package_progress', { p_project: projectId }),
        sb().from('work_packages').select('id, code, name, start_date, end_date').eq('project_id', projectId!).is('deleted_at', null).order('position'),
        sb()
          .from('milestones')
          .select('id, code, title, kind, due_date, actual_date, status, approval_status, work_package_id, verification')
          .eq('project_id', projectId!)
          .is('deleted_at', null)
          .order('due_date'),
        sb().from('risks').select('id, kind, code, title, probability, impact, score, status, mitigation, review_date, owner_id').eq('project_id', projectId!).is('deleted_at', null).order('score', { ascending: false }),
        sb().from('evidence_items').select('*').eq('project_id', projectId!).eq('required', true).in('status', ['missing', 'rejected']),
        sb()
          .from('cards')
          .select('id, title, due_date, board_id')
          .eq('project_id', projectId!)
          .is('deleted_at', null)
          .is('archived_at', null)
          .eq('is_template', false)
          .neq('status', 'done')
          .lt('due_date', today)
          .order('due_date')
          .limit(100),
      ]);
      return {
        summary: (must(summary) as ProjectSummary[])[0] ?? null,
        progress: must(progress) as WpProgress[],
        workPackages: must(wps) as WpLite[],
        milestones: must(ms) as MilestoneRow[],
        risks: must(risks) as RiskRow[],
        evidenceMissing: must(evidence) as EvidenceItem[],
        overdueTasks: must(overdue) as { id: string; title: string; due_date: string; board_id: string }[],
      };
    },
  });
}
