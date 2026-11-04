import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { AlertCircle, GanttChartSquare, MoreHorizontal, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useOrganizations } from '@/data/core';
import {
  WP_STATUS_LABEL,
  saveWorkPackage,
  setWorkPackageDeleted,
  setWpMembers,
  setWpPredecessors,
  useBudgetByWp,
  useEffortByWp,
  useKpisLite,
  useMilestones,
  useProjectCardsLite,
  useWorkPackages,
  useWpDependencies,
  useWpMembers,
  useWpProgress,
  type WorkPackage,
  type WpInput,
  type WpMember,
  type WpStatus,
  type WpDependency,
} from '@/data/controls';
import { useProjectCtx } from '@/features/project/context';
import { Avatar, Button, Checkbox, EmptyState, ErrorNote, Field, IconButton, Input, PageHeader, PageLoading, Select, StatusPill, Textarea } from '@/components/ui';
import { Dialog } from '@/components/ui/Dialog';
import { MenuContent, MenuItem, MenuRoot, MenuTrigger } from '@/components/ui/Menu';
import { Markdown } from '@/components/ui/Markdown';
import { useToast } from '@/components/ui/Toast';
import { Meter } from '@/components/charts';
import { keyAfterLast } from '@/domain/ordering';
import { fmtDate, formatCents, hours, monthRangeLabel, projectMonthEnd, projectMonthOf, projectMonthStart } from './helpers';
import { MILESTONE_STATUS_LABEL } from '@/data/controls';

export default function WorkPackagesPage() {
  const ctx = useProjectCtx();
  const { project, canEdit, people } = ctx;
  const [showDeleted, setShowDeleted] = useState(false);
  const wps = useWorkPackages(project.id, showDeleted);
  const members = useWpMembers(project.id);
  const deps = useWpDependencies(project.id);
  const progress = useWpProgress(project.id);
  const orgs = useOrganizations(project.workspace_id);
  const toast = useToast();
  const [editing, setEditing] = useState<WorkPackage | 'new' | null>(null);
  const [detail, setDetail] = useState<string | null>(null);

  const progressMap = useMemo(() => new Map((progress.data ?? []).map((p) => [p.work_package_id, p])), [progress.data]);
  const orgName = (id: string | null) => {
    const o = orgs.data?.find((x) => x.id === id);
    return o ? o.short_name || o.name : '—';
  };
  const list = (wps.data ?? []).filter((w) => showDeleted || !w.deleted_at);
  const active = (wps.data ?? []).filter((w) => !w.deleted_at);
  const detailWp = list.find((w) => w.id === detail) ?? null;

  const remove = async (wp: WorkPackage) => {
    try {
      const row = await setWorkPackageDeleted(wp, true);
      toast.show(`Moved ${wp.code} to trash`, { undo: () => setWorkPackageDeleted(row, false).then(() => undefined) });
    } catch (err) {
      toast.error(err);
    }
  };

  if (wps.isLoading) return <PageLoading />;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 px-3 py-4 sm:px-5">
      <PageHeader
        title="Work packages"
        subtitle={project.start_date ? `Project months count from ${fmtDate(project.start_date)}.` : 'Set a project start date to see project months (M1, M2…).'}
        actions={
          <>
            {ctx.has('timeline') && (
              <Link to={`/p/${project.id}/timeline?group=wp`} className="inline-flex h-9 items-center gap-1.5 rounded-[4px] border border-rule px-3 text-sm hover:bg-hover">
                <GanttChartSquare className="size-4" aria-hidden /> Timeline by work package
              </Link>
            )}
            {canEdit && (
              <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
                New work package
              </Button>
            )}
          </>
        }
      />
      {wps.error && <ErrorNote error={wps.error} retry={() => wps.refetch()} />}
      <div className="flex items-center gap-3">
        <Checkbox checked={showDeleted} onChange={setShowDeleted} label="Show deleted" />
      </div>
      {list.length === 0 ? (
        <EmptyState
          title="No work packages yet"
          action={canEdit ? <Button size="sm" variant="primary" onClick={() => setEditing('new')}>Create the first work package</Button> : undefined}
        >
          Work packages group activities, milestones, effort and budget. Tasks are linked to a work package from the task's details.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-rule text-left">
                <th className="py-2 pr-3 font-bold">Work package</th>
                <th className="py-2 pr-3 font-bold">Lead</th>
                <th className="py-2 pr-3 font-bold">Period</th>
                <th className="py-2 pr-3 font-bold">People</th>
                <th className="py-2 pr-3 font-bold">Status</th>
                <th className="w-48 py-2 pr-3 font-bold">Progress (actual · planned)</th>
                <th className="py-2 pr-3 text-right font-bold">Tasks</th>
                <th className="py-2 pr-3 text-right font-bold">Milestones</th>
                <th className="py-2 pr-3 text-right font-bold">Hours</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {list.map((wp) => {
                const p = progressMap.get(wp.id);
                const team = (members.data ?? []).filter((m) => m.work_package_id === wp.id);
                return (
                  <tr key={wp.id} className={`border-b border-grid align-top hover:bg-hover ${wp.deleted_at ? 'opacity-60' : ''}`}>
                    <td className="py-2 pr-3">
                      <button className="text-left hover:underline" onClick={() => setDetail(wp.id)}>
                        <span className="font-bold">{wp.code}</span> {wp.name}
                      </button>
                      {wp.deleted_at && <span className="ml-1 text-xs text-secondary">· deleted</span>}
                    </td>
                    <td className="py-2 pr-3">{orgName(wp.lead_org_id)}</td>
                    <td className="num py-2 pr-3">
                      <span className="block">{monthRangeLabel(project.start_date, wp.start_date, wp.end_date) || '—'}</span>
                      <span className="text-xs text-secondary">
                        {wp.start_date || wp.end_date ? `${fmtDate(wp.start_date, 'MMM yyyy')} – ${fmtDate(wp.end_date, 'MMM yyyy')}` : ''}
                      </span>
                    </td>
                    <td className="py-2 pr-3">
                      <span className="flex -space-x-1">
                        {team.slice(0, 4).map((m) => {
                          const person = people.find((x) => x.user_id === m.user_id);
                          return (
                            <Avatar
                              key={m.user_id}
                              name={`${person?.display_name ?? 'Former member'}${m.role === 'lead' ? ' (lead)' : ''}`}
                              color={person?.avatar_color ?? 'teal'}
                              size={22}
                              className="ring-2 ring-[var(--v-surface)]"
                            />
                          );
                        })}
                        {team.length === 0 && <span className="text-secondary">—</span>}
                      </span>
                    </td>
                    <td className="py-2 pr-3">{WP_STATUS_LABEL[wp.status]}</td>
                    <td className="py-2 pr-3">
                      {p ? <Meter value={p.actual_progress} planned={p.planned_progress} label={`${wp.code} progress`} /> : <span className="text-secondary">—</span>}
                      {p && p.planned_progress != null && p.actual_progress + 10 < p.planned_progress && wp.status !== 'completed' && (
                        <span className="mt-0.5 inline-flex items-center gap-1 text-xs text-serious">
                          <AlertCircle className="size-3.5" aria-hidden />
                          <span className="text-ink">Behind plan</span>
                        </span>
                      )}
                    </td>
                    <td className="num py-2 pr-3 text-right">
                      {p ? `${p.tasks_done}/${p.tasks_total}` : '—'}
                      {p && p.tasks_overdue > 0 && <span className="block text-xs text-critical">{p.tasks_overdue} overdue</span>}
                    </td>
                    <td className="num py-2 pr-3 text-right">{p ? `${p.milestones_done}/${p.milestones_total}` : '—'}</td>
                    <td className="num py-2 pr-3 text-right">
                      {p ? hours(p.logged_minutes) : '—'}
                      {p && p.estimate_minutes > 0 && <span className="block text-xs text-secondary">of {hours(p.estimate_minutes)}</span>}
                    </td>
                    <td className="py-2 text-right">
                      {canEdit &&
                        (wp.deleted_at ? (
                          <Button size="sm" icon={<RotateCcw className="size-3.5" />} onClick={() => setWorkPackageDeleted(wp, false).catch(toast.error)}>
                            Restore
                          </Button>
                        ) : (
                          <MenuRoot>
                            <MenuTrigger asChild>
                              <IconButton label={`Actions for ${wp.code}`}>
                                <MoreHorizontal className="size-4" />
                              </IconButton>
                            </MenuTrigger>
                            <MenuContent>
                              <MenuItem icon={<Pencil className="size-4" />} onSelect={() => setEditing(wp)}>
                                Edit
                              </MenuItem>
                              <MenuItem icon={<Trash2 className="size-4" />} onSelect={() => remove(wp)}>
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

      {editing && (
        <WpEditor
          wp={editing === 'new' ? null : editing}
          all={active}
          members={members.data ?? []}
          deps={deps.data ?? []}
          orgs={orgs.data ?? []}
          onClose={() => setEditing(null)}
        />
      )}
      {detailWp && <WpDetail wp={detailWp} orgName={orgName(detailWp.lead_org_id)} members={members.data ?? []} onClose={() => setDetail(null)} onEdit={() => (setDetail(null), setEditing(detailWp))} />}
    </div>
  );
}

function WpEditor({
  wp,
  all,
  members,
  deps,
  orgs,
  onClose,
}: {
  wp: WorkPackage | null;
  all: WorkPackage[];
  members: WpMember[];
  deps: WpDependency[];
  orgs: { id: string; name: string; short_name: string }[];
  onClose: () => void;
}) {
  const { project, people } = useProjectCtx();
  const toast = useToast();
  const start = project.start_date;
  const [form, setForm] = useState<WpInput>({
    code: wp?.code ?? `WP${all.length + 1}`,
    name: wp?.name ?? '',
    description: wp?.description ?? '',
    objectives: wp?.objectives ?? '',
    lead_org_id: wp?.lead_org_id ?? null,
    start_date: wp?.start_date ?? project.start_date,
    end_date: wp?.end_date ?? project.end_date,
    status: wp?.status ?? 'not_started',
    progress_mode: wp?.progress_mode ?? 'tasks',
    manual_progress: wp?.manual_progress ?? null,
  });
  const [team, setTeam] = useState<{ user_id: string; role: WpMember['role'] }[]>(
    wp ? members.filter((m) => m.work_package_id === wp.id).map((m) => ({ user_id: m.user_id, role: m.role })) : [],
  );
  const [preds, setPreds] = useState<string[]>(wp ? deps.filter((d) => d.successor_id === wp.id).map((d) => d.predecessor_id) : []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof WpInput>(k: K, v: WpInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  const startM = projectMonthOf(start, form.start_date);
  const endM = projectMonthOf(start, form.end_date);

  const submit = async () => {
    setError(null);
    if (!form.code.trim() || !form.name.trim()) return setError('Code and name are required.');
    if (form.start_date && form.end_date && form.end_date < form.start_date) return setError('The end date must be on or after the start date.');
    if (form.progress_mode === 'manual' && (form.manual_progress == null || form.manual_progress < 0 || form.manual_progress > 100))
      return setError('Manual progress must be between 0 and 100.');
    setBusy(true);
    try {
      const row = await saveWorkPackage(project.id, { ...form, code: form.code.trim(), name: form.name.trim() }, wp ?? undefined, keyAfterLast(all));
      await setWpMembers(project.id, row.id, team, members);
      await setWpPredecessors(project.id, row.id, preds, deps);
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={onClose}
      title={wp ? `Edit ${wp.code}` : 'New work package'}
      width={680}
      footer={
        <Button variant="primary" loading={busy} onClick={submit}>
          {wp ? 'Save' : 'Create'}
        </Button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-[120px_1fr]">
        <Field label="Code" htmlFor="wp-code">
          <Input id="wp-code" value={form.code} onChange={(e) => set('code', e.target.value)} maxLength={20} />
        </Field>
        <Field label="Name" htmlFor="wp-name">
          <Input id="wp-name" value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={200} />
        </Field>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Lead organisation" htmlFor="wp-lead" hint={orgs.length ? undefined : 'Add organisations under Workspace → Organisations.'}>
          <Select id="wp-lead" value={form.lead_org_id ?? ''} onChange={(e) => set('lead_org_id', e.target.value || null)}>
            <option value="">None</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.short_name ? `${o.short_name} · ${o.name}` : o.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status" htmlFor="wp-status">
          <Select id="wp-status" value={form.status} onChange={(e) => set('status', e.target.value as WpStatus)}>
            {(Object.keys(WP_STATUS_LABEL) as WpStatus[]).map((s) => (
              <option key={s} value={s}>
                {WP_STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Start" htmlFor="wp-start" hint={startM ? `Project month M${startM}` : undefined}>
          <Input id="wp-start" type="date" value={form.start_date ?? ''} onChange={(e) => set('start_date', e.target.value || null)} />
        </Field>
        <Field label="End" htmlFor="wp-end" hint={endM ? `Project month M${endM}` : undefined}>
          <Input id="wp-end" type="date" value={form.end_date ?? ''} onChange={(e) => set('end_date', e.target.value || null)} />
        </Field>
      </div>
      {start && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-secondary">Or set by project month:</span>
          <label className="flex items-center gap-1">
            M
            <Input
              type="number"
              min={1}
              className="h-8 w-16"
              aria-label="Start month"
              value={startM ?? ''}
              onChange={(e) => {
                const m = parseInt(e.target.value, 10);
                if (m >= 1) set('start_date', projectMonthStart(start, m));
              }}
            />
          </label>
          <span>to</span>
          <label className="flex items-center gap-1">
            M
            <Input
              type="number"
              min={1}
              className="h-8 w-16"
              aria-label="End month"
              value={endM ?? ''}
              onChange={(e) => {
                const m = parseInt(e.target.value, 10);
                if (m >= 1) set('end_date', projectMonthEnd(start, m));
              }}
            />
          </label>
        </div>
      )}
      <div className="mt-3 flex flex-col gap-3">
        <Field label="Description" htmlFor="wp-desc" hint="Markdown supported.">
          <Textarea id="wp-desc" rows={3} value={form.description} onChange={(e) => set('description', e.target.value)} />
        </Field>
        <Field label="Objectives" htmlFor="wp-obj">
          <Textarea id="wp-obj" rows={2} value={form.objectives} onChange={(e) => set('objectives', e.target.value)} />
        </Field>
        <fieldset>
          <legend className="mb-1 text-[13px] font-bold">Progress</legend>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-1.5">
              <input type="radio" className="accent-[var(--v-teal-deep)]" checked={form.progress_mode === 'tasks'} onChange={() => set('progress_mode', 'tasks')} />
              From completed tasks
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" className="accent-[var(--v-teal-deep)]" checked={form.progress_mode === 'manual'} onChange={() => set('progress_mode', 'manual')} />
              Set manually
            </label>
            {form.progress_mode === 'manual' && (
              <label className="flex items-center gap-1">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  className="h-8 w-20"
                  aria-label="Manual progress percent"
                  value={form.manual_progress ?? ''}
                  onChange={(e) => set('manual_progress', e.target.value === '' ? null : Number(e.target.value))}
                />
                %
              </label>
            )}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-1 text-[13px] font-bold">Responsible people</legend>
          <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
            {people.map((p) => {
              const t = team.find((x) => x.user_id === p.user_id);
              return (
                <li key={p.user_id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="accent-[var(--v-teal-deep)]"
                    aria-label={`Include ${p.display_name}`}
                    checked={Boolean(t)}
                    onChange={(e) =>
                      setTeam((cur) => (e.target.checked ? [...cur, { user_id: p.user_id, role: 'responsible' }] : cur.filter((x) => x.user_id !== p.user_id)))
                    }
                  />
                  <Avatar name={p.display_name} color={p.avatar_color} size={20} />
                  <span className="flex-1 truncate">{p.display_name}</span>
                  {t && (
                    <Select
                      className="h-7 w-36 text-xs"
                      aria-label={`Role of ${p.display_name}`}
                      value={t.role}
                      onChange={(e) => setTeam((cur) => cur.map((x) => (x.user_id === p.user_id ? { ...x, role: e.target.value as WpMember['role'] } : x)))}
                    >
                      <option value="lead">Lead</option>
                      <option value="responsible">Responsible</option>
                      <option value="contributor">Contributor</option>
                    </Select>
                  )}
                </li>
              );
            })}
          </ul>
        </fieldset>
        {all.filter((w) => w.id !== wp?.id).length > 0 && (
          <fieldset>
            <legend className="mb-1 text-[13px] font-bold">Depends on</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {all
                .filter((w) => w.id !== wp?.id)
                .map((w) => (
                  <Checkbox
                    key={w.id}
                    checked={preds.includes(w.id)}
                    onChange={(v) => setPreds((cur) => (v ? [...cur, w.id] : cur.filter((x) => x !== w.id)))}
                    label={`${w.code} ${w.name}`}
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

function WpDetail({ wp, orgName, members, onClose, onEdit }: { wp: WorkPackage; orgName: string; members: WpMember[]; onClose: () => void; onEdit: () => void }) {
  const ctx = useProjectCtx();
  const { project, people, finance, canEdit, openCard } = ctx;
  const cards = useProjectCardsLite(project.id);
  const ms = useMilestones(project.id);
  const kpis = useKpisLite(project.id, ctx.has('kpis'));
  const effort = useEffortByWp(project.id);
  const budget = useBudgetByWp(project.id, finance !== 'none');
  const progress = useWpProgress(project.id);
  const p = progress.data?.find((x) => x.work_package_id === wp.id);
  const tasks = (cards.data ?? []).filter((c) => c.work_package_id === wp.id);
  const milestones = (ms.data ?? []).filter((m) => m.work_package_id === wp.id);
  const wpKpis = (kpis.data ?? []).filter((k) => k.work_package_id === wp.id);
  const team = members.filter((m) => m.work_package_id === wp.id);
  const b = budget.data?.get(wp.id);

  return (
    <Dialog
      open
      onOpenChange={onClose}
      title={`${wp.code} ${wp.name}`}
      description={`${orgName !== '—' ? `Lead: ${orgName} · ` : ''}${monthRangeLabel(project.start_date, wp.start_date, wp.end_date) || 'No dates'} · ${WP_STATUS_LABEL[wp.status]}`}
      width={760}
      footer={
        canEdit && (
          <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={onEdit}>
            Edit work package
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-5">
        {p && <Meter value={p.actual_progress} planned={p.planned_progress} label="Progress" />}
        {wp.description && <Markdown source={wp.description} />}
        {wp.objectives && (
          <section>
            <h3 className="mb-1 text-sm">Objectives</h3>
            <Markdown source={wp.objectives} />
          </section>
        )}
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div className="border-l-2 border-teal bg-card px-3 py-2">
            <dt className="text-xs text-secondary">Planned effort</dt>
            <dd className="num text-lg">{effort.data?.get(wp.id) != null ? `${effort.data.get(wp.id)!.toFixed(2)} PM` : '—'}</dd>
          </div>
          {finance !== 'none' && (
            <>
              <div className="border-l-2 border-teal bg-card px-3 py-2">
                <dt className="text-xs text-secondary">Budgeted direct costs</dt>
                <dd className="num text-lg">{b ? formatCents(b.amountCents) : '—'}</dd>
              </div>
              <div className="border-l-2 border-teal bg-card px-3 py-2">
                <dt className="text-xs text-secondary">Budgeted person-months</dt>
                <dd className="num text-lg">{b ? b.pm.toFixed(2) : '—'}</dd>
              </div>
            </>
          )}
          <div className="border-l-2 border-teal bg-card px-3 py-2">
            <dt className="text-xs text-secondary">Time logged</dt>
            <dd className="num text-lg">{p ? hours(p.logged_minutes) : '—'}</dd>
          </div>
        </dl>
        <section>
          <h3 className="mb-1 text-sm">People</h3>
          {team.length ? (
            <ul className="flex flex-wrap gap-2 text-sm">
              {team.map((m) => {
                const person = people.find((x) => x.user_id === m.user_id);
                return (
                  <li key={m.user_id} className="inline-flex items-center gap-1.5 rounded-[3px] bg-card py-0.5 pl-0.5 pr-2">
                    <Avatar name={person?.display_name ?? 'Former member'} color={person?.avatar_color ?? 'teal'} size={20} />
                    {person?.display_name ?? 'Former member'}
                    <span className="text-xs text-secondary">{m.role}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-secondary">No responsible people yet.</p>
          )}
        </section>
        <section>
          <h3 className="mb-1 text-sm">
            Tasks <span className="num font-normal text-secondary">{tasks.length}</span>
          </h3>
          {tasks.length ? (
            <ul className="flex max-h-64 flex-col divide-y divide-grid overflow-y-auto">
              {tasks.map((t) => (
                <li key={t.id} className="flex items-center gap-2 py-1 text-sm">
                  <button className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => (onClose(), openCard(t.id))}>
                    {t.title}
                  </button>
                  <span className="num text-xs text-secondary">{fmtDate(t.due_date, 'd MMM')}</span>
                  <StatusPill status={t.status} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-secondary">No tasks are linked to this work package. Link tasks from a task's details.</p>
          )}
        </section>
        {ctx.has('milestones') && (
          <section>
            <h3 className="mb-1 text-sm">Milestones and deliverables</h3>
            {milestones.length ? (
              <ul className="flex flex-col divide-y divide-grid text-sm">
                {milestones.map((m) => (
                  <li key={m.id} className="flex items-center gap-2 py-1">
                    <span className="min-w-0 flex-1 truncate">
                      {m.code && <b>{m.code} </b>}
                      {m.title}
                    </span>
                    <span className="num text-xs text-secondary">{fmtDate(m.due_date)}</span>
                    <span className="text-xs">{MILESTONE_STATUS_LABEL[m.status]}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-secondary">None yet.</p>
            )}
          </section>
        )}
        {ctx.has('kpis') && (
          <section>
            <h3 className="mb-1 text-sm">KPIs</h3>
            {wpKpis.length ? (
              <ul className="flex flex-col gap-1 text-sm">
                {wpKpis.map((k) => (
                  <li key={k.id}>
                    {k.code && <b>{k.code} </b>}
                    {k.name}
                    {k.target != null && (
                      <span className="text-secondary">
                        {' '}
                        · target <span className="num">{Number(k.target).toLocaleString('en-GB')}</span> {k.unit}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-secondary">No KPIs linked to this work package.</p>
            )}
          </section>
        )}
      </div>
    </Dialog>
  );
}
