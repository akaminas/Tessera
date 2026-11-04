import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { format, parseISO } from 'date-fns';
import Big from 'big.js';
import { CheckCircle2, CircleAlert, Download } from 'lucide-react';
import { useWorkspaceCtx } from '@/layout/WorkspaceContext';
import { useProject, useProjectPeople, useProjectRole, useWorkspaceProjects } from '@/data/core';
import { currentPeriod, useEffortData, useFinanceData, useKpis, useReportData, useReportingPeriods, partnerLabel, type ReportingPeriod } from '@/data/finance';
import { Button, EmptyState, ErrorNote, PageHeader, PageLoading, Section, Select } from '@/components/ui';
import { MenuContent, MenuItem, MenuRoot, MenuTrigger } from '@/components/ui/Menu';
import { useToast } from '@/components/ui/Toast';
import { Meter, StatTile } from '@/components/charts';
import { computeBudget, minutesToPm, money, num, pct, settingsFromFunding, toBig } from '@/domain/finance';
import { kpiProgress } from '@/features/finance/KpisPage';
import { downloadCSV, downloadPDF, downloadXLSX, type Cell, type PdfSection, type SheetSpec } from '@/lib/exporters';
import { usePersistentState } from '@/lib/usePersistentState';

const MS_STATUS: Record<string, string> = { planned: 'Planned', on_track: 'On track', at_risk: 'At risk', delayed: 'Delayed', done: 'Done', cancelled: 'Cancelled' };
const APPROVAL: Record<string, string> = { not_required: '—', not_submitted: 'Not submitted', submitted: 'Submitted', approved: 'Approved', rejected: 'Rejected' };

export default function ReportsPage() {
  const { current } = useWorkspaceCtx();
  const projects = useWorkspaceProjects(current?.id);
  const list = (projects.data ?? []).filter((p) => !p.personal_owner);
  const [projectId, setProjectId] = usePersistentState<string>(`reports-project:${current?.id}`, '');
  const pid = list.some((p) => p.id === projectId) ? projectId : list[0]?.id;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-6 sm:px-6">
      <PageHeader title="Reports" subtitle="Status, progress, KPIs, effort and finance from live project records" />
      {projects.isLoading && <PageLoading />}
      {!projects.isLoading && list.length === 0 && <EmptyState title="No projects to report on" />}
      {pid && (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm font-bold">
              Project
              <Select value={pid} onChange={(e) => setProjectId(e.target.value)} className="mt-1 h-9 w-72">
                {list.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </label>
          </div>
          <ProjectReport key={pid} projectId={pid} />
        </>
      )}
    </div>
  );
}

function inPeriod(date: string | null, p: ReportingPeriod | null) {
  if (!p) return true;
  return Boolean(date) && date! >= p.start_date && date! <= p.end_date;
}

function ProjectReport({ projectId }: { projectId: string }) {
  const toast = useToast();
  const project = useProject(projectId);
  const role = useProjectRole(projectId);
  const people = useProjectPeople(projectId);
  const periods = useReportingPeriods(projectId);
  const report = useReportData(projectId);
  const kpis = useKpis(projectId);
  const effort = useEffortData(projectId);
  const finance = role.data?.finance ?? 'none';
  const fin = useFinanceData(projectId, finance !== 'none');
  const [periodId, setPeriodId] = useState<string>('');
  useEffect(() => {
    if (periods.data && !periodId) setPeriodId(currentPeriod(periods.data)?.id ?? 'all');
  }, [periods.data, periodId]);
  const period = (periods.data ?? []).find((p) => p.id === periodId) ?? null;

  const name = (id: string | null) => (people.data ?? []).find((p) => p.user_id === id)?.display_name ?? '';
  const settings = settingsFromFunding(project.data?.funding);
  const cur = project.data?.currency ?? 'EUR';

  const model = useMemo(() => {
    if (!report.data || !kpis.data || !effort.data) return null;
    const r = report.data;
    const wpById = new Map(r.workPackages.map((w) => [w.id, w]));
    const end = period?.end_date ?? '9999-12-31';
    // KPI value as at the end of the period
    const kpiRows = kpis.data.kpis.map((k) => {
      const ms = kpis.data.measurements.filter((m) => m.kpi_id === k.id && m.verification_status !== 'rejected' && m.measured_on <= end).sort((a, b) => a.measured_on.localeCompare(b.measured_on));
      const value = ms.length ? (k.aggregation === 'sum' ? ms.reduce((t, m) => t + Number(m.value), 0) : k.aggregation === 'max' ? Math.max(...ms.map((m) => Number(m.value))) : Number(ms[ms.length - 1].value)) : null;
      const measuredInPeriod = period ? kpis.data.measurements.some((m) => m.kpi_id === k.id && inPeriod(m.measured_on, period)) : ms.length > 0;
      const st = kpis.data.status.find((s) => s.kpi_id === k.id);
      return { k, value, progress: kpiProgress(k, value), measuredInPeriod, evidenceMissing: st?.evidence_missing ?? 0, verified: st?.verified ?? 0, count: st?.measurements ?? 0 };
    });
    const milestones = r.milestones.filter((m) => !period || inPeriod(m.due_date, period) || inPeriod(m.actual_date, period));
    const today = new Date().toISOString().slice(0, 10);
    const overdueMs = r.milestones.filter((m) => m.due_date && m.due_date < today && !['done', 'cancelled'].includes(m.status));
    // effort in the period
    const hours = settings.hoursPerPm;
    const effortByWp = new Map<string, { reported: Big; logged: Big; planned: Big }>();
    const bucket = (w: string | null) => {
      const k = w ?? 'none';
      if (!effortByWp.has(k)) effortByWp.set(k, { reported: new Big(0), logged: new Big(0), planned: new Big(0) });
      return effortByWp.get(k)!;
    };
    for (const rep of effort.data.reports) {
      if (period && (rep.period_end < period.start_date || rep.period_start > period.end_date)) continue;
      bucket(rep.work_package_id).reported = bucket(rep.work_package_id).reported.plus(toBig(rep.actual_pm));
    }
    for (const t of effort.data.time) {
      if (!inPeriod(t.entry_date, period)) continue;
      const b = bucket(t.cards?.work_package_id ?? null);
      b.logged = b.logged.plus(minutesToPm(t.minutes ?? 0, hours));
    }
    for (const a of effort.data.allocations) {
      if (period && a.reporting_period_id && a.reporting_period_id !== period.id) continue;
      bucket(a.work_package_id).planned = bucket(a.work_package_id).planned.plus(toBig(a.planned_pm));
    }
    // finance
    let financeRows: { label: string; planned: Big; periodActual: Big; toDate: Big; committed: Big }[] | null = null;
    let financeTotals: { planned: Big; eligible: Big; periodActual: Big; toDate: Big; committed: Big; remaining: Big } | null = null;
    if (fin.data) {
      const d = fin.data;
      const pf = new Map(d.partnerFinance.map((p) => [p.partner_id, p]));
      const partners = d.partners.map((p) => ({ id: p.id, name: partnerLabel(p), pm_rate: pf.get(p.id)?.pm_rate, funding_rate: pf.get(p.id)?.funding_rate, indirect_rate: pf.get(p.id)?.indirect_rate }));
      const all = computeBudget({ categories: d.categories, partners, lines: d.lines, expenditures: d.expenditures.filter((e) => e.spent_on <= end), settings });
      const inP = computeBudget({ categories: d.categories, partners, lines: [], expenditures: d.expenditures.filter((e) => inPeriod(e.spent_on, period) && e.status === 'actual'), settings });
      financeRows = all.byPartner.map((p) => ({
        label: partnerLabel(d.partners.find((x) => x.id === p.partnerId)),
        planned: p.planned,
        periodActual: inP.byPartner.find((x) => x.partnerId === p.partnerId)?.actual ?? new Big(0),
        toDate: p.actual,
        committed: p.committed,
      }));
      financeTotals = { planned: all.total.planned, eligible: all.total.eligible, periodActual: inP.total.actual, toDate: all.total.actual, committed: all.total.committed, remaining: all.total.remaining };
    }
    return { wpById, kpiRows, milestones, overdueMs, effortByWp, financeRows, financeTotals };
  }, [report.data, kpis.data, effort.data, fin.data, period, settings]);

  if (report.isLoading || kpis.isLoading || effort.isLoading || project.isLoading || periods.isLoading) return <PageLoading />;
  const err = report.error || kpis.error || effort.error || project.error;
  if (err || !report.data || !model || !project.data) return <ErrorNote error={err} retry={() => report.refetch()} />;
  const r = report.data;
  const s = r.summary;
  const p = project.data;
  const missingKpis = model.kpiRows.filter((x) => !x.measuredInPeriod && x.k.frequency !== 'once');
  const periodLabel = period ? `${period.code} ${period.name} (${format(parseISO(period.start_date), 'd MMM yyyy')} – ${format(parseISO(period.end_date), 'd MMM yyyy')})` : 'Whole project to date';
  const m = (v: Big) => money(v, cur);

  /* ---------------------------------------------------------- exports */
  const tables = () => {
    const wpRows: Cell[][] = r.progress.map((g) => {
      const w = model.wpById.get(g.work_package_id);
      return [w?.code ?? '', w?.name ?? '', g.tasks_done, g.tasks_total, g.tasks_overdue, Number(g.actual_progress), g.planned_progress != null ? Number(g.planned_progress) : null, g.milestones_done, g.milestones_total];
    });
    const msRows: Cell[][] = model.milestones.map((x) => [x.code, x.title, x.kind, model.wpById.get(x.work_package_id ?? '')?.code ?? '', x.due_date, x.actual_date, MS_STATUS[x.status] ?? x.status, APPROVAL[x.approval_status] ?? x.approval_status]);
    const riskRows: Cell[][] = r.risks.filter((x) => !['closed'].includes(x.status)).map((x) => [x.kind, x.code, x.title, x.probability, x.impact, x.score, x.status, name(x.owner_id), x.review_date, x.mitigation]);
    const kpiRows: Cell[][] = model.kpiRows.map((x) => [x.k.code, x.k.name, x.k.unit, x.k.baseline != null ? Number(x.k.baseline) : null, x.k.target != null ? Number(x.k.target) : null, x.value, x.progress != null ? Math.round(x.progress) : null, x.measuredInPeriod ? 'yes' : 'no', `${x.verified}/${x.count}`, x.evidenceMissing]);
    const effortRows: Cell[][] = [...model.effortByWp.entries()].map(([w, e]) => [w === 'none' ? 'No work package' : model.wpById.get(w)?.code ?? '', Number(e.planned.toFixed(2)), Number(e.reported.toFixed(2)), Number(e.logged.toFixed(2)), Number(e.reported.plus(e.logged).toFixed(2))]);
    const missing: Cell[][] = [
      ...r.evidenceMissing.map((e) => ['Evidence', `${e.title} (${e.entity_type.replace('_', ' ')})`, e.status, e.due_date]),
      ...missingKpis.map((x) => ['KPI measurement', `${x.k.code} ${x.k.name}`.trim(), 'no measurement in period', period?.end_date ?? null]),
      ...model.overdueMs.map((x) => ['Overdue milestone', `${x.code} ${x.title}`.trim(), MS_STATUS[x.status], x.due_date]),
      ...r.overdueTasks.map((t) => ['Overdue task', t.title, 'open', t.due_date]),
    ];
    const finRows: Cell[][] | null = model.financeRows ? model.financeRows.map((x) => [x.label, Number(x.planned.toFixed(2)), Number(x.periodActual.toFixed(2)), Number(x.toDate.toFixed(2)), Number(x.committed.toFixed(2)), Number(x.planned.minus(x.toDate).minus(x.committed).toFixed(2))]) : null;
    return { wpRows, msRows, riskRows, kpiRows, effortRows, missing, finRows };
  };
  const H = {
    wp: ['WP', 'Name', 'Tasks done', 'Tasks', 'Overdue', 'Actual %', 'Planned %', 'Milestones done', 'Milestones'],
    ms: ['Code', 'Title', 'Kind', 'WP', 'Due', 'Completed', 'Status', 'Approval'],
    risk: ['Kind', 'Code', 'Title', 'Probability', 'Impact', 'Score', 'Status', 'Owner', 'Review', 'Mitigation'],
    kpi: ['Code', 'KPI', 'Unit', 'Baseline', 'Target', 'Value at period end', 'Progress %', 'Measured in period', 'Verified', 'Evidence missing'],
    effort: ['WP', 'Planned PM (allocations)', 'Reported PM', 'Logged PM', 'Actual PM'],
    missing: ['Type', 'Item', 'Status', 'Due'],
    fin: ['Partner', 'Planned direct', 'Actual in period', 'Actual to date', 'Committed', 'Remaining'],
  };
  const filename = `${p.acronym || p.name.slice(0, 24)}-report-${period?.code ?? 'to-date'}`.replace(/\s+/g, '-');
  const exportPdf = async () => {
    const t = tables();
    const sections: PdfSection[] = [
      {
        heading: 'Summary',
        paragraphs: [
          s
            ? `${s.tasks_done} of ${s.tasks_total} tasks done (${s.tasks_overdue} overdue, ${s.tasks_blocked} blocked). ${s.milestones_done} of ${s.milestones_total} milestones done (${s.milestones_overdue} overdue, ${s.milestones_at_risk} at risk). ${s.risks_open} open risks (${s.risks_high} high), ${s.issues_open} open issues. ${s.evidence_missing} required evidence items missing.`
            : '',
        ],
      },
      { heading: 'Missing evidence and updates', table: { head: H.missing, body: t.missing } },
      { heading: 'Work-package progress', table: { head: H.wp, body: t.wpRows, numeric: [2, 3, 4, 5, 6, 7, 8] } },
      { heading: 'Milestones and deliverables', table: { head: H.ms, body: t.msRows } },
      { heading: 'Risks and issues', table: { head: H.risk.slice(0, 9), body: t.riskRows.map((x) => x.slice(0, 9)), numeric: [3, 4, 5] } },
      { heading: 'KPI performance', table: { head: H.kpi, body: t.kpiRows, numeric: [3, 4, 5, 6, 9] } },
      { heading: 'Personnel effort (person-months)', table: { head: H.effort, body: t.effortRows, numeric: [1, 2, 3, 4] } },
    ];
    if (t.finRows) sections.push({ heading: `Financial report (${cur})`, table: { head: H.fin, body: t.finRows, numeric: [1, 2, 3, 4, 5] } });
    await downloadPDF(filename, `${p.name}: progress report`, periodLabel, sections);
  };
  const exportXlsx = async () => {
    const t = tables();
    const sheets: SheetSpec[] = [
      { name: 'Missing items', header: H.missing, rows: t.missing },
      { name: 'Work packages', header: H.wp, rows: t.wpRows },
      { name: 'Milestones', header: H.ms, rows: t.msRows },
      { name: 'Risks', header: H.risk, rows: t.riskRows },
      { name: 'KPIs', header: H.kpi, rows: t.kpiRows },
      { name: 'Effort', header: H.effort, rows: t.effortRows, totals: true, formats: [undefined, '0.00', '0.00', '0.00', '0.00'] },
    ];
    if (t.finRows) sheets.push({ name: 'Finance', header: H.fin, rows: t.finRows, totals: true, formats: [undefined, '#,##0.00', '#,##0.00', '#,##0.00', '#,##0.00', '#,##0.00'] });
    await downloadXLSX(filename, sheets);
  };

  const t = tables();
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm font-bold">
          Reporting period
          <Select value={periodId} onChange={(e) => setPeriodId(e.target.value)} className="mt-1 h-9 w-72">
            <option value="all">Whole project to date</option>
            {(periods.data ?? []).map((x) => (
              <option key={x.id} value={x.id}>
                {x.code} {x.name}
              </option>
            ))}
          </Select>
        </label>
        {(periods.data ?? []).length === 0 && (
          <span className="pb-2 text-xs text-secondary">
            No reporting periods yet. <Link className="text-link underline" to={`/p/${projectId}/settings`}>Set them up in project settings</Link>.
          </span>
        )}
        <div className="ml-auto pb-0.5">
          <MenuRoot>
            <MenuTrigger asChild>
              <Button icon={<Download className="size-4" />}>Export report</Button>
            </MenuTrigger>
            <MenuContent>
              <MenuItem onSelect={() => exportPdf().catch(toast.error)}>PDF</MenuItem>
              <MenuItem onSelect={() => exportXlsx().catch(toast.error)}>Excel (XLSX)</MenuItem>
              <MenuItem onSelect={() => downloadCSV(`${filename}-missing`, [H.missing, ...t.missing])}>Missing items (CSV)</MenuItem>
              <MenuItem onSelect={() => downloadCSV(`${filename}-milestones`, [H.ms, ...t.msRows])}>Milestones (CSV)</MenuItem>
              <MenuItem onSelect={() => downloadCSV(`${filename}-kpis`, [H.kpi, ...t.kpiRows])}>KPIs (CSV)</MenuItem>
            </MenuContent>
          </MenuRoot>
        </div>
      </div>
      <p className="text-sm text-secondary">
        {p.name} · {periodLabel}
      </p>

      {s && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
          <StatTile label="Tasks done" value={`${s.tasks_done}/${s.tasks_total}`} note={s.tasks_total ? pct(s.tasks_done / s.tasks_total) : undefined} />
          <StatTile label="Overdue tasks" value={s.tasks_overdue} tone={s.tasks_overdue ? 'serious' : undefined} />
          <StatTile label="Milestones done" value={`${s.milestones_done}/${s.milestones_total}`} />
          <StatTile label="Milestones overdue or at risk" value={s.milestones_overdue + s.milestones_at_risk} tone={s.milestones_overdue ? 'critical' : undefined} />
          <StatTile label="Open risks (high)" value={`${s.risks_open} (${s.risks_high})`} tone={s.risks_high ? 'serious' : undefined} />
          <StatTile label="Evidence missing" value={s.evidence_missing} tone={s.evidence_missing ? 'serious' : undefined} />
        </div>
      )}

      <Section id="rep-missing" title="Missing evidence and updates" count={t.missing.length}>
        {t.missing.length === 0 ? (
          <p className="flex items-center gap-1.5 text-sm">
            <CheckCircle2 className="size-4 text-good" aria-hidden /> Nothing is missing for this period.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-grid text-sm">
            {r.evidenceMissing.map((e) => (
              <li key={e.id} className="flex items-center gap-2 py-1.5">
                <CircleAlert className="size-4 text-serious" aria-hidden />
                <span className="flex-1">
                  Evidence {e.status === 'rejected' ? 'rejected' : 'missing'}: <b>{e.title}</b> <span className="text-secondary">({e.entity_type.replace('_', ' ')})</span>
                </span>
                {e.due_date && <span className="num text-xs text-secondary">due {e.due_date}</span>}
              </li>
            ))}
            {missingKpis.map((x) => (
              <li key={x.k.id} className="flex items-center gap-2 py-1.5">
                <CircleAlert className="size-4 text-serious" aria-hidden />
                <span className="flex-1">
                  No measurement {period ? 'in this period' : 'yet'} for KPI <b>{`${x.k.code} ${x.k.name}`.trim()}</b>
                </span>
                <Link className="text-xs text-link underline" to={`/p/${projectId}/kpis`}>
                  Record
                </Link>
              </li>
            ))}
            {model.overdueMs.map((x) => (
              <li key={x.id} className="flex items-center gap-2 py-1.5">
                <CircleAlert className="size-4 text-critical" aria-hidden />
                <span className="flex-1">
                  Milestone overdue: <b>{`${x.code} ${x.title}`.trim()}</b> <span className="text-secondary">({MS_STATUS[x.status]})</span>
                </span>
                <span className="num text-xs text-secondary">due {x.due_date}</span>
              </li>
            ))}
            {r.overdueTasks.map((x) => (
              <li key={x.id} className="flex items-center gap-2 py-1.5">
                <CircleAlert className="size-4 text-serious" aria-hidden />
                <Link className="flex-1 hover:underline" to={`/p/${projectId}/board/${x.board_id}?card=${x.id}`}>
                  Overdue task: {x.title}
                </Link>
                <span className="num text-xs text-secondary">due {x.due_date}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="rep-wp" title="Work-package progress" count={r.progress.length}>
        {r.progress.length === 0 ? (
          <p className="text-sm text-secondary">No work packages.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-sm">
              <thead>
                <tr className="border-b border-rule text-left">
                  <th className="py-1.5 pr-3">Work package</th>
                  <th className="w-64 py-1.5 pr-3">Actual progress (marker: planned by date)</th>
                  <th className="py-1.5 pr-3 text-right">Tasks</th>
                  <th className="py-1.5 pr-3 text-right">Overdue</th>
                  <th className="py-1.5 text-right">Milestones</th>
                </tr>
              </thead>
              <tbody>
                {r.progress.map((g) => {
                  const w = model.wpById.get(g.work_package_id);
                  return (
                    <tr key={g.work_package_id} className="border-b border-grid">
                      <td className="py-1.5 pr-3">
                        <b>{w?.code}</b> {w?.name}
                      </td>
                      <td className="py-1.5 pr-3">
                        <Meter value={Number(g.actual_progress)} planned={g.planned_progress != null ? Number(g.planned_progress) : null} label={`${w?.code} progress`} />
                      </td>
                      <td className="num py-1.5 pr-3 text-right">
                        {g.tasks_done}/{g.tasks_total}
                      </td>
                      <td className={`num py-1.5 pr-3 text-right ${g.tasks_overdue ? 'text-critical' : ''}`}>{g.tasks_overdue}</td>
                      <td className="num py-1.5 text-right">
                        {g.milestones_done}/{g.milestones_total}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section id="rep-ms" title={period ? 'Milestones and deliverables due or completed in this period' : 'Milestones and deliverables'} count={model.milestones.length}>
        {model.milestones.length === 0 ? (
          <p className="text-sm text-secondary">None.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-sm">
              <thead>
                <tr className="border-b border-rule text-left">
                  {H.ms.map((h) => (
                    <th key={h} className="py-1.5 pr-3">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {t.msRows.map((row, i) => (
                  <tr key={i} className="border-b border-grid">
                    {row.map((c, j) => (
                      <td key={j} className={`py-1.5 pr-3 ${j === 4 || j === 5 ? 'num' : ''} ${j === 6 && (c === 'At risk' || c === 'Delayed') ? 'text-critical' : ''}`}>
                        {c == null || c === '' ? '—' : String(c)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section id="rep-risks" title="Open risks and issues" count={t.riskRows.length}>
        {t.riskRows.length === 0 ? (
          <p className="text-sm text-secondary">No open risks or issues.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-grid text-sm">
            {r.risks
              .filter((x) => x.status !== 'closed')
              .map((x) => (
                <li key={x.id} className="flex flex-wrap items-baseline gap-2 py-1.5">
                  <span className={`num w-10 font-bold ${x.score >= 15 ? 'text-critical' : x.score >= 8 ? 'text-serious' : ''}`} title={`Probability ${x.probability} × impact ${x.impact}`}>
                    {x.score}
                  </span>
                  <span className="text-xs uppercase text-secondary">{x.kind}</span>
                  <span className="min-w-0 flex-1">
                    <b>{x.title}</b>
                    {x.mitigation && <span className="text-secondary"> · {x.mitigation}</span>}
                  </span>
                  <span className="text-xs text-secondary">{x.status}</span>
                  {name(x.owner_id) && <span className="text-xs">{name(x.owner_id)}</span>}
                </li>
              ))}
          </ul>
        )}
      </Section>

      <Section id="rep-kpi" title="KPI performance" count={model.kpiRows.length}>
        {model.kpiRows.length === 0 ? (
          <p className="text-sm text-secondary">No KPIs defined.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-rule text-left">
                  <th className="py-1.5 pr-3">KPI</th>
                  <th className="py-1.5 pr-3 text-right">Baseline</th>
                  <th className="py-1.5 pr-3 text-right">Target</th>
                  <th className="py-1.5 pr-3 text-right">{period ? 'Value at period end' : 'Current value'}</th>
                  <th className="w-48 py-1.5 pr-3">Progress</th>
                  <th className="py-1.5">Verified</th>
                </tr>
              </thead>
              <tbody>
                {model.kpiRows.map((x) => (
                  <tr key={x.k.id} className="border-b border-grid">
                    <td className="py-1.5 pr-3">
                      {x.k.code && <span className="text-secondary">{x.k.code} </span>}
                      {x.k.name} <span className="text-xs text-secondary">{x.k.unit}</span>
                      {!x.measuredInPeriod && <span className="ml-1 text-xs text-serious">· no measurement in period</span>}
                    </td>
                    <td className="num py-1.5 pr-3 text-right">{x.k.baseline != null ? num(Number(x.k.baseline), 2) : '—'}</td>
                    <td className="num py-1.5 pr-3 text-right">{x.k.target != null ? num(Number(x.k.target), 2) : '—'}</td>
                    <td className="num py-1.5 pr-3 text-right">{x.value != null ? num(x.value, 2) : '—'}</td>
                    <td className="py-1.5 pr-3">{x.progress != null ? <Meter value={x.progress} label={`${x.k.name} progress`} /> : <span className="text-xs text-secondary">—</span>}</td>
                    <td className="num py-1.5 text-xs">
                      {x.verified}/{x.count}
                      {x.evidenceMissing > 0 && <span className="text-serious"> · {x.evidenceMissing} evidence missing</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section id="rep-effort" title="Personnel effort (person-months)">
        {t.effortRows.length === 0 ? (
          <p className="text-sm text-secondary">No effort reported, allocated or logged {period ? 'in this period' : 'yet'}.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-rule text-left">
                  {H.effort.map((h, i) => (
                    <th key={h} className={`py-1.5 pr-3 ${i ? 'text-right' : ''}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {t.effortRows.map((row, i) => (
                  <tr key={i} className="border-b border-grid">
                    {row.map((c, j) => (
                      <td key={j} className={`py-1.5 pr-3 ${j ? 'num text-right' : ''}`}>
                        {j ? num(Number(c), 2) : String(c)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-xs text-secondary">Logged time is converted at {settings.hoursPerPm} hours per person-month.</p>
          </div>
        )}
      </Section>

      {finance !== 'none' && (
        <Section id="rep-fin" title="Financial report">
          {fin.isLoading ? (
            <PageLoading />
          ) : !model.financeRows || !model.financeTotals ? (
            <p className="text-sm text-secondary">No financial data.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <StatTile label="Planned direct budget" value={m(model.financeTotals.planned)} note={`${m(model.financeTotals.eligible)} eligible incl. indirect`} />
                <StatTile label={period ? 'Spent in period' : 'Spent to date'} value={m(period ? model.financeTotals.periodActual : model.financeTotals.toDate)} />
                <StatTile label="Spent to period end" value={m(model.financeTotals.toDate)} note={model.financeTotals.planned.gt(0) ? `${pct(Number(model.financeTotals.toDate.div(model.financeTotals.planned).toFixed(4)), 1)} of plan` : undefined} />
                <StatTile label="Remaining" value={m(model.financeTotals.remaining)} tone={model.financeTotals.remaining.lt(0) ? 'critical' : undefined} />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b border-rule text-left">
                      {H.fin.map((h, i) => (
                        <th key={h} className={`py-1.5 pr-3 ${i ? 'text-right' : ''}`}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {model.financeRows.map((x) => (
                      <tr key={x.label} className="border-b border-grid">
                        <td className="py-1.5 pr-3">{x.label}</td>
                        <td className="num py-1.5 pr-3 text-right">{m(x.planned)}</td>
                        <td className="num py-1.5 pr-3 text-right">{m(x.periodActual)}</td>
                        <td className="num py-1.5 pr-3 text-right">{m(x.toDate)}</td>
                        <td className="num py-1.5 pr-3 text-right">{m(x.committed)}</td>
                        <td className="num py-1.5 pr-3 text-right">{m(x.planned.minus(x.toDate).minus(x.committed))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-secondary">
                Amounts are direct costs from recorded budget lines and expenditure. <Link className="text-link underline" to={`/p/${projectId}/budget`}>Open the budget</Link> for indirect costs and variances.
              </p>
            </>
          )}
        </Section>
      )}
    </div>
  );
}
