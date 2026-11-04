/**
 * Project controls: work packages, milestones & deliverables, evidence, risks,
 * meetings, reporting periods and partners. All rows are protected by RLS;
 * financial figures are only queried when the caller has finance access.
 */
import { useQuery } from '@tanstack/react-query';
import { sb } from '@/lib/supabase';
import { must } from './errors';
import { qk, queryClient } from './queryClient';
import { safeUpdate, tableBackend } from './safeUpdate';
import type { ActivityEntry, CardStatus } from './types';

const inval = (projectId: string) => {
  queryClient.invalidateQueries({ queryKey: qk.project(projectId) });
  queryClient.invalidateQueries({ queryKey: ['global'] });
};

/* ============================================================ Work packages */

export type WpStatus = 'not_started' | 'in_progress' | 'completed' | 'on_hold' | 'cancelled';

export interface WorkPackage {
  id: string;
  project_id: string;
  code: string;
  name: string;
  description: string;
  objectives: string;
  lead_org_id: string | null;
  start_date: string | null;
  end_date: string | null;
  status: WpStatus;
  progress_mode: 'tasks' | 'manual';
  manual_progress: number | null;
  color: string;
  position: string;
  deleted_at: string | null;
  version: number;
}

export interface WpMember {
  work_package_id: string;
  user_id: string;
  project_id: string;
  role: 'lead' | 'responsible' | 'contributor';
}

export interface WpDependency {
  predecessor_id: string;
  successor_id: string;
  project_id: string;
}

export interface WpProgress {
  work_package_id: string;
  tasks_total: number;
  tasks_done: number;
  tasks_overdue: number;
  actual_progress: number;
  planned_progress: number | null;
  estimate_minutes: number;
  logged_minutes: number;
  milestones_total: number;
  milestones_done: number;
}

export const WP_STATUS_LABEL: Record<WpStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  completed: 'Completed',
  on_hold: 'On hold',
  cancelled: 'Cancelled',
};

export function useWorkPackages(projectId: string, includeDeleted = false) {
  return useQuery({
    queryKey: qk.projectPart(projectId, 'wps', includeDeleted),
    queryFn: async () => {
      let q = sb().from('work_packages').select('*').eq('project_id', projectId).order('position').order('code');
      if (!includeDeleted) q = q.is('deleted_at', null);
      return must(await q) as WorkPackage[];
    },
  });
}

export function useWpMembers(projectId: string) {
  return useQuery({
    queryKey: qk.projectPart(projectId, 'wp-members'),
    queryFn: async () => must(await sb().from('wp_members').select('*').eq('project_id', projectId)) as WpMember[],
  });
}

export function useWpDependencies(projectId: string) {
  return useQuery({
    queryKey: qk.projectPart(projectId, 'wp-deps'),
    queryFn: async () => must(await sb().from('wp_dependencies').select('*').eq('project_id', projectId)) as WpDependency[],
  });
}

export function useWpProgress(projectId: string) {
  return useQuery({
    queryKey: qk.projectPart(projectId, 'wp-progress'),
    queryFn: async () =>
      (must(await sb().rpc('work_package_progress', { p_project: projectId })) as WpProgress[]).map((r) => ({
        ...r,
        actual_progress: Number(r.actual_progress ?? 0),
        planned_progress: r.planned_progress == null ? null : Number(r.planned_progress),
        estimate_minutes: Number(r.estimate_minutes ?? 0),
        logged_minutes: Number(r.logged_minutes ?? 0),
      })),
  });
}

export type WpInput = Pick<
  WorkPackage,
  'code' | 'name' | 'description' | 'objectives' | 'lead_org_id' | 'start_date' | 'end_date' | 'status' | 'progress_mode' | 'manual_progress'
>;

export async function saveWorkPackage(projectId: string, input: WpInput, existing?: WorkPackage, position?: string): Promise<WorkPackage> {
  let row: WorkPackage;
  if (existing) row = await safeUpdate(tableBackend<WorkPackage>('work_packages'), existing, input);
  else row = must(await sb().from('work_packages').insert({ ...input, project_id: projectId, position: position ?? 'a0' }).select('*').single()) as WorkPackage;
  inval(projectId);
  return row;
}

export async function setWorkPackageDeleted(wp: WorkPackage, deleted: boolean): Promise<WorkPackage> {
  const fresh = (must(await sb().from('work_packages').select('*').eq('id', wp.id).single()) as WorkPackage) ?? wp;
  const row = await safeUpdate(tableBackend<WorkPackage>('work_packages'), fresh, { deleted_at: deleted ? new Date().toISOString() : null });
  inval(wp.project_id);
  return row;
}

/** Replace the responsible people of a work package. */
export async function setWpMembers(projectId: string, wpId: string, members: { user_id: string; role: WpMember['role'] }[], current: WpMember[]) {
  const keep = new Set(members.map((m) => m.user_id));
  const toRemove = current.filter((m) => m.work_package_id === wpId && !keep.has(m.user_id)).map((m) => m.user_id);
  if (toRemove.length) must(await sb().from('wp_members').delete().eq('work_package_id', wpId).in('user_id', toRemove));
  if (members.length)
    must(
      await sb()
        .from('wp_members')
        .upsert(
          members.map((m) => ({ work_package_id: wpId, user_id: m.user_id, role: m.role, project_id: projectId })),
          { onConflict: 'work_package_id,user_id' },
        ),
    );
  inval(projectId);
}

export async function setWpPredecessors(projectId: string, wpId: string, predecessors: string[], current: WpDependency[]) {
  const existing = current.filter((d) => d.successor_id === wpId).map((d) => d.predecessor_id);
  const remove = existing.filter((p) => !predecessors.includes(p));
  const add = predecessors.filter((p) => !existing.includes(p));
  if (remove.length) must(await sb().from('wp_dependencies').delete().eq('successor_id', wpId).in('predecessor_id', remove));
  for (const p of add) must(await sb().from('wp_dependencies').insert({ predecessor_id: p, successor_id: wpId, project_id: projectId }));
  inval(projectId);
}

/* ============================================================ Lightweight links */

export interface CardLite {
  id: string;
  title: string;
  status: CardStatus;
  due_date: string | null;
  work_package_id: string | null;
  milestone_id: string | null;
  board_id: string;
  version: number;
}

export function useProjectCardsLite(projectId: string) {
  return useQuery({
    queryKey: qk.projectPart(projectId, 'cards-lite'),
    queryFn: async () =>
      must(
        await sb()
          .from('cards')
          .select('id, title, status, due_date, work_package_id, milestone_id, board_id, version')
          .eq('project_id', projectId)
          .is('deleted_at', null)
          .is('archived_at', null)
          .eq('is_template', false)
          .order('due_date', { ascending: true, nullsFirst: false }),
      ) as CardLite[],
  });
}

export async function setCardMilestone(projectId: string, card: CardLite, milestoneId: string | null) {
  const { updateCard } = await import('./cards');
  const full = must(await sb().from('cards').select('*').eq('id', card.id).single());
  await updateCard(full as never, { milestone_id: milestoneId });
  inval(projectId);
}

export function useKpisLite(projectId: string, enabled: boolean) {
  return useQuery({
    queryKey: qk.projectPart(projectId, 'kpis-lite'),
    enabled,
    queryFn: async () =>
      must(
        await sb().from('kpis').select('id, code, name, unit, target, work_package_id').eq('project_id', projectId).is('deleted_at', null).order('position'),
      ) as { id: string; code: string; name: string; unit: string; target: number | null; work_package_id: string | null }[],
  });
}

/** Planned person-months per work package (effort is visible to project members). */
export function useEffortByWp(projectId: string) {
  return useQuery({
    queryKey: qk.projectPart(projectId, 'effort-by-wp'),
    queryFn: async () => {
      const rows = must(await sb().from('effort_allocations').select('work_package_id, planned_pm').eq('project_id', projectId)) as {
        work_package_id: string | null;
        planned_pm: number;
      }[];
      const map = new Map<string, number>();
      for (const r of rows) if (r.work_package_id) map.set(r.work_package_id, (map.get(r.work_package_id) ?? 0) + Number(r.planned_pm));
      return map;
    },
  });
}

/** Allocated budget per WP — only call with finance access (RLS hides it otherwise). */
export function useBudgetByWp(projectId: string, enabled: boolean) {
  return useQuery({
    queryKey: qk.projectPart(projectId, 'budget-by-wp'),
    enabled,
    queryFn: async () => {
      const rows = must(await sb().from('budget_lines').select('work_package_id, amount, person_months').eq('project_id', projectId)) as {
        work_package_id: string | null;
        amount: number;
        person_months: number | null;
      }[];
      const map = new Map<string, { amountCents: number; pm: number }>();
      for (const r of rows) {
        if (!r.work_package_id) continue;
        const cur = map.get(r.work_package_id) ?? { amountCents: 0, pm: 0 };
        // amounts are numeric(14,2); sum in integer cents to stay exact
        cur.amountCents += Math.round(Number(r.amount) * 100);
        cur.pm += Number(r.person_months ?? 0);
        map.set(r.work_package_id, cur);
      }
      return map;
    },
  });
}

/* ============================================================= Milestones */

export type MilestoneKind = 'milestone' | 'deliverable' | 'report' | 'event' | 'control';
export type MilestoneStatus = 'planned' | 'on_track' | 'at_risk' | 'delayed' | 'done' | 'cancelled';
export type ApprovalStatus = 'not_required' | 'not_submitted' | 'submitted' | 'approved' | 'rejected';

export interface Milestone {
  id: string;
  project_id: string;
  work_package_id: string | null;
  code: string;
  title: string;
  description: string;
  kind: MilestoneKind;
  due_date: string | null;
  actual_date: string | null;
  status: MilestoneStatus;
  approval_status: ApprovalStatus;
  verification: string;
  evidence_required: boolean;
  responsible_org_id: string | null;
  owner_id: string | null;
  dissemination: string;
  notes: string;
  approved_by: string | null;
  approved_at: string | null;
  position: string;
  deleted_at: string | null;
  version: number;
}

export const MILESTONE_KIND_LABEL: Record<MilestoneKind, string> = {
  milestone: 'Milestone',
  deliverable: 'Deliverable',
  report: 'Report',
  event: 'Event',
  control: 'Control point',
};
export const MILESTONE_STATUS_LABEL: Record<MilestoneStatus, string> = {
  planned: 'Planned',
  on_track: 'On track',
  at_risk: 'At risk',
  delayed: 'Delayed',
  done: 'Done',
  cancelled: 'Cancelled',
};
export const APPROVAL_LABEL: Record<ApprovalStatus, string> = {
  not_required: 'Not required',
  not_submitted: 'Not submitted',
  submitted: 'Submitted',
  approved: 'Approved',
  rejected: 'Rejected',
};

export function useMilestones(projectId: string, includeDeleted = false) {
  return useQuery({
    queryKey: qk.projectPart(projectId, 'milestones', includeDeleted),
    queryFn: async () => {
      let q = sb().from('milestones').select('*').eq('project_id', projectId).order('due_date', { ascending: true, nullsFirst: false }).order('position');
      if (!includeDeleted) q = q.is('deleted_at', null);
      return must(await q) as Milestone[];
    },
  });
}

export type MilestoneInput = Partial<Omit<Milestone, 'id' | 'project_id' | 'version' | 'approved_by' | 'approved_at'>>;

export async function saveMilestone(projectId: string, input: MilestoneInput, existing?: Milestone): Promise<Milestone> {
  let row: Milestone;
  if (existing) row = await safeUpdate<Milestone>(tableBackend<Milestone>('milestones'), existing, input);
  else row = must(await sb().from('milestones').insert({ ...input, project_id: projectId }).select('*').single()) as Milestone;
  inval(projectId);
  return row;
}

export async function updateMilestone(ms: Milestone, patch: MilestoneInput): Promise<Milestone> {
  const row = await safeUpdate<Milestone>(tableBackend<Milestone>('milestones'), ms, patch);
  inval(ms.project_id);
  return row;
}

export interface MilestoneDependency {
  predecessor_id: string;
  successor_id: string;
  project_id: string;
}

export function useMilestoneDependencies(projectId: string) {
  return useQuery({
    queryKey: qk.projectPart(projectId, 'ms-deps'),
    queryFn: async () => must(await sb().from('milestone_dependencies').select('*').eq('project_id', projectId)) as MilestoneDependency[],
  });
}

export async function setMilestonePredecessors(projectId: string, msId: string, predecessors: string[], current: MilestoneDependency[]) {
  const existing = current.filter((d) => d.successor_id === msId).map((d) => d.predecessor_id);
  const remove = existing.filter((p) => !predecessors.includes(p));
  const add = predecessors.filter((p) => !existing.includes(p));
  if (remove.length) must(await sb().from('milestone_dependencies').delete().eq('successor_id', msId).in('predecessor_id', remove));
  for (const p of add) must(await sb().from('milestone_dependencies').insert({ predecessor_id: p, successor_id: msId, project_id: projectId }));
  inval(projectId);
}

export function useEntityHistory(projectId: string, entityId: string | undefined) {
  return useQuery({
    queryKey: qk.projectPart(projectId, 'history', entityId),
    enabled: Boolean(entityId),
    queryFn: async () =>
      must(
        await sb().from('activity_log').select('*').eq('project_id', projectId).eq('entity_id', entityId!).order('created_at', { ascending: false }).limit(100),
      ) as ActivityEntry[],
  });
}

/* =============================================================== Evidence */

export type EvidenceStatus = 'missing' | 'submitted' | 'verified' | 'rejected';
export interface EvidenceItem {
  id: string;
  project_id: string;
  entity_type: string;
  entity_id: string;
  title: string;
  required: boolean;
  status: EvidenceStatus;
  attachment_id: string | null;
  url: string | null;
  due_date: string | null;
  note: string;
  is_finance: boolean;
  submitted_by: string | null;
  submitted_at: string | null;
  verified_by: string | null;
  verified_at: string | null;
  created_at: string;
}

export const EVIDENCE_LABEL: Record<EvidenceStatus, string> = {
  missing: 'Missing',
  submitted: 'Submitted',
  verified: 'Verified',
  rejected: 'Rejected',
};

export function useEvidence(projectId: string, entityType: string) {
  return useQuery({
    queryKey: qk.projectPart(projectId, 'evidence', entityType),
    queryFn: async () =>
      must(await sb().from('evidence_items').select('*').eq('project_id', projectId).eq('entity_type', entityType).order('created_at')) as EvidenceItem[],
  });
}

export async function addEvidence(projectId: string, entityType: string, entityId: string, title: string, opts: { required?: boolean; url?: string | null; due_date?: string | null } = {}) {
  must(
    await sb()
      .from('evidence_items')
      .insert({
        project_id: projectId,
        entity_type: entityType,
        entity_id: entityId,
        title,
        required: opts.required ?? true,
        url: opts.url || null,
        due_date: opts.due_date || null,
      }),
  );
  inval(projectId);
}

export async function updateEvidence(ev: EvidenceItem, patch: Partial<Pick<EvidenceItem, 'status' | 'url' | 'attachment_id' | 'note' | 'title' | 'required'>>) {
  must(await sb().from('evidence_items').update(patch).eq('id', ev.id));
  inval(ev.project_id);
}

export async function deleteEvidence(ev: EvidenceItem) {
  must(await sb().from('evidence_items').delete().eq('id', ev.id));
  inval(ev.project_id);
}

/** Upload a file as evidence: stored as an attachment, then linked to the evidence item. */
export async function attachEvidenceFile(ev: EvidenceItem, file: File) {
  const { uploadAttachment } = await import('./cardExtras');
  const entityType = (['milestone', 'kpi', 'expense', 'risk', 'meeting', 'work_package'] as const).find((t) => t === ev.entity_type) ?? 'evidence';
  const id = await uploadAttachment(ev.project_id, file, {
    entityType,
    entityId: ev.entity_id,
    finance: ev.entity_type === 'expense',
  });
  await updateEvidence(ev, ev.status === 'rejected' ? { attachment_id: id, status: 'submitted' } : { attachment_id: id });
}

/* ================================================================== Risks */

export type RiskStatus = 'open' | 'monitoring' | 'mitigated' | 'occurred' | 'closed';
export interface Risk {
  id: string;
  project_id: string;
  work_package_id: string | null;
  kind: 'risk' | 'issue';
  code: string;
  title: string;
  description: string;
  category: string;
  probability: number;
  impact: number;
  score: number;
  mitigation: string;
  contingency: string;
  owner_id: string | null;
  status: RiskStatus;
  review_date: string | null;
  raised_on: string;
  resolved_on: string | null;
  deleted_at: string | null;
  version: number;
}

export const RISK_STATUS_LABEL: Record<RiskStatus, string> = {
  open: 'Open',
  monitoring: 'Monitoring',
  mitigated: 'Mitigated',
  occurred: 'Occurred',
  closed: 'Closed',
};

export function useRisks(projectId: string) {
  return useQuery({
    queryKey: qk.projectPart(projectId, 'risks'),
    queryFn: async () => must(await sb().from('risks').select('*').eq('project_id', projectId).is('deleted_at', null).order('score', { ascending: false })) as Risk[],
  });
}

export type RiskInput = Partial<Omit<Risk, 'id' | 'project_id' | 'score' | 'version'>>;

export async function saveRisk(projectId: string, input: RiskInput, existing?: Risk): Promise<Risk> {
  let row: Risk;
  if (existing) row = await safeUpdate<Risk>(tableBackend<Risk>('risks'), existing, input);
  else row = must(await sb().from('risks').insert({ ...input, project_id: projectId }).select('*').single()) as Risk;
  inval(projectId);
  return row;
}

/* =============================================================== Meetings */

export interface Meeting {
  id: string;
  project_id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  location: string;
  online_url: string | null;
  agenda: string;
  minutes: string;
  status: 'planned' | 'held' | 'cancelled';
  attendees: string[];
  external_attendees: string;
  created_by: string | null;
  deleted_at: string | null;
  version: number;
}
export interface MeetingDecision {
  id: string;
  meeting_id: string;
  project_id: string;
  text: string;
  position: string;
  created_at: string;
}
export interface MeetingAction {
  id: string;
  meeting_id: string;
  project_id: string;
  title: string;
  owner_id: string | null;
  due_date: string | null;
  status: 'open' | 'done';
  card_id: string | null;
  position: string;
  created_at: string;
}

export function useMeetings(projectId: string) {
  return useQuery({
    queryKey: qk.projectPart(projectId, 'meetings'),
    queryFn: async () => must(await sb().from('meetings').select('*').eq('project_id', projectId).is('deleted_at', null).order('starts_at', { ascending: false })) as Meeting[],
  });
}

export function useMeetingDetail(projectId: string, meetingId: string | undefined) {
  return useQuery({
    queryKey: qk.projectPart(projectId, 'meeting', meetingId),
    enabled: Boolean(meetingId),
    queryFn: async () => {
      const [d, a] = await Promise.all([
        sb().from('meeting_decisions').select('*').eq('meeting_id', meetingId!).order('position').order('created_at'),
        sb().from('meeting_actions').select('*').eq('meeting_id', meetingId!).order('position').order('created_at'),
      ]);
      return { decisions: must(d) as MeetingDecision[], actions: must(a) as MeetingAction[] };
    },
  });
}

export type MeetingInput = Partial<Omit<Meeting, 'id' | 'project_id' | 'version' | 'created_by'>>;

export async function saveMeeting(projectId: string, input: MeetingInput, existing?: Meeting): Promise<Meeting> {
  let row: Meeting;
  if (existing) row = await safeUpdate<Meeting>(tableBackend<Meeting>('meetings'), existing, input);
  else row = must(await sb().from('meetings').insert({ ...input, project_id: projectId }).select('*').single()) as Meeting;
  inval(projectId);
  return row;
}

export async function addDecision(projectId: string, meetingId: string, text: string, position: string) {
  must(await sb().from('meeting_decisions').insert({ meeting_id: meetingId, project_id: projectId, text, position }));
  inval(projectId);
}
export async function deleteDecision(d: MeetingDecision) {
  must(await sb().from('meeting_decisions').delete().eq('id', d.id));
  inval(d.project_id);
}
export async function addAction(projectId: string, meetingId: string, input: { title: string; owner_id: string | null; due_date: string | null; position: string }) {
  must(await sb().from('meeting_actions').insert({ meeting_id: meetingId, project_id: projectId, ...input }));
  inval(projectId);
}
export async function updateAction(a: MeetingAction, patch: Partial<Pick<MeetingAction, 'title' | 'owner_id' | 'due_date' | 'status'>>) {
  must(await sb().from('meeting_actions').update(patch).eq('id', a.id));
  inval(a.project_id);
}
export async function deleteAction(a: MeetingAction) {
  must(await sb().from('meeting_actions').delete().eq('id', a.id));
  inval(a.project_id);
}
export async function actionToCard(a: MeetingAction, listId: string): Promise<string> {
  const id = must(await sb().rpc('action_to_card', { p_action: a.id, p_list: listId })) as string;
  inval(a.project_id);
  return id;
}

/* ====================================================== Reporting periods */

export interface ReportingPeriod {
  id: string;
  project_id: string;
  code: string;
  name: string;
  start_date: string;
  end_date: string;
  due_date: string | null;
  status: 'open' | 'in_preparation' | 'submitted' | 'approved';
  notes: string;
}

export const PERIOD_STATUS_LABEL: Record<ReportingPeriod['status'], string> = {
  open: 'Open',
  in_preparation: 'In preparation',
  submitted: 'Submitted',
  approved: 'Approved',
};

export function useReportingPeriods(projectId: string) {
  return useQuery({
    queryKey: qk.projectPart(projectId, 'periods'),
    queryFn: async () => must(await sb().from('reporting_periods').select('*').eq('project_id', projectId).order('start_date')) as ReportingPeriod[],
  });
}

export async function saveReportingPeriod(projectId: string, input: Omit<ReportingPeriod, 'id' | 'project_id'>, id?: string) {
  if (id) must(await sb().from('reporting_periods').update(input).eq('id', id));
  else must(await sb().from('reporting_periods').insert({ ...input, project_id: projectId }));
  inval(projectId);
}
export async function deleteReportingPeriod(p: ReportingPeriod) {
  must(await sb().from('reporting_periods').delete().eq('id', p.id));
  inval(p.project_id);
}
export async function generateReportingPeriods(projectId: string, months: number, dueAfterDays: number): Promise<number> {
  const n = must(await sb().rpc('generate_reporting_periods', { p_project: projectId, p_months: months, p_due_after_days: dueAfterDays })) as number;
  inval(projectId);
  return n;
}

/* ================================================================ Partners */

export interface ProjectPartner {
  id: string;
  project_id: string;
  organization_id: string;
  role: 'coordinator' | 'partner' | 'associated' | 'subcontractor' | 'third_party';
  short_name: string;
  contact_user_id: string | null;
  position: string;
  created_at: string;
}

export const PARTNER_ROLE_LABEL: Record<ProjectPartner['role'], string> = {
  coordinator: 'Coordinator',
  partner: 'Partner',
  associated: 'Associated partner',
  subcontractor: 'Subcontractor',
  third_party: 'Third party',
};

export function usePartners(projectId: string) {
  return useQuery({
    queryKey: qk.projectPart(projectId, 'partners'),
    queryFn: async () => must(await sb().from('project_partners').select('*').eq('project_id', projectId).order('position').order('created_at')) as ProjectPartner[],
  });
}

export async function addPartner(projectId: string, input: { organization_id: string; role: ProjectPartner['role']; short_name: string; position: string; contact_user_id?: string | null }) {
  must(await sb().from('project_partners').insert({ ...input, project_id: projectId }));
  inval(projectId);
}
export async function updatePartner(p: ProjectPartner, patch: Partial<Pick<ProjectPartner, 'role' | 'short_name' | 'contact_user_id'>>) {
  must(await sb().from('project_partners').update(patch).eq('id', p.id));
  inval(p.project_id);
}
export async function removePartner(p: ProjectPartner) {
  must(await sb().from('project_partners').delete().eq('id', p.id));
  inval(p.project_id);
}

/** Create an organisation in the workspace and return its id. */
export async function createOrganization(workspaceId: string, input: { name: string; short_name: string; country: string; kind: string }): Promise<string> {
  const row = must(await sb().from('organizations').insert({ ...input, workspace_id: workspaceId }).select('id').single()) as { id: string };
  queryClient.invalidateQueries({ queryKey: qk.wsOrgs(workspaceId) });
  return row.id;
}

/* ============================================================== Activity */

export function useActivityPage(projectId: string, opts: { entityType?: string; actorId?: string; limit: number }) {
  return useQuery({
    queryKey: qk.projectPart(projectId, 'activity-feed', opts.entityType ?? 'all', opts.actorId ?? 'all', opts.limit),
    placeholderData: (prev) => prev,
    queryFn: async () => {
      let q = sb().from('activity_log').select('*').eq('project_id', projectId).order('created_at', { ascending: false }).limit(opts.limit + 1);
      if (opts.entityType) q = q.eq('entity_type', opts.entityType);
      if (opts.actorId) q = q.eq('actor_id', opts.actorId);
      const rows = must(await q) as ActivityEntry[];
      return { rows: rows.slice(0, opts.limit), more: rows.length > opts.limit };
    },
  });
}
