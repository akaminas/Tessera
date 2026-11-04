import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { differenceInCalendarMonths, parseISO } from 'date-fns';
import Big from 'big.js';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Info, Upload, XCircle } from 'lucide-react';
import { useProjectCtx } from '@/features/project/context';
import { Button, Checkbox, Field, Input, Select, Section } from '@/components/ui';
import { useToast } from '@/components/ui/Toast';
import { humanError } from '@/data/errors';
import { fetchPlanForExport, importBudget, importPlan, partnerLabel, useFinanceData } from '@/data/finance';
import {
  buildBudgetPayload,
  buildBudgetWorkbook,
  buildPlanPayload,
  buildPlanWorkbook,
  budgetBlockers,
  detectWorkbookKind,
  groupOfKind,
  loadWorkbook,
  parseBudgetWorkbook,
  parsePlanWorkbook,
  planBlockers,
  reconcileBudget,
  STATUS_LABEL,
  SUMMARY_GROUP_LABEL,
  type BudgetSettingsDraft,
  type Issue,
  type MilestoneStatus,
  type ParsedBudget,
  type ParsedPlan,
  type PlanExport,
  type SummaryGroup,
} from '@/domain/workbooks';
import { computeBudget, isNumberLike, num, settingsFromFunding, toBig, type CategoryKind } from '@/domain/finance';
import { downloadCSV } from '@/lib/exporters';
import { useBudgetModel } from '@/features/finance/shared';
import { cn } from '@/lib/cn';

type Loaded = { file: string; kind: 'plan'; plan: ParsedPlan } | { file: string; kind: 'budget'; budget: ParsedBudget };

function save(buf: ArrayBuffer, filename: string) {
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export default function ImportPage() {
  const ctx = useProjectCtx();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);

  const readFile = async (f: File) => {
    setError(null);
    setLoaded(null);
    if (!/\.xlsx$/i.test(f.name)) return setError('Choose an Excel workbook (.xlsx).');
    if (f.size > 20 * 1024 * 1024) return setError('Workbooks are limited to 20 MB.');
    setBusy(true);
    try {
      const wb = await loadWorkbook(await f.arrayBuffer());
      const kind = detectWorkbookKind(wb);
      if (kind === 'plan') setLoaded({ file: f.name, kind, plan: parsePlanWorkbook(wb) });
      else if (kind === 'budget') setLoaded({ file: f.name, kind, budget: parseBudgetWorkbook(wb) });
      else setError('This workbook does not look like a project plan (work-package sheets with an M1, M2, … month grid) or a budget (a “Cost Category” table per partner).');
    } catch (e) {
      setError(`The workbook could not be read: ${humanError(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-7 px-3 py-4 sm:px-5">
      <div>
        <h2 className="text-xl">Import and export workbooks</h2>
        <p className="text-sm text-secondary">
          Bring in an existing project plan or consortium budget from Excel, review how it maps, correct anything wrong, then import. Nothing is written until you confirm.
        </p>
      </div>

      <section
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files[0];
          if (f) readFile(f);
        }}
        className={cn('flex flex-col items-start gap-2 rounded-[6px] border border-dashed p-5', drag ? 'border-teal bg-accent-soft' : 'border-rule')}
      >
        <FileSpreadsheet className="size-6 text-secondary" aria-hidden />
        <p className="text-sm">Drop an .xlsx file here, or choose one.</p>
        <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-[4px] border border-rule bg-surface px-3 text-sm hover:bg-hover">
          <Upload className="size-4" aria-hidden />
          Choose workbook
          <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])} />
        </label>
        {busy && <p className="text-sm text-secondary">Reading workbook…</p>}
        {error && (
          <p role="alert" className="text-sm text-critical">
            {error}
          </p>
        )}
      </section>

      {loaded?.kind === 'plan' && <PlanPreview key={loaded.file} file={loaded.file} initial={loaded.plan} onDone={() => setLoaded(null)} />}
      {loaded?.kind === 'budget' && <BudgetPreview key={loaded.file} file={loaded.file} initial={loaded.budget} onDone={() => setLoaded(null)} />}

      <ExportSection />
      {!ctx.canManage && ctx.finance !== 'edit' && <p className="text-sm text-secondary">Importing needs project-manager rights (plans) or finance edit access (budgets). You can still preview workbooks and export.</p>}
    </div>
  );
}

/* --------------------------------------------------------------- issues */

function IssueList({ issues }: { issues: Issue[] }) {
  if (!issues.length) return <p className="text-sm text-secondary">No problems found.</p>;
  const icon = { error: <XCircle className="size-4 text-critical" aria-hidden />, warning: <AlertTriangle className="size-4 text-serious" aria-hidden />, info: <Info className="size-4 text-indigo" aria-hidden /> };
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {issues.map((i, k) => (
        <li key={k} className="flex items-start gap-2">
          {icon[i.level]}
          <span className="flex-1">
            <span className="sr-only">{i.level}: </span>
            {i.message}
            {i.ref && <span className="font-mono text-xs text-secondary"> · {i.ref}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function monthsText(r: { planned: number[]; due: number[]; done: number[] }): string {
  const fmt = (ms: number[]) => {
    const s = [...ms].sort((a, b) => a - b);
    const out: string[] = [];
    for (let i = 0; i < s.length; i++) {
      let j = i;
      while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
      out.push(i === j ? `M${s[i]}` : `M${s[i]}–M${s[j]}`);
      i = j;
    }
    return out.join(', ');
  };
  return [r.done.length && `done ${fmt(r.done)}`, r.planned.length && `planned ${fmt(r.planned)}`, r.due.length && `due ${fmt(r.due)}`].filter(Boolean).join(' · ') || '—';
}

/* ------------------------------------------------------------------ plan */

function PlanPreview({ file, initial, onDone }: { file: string; initial: ParsedPlan; onDone: () => void }) {
  const ctx = useProjectCtx();
  const toast = useToast();
  const [p, setP] = useState<ParsedPlan>(() => ({ ...initial, startDate: initial.startDate ?? ctx.project.start_date }));
  const [boardName, setBoardName] = useState('Work plan');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ board_id: string; work_packages: number; cards: number; milestones: number } | null>(null);
  const blockers = planBlockers(p);
  const warnings = p.issues.filter((i) => i.level === 'warning').length;
  const errors = p.issues.filter((i) => i.level === 'error').length;
  const upd = <K extends keyof ParsedPlan>(k: K, v: ParsedPlan[K]) => setP((x) => ({ ...x, [k]: v }));
  const [showRows, setShowRows] = useState(40);

  if (result)
    return (
      <section className="border-l-2 border-teal bg-card p-4">
        <h3 className="text-lg">Plan imported</h3>
        <p className="text-sm">
          {result.work_packages} work packages, {result.cards} tasks and activities, {result.milestones} milestones.
        </p>
        <div className="mt-2 flex flex-wrap gap-3 text-sm">
          <Link className="text-link underline" to={`/p/${ctx.project.id}/board/${result.board_id}`}>
            Open the work-plan board
          </Link>
          <Link className="text-link underline" to={`/p/${ctx.project.id}/timeline`}>
            Timeline
          </Link>
          <Link className="text-link underline" to={`/p/${ctx.project.id}/workpackages`}>
            Work packages
          </Link>
          <Link className="text-link underline" to={`/p/${ctx.project.id}/milestones`}>
            Milestones
          </Link>
          <button className="text-link underline" onClick={onDone}>
            Import another workbook
          </button>
        </div>
      </section>
    );

  return (
    <section className="flex flex-col gap-5">
      <h3 className="font-title text-lg">
        Project plan: {file} <span className="font-sans text-sm text-secondary">· {p.workPackages.length} work packages, {p.rows.length} rows, {p.milestones.length} milestones</span>
      </h3>
      <Section id="imp-issues" title={`Checks (${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'})`}>
        <IssueList issues={p.issues} />
      </Section>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Project start (M1)" htmlFor="ip-start" hint={ctx.project.start_date && p.startDate !== ctx.project.start_date ? `The project currently starts ${ctx.project.start_date}.` : undefined}>
          <Input id="ip-start" type="date" value={p.startDate ?? ''} onChange={(e) => upd('startDate', e.target.value || null)} />
        </Field>
        <Field label="Months in the plan" htmlFor="ip-months">
          <Input id="ip-months" type="number" min={1} max={120} value={p.months} onChange={(e) => upd('months', Math.max(1, Math.min(120, Number(e.target.value) || 1)))} />
        </Field>
        <Field label="Name of the new board" htmlFor="ip-board">
          <Input id="ip-board" value={boardName} onChange={(e) => setBoardName(e.target.value)} maxLength={200} />
        </Field>
      </div>

      <Section id="imp-wps" title="Work packages">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-rule text-left">
                <th className="py-1 pr-2">Code</th>
                <th className="py-1 pr-2">Name</th>
                <th className="py-1 pr-2">Lead organisation</th>
                <th className="py-1 pr-2">Start month</th>
                <th className="py-1 pr-2">End month</th>
                <th className="py-1">Sheet</th>
              </tr>
            </thead>
            <tbody>
              {p.workPackages.map((w, i) => {
                const set = (patch: Partial<typeof w>) => upd('workPackages', p.workPackages.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                return (
                  <tr key={i} className="border-b border-grid">
                    <td className="py-1 pr-2">
                      <Input value={w.code} disabled className="h-8 w-20" aria-label="Code" />
                    </td>
                    <td className="py-1 pr-2">
                      <Input value={w.name} onChange={(e) => set({ name: e.target.value })} className="h-8" aria-label="Name" />
                    </td>
                    <td className="py-1 pr-2">
                      <Input value={w.lead} onChange={(e) => set({ lead: e.target.value })} className="h-8" aria-label="Lead" />
                    </td>
                    <td className="py-1 pr-2">
                      <Input type="number" min={1} value={w.start_month} onChange={(e) => set({ start_month: Number(e.target.value) || 1 })} className="h-8 w-20" aria-label="Start month" />
                    </td>
                    <td className="py-1 pr-2">
                      <Input type="number" min={1} value={w.end_month} onChange={(e) => set({ end_month: Number(e.target.value) || 1 })} className="h-8 w-20" aria-label="End month" />
                    </td>
                    <td className="py-1 text-xs text-secondary">{w.sheet}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-secondary">Lead organisations are matched by name or short name to the workspace’s organisations; unmatched leads stay as text in the import.</p>
      </Section>

      <Section id="imp-rows" title={`Tasks and activities (${p.rows.filter((r) => r.include).length} of ${p.rows.length} included)`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-rule text-left">
                <th className="py-1 pr-2">Import</th>
                <th className="py-1 pr-2">WP</th>
                <th className="py-1 pr-2">Kind</th>
                <th className="py-1 pr-2">Title</th>
                <th className="py-1 pr-2">Responsible</th>
                <th className="py-1">Months</th>
              </tr>
            </thead>
            <tbody>
              {p.rows.slice(0, showRows).map((r) => {
                const set = (patch: Partial<typeof r>) => upd('rows', p.rows.map((x) => (x.id === r.id ? { ...x, ...patch } : x)));
                return (
                  <tr key={r.id} className={cn('border-b border-grid', !r.include && 'opacity-50')}>
                    <td className="py-1 pr-2">
                      <input type="checkbox" className="accent-[var(--v-teal-deep)]" checked={r.include} onChange={(e) => set({ include: e.target.checked })} aria-label={`Import ${r.title}`} />
                    </td>
                    <td className="py-1 pr-2">{r.wp}</td>
                    <td className="py-1 pr-2">
                      <Select value={r.kind} onChange={(e) => set({ kind: e.target.value as 'task' | 'activity' })} className="h-8 w-28" aria-label="Kind">
                        <option value="task">Task (group)</option>
                        <option value="activity">Activity</option>
                      </Select>
                    </td>
                    <td className="py-1 pr-2">
                      <Input value={r.title} onChange={(e) => set({ title: e.target.value })} className="h-8" aria-label="Title" title={r.ref} />
                    </td>
                    <td className="py-1 pr-2">
                      <Input value={r.responsible} onChange={(e) => set({ responsible: e.target.value })} className="h-8 w-36" aria-label="Responsible" />
                    </td>
                    <td className="py-1 text-xs">{monthsText(r)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {p.rows.length > showRows && (
          <Button size="sm" onClick={() => setShowRows(p.rows.length)}>
            Show all {p.rows.length} rows
          </Button>
        )}
        <p className="text-xs text-secondary">Activities are placed under the task above them. Month colours become each card’s M1–M{p.months} schedule; dates are derived from the months.</p>
      </Section>

      <Section id="imp-ms" title={`Milestones (${p.milestones.filter((m) => m.include).length} of ${p.milestones.length} included)`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-rule text-left">
                <th className="py-1 pr-2">Import</th>
                <th className="py-1 pr-2">#</th>
                <th className="py-1 pr-2">Title</th>
                <th className="py-1 pr-2">Kind</th>
                <th className="py-1 pr-2">WP</th>
                <th className="py-1 pr-2">Due</th>
                <th className="py-1 pr-2">Status</th>
                <th className="py-1">Verification</th>
              </tr>
            </thead>
            <tbody>
              {p.milestones.map((m) => {
                const set = (patch: Partial<typeof m>) => upd('milestones', p.milestones.map((x) => (x.id === m.id ? { ...x, ...patch } : x)));
                return (
                  <tr key={m.id} className={cn('border-b border-grid', !m.include && 'opacity-50')}>
                    <td className="py-1 pr-2">
                      <input type="checkbox" className="accent-[var(--v-teal-deep)]" checked={m.include} onChange={(e) => set({ include: e.target.checked })} aria-label={`Import ${m.title}`} />
                    </td>
                    <td className="py-1 pr-2">
                      <Input value={m.code} onChange={(e) => set({ code: e.target.value })} className="h-8 w-14" aria-label="Code" />
                    </td>
                    <td className="py-1 pr-2">
                      <Input value={m.title} onChange={(e) => set({ title: e.target.value })} className="h-8" aria-label="Title" title={m.ref} />
                    </td>
                    <td className="py-1 pr-2">
                      <Select value={m.kind} onChange={(e) => set({ kind: e.target.value as typeof m.kind })} className="h-8 w-28" aria-label="Kind">
                        {['milestone', 'deliverable', 'report', 'event', 'control'].map((k) => (
                          <option key={k} value={k}>
                            {k[0].toUpperCase() + k.slice(1)}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="py-1 pr-2">
                      <Select value={m.wp} onChange={(e) => set({ wp: e.target.value })} className="h-8 w-24" aria-label="Work package">
                        <option value="">None</option>
                        {p.workPackages.map((w) => (
                          <option key={w.code} value={w.code}>
                            {w.code}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="py-1 pr-2">
                      <Input type="date" value={m.due_date ?? ''} onChange={(e) => set({ due_date: e.target.value || null })} className="h-8 w-36" aria-label="Due date" />
                    </td>
                    <td className="py-1 pr-2">
                      <Select value={m.status} onChange={(e) => set({ status: e.target.value as MilestoneStatus })} className="h-8 w-28" aria-label="Status" title={m.rawStatus ? `In the workbook: ${m.rawStatus}` : undefined}>
                        {(Object.keys(STATUS_LABEL) as MilestoneStatus[]).map((s) => (
                          <option key={s} value={s}>
                            {STATUS_LABEL[s]}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="py-1">
                      <Input value={m.verification} onChange={(e) => set({ verification: e.target.value })} className="h-8" aria-label="Verification" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <div className="flex flex-col gap-2 border-t border-grid pt-3">
        {blockers.length > 0 && (
          <ul className="text-sm text-critical">
            {blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        )}
        {warnings > 0 && <Checkbox checked={ack} onChange={setAck} label={`I have reviewed the ${warnings} warning${warnings === 1 ? '' : 's'}`} />}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            loading={busy}
            disabled={!ctx.canManage || blockers.length > 0 || errors > 0 || (warnings > 0 && !ack)}
            onClick={async () => {
              setBusy(true);
              try {
                setResult(await importPlan(ctx.project.id, buildPlanPayload(p, boardName.trim() || 'Work plan')));
              } catch (e) {
                toast.error(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            Import plan
          </Button>
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          {!ctx.canManage && <span className="text-sm text-secondary">Only project managers can import a plan.</span>}
          {errors > 0 && <span className="text-sm text-critical">Fix the errors in the workbook and upload it again.</span>}
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- budget */

const KINDS: CategoryKind[] = ['personnel', 'subcontracting', 'travel', 'equipment', 'other', 'third_party', 'internal', 'other_direct'];

function BudgetPreview({ file, initial, onDone }: { file: string; initial: ParsedBudget; onDone: () => void }) {
  const ctx = useProjectCtx();
  const toast = useToast();
  const [b, setB] = useState<ParsedBudget>(initial);
  const [s, setS] = useState<BudgetSettingsDraft>(initial.settings);
  const [replace, setReplace] = useState(true);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showLines, setShowLines] = useState(30);
  const [result, setResult] = useState<{ partners: number; categories: number; lines: number; work_packages: number } | null>(null);
  const recon = useMemo(() => reconcileBudget(b, s), [b, s]);
  const blockers = budgetBlockers(b, s);
  const errors = b.issues.filter((i) => i.level === 'error').length;
  const warnings = b.issues.filter((i) => i.level === 'warning').length + recon.filter((r) => r.status === 'difference').length;
  const diffs = recon.filter((r) => r.status === 'difference');
  const included = b.lines.filter((l) => l.include && b.partners.find((p) => p.key === l.partner)?.include);
  const total = included.reduce((t, l) => t.plus(toBig(l.amount)), new Big(0));
  const canImport = ctx.finance === 'edit';

  if (result)
    return (
      <section className="border-l-2 border-teal bg-card p-4">
        <h3 className="text-lg">Budget imported</h3>
        <p className="text-sm">
          {result.partners} partners, {result.categories} cost categories, {result.lines} budget lines, {result.work_packages} work packages.
        </p>
        <div className="mt-2 flex flex-wrap gap-3 text-sm">
          <Link className="text-link underline" to={`/p/${ctx.project.id}/budget`}>
            Open the budget
          </Link>
          <Link className="text-link underline" to={`/p/${ctx.project.id}/budget/partners`}>
            Partner rates
          </Link>
          <button className="text-link underline" onClick={onDone}>
            Import another workbook
          </button>
        </div>
      </section>
    );

  const pctInput = (key: 'indirect_rate' | 'funding_rate', label: string, id: string) => (
    <Field label={label} htmlFor={id}>
      <Input
        id={id}
        inputMode="decimal"
        defaultValue={toBig(s[key]).times(100).toString()}
        onBlur={(e) => isNumberLike(e.target.value) && setS({ ...s, [key]: toBig(e.target.value).div(100).toString() })}
      />
    </Field>
  );

  const byScope = new Map<string, typeof recon>();
  for (const r of recon) byScope.set(r.scope, [...(byScope.get(r.scope) ?? []), r]);

  return (
    <section className="flex flex-col gap-5">
      <h3 className="font-title text-lg">
        Budget: {file}{' '}
        <span className="font-sans text-sm text-secondary">
          · {b.partners.length} partners, {b.lines.length} lines, {num(total, 2)} direct costs selected
        </span>
      </h3>
      <Section id="imp-b-issues" title={`Checks (${errors} error${errors === 1 ? '' : 's'}, ${b.issues.filter((i) => i.level === 'warning').length} warnings)`}>
        <IssueList issues={b.issues} />
      </Section>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {pctInput('indirect_rate', 'Indirect rate (%)', 'ib-ir')}
        {pctInput('funding_rate', 'Funding rate (%)', 'ib-fr')}
        <Field label="Round indirect" htmlFor="ib-r">
          <Select id="ib-r" value={s.rounding} onChange={(e) => setS({ ...s, rounding: e.target.value as BudgetSettingsDraft['rounding'] })}>
            <option value="none">Do not round</option>
            <option value="line">Every line</option>
            <option value="category">Per category</option>
            <option value="partner">Per partner</option>
          </Select>
        </Field>
        <Field label="Method" htmlFor="ib-m">
          <Select id="ib-m" value={s.rounding_mode} onChange={(e) => setS({ ...s, rounding_mode: e.target.value as BudgetSettingsDraft['rounding_mode'] })}>
            <option value="half_up">Half up</option>
            <option value="half_even">Half even</option>
            <option value="up">Up</option>
            <option value="down">Down</option>
          </Select>
        </Field>
        <Field label="Decimals" htmlFor="ib-d">
          <Input id="ib-d" type="number" min={0} max={4} value={s.rounding_decimals} onChange={(e) => setS({ ...s, rounding_decimals: Math.max(0, Math.min(4, Number(e.target.value) || 0)) })} />
        </Field>
        <div className="flex items-end pb-2">
          <Checkbox checked={replace} onChange={setReplace} label="Replace earlier imports" />
        </div>
      </div>

      <Section id="imp-b-recon" title={`Reconciliation (${diffs.length} difference${diffs.length === 1 ? '' : 's'})`}>
        <p className="text-xs text-secondary">
          Recomputed values use the rules above. Differences are shown, never corrected silently: import uses the line amounts, and indirect costs are always recomputed from them.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-rule text-left">
                <th className="py-1 pr-2">Scope</th>
                <th className="py-1 pr-2">Check</th>
                <th className="py-1 pr-2 text-right">Workbook</th>
                <th className="py-1 pr-2 text-right">Recomputed</th>
                <th className="py-1 pr-2 text-right">Difference</th>
                <th className="py-1">Result</th>
              </tr>
            </thead>
            <tbody>
              {[...byScope.entries()].flatMap(([scope, rows]) =>
                rows.map((r, i) => (
                  <tr key={scope + i} className="border-b border-grid">
                    <td className="py-1 pr-2">{i === 0 ? scope : ''}</td>
                    <td className="py-1 pr-2">
                      {r.check}
                      {r.ref && <span className="font-mono text-xs text-secondary"> · {r.ref}</span>}
                    </td>
                    <td className="num py-1 pr-2 text-right">{r.source ?? '—'}</td>
                    <td className="num py-1 pr-2 text-right">{r.computed || '—'}</td>
                    <td className="num py-1 pr-2 text-right">{r.difference ?? '—'}</td>
                    <td className="py-1">
                      {r.status === 'ok' ? (
                        <span className="inline-flex items-center gap-1 text-xs text-good">
                          <CheckCircle2 className="size-3.5" aria-hidden />
                          <span className="text-ink">Matches</span>
                        </span>
                      ) : r.status === 'missing' ? (
                        <span className="text-xs text-secondary">Not in workbook</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-serious">
                          <AlertTriangle className="size-3.5" aria-hidden />
                          <span className="text-ink">Differs</span>
                        </span>
                      )}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="imp-b-partners" title="Partners">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-rule text-left">
                <th className="py-1 pr-2">Import</th>
                <th className="py-1 pr-2">Name</th>
                <th className="py-1 pr-2">Short name</th>
                <th className="py-1 pr-2">Country</th>
                <th className="py-1 pr-2">Role</th>
                <th className="py-1 pr-2">PM rate</th>
                <th className="py-1">Sheet</th>
              </tr>
            </thead>
            <tbody>
              {b.partners.map((pt) => {
                const set = (patch: Partial<typeof pt>) => setB({ ...b, partners: b.partners.map((x) => (x.key === pt.key ? { ...x, ...patch } : x)) });
                return (
                  <tr key={pt.key} className={cn('border-b border-grid', !pt.include && 'opacity-50')}>
                    <td className="py-1 pr-2">
                      <input type="checkbox" className="accent-[var(--v-teal-deep)]" checked={pt.include} onChange={(e) => set({ include: e.target.checked })} aria-label={`Import ${pt.name}`} />
                    </td>
                    <td className="py-1 pr-2">
                      <Input value={pt.name} onChange={(e) => set({ name: e.target.value })} className="h-8" aria-label="Name" />
                    </td>
                    <td className="py-1 pr-2">
                      <Input value={pt.short_name} onChange={(e) => set({ short_name: e.target.value })} className="h-8 w-28" aria-label="Short name" maxLength={30} />
                    </td>
                    <td className="py-1 pr-2">
                      <Input value={pt.country} onChange={(e) => set({ country: e.target.value })} className="h-8 w-32" aria-label="Country" />
                    </td>
                    <td className="py-1 pr-2">
                      <Select value={pt.role} onChange={(e) => set({ role: e.target.value as typeof pt.role })} className="h-8 w-32" aria-label="Role">
                        <option value="coordinator">Coordinator</option>
                        <option value="partner">Partner</option>
                      </Select>
                    </td>
                    <td className="py-1 pr-2">
                      <Input value={pt.pm_rate ?? ''} onChange={(e) => set({ pm_rate: e.target.value || null })} className="h-8 w-28" inputMode="decimal" aria-label="Person-month rate" />
                    </td>
                    <td className="py-1 text-xs text-secondary">{pt.sheet}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-secondary">Organisations are matched by name in this workspace and created if missing. Rates are visible only to people with finance access.</p>
      </Section>

      <Section id="imp-b-cats" title="Cost categories">
        <ul className="flex flex-col divide-y divide-grid text-sm">
          {b.categories.map((c) => {
            const set = (patch: Partial<typeof c>) => setB({ ...b, categories: b.categories.map((x) => (x.name === c.name ? { ...x, ...patch } : x)) });
            return (
              <li key={c.name} className="flex flex-wrap items-center gap-3 py-1.5">
                <span className="min-w-0 flex-1">{c.name}</span>
                <Select value={c.kind} onChange={(e) => set({ kind: e.target.value as CategoryKind })} className="h-8 w-52" aria-label={`Kind of ${c.name}`}>
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {k.replace('_', ' ')}
                    </option>
                  ))}
                </Select>
                <span className="text-xs text-secondary">Summary column: {SUMMARY_GROUP_LABEL[groupOfKind(c.kind) as SummaryGroup]}</span>
                <Checkbox checked={c.indirect_base} onChange={(v) => set({ indirect_base: v })} label="Indirect base" />
              </li>
            );
          })}
        </ul>
      </Section>

      <Section id="imp-b-lines" title={`Budget lines (${included.length} of ${b.lines.length} included)`} defaultOpen={false}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-rule text-left">
                <th className="py-1 pr-2">Import</th>
                <th className="py-1 pr-2">Partner</th>
                <th className="py-1 pr-2">Category</th>
                <th className="py-1 pr-2 text-right">Amount</th>
                <th className="py-1 pr-2">Year</th>
                <th className="py-1 pr-2">WP</th>
                <th className="py-1 pr-2 text-right">PMs</th>
                <th className="py-1 pr-2">Description</th>
                <th className="py-1">Cell</th>
              </tr>
            </thead>
            <tbody>
              {b.lines.slice(0, showLines).map((l) => {
                const set = (patch: Partial<typeof l>) => setB({ ...b, lines: b.lines.map((x) => (x.id === l.id ? { ...x, ...patch } : x)) });
                return (
                  <tr key={l.id} className={cn('border-b border-grid', !l.include && 'opacity-50')}>
                    <td className="py-1 pr-2">
                      <input type="checkbox" className="accent-[var(--v-teal-deep)]" checked={l.include} onChange={(e) => set({ include: e.target.checked })} aria-label="Import line" />
                    </td>
                    <td className="py-1 pr-2">{b.partners.find((p) => p.key === l.partner)?.short_name}</td>
                    <td className="py-1 pr-2">{l.category}</td>
                    <td className="py-1 pr-2 text-right">
                      <Input
                        defaultValue={String(l.amount)}
                        onBlur={(e) => isNumberLike(e.target.value) && set({ amount: Number(toBig(e.target.value).toString()) })}
                        className="num h-8 w-28 text-right"
                        inputMode="decimal"
                        aria-label="Amount"
                      />
                    </td>
                    <td className="num py-1 pr-2">{l.year ?? '—'}</td>
                    <td className="py-1 pr-2">{l.wp ?? '—'}</td>
                    <td className="num py-1 pr-2 text-right">{l.person_months != null ? num(l.person_months, 4) : '—'}</td>
                    <td className="max-w-[240px] truncate py-1 pr-2" title={l.description}>
                      {l.description}
                    </td>
                    <td className="py-1 font-mono text-xs text-secondary">{l.ref}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {b.lines.length > showLines && (
          <Button size="sm" onClick={() => setShowLines(b.lines.length)}>
            Show all {b.lines.length} lines
          </Button>
        )}
        <p className="text-xs text-secondary">Person-months are stored with four decimals.</p>
      </Section>

      <div className="flex flex-col gap-2 border-t border-grid pt-3">
        {blockers.length > 0 && (
          <ul className="text-sm text-critical">
            {blockers.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        )}
        {warnings > 0 && <Checkbox checked={ack} onChange={setAck} label={`I have reviewed the warnings and ${diffs.length} reconciliation difference${diffs.length === 1 ? '' : 's'}`} />}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            loading={busy}
            disabled={!canImport || blockers.length > 0 || errors > 0 || (warnings > 0 && !ack)}
            onClick={async () => {
              setBusy(true);
              try {
                setResult(await importBudget(ctx.project.id, buildBudgetPayload(b, s, replace)));
              } catch (e) {
                toast.error(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            Import budget
          </Button>
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          {!canImport && <span className="text-sm text-secondary">Importing a budget needs finance edit access.</span>}
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- export */

function ExportSection() {
  const ctx = useProjectCtx();
  const toast = useToast();
  const finance = useFinanceData(ctx.project.id, ctx.finance !== 'none');
  const model = useBudgetModel(ctx.project, finance.data);
  const [busy, setBusy] = useState<string | null>(null);
  const base = ctx.project.acronym || ctx.project.name.slice(0, 30).replace(/\s+/g, '-');

  const planData = async (): Promise<PlanExport> => {
    const d = await fetchPlanForExport(ctx.project.id);
    const start = ctx.project.start_date ?? d.workPackages.find((w) => w.start_date)?.start_date;
    if (!start) throw new Error('Set the project start date before exporting a month plan.');
    const end = ctx.project.end_date;
    const startD = parseISO(start);
    const monthOf = (date: string | null) => (date ? differenceInCalendarMonths(parseISO(date), startD) + 1 : null);
    const maxSched = Math.max(0, ...d.cards.flatMap((c) => [...(c.schedule?.planned ?? []), ...(c.schedule?.due ?? []), ...(c.schedule?.done ?? [])]));
    const months = Math.max(1, end ? (monthOf(end) ?? 1) : 1, maxSched);
    const children = new Map<string, typeof d.cards>();
    for (const c of d.cards) if (c.parent_id) children.set(c.parent_id, [...(children.get(c.parent_id) ?? []), c]);
    const ids = new Set(d.cards.map((c) => c.id));
    const scheduleOf = (c: (typeof d.cards)[number]) => {
      if (c.schedule && (c.schedule.planned?.length || c.schedule.due?.length || c.schedule.done?.length))
        return { planned: c.schedule.planned ?? [], due: c.schedule.due ?? [], done: c.schedule.done ?? [] };
      const a = monthOf(c.start_date ?? c.due_date);
      const b = monthOf(c.due_date ?? c.start_date);
      if (a == null || b == null) return { planned: [], due: [], done: [] };
      const range: number[] = [];
      for (let m = Math.max(1, a); m <= Math.min(months, b); m++) range.push(m);
      return c.status === 'done' ? { planned: [], due: [], done: range } : { planned: range, due: [], done: [] };
    };
    const rows: PlanExport['rows'] = [];
    for (const wp of d.workPackages) {
      const top = d.cards.filter((c) => c.work_package_id === wp.id && (!c.parent_id || !ids.has(c.parent_id)));
      for (const c of top) {
        const kids = children.get(c.id) ?? [];
        rows.push({ wp: wp.code, kind: kids.length ? 'task' : 'activity', title: c.title, responsible: c.responsible_text, ...scheduleOf(c) });
        for (const k of kids) rows.push({ wp: wp.code, kind: 'activity', title: k.title, responsible: k.responsible_text, ...scheduleOf(k) });
      }
    }
    const orgName = (id: string | null) => d.orgs.find((o) => o.id === id)?.short_name || d.orgs.find((o) => o.id === id)?.name || '';
    const wpCode = (id: string | null) => d.workPackages.find((w) => w.id === id)?.code ?? '';
    return {
      projectName: ctx.project.name,
      startDate: start.slice(0, 8) + '01',
      months,
      workPackages: d.workPackages.map((w) => ({ code: w.code, name: w.name, lead: orgName(w.lead_org_id) })),
      rows,
      milestones: d.milestones.map((m) => ({ code: m.code, title: m.title, wp: wpCode(m.work_package_id), due_date: m.due_date, verification: m.verification, status: m.status as MilestoneStatus, notes: m.notes })),
    };
  };

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="flex flex-col gap-3 border-t border-grid pt-5">
      <h3 className="text-lg">Export</h3>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-2 border-l-2 border-teal bg-card p-3">
          <p className="font-bold">Project plan</p>
          <p className="text-sm text-secondary">Work packages as sheets with a coloured M1–Mn grid (planned, due, completed), plus a milestones sheet. Can be imported again.</p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              icon={<Download className="size-3.5" />}
              loading={busy === 'plan'}
              onClick={() =>
                run('plan', async () => {
                  const d = await planData();
                  if (!d.workPackages.length) throw new Error('This project has no work packages to export.');
                  save(await buildPlanWorkbook(d), `${base}-plan.xlsx`);
                })
              }
            >
              Plan (XLSX)
            </Button>
            <Button
              size="sm"
              variant="ghost"
              loading={busy === 'plancsv'}
              onClick={() =>
                run('plancsv', async () => {
                  const d = await planData();
                  downloadCSV(`${base}-plan`, [
                    ['Work package', 'Kind', 'Title', 'Responsible', 'Planned months', 'Due months', 'Done months'],
                    ...d.rows.map((r) => [r.wp, r.kind, r.title, r.responsible, r.planned.join(' '), r.due.join(' '), r.done.join(' ')]),
                  ]);
                })
              }
            >
              CSV
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-2 border-l-2 border-teal bg-card p-3">
          <p className="font-bold">Consortium budget</p>
          {ctx.finance === 'none' ? (
            <p className="text-sm text-secondary">Requires finance access.</p>
          ) : (
            <>
              <p className="text-sm text-secondary">Summary by partner and category with recomputed indirect costs, person-months per work package, and one sheet per partner.</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  icon={<Download className="size-3.5" />}
                  loading={busy === 'budget'}
                  disabled={!finance.data || !model}
                  onClick={() =>
                    run('budget', async () => {
                      const d = finance.data!;
                      if (!d.lines.length) throw new Error('There are no budget lines to export.');
                      const m = model!;
                      const settings = settingsFromFunding(ctx.project.funding);
                      const partners = d.partners.map((p) => {
                        const r = m.result.byPartner.find((x) => x.partnerId === p.id);
                        const pl = d.lines.filter((l) => l.partner_id === p.id);
                        const sub = computeBudget({ categories: d.categories, partners: [{ id: p.id, name: partnerLabel(p), pm_rate: m.partnerFinance.get(p.id)?.pm_rate, funding_rate: m.partnerFinance.get(p.id)?.funding_rate, indirect_rate: m.partnerFinance.get(p.id)?.indirect_rate }], lines: pl, expenditures: [], settings });
                        const groups = { personnel: new Big(0), subcontracting: new Big(0), travel: new Big(0), equipment: new Big(0), other: new Big(0), other_categories: new Big(0) } as Record<SummaryGroup, Big>;
                        const pm: Record<string, Big> = {};
                        for (const l of pl) {
                          const g = groupOfKind(m.catById.get(l.category_id)?.kind ?? 'other_direct');
                          groups[g] = groups[g].plus(toBig(l.amount));
                          const code = l.work_package_id ? m.wpById.get(l.work_package_id)?.code : undefined;
                          if (code && l.person_months != null) pm[code] = (pm[code] ?? new Big(0)).plus(toBig(l.person_months));
                        }
                        return {
                          name: p.organizations?.name || partnerLabel(p),
                          short: partnerLabel(p),
                          country: p.organizations?.country ?? '',
                          groups: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.toFixed(2)])) as Record<SummaryGroup, string>,
                          indirect: (r?.indirect ?? new Big(0)).toFixed(2),
                          total: (r?.eligible ?? new Big(0)).toFixed(2),
                          fundingRate: (r?.fundingRate ?? settings.fundingRate).toString(),
                          requested: (r?.requested ?? new Big(0)).toFixed(2),
                          pmByWp: Object.fromEntries(Object.entries(pm).map(([k, v]) => [k, v.toFixed(4)])),
                          lines: pl.map((l) => {
                            const lr = sub.lines.get(l.id)!;
                            return {
                              category: m.catById.get(l.category_id)?.name ?? '',
                              amount: toBig(l.amount).toFixed(2),
                              indirect: lr.indirect.toFixed(2),
                              total: lr.total.toFixed(2),
                              year: l.financial_year,
                              wp: l.work_package_id ? m.wpById.get(l.work_package_id)?.code ?? null : null,
                              pms: l.person_months != null ? toBig(l.person_months).toFixed(4) : null,
                              description: l.description,
                            };
                          }),
                        };
                      });
                      const coord = d.partners.find((p) => p.role === 'coordinator');
                      save(
                        await buildBudgetWorkbook({
                          title: `${ctx.project.name} — consortium budget`,
                          currency: ctx.project.currency,
                          coordinator: coord?.organizations?.name ?? '',
                          indirectRatePct: settings.indirectRate.times(100).toString(),
                          partners,
                          workPackages: d.workPackages.map((w) => ({ code: w.code, name: w.name })),
                        }),
                        `${base}-budget.xlsx`,
                      );
                    })
                  }
                >
                  Budget (XLSX)
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
