import { useMemo, useRef, useState, type ReactNode } from 'react';
import { format, formatDistanceToNow, parseISO } from 'date-fns';
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  CircleDot,
  Clock,
  Download,
  ExternalLink,
  FileText,
  Link2,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react';
import { useOrganizations } from '@/data/core';
import {
  APPROVAL_LABEL,
  EVIDENCE_LABEL,
  MILESTONE_KIND_LABEL,
  MILESTONE_STATUS_LABEL,
  addEvidence,
  attachEvidenceFile,
  deleteEvidence,
  saveMilestone,
  setCardMilestone,
  setMilestonePredecessors,
  updateEvidence,
  updateMilestone,
  useEntityHistory,
  useEvidence,
  useMilestoneDependencies,
  useMilestones,
  useProjectCardsLite,
  useWorkPackages,
  type ApprovalStatus,
  type EvidenceItem,
  type Milestone,
  type MilestoneDependency,
  type MilestoneInput,
  type MilestoneKind,
  type MilestoneStatus,
} from '@/data/controls';
import { openAttachment, useAttachments } from '@/data/cardExtras';
import { useProjectCtx } from '@/features/project/context';
import { Avatar, Button, Checkbox, EmptyState, ErrorNote, Field, IconButton, Input, PageHeader, PageLoading, Select, StatusPill, Textarea } from '@/components/ui';
import { Dialog } from '@/components/ui/Dialog';
import { MenuContent, MenuItem, MenuRoot, MenuTrigger } from '@/components/ui/Menu';
import { Markdown } from '@/components/ui/Markdown';
import { useToast } from '@/components/ui/Toast';
import { StatTile } from '@/components/charts';
import { downloadCSV, downloadPDF, downloadXLSX, type Cell } from '@/lib/exporters';
import { keyAfterLast } from '@/domain/ordering';
import { cn } from '@/lib/cn';
import { evidenceState, fmtDate, isOverdue, projectMonthOf, type EvidenceState } from './helpers';

const STATUS_META: Record<MilestoneStatus, { icon: ReactNode; cls: string }> = {
  planned: { icon: <Circle className="size-3.5" aria-hidden />, cls: 'text-secondary' },
  on_track: { icon: <CircleDot className="size-3.5" aria-hidden />, cls: 'text-teal-deep' },
  at_risk: { icon: <AlertTriangle className="size-3.5" aria-hidden />, cls: 'text-serious' },
  delayed: { icon: <Clock className="size-3.5" aria-hidden />, cls: 'text-critical' },
  done: { icon: <CheckCircle2 className="size-3.5" aria-hidden />, cls: 'text-good' },
  cancelled: { icon: <XCircle className="size-3.5" aria-hidden />, cls: 'text-muted' },
};

export function MilestoneStatusMark({ status }: { status: MilestoneStatus }) {
  const m = STATUS_META[status];
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs', m.cls)}>
      {m.icon}
      <span className="text-ink">{MILESTONE_STATUS_LABEL[status]}</span>
    </span>
  );
}

const EVIDENCE_META: Record<EvidenceState, { label: string; icon: ReactNode; cls: string }> = {
  none: { label: 'Not required', icon: null, cls: 'text-secondary' },
  missing: { label: 'Missing', icon: <AlertTriangle className="size-3.5" aria-hidden />, cls: 'text-critical' },
  submitted: { label: 'Submitted', icon: <CircleDot className="size-3.5" aria-hidden />, cls: 'text-secondary' },
  verified: { label: 'Verified', icon: <CheckCircle2 className="size-3.5" aria-hidden />, cls: 'text-good' },
};

function EvidenceMark({ state }: { state: EvidenceState }) {
  const m = EVIDENCE_META[state];
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs', m.cls)}>
      {m.icon}
      <span className="text-ink">{m.label}</span>
    </span>
  );
}

interface Filters {
  text: string;
  kind: '' | MilestoneKind;
  status: '' | MilestoneStatus;
  wp: string;
  overdue: boolean;
  missing: boolean;
  approval: boolean;
}

export default function MilestonesPage() {
  const ctx = useProjectCtx();
  const { project, canEdit, people } = ctx;
  const [showDeleted, setShowDeleted] = useState(false);
  const ms = useMilestones(project.id, showDeleted);
  const wps = useWorkPackages(project.id);
  const evidence = useEvidence(project.id, 'milestone');
  const orgs = useOrganizations(project.workspace_id);
  const toast = useToast();
  const [filters, setFilters] = useState<Filters>({ text: '', kind: '', status: '', wp: '', overdue: false, missing: false, approval: false });
  const [editing, setEditing] = useState<Milestone | 'new' | null>(null);
  const [detail, setDetail] = useState<string | null>(null);

  const evByMs = useMemo(() => {
    const m = new Map<string, EvidenceItem[]>();
    for (const e of evidence.data ?? []) m.set(e.entity_id, [...(m.get(e.entity_id) ?? []), e]);
    return m;
  }, [evidence.data]);
  const evState = (m: Milestone) => evidenceState(evByMs.get(m.id) ?? [], m.evidence_required);
  const wpCode = (id: string | null) => wps.data?.find((w) => w.id === id)?.code ?? '';
  const person = (id: string | null) => people.find((p) => p.user_id === id);
  const orgName = (id: string | null) => {
    const o = orgs.data?.find((x) => x.id === id);
    return o ? o.short_name || o.name : '';
  };

  const all = useMemo(() => (ms.data ?? []).filter((m) => showDeleted || !m.deleted_at), [ms.data, showDeleted]);
  const live = all.filter((m) => !m.deleted_at);
  const list = useMemo(() => {
    const t = filters.text.trim().toLowerCase();
    return all.filter(
      (m) =>
        (!t || `${m.code} ${m.title} ${m.verification}`.toLowerCase().includes(t)) &&
        (!filters.kind || m.kind === filters.kind) &&
        (!filters.status || m.status === filters.status) &&
        (!filters.wp || (filters.wp === 'none' ? !m.work_package_id : m.work_package_id === filters.wp)) &&
        (!filters.overdue || isOverdue(m)) &&
        (!filters.missing || evState(m) === 'missing') &&
        (!filters.approval || m.approval_status === 'submitted'),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, filters, evByMs]);

  const counts = {
    total: live.length,
    done: live.filter((m) => m.status === 'done').length,
    risk: live.filter((m) => m.status === 'at_risk' || m.status === 'delayed').length,
    overdue: live.filter((m) => isOverdue(m)).length,
    missing: live.filter((m) => evState(m) === 'missing' && m.status !== 'cancelled').length,
    approval: live.filter((m) => m.approval_status === 'submitted').length,
  };

  const rows = (): { head: string[]; body: Cell[][] } => ({
    head: ['Code', 'Title', 'Type', 'Work package', 'Due', 'Project month', 'Completed', 'Status', 'Approval', 'Owner', 'Responsible', 'Means of verification', 'Evidence', 'Notes'],
    body: list.map((m) => [
      m.code,
      m.title,
      MILESTONE_KIND_LABEL[m.kind],
      wpCode(m.work_package_id),
      m.due_date,
      projectMonthOf(project.start_date, m.due_date) ? `M${projectMonthOf(project.start_date, m.due_date)}` : '',
      m.actual_date,
      MILESTONE_STATUS_LABEL[m.status] + (isOverdue(m) ? ' (overdue)' : ''),
      APPROVAL_LABEL[m.approval_status],
      person(m.owner_id)?.display_name ?? '',
      orgName(m.responsible_org_id),
      m.verification,
      EVIDENCE_META[evState(m)].label,
      m.notes,
    ]),
  });
  const fileBase = `${(project.acronym || project.name).replace(/[^\w-]+/g, '_')}_milestones_${format(new Date(), 'yyyy-MM-dd')}`;

  const remove = async (m: Milestone) => {
    try {
      const row = await updateMilestone(m, { deleted_at: new Date().toISOString() });
      toast.show(`Moved “${m.title}” to trash`, { undo: () => updateMilestone(row, { deleted_at: null }).then(() => undefined) });
    } catch (err) {
      toast.error(err);
    }
  };

  if (ms.isLoading) return <PageLoading />;
  const detailMs = all.find((m) => m.id === detail) ?? null;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 px-3 py-4 sm:px-5">
      <PageHeader
        title="Milestones and deliverables"
        subtitle="Internal control points, deliverables and reports with their evidence and approval."
        actions={
          <>
            <MenuRoot>
              <MenuTrigger asChild>
                <Button icon={<Download className="size-4" />} disabled={!list.length}>
                  Export
                </Button>
              </MenuTrigger>
              <MenuContent>
                <MenuItem onSelect={() => downloadCSV(fileBase, [rows().head, ...rows().body])}>CSV</MenuItem>
                <MenuItem
                  onSelect={() =>
                    downloadXLSX(fileBase, [{ name: 'Milestones', header: rows().head, rows: rows().body }]).catch(toast.error)
                  }
                >
                  Excel workbook
                </MenuItem>
                <MenuItem
                  onSelect={() =>
                    downloadPDF(fileBase, `Milestone report: ${project.name}`, `${counts.done} of ${counts.total} done · ${counts.overdue} overdue · ${counts.missing} missing evidence`, [
                      {
                        heading: 'Summary',
                        paragraphs: [
                          `Total ${counts.total}; done ${counts.done}; at risk or delayed ${counts.risk}; overdue ${counts.overdue}; missing evidence ${counts.missing}; awaiting approval ${counts.approval}.`,
                        ],
                      },
                      {
                        heading: 'Milestones',
                        table: {
                          head: ['Code', 'Title', 'Due', 'Status', 'Approval', 'Evidence'],
                          body: list.map((m) => [m.code, m.title, m.due_date, MILESTONE_STATUS_LABEL[m.status] + (isOverdue(m) ? ' (overdue)' : ''), APPROVAL_LABEL[m.approval_status], EVIDENCE_META[evState(m)].label]),
                        },
                      },
                    ]).catch(toast.error)
                  }
                >
                  PDF report
                </MenuItem>
              </MenuContent>
            </MenuRoot>
            {canEdit && (
              <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
                New
              </Button>
            )}
          </>
        }
      />
      {ms.error && <ErrorNote error={ms.error} retry={() => ms.refetch()} />}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Total" value={counts.total} />
        <StatTile label="Done" value={counts.done} />
        <StatTile label="At risk or delayed" value={counts.risk} tone={counts.risk ? 'serious' : undefined} />
        <StatTile label="Overdue" value={counts.overdue} tone={counts.overdue ? 'critical' : undefined} />
        <StatTile label="Missing evidence" value={counts.missing} tone={counts.missing ? 'critical' : undefined} />
        <StatTile label="Awaiting approval" value={counts.approval} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input value={filters.text} onChange={(e) => setFilters({ ...filters, text: e.target.value })} placeholder="Filter" aria-label="Filter milestones" className="h-8 w-48" />
        <Select value={filters.kind} onChange={(e) => setFilters({ ...filters, kind: e.target.value as Filters['kind'] })} className="h-8 w-40" aria-label="Type">
          <option value="">All types</option>
          {(Object.keys(MILESTONE_KIND_LABEL) as MilestoneKind[]).map((k) => (
            <option key={k} value={k}>
              {MILESTONE_KIND_LABEL[k]}
            </option>
          ))}
        </Select>
        <Select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value as Filters['status'] })} className="h-8 w-36" aria-label="Status">
          <option value="">All statuses</option>
          {(Object.keys(MILESTONE_STATUS_LABEL) as MilestoneStatus[]).map((k) => (
            <option key={k} value={k}>
              {MILESTONE_STATUS_LABEL[k]}
            </option>
          ))}
        </Select>
        {(wps.data ?? []).length > 0 && (
          <Select value={filters.wp} onChange={(e) => setFilters({ ...filters, wp: e.target.value })} className="h-8 w-40" aria-label="Work package">
            <option value="">All work packages</option>
            {(wps.data ?? []).map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} {w.name}
              </option>
            ))}
            <option value="none">No work package</option>
          </Select>
        )}
        <Checkbox checked={filters.overdue} onChange={(v) => setFilters({ ...filters, overdue: v })} label="Overdue" />
        <Checkbox checked={filters.missing} onChange={(v) => setFilters({ ...filters, missing: v })} label="Missing evidence" />
        <Checkbox checked={filters.approval} onChange={(v) => setFilters({ ...filters, approval: v })} label="Awaiting approval" />
        <Checkbox checked={showDeleted} onChange={setShowDeleted} label="Show deleted" />
      </div>
      {list.length === 0 ? (
        <EmptyState title={live.length ? 'Nothing matches these filters' : 'No milestones yet'} action={canEdit && !live.length ? <Button size="sm" variant="primary" onClick={() => setEditing('new')}>Add the first milestone</Button> : undefined}>
          {!live.length && 'Track control points, deliverables and reports with due dates, means of verification and evidence.'}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-rule text-left">
                <th className="py-2 pr-2 font-bold">Code</th>
                <th className="py-2 pr-3 font-bold">Title</th>
                <th className="py-2 pr-3 font-bold">WP</th>
                <th className="py-2 pr-3 font-bold">Due</th>
                <th className="py-2 pr-3 font-bold">Status</th>
                <th className="py-2 pr-3 font-bold">Approval</th>
                <th className="py-2 pr-3 font-bold">Owner</th>
                <th className="py-2 pr-3 font-bold">Evidence</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {list.map((m) => {
                const owner = person(m.owner_id);
                const overdue = isOverdue(m);
                const month = projectMonthOf(project.start_date, m.due_date);
                return (
                  <tr key={m.id} className={cn('border-b border-grid align-top hover:bg-hover', m.deleted_at && 'opacity-60')}>
                    <td className="num py-2 pr-2 text-secondary">{m.code}</td>
                    <td className="py-2 pr-3">
                      <button className="text-left hover:underline" onClick={() => setDetail(m.id)}>
                        {m.title}
                      </button>
                      <span className="block text-xs text-secondary">
                        {MILESTONE_KIND_LABEL[m.kind]}
                        {orgName(m.responsible_org_id) && ` · ${orgName(m.responsible_org_id)}`}
                      </span>
                    </td>
                    <td className="py-2 pr-3">{wpCode(m.work_package_id) || '—'}</td>
                    <td className="num py-2 pr-3">
                      {fmtDate(m.due_date)}
                      {month && <span className="block text-xs text-secondary">M{month}</span>}
                      {m.actual_date && <span className="block text-xs text-secondary">done {fmtDate(m.actual_date, 'd MMM')}</span>}
                    </td>
                    <td className="py-2 pr-3">
                      <MilestoneStatusMark status={m.status} />
                      {overdue && (
                        <span className="mt-0.5 flex items-center gap-1 text-xs text-critical">
                          <AlertTriangle className="size-3.5" aria-hidden />
                          <span className="text-ink">Overdue</span>
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-xs">{APPROVAL_LABEL[m.approval_status]}</td>
                    <td className="py-2 pr-3">
                      {owner ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Avatar name={owner.display_name} color={owner.avatar_color} size={20} />
                          <span className="hidden truncate lg:inline">{owner.display_name}</span>
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      <EvidenceMark state={evState(m)} />
                    </td>
                    <td className="py-2 text-right">
                      {canEdit &&
                        (m.deleted_at ? (
                          <Button size="sm" icon={<RotateCcw className="size-3.5" />} onClick={() => updateMilestone(m, { deleted_at: null }).catch(toast.error)}>
                            Restore
                          </Button>
                        ) : (
                          <MenuRoot>
                            <MenuTrigger asChild>
                              <IconButton label={`Actions for ${m.title}`}>
                                <MoreHorizontal className="size-4" />
                              </IconButton>
                            </MenuTrigger>
                            <MenuContent>
                              <MenuItem icon={<Pencil className="size-4" />} onSelect={() => setEditing(m)}>
                                Edit
                              </MenuItem>
                              {m.status !== 'done' && (
                                <MenuItem icon={<CheckCircle2 className="size-4" />} onSelect={() => updateMilestone(m, { status: 'done' }).catch(toast.error)}>
                                  Mark done
                                </MenuItem>
                              )}
                              <MenuItem icon={<Trash2 className="size-4" />} onSelect={() => remove(m)}>
                                Move to trash
                              </MenuItem>
                            </MenuContent>
                          </MenuRoot>
                        ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {editing && <MilestoneEditor ms={editing === 'new' ? null : editing} all={live} onClose={() => setEditing(null)} />}
      {detailMs && (
        <MilestoneDetail
          ms={detailMs}
          evidence={evByMs.get(detailMs.id) ?? []}
          wpLabel={wpCode(detailMs.work_package_id)}
          orgLabel={orgName(detailMs.responsible_org_id)}
          all={live}
          onEdit={() => (setDetail(null), setEditing(detailMs))}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}

function MilestoneEditor({ ms, all, onClose }: { ms: Milestone | null; all: Milestone[]; onClose: () => void }) {
  const { project, people } = useProjectCtx();
  const wps = useWorkPackages(project.id);
  const orgs = useOrganizations(project.workspace_id);
  const deps = useMilestoneDependencies(project.id);
  const toast = useToast();
  const [form, setForm] = useState<MilestoneInput>({
    code: ms?.code ?? '',
    title: ms?.title ?? '',
    description: ms?.description ?? '',
    kind: ms?.kind ?? 'milestone',
    work_package_id: ms?.work_package_id ?? null,
    due_date: ms?.due_date ?? null,
    actual_date: ms?.actual_date ?? null,
    status: ms?.status ?? 'planned',
    approval_status: ms?.approval_status ?? 'not_required',
    verification: ms?.verification ?? '',
    evidence_required: ms?.evidence_required ?? false,
    responsible_org_id: ms?.responsible_org_id ?? null,
    owner_id: ms?.owner_id ?? null,
    dissemination: ms?.dissemination ?? '',
    notes: ms?.notes ?? '',
  });
  const [preds, setPreds] = useState<string[] | null>(null);
  const currentPreds = preds ?? (ms ? (deps.data ?? []).filter((d) => d.successor_id === ms.id).map((d) => d.predecessor_id) : []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof MilestoneInput>(k: K, v: MilestoneInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const month = projectMonthOf(project.start_date, form.due_date ?? null);

  return (
    <Dialog
      open
      onOpenChange={onClose}
      title={ms ? 'Edit milestone' : 'New milestone or deliverable'}
      width={680}
      footer={
        <Button
          variant="primary"
          loading={busy}
          onClick={async () => {
            setError(null);
            if (!form.title?.trim()) return setError('A title is required.');
            setBusy(true);
            try {
              const payload: MilestoneInput = { ...form, title: form.title!.trim() };
              if (!ms) payload.position = keyAfterLast(all);
              // Approval decisions go through the dedicated buttons; never change them from here.
              if (ms && (ms.approval_status === 'approved' || ms.approval_status === 'rejected' || ms.approval_status === 'submitted')) delete payload.approval_status;
              const row = await saveMilestone(project.id, payload, ms ?? undefined);
              if (preds) await setMilestonePredecessors(project.id, row.id, preds, (deps.data ?? []) as MilestoneDependency[]);
              onClose();
            } catch (err) {
              toast.error(err);
            } finally {
              setBusy(false);
            }
          }}
        >
          {ms ? 'Save' : 'Create'}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-[110px_1fr_160px]">
          <Field label="Code" htmlFor="ms-code">
            <Input id="ms-code" value={form.code} onChange={(e) => set('code', e.target.value)} maxLength={20} />
          </Field>
          <Field label="Title" htmlFor="ms-title">
            <Input id="ms-title" value={form.title} onChange={(e) => set('title', e.target.value)} maxLength={300} />
          </Field>
          <Field label="Type" htmlFor="ms-kind">
            <Select id="ms-kind" value={form.kind} onChange={(e) => set('kind', e.target.value as MilestoneKind)}>
              {(Object.keys(MILESTONE_KIND_LABEL) as MilestoneKind[]).map((k) => (
                <option key={k} value={k}>
                  {MILESTONE_KIND_LABEL[k]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Due" htmlFor="ms-due" hint={month ? `Project month M${month}` : undefined}>
            <Input id="ms-due" type="date" value={form.due_date ?? ''} onChange={(e) => set('due_date', e.target.value || null)} />
          </Field>
          <Field label="Completed on" htmlFor="ms-actual">
            <Input id="ms-actual" type="date" value={form.actual_date ?? ''} onChange={(e) => set('actual_date', e.target.value || null)} />
          </Field>
          <Field label="Status" htmlFor="ms-status">
            <Select id="ms-status" value={form.status} onChange={(e) => set('status', e.target.value as MilestoneStatus)}>
              {(Object.keys(MILESTONE_STATUS_LABEL) as MilestoneStatus[]).map((k) => (
                <option key={k} value={k}>
                  {MILESTONE_STATUS_LABEL[k]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Work package" htmlFor="ms-wp">
            <Select id="ms-wp" value={form.work_package_id ?? ''} onChange={(e) => set('work_package_id', e.target.value || null)}>
              <option value="">None</option>
              {(wps.data ?? []).map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} {w.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Owner" htmlFor="ms-owner">
            <Select id="ms-owner" value={form.owner_id ?? ''} onChange={(e) => set('owner_id', e.target.value || null)}>
              <option value="">Nobody</option>
              {people.map((p) => (
                <option key={p.user_id} value={p.user_id}>
                  {p.display_name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Responsible organisation" htmlFor="ms-org">
            <Select id="ms-org" value={form.responsible_org_id ?? ''} onChange={(e) => set('responsible_org_id', e.target.value || null)}>
              <option value="">None</option>
              {(orgs.data ?? []).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.short_name || o.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Means of verification" htmlFor="ms-ver" hint="What proves this was achieved, e.g. signed minutes, uploaded deliverable, attendance list.">
          <Input id="ms-ver" value={form.verification} onChange={(e) => set('verification', e.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-4">
          <Checkbox checked={Boolean(form.evidence_required)} onChange={(v) => set('evidence_required', v)} label="Evidence is required" />
          {(!ms || ms.approval_status === 'not_required' || ms.approval_status === 'not_submitted') && (
            <Checkbox
              checked={form.approval_status !== 'not_required'}
              onChange={(v) => set('approval_status', (v ? 'not_submitted' : 'not_required') as ApprovalStatus)}
              label="Needs approval by a project manager"
            />
          )}
        </div>
        <Field label="Description" htmlFor="ms-desc">
          <Textarea id="ms-desc" rows={3} value={form.description} onChange={(e) => set('description', e.target.value)} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Dissemination level" htmlFor="ms-dis" hint="Optional, e.g. Public or Sensitive.">
            <Input id="ms-dis" value={form.dissemination} onChange={(e) => set('dissemination', e.target.value)} />
          </Field>
          <Field label="Notes" htmlFor="ms-notes">
            <Input id="ms-notes" value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          </Field>
        </div>
        {all.filter((x) => x.id !== ms?.id).length > 0 && (
          <fieldset>
            <legend className="mb-1 text-[13px] font-bold">Depends on</legend>
            <div className="flex max-h-32 flex-col gap-1 overflow-y-auto">
              {all
                .filter((x) => x.id !== ms?.id)
                .map((x) => (
                  <Checkbox
                    key={x.id}
                    checked={currentPreds.includes(x.id)}
                    onChange={(v) => setPreds(v ? [...currentPreds, x.id] : currentPreds.filter((p) => p !== x.id))}
                    label={`${x.code ? x.code + ' ' : ''}${x.title}`}
                  />
                ))}
            </div>
          </fieldset>
        )}
        {error && (
          <p role="alert" className="text-sm text-critical">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}

function MilestoneDetail({
  ms,
  evidence,
  wpLabel,
  orgLabel,
  all,
  onEdit,
  onClose,
}: {
  ms: Milestone;
  evidence: EvidenceItem[];
  wpLabel: string;
  orgLabel: string;
  all: Milestone[];
  onEdit: () => void;
  onClose: () => void;
}) {
  const ctx = useProjectCtx();
  const { project, canEdit, canManage, people, openCard } = ctx;
  const toast = useToast();
  const history = useEntityHistory(project.id, ms.id);
  const deps = useMilestoneDependencies(project.id);
  const cards = useProjectCardsLite(project.id);
  const attachments = useAttachments(project.id, { entityId: ms.id });
  const [newEvidence, setNewEvidence] = useState('');
  const [linkSearch, setLinkSearch] = useState('');
  const owner = people.find((p) => p.user_id === ms.owner_id);
  const linked = (cards.data ?? []).filter((c) => c.milestone_id === ms.id);
  const preds = (deps.data ?? []).filter((d) => d.successor_id === ms.id).map((d) => all.find((x) => x.id === d.predecessor_id)).filter(Boolean) as Milestone[];
  const succs = (deps.data ?? []).filter((d) => d.predecessor_id === ms.id).map((d) => all.find((x) => x.id === d.successor_id)).filter(Boolean) as Milestone[];
  const candidates = linkSearch.trim().length >= 2 ? (cards.data ?? []).filter((c) => c.milestone_id !== ms.id && c.title.toLowerCase().includes(linkSearch.toLowerCase())).slice(0, 8) : [];

  const approval = async (status: ApprovalStatus) => {
    try {
      await updateMilestone(ms, { approval_status: status });
      toast.show(`Approval: ${APPROVAL_LABEL[status].toLowerCase()}`);
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={onClose}
      title={`${ms.code ? ms.code + ' ' : ''}${ms.title}`}
      description={`${MILESTONE_KIND_LABEL[ms.kind]}${wpLabel ? ` · ${wpLabel}` : ''}${orgLabel ? ` · ${orgLabel}` : ''}`}
      width={780}
      footer={
        <>
          {canEdit && ms.approval_status === 'not_submitted' && (
            <Button onClick={() => approval('submitted')}>Submit for approval</Button>
          )}
          {canEdit && ms.approval_status === 'rejected' && <Button onClick={() => approval('submitted')}>Resubmit for approval</Button>}
          {canManage && ms.approval_status === 'submitted' && (
            <>
              <Button variant="danger" onClick={() => approval('rejected')}>
                Reject
              </Button>
              <Button variant="primary" onClick={() => approval('approved')}>
                Approve
              </Button>
            </>
          )}
          {canEdit && (
            <Button icon={<Pencil className="size-4" />} onClick={onEdit}>
              Edit
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-secondary">Due</dt>
            <dd className="num">
              {fmtDate(ms.due_date)}
              {projectMonthOf(project.start_date, ms.due_date) && <span className="text-secondary"> · M{projectMonthOf(project.start_date, ms.due_date)}</span>}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-secondary">Status</dt>
            <dd>
              <MilestoneStatusMark status={ms.status} />
              {isOverdue(ms) && <span className="ml-1 text-xs text-critical">Overdue</span>}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-secondary">Approval</dt>
            <dd>
              {APPROVAL_LABEL[ms.approval_status]}
              {ms.approved_at && <span className="block text-xs text-secondary">{fmtDate(ms.approved_at.slice(0, 10))}</span>}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-secondary">Owner</dt>
            <dd>{owner?.display_name ?? '—'}</dd>
          </div>
        </dl>
        {ms.verification && (
          <p className="border-l-2 border-teal bg-card px-3 py-2 text-sm">
            <span className="text-secondary">Means of verification: </span>
            {ms.verification}
          </p>
        )}
        {ms.description && <Markdown source={ms.description} />}
        {ms.notes && <p className="text-sm text-secondary">{ms.notes}</p>}

        <section>
          <h3 className="mb-1.5 text-sm">Evidence</h3>
          {evidence.length === 0 && (
            <p className="text-sm text-secondary">{ms.evidence_required ? 'Evidence is required but nothing has been added yet.' : 'No evidence items.'}</p>
          )}
          <ul className="flex flex-col divide-y divide-grid">
            {evidence.map((e) => (
              <EvidenceRow key={e.id} ev={e} attachments={attachments.data ?? []} canEdit={canEdit} canVerify={canManage} />
            ))}
          </ul>
          {canEdit && (
            <form
              className="mt-2 flex gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!newEvidence.trim()) return;
                try {
                  await addEvidence(project.id, 'milestone', ms.id, newEvidence.trim(), { due_date: ms.due_date });
                  setNewEvidence('');
                } catch (err) {
                  toast.error(err);
                }
              }}
            >
              <Input value={newEvidence} onChange={(e) => setNewEvidence(e.target.value)} placeholder={ms.verification || 'Required document, e.g. signed minutes'} className="h-8" aria-label="New evidence item" />
              <Button size="sm" type="submit" icon={<Plus className="size-3.5" />} disabled={!newEvidence.trim()}>
                Add
              </Button>
            </form>
          )}
        </section>

        <section>
          <h3 className="mb-1.5 text-sm">
            Linked tasks <span className="num font-normal text-secondary">{linked.length}</span>
          </h3>
          <ul className="flex flex-col divide-y divide-grid">
            {linked.map((c) => (
              <li key={c.id} className="flex items-center gap-2 py-1 text-sm">
                <button className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => (onClose(), openCard(c.id))}>
                  {c.title}
                </button>
                <StatusPill status={c.status} />
                {canEdit && (
                  <IconButton label={`Unlink ${c.title}`} onClick={() => setCardMilestone(project.id, c, null).catch(toast.error)}>
                    <XCircle className="size-3.5" />
                  </IconButton>
                )}
              </li>
            ))}
          </ul>
          {canEdit && (
            <div className="relative mt-2">
              <Input value={linkSearch} onChange={(e) => setLinkSearch(e.target.value)} placeholder="Link a task: type to search" className="h-8" aria-label="Find task to link" />
              {candidates.length > 0 && (
                <ul className="absolute left-0 right-0 top-full z-20 mt-1 rounded-[4px] border border-rule bg-surface p-1 text-sm">
                  {candidates.map((c) => (
                    <li key={c.id}>
                      <button
                        className="w-full truncate rounded-[3px] px-2 py-1 text-left hover:bg-hover"
                        onClick={() =>
                          setCardMilestone(project.id, c, ms.id)
                            .then(() => setLinkSearch(''))
                            .catch(toast.error)
                        }
                      >
                        {c.title}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>

        {(preds.length > 0 || succs.length > 0) && (
          <section className="text-sm">
            <h3 className="mb-1.5 text-sm">Dependencies</h3>
            {preds.map((p) => (
              <p key={p.id}>
                <span className="text-secondary">Depends on </span>
                {p.code} {p.title} · <MilestoneStatusMark status={p.status} />
              </p>
            ))}
            {succs.map((p) => (
              <p key={p.id}>
                <span className="text-secondary">Needed by </span>
                {p.code} {p.title}
              </p>
            ))}
          </section>
        )}

        <section>
          <h3 className="mb-1.5 text-sm">History</h3>
          <ul className="flex flex-col gap-1 text-xs">
            {(history.data ?? []).map((h) => (
              <li key={h.id}>
                <b>{people.find((p) => p.user_id === h.actor_id)?.display_name ?? 'Someone'}</b> {h.summary}{' '}
                <span className="text-secondary">{formatDistanceToNow(parseISO(h.created_at), { addSuffix: true })}</span>
              </li>
            ))}
            {history.data?.length === 0 && <li className="text-secondary">No changes recorded yet.</li>}
          </ul>
        </section>
      </div>
    </Dialog>
  );
}

function EvidenceRow({
  ev,
  attachments,
  canEdit,
  canVerify,
}: {
  ev: EvidenceItem;
  attachments: import('@/data/cardExtras').Attachment[];
  canEdit: boolean;
  canVerify: boolean;
}) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState('');
  const [addingUrl, setAddingUrl] = useState(false);
  const att = attachments.find((a) => a.id === ev.attachment_id);
  const statusCls = { missing: 'text-critical', submitted: 'text-secondary', verified: 'text-good', rejected: 'text-critical' }[ev.status];
  return (
    <li className="flex flex-col gap-1 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn('inline-flex items-center gap-1 text-xs', statusCls)}>
          {ev.status === 'verified' ? <CheckCircle2 className="size-3.5" aria-hidden /> : ev.status === 'submitted' ? <CircleDot className="size-3.5" aria-hidden /> : <AlertTriangle className="size-3.5" aria-hidden />}
          <span className="text-ink">{EVIDENCE_LABEL[ev.status]}</span>
        </span>
        <span className="min-w-0 flex-1">
          {ev.title}
          {!ev.required && <span className="text-xs text-secondary"> · optional</span>}
        </span>
        {att && (
          <button className="inline-flex items-center gap-1 text-link hover:underline" onClick={() => openAttachment(att).catch(toast.error)}>
            <FileText className="size-3.5" aria-hidden />
            {att.name}
          </button>
        )}
        {ev.url && (
          <a className="inline-flex items-center gap-1 text-link hover:underline" href={ev.url} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="size-3.5" aria-hidden />
            Link
          </a>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {canEdit && ev.status !== 'verified' && (
          <>
            <input
              ref={fileRef}
              type="file"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                setBusy(true);
                try {
                  await attachEvidenceFile(ev, f);
                  toast.show('Evidence uploaded');
                } catch (err) {
                  toast.error(err);
                } finally {
                  setBusy(false);
                }
              }}
            />
            <Button size="sm" variant="ghost" loading={busy} icon={<Upload className="size-3.5" />} onClick={() => fileRef.current?.click()}>
              Upload file
            </Button>
            {addingUrl ? (
              <form
                className="flex gap-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!/^https?:\/\//i.test(url)) return toast.error(new Error('Links must start with http:// or https://'));
                  updateEvidence(ev, ev.status === 'rejected' ? { url, status: 'submitted' } : { url })
                    .then(() => (setAddingUrl(false), setUrl('')))
                    .catch(toast.error);
                }}
              >
                <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className="h-7 w-56 text-xs" aria-label="Evidence link" autoFocus />
                <Button size="sm" type="submit">
                  Save
                </Button>
              </form>
            ) : (
              <Button size="sm" variant="ghost" icon={<Link2 className="size-3.5" />} onClick={() => setAddingUrl(true)}>
                Add link
              </Button>
            )}
          </>
        )}
        {canVerify && ev.status === 'submitted' && (
          <>
            <Button size="sm" variant="ghost" onClick={() => updateEvidence(ev, { status: 'verified' }).catch(toast.error)}>
              Verify
            </Button>
            <Button size="sm" variant="ghost" onClick={() => updateEvidence(ev, { status: 'rejected' }).catch(toast.error)}>
              Reject
            </Button>
          </>
        )}
        {canVerify && ev.status === 'rejected' && (ev.url || ev.attachment_id) && (
          <Button size="sm" variant="ghost" onClick={() => updateEvidence(ev, { status: 'submitted' }).catch(toast.error)}>
            Reopen
          </Button>
        )}
        {canVerify && (
          <IconButton label={`Delete evidence ${ev.title}`} onClick={() => deleteEvidence(ev).catch(toast.error)}>
            <Trash2 className="size-3.5" />
          </IconButton>
        )}
        {ev.verified_at && <span className="text-xs text-secondary">checked {format(parseISO(ev.verified_at), 'd MMM yyyy')}</span>}
      </div>
    </li>
  );
}
