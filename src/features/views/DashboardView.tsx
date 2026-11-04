import { useMemo } from 'react';
import { addDays, format, parseISO, startOfWeek } from 'date-fns';
import { useProjectCtx } from '@/features/project/context';
import { useProjectCards, useProjectMilestones, useProjectStructure, useProjectSummary, useWpProgress } from '@/data/views';
import { useWorkPackagesLite } from '@/data/lite';
import { dueState } from '@/domain/cardFilter';
import { ChartFrame, ColumnChart, HBarChart, StatTile } from '@/components/charts';
import { EmptyState, ErrorNote, PageLoading, STATUS_LABEL } from '@/components/ui';
import type { CardStatus } from '@/data/types';

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const pct = (n: number) => `${Math.round(n)} %`;

export default function DashboardView() {
  const ctx = useProjectCtx();
  const { project, people } = ctx;
  const cardsQ = useProjectCards(project.id);
  const structQ = useProjectStructure(project.id);
  const summaryQ = useProjectSummary(project.id);
  const wpOn = ctx.has('workpackages');
  const msOn = ctx.has('milestones');
  const wpProg = useWpProgress(project.id, wpOn);
  const wps = useWorkPackagesLite(project.id, wpOn);
  const msQ = useProjectMilestones(project.id, msOn);

  const cards = useMemo(() => cardsQ.data ?? [], [cardsQ.data]);
  const open = useMemo(() => cards.filter((c) => c.status !== 'done'), [cards]);

  const byList = useMemo(() => {
    const lists = structQ.data?.lists ?? [];
    const boards = structQ.data?.boards ?? [];
    return lists
      .map((l) => ({
        label: boards.length > 1 ? `${boards.find((b) => b.id === l.board_id)?.name ?? ''} · ${l.name}` : l.name,
        value: open.filter((c) => c.list_id === l.id).length,
      }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [structQ.data, open]);

  const byStatus = useMemo(
    () =>
      (Object.keys(STATUS_LABEL) as CardStatus[])
        .map((s) => ({ label: STATUS_LABEL[s], value: cards.filter((c) => c.status === s).length }))
        .filter((d) => d.value > 0)
        .sort((a, b) => b.value - a.value),
    [cards],
  );

  const byDue = useMemo(() => {
    const today = new Date();
    const counts = { Overdue: 0, 'Due today': 0, 'Next 7 days': 0, Later: 0, 'No due date': 0 };
    const week = format(addDays(today, 7), 'yyyy-MM-dd');
    for (const c of open) {
      const st = dueState(c.due_date, c.status, today);
      if (st === 'overdue') counts.Overdue++;
      else if (st === 'today') counts['Due today']++;
      else if (st === 'none') counts['No due date']++;
      else if (c.due_date! <= week) counts['Next 7 days']++;
      else counts.Later++;
    }
    return Object.entries(counts).map(([label, value]) => ({ label, value }));
  }, [open]);

  const workload = useMemo(() => {
    const rows = people.map((p) => ({ label: p.display_name, value: open.filter((c) => c.card_assignees.some((a) => a.user_id === p.user_id)).length }));
    const unassigned = open.filter((c) => c.card_assignees.length === 0).length;
    if (unassigned) rows.push({ label: 'Unassigned', value: unassigned });
    return rows.filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
  }, [people, open]);

  const weekly = useMemo(() => {
    const start = startOfWeek(addDays(new Date(), -7 * 11), { weekStartsOn: 1 });
    const weeks = Array.from({ length: 12 }, (_, i) => addDays(start, i * 7));
    const values = weeks.map((w, i) => {
      const from = format(w, 'yyyy-MM-dd');
      const to = i < 11 ? format(weeks[i + 1], 'yyyy-MM-dd') : '9999-12-31';
      return cards.filter((c) => c.completed_at && c.completed_at.slice(0, 10) >= from && c.completed_at.slice(0, 10) < to).length;
    });
    return { labels: weeks.map((w) => format(w, 'd MMM')), values };
  }, [cards]);

  const wpData = useMemo(() => {
    if (!wpOn) return [];
    const names = new Map((wps.data ?? []).map((w) => [w.id, w.code]));
    return (wpProg.data ?? [])
      .filter((r) => names.has(r.work_package_id))
      .map((r) => ({
        label: names.get(r.work_package_id)!,
        value: Number(r.actual_progress) || 0,
        secondary: r.planned_progress == null ? undefined : Number(r.planned_progress),
        gap: (r.planned_progress == null ? 0 : Number(r.planned_progress)) - (Number(r.actual_progress) || 0),
      }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  }, [wpOn, wps.data, wpProg.data]);

  const msData = useMemo(() => {
    if (!msOn) return [];
    const labels: Record<string, string> = { planned: 'Planned', on_track: 'On track', at_risk: 'At risk', delayed: 'Delayed', done: 'Done', cancelled: 'Cancelled' };
    const today = format(new Date(), 'yyyy-MM-dd');
    const counts = new Map<string, number>();
    for (const m of msQ.data ?? []) {
      const late = m.due_date && m.due_date < today && !['done', 'cancelled'].includes(m.status);
      const key = late ? 'Overdue' : labels[m.status] ?? m.status;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  }, [msOn, msQ.data]);

  if (cardsQ.isLoading || structQ.isLoading) return <PageLoading />;
  if (cardsQ.error) return <div className="p-6"><ErrorNote error={cardsQ.error} retry={() => cardsQ.refetch()} /></div>;

  const s = summaryQ.data;
  const totalDone = weekly.values.reduce((a, b) => a + b, 0);
  const peakWeek = weekly.values.indexOf(Math.max(...weekly.values));
  const busiest = workload[0];
  const behind = [...wpData].filter((w) => w.secondary !== undefined).sort((a, b) => b.gap - a.gap)[0];
  const overdueCount = byDue.find((d) => d.label === 'Overdue')?.value ?? 0;
  const footer = `Source: live project data, ${format(new Date(), 'd MMM yyyy HH:mm')}`;

  if (!cards.length && !(msQ.data ?? []).length)
    return (
      <div className="p-6">
        <EmptyState title="No data to chart yet">Charts appear once the project has tasks.</EmptyState>
      </div>
    );

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-5 sm:px-6">
      {s && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatTile label="Tasks done" value={`${s.tasks_done} / ${s.tasks_total}`} note={s.tasks_total ? pct((100 * s.tasks_done) / s.tasks_total) : undefined} />
          <StatTile label="Overdue tasks" value={s.tasks_overdue} tone={s.tasks_overdue ? 'critical' : undefined} />
          <StatTile label="Blocked" value={s.tasks_blocked} tone={s.tasks_blocked ? 'serious' : undefined} />
          <StatTile label="Open and unassigned" value={s.tasks_unassigned} />
          {msOn && <StatTile label="Milestones done" value={`${s.milestones_done} / ${s.milestones_total}`} note={s.milestones_overdue ? `${s.milestones_overdue} overdue` : undefined} tone={s.milestones_overdue ? 'critical' : undefined} />}
          {(ctx.has('risks') || s.risks_open > 0) && <StatTile label="Open risks" value={s.risks_open} note={s.risks_high ? `${s.risks_high} high (score ≥ 15)` : undefined} tone={s.risks_high ? 'serious' : undefined} />}
          {(msOn || ctx.has('kpis')) && s.evidence_missing > 0 && <StatTile label="Evidence missing" value={s.evidence_missing} tone="serious" />}
        </div>
      )}

      <div className="grid gap-x-10 gap-y-8 lg:grid-cols-2">
        {byList.length > 0 && (
          <ChartFrame title={`“${byList[0].label}” holds the most open tasks (${byList[0].value})`} subtitle="Open tasks per list" unit="Tasks" footer={footer}>
            <HBarChart data={byList} highlight={byList[0].label} />
          </ChartFrame>
        )}
        {byDue.some((d) => d.value > 0) && (
          <ChartFrame
            title={overdueCount ? `${plural(overdueCount, 'open task')} ${overdueCount === 1 ? 'is' : 'are'} overdue` : 'No open task is overdue'}
            subtitle="Open tasks by due date"
            unit="Tasks"
            footer={footer}
          >
            <HBarChart data={byDue} highlight={overdueCount ? 'Overdue' : undefined} />
          </ChartFrame>
        )}
        {byStatus.length > 0 && (
          <ChartFrame title={`${byStatus[0].label} is the most common status (${byStatus[0].value} of ${cards.length})`} subtitle="All tasks by status" unit="Tasks" footer={footer}>
            <HBarChart data={byStatus} />
          </ChartFrame>
        )}
        {workload.length > 0 && (
          <ChartFrame title={`${busiest.label} carries the most open tasks (${busiest.value})`} subtitle="Open tasks per person; a task with two assignees counts for both" unit="Open tasks" footer={footer}>
            <HBarChart data={workload} highlight={busiest.label} />
          </ChartFrame>
        )}
        <ChartFrame
          title={totalDone ? `${plural(totalDone, 'task')} completed in the last 12 weeks${weekly.values[peakWeek] ? `, most in the week of ${weekly.labels[peakWeek]}` : ''}` : 'No tasks completed in the last 12 weeks'}
          subtitle="Completions per week (Monday start)"
          unit="Tasks completed"
          footer={footer}
        >
          <ColumnChart categories={weekly.labels} series={[{ name: 'Completed', values: weekly.values, color: 'teal' }]} />
        </ChartFrame>
        {wpData.length > 0 && (
          <ChartFrame
            title={behind && behind.gap > 0 ? `${behind.label} is furthest behind plan (${Math.round(behind.gap)} points)` : 'Work packages are on or ahead of the time-based plan'}
            subtitle="Task completion (dark) against elapsed share of each work package’s dates (light)"
            unit="Per cent"
            footer={footer}
          >
            <HBarChart data={wpData.map(({ label, value, secondary }) => ({ label, value, secondary }))} format={pct} max={100} highlight={behind && behind.gap > 0 ? behind.label : undefined} />
          </ChartFrame>
        )}
        {msData.length > 0 && (
          <ChartFrame title={`${msData[0].label} is the largest milestone group (${msData[0].value})`} subtitle="Milestones and deliverables by status; overdue counted separately" unit="Milestones" footer={footer}>
            <HBarChart data={msData} highlight={msData.find((m) => m.label === 'Overdue') ? 'Overdue' : undefined} />
          </ChartFrame>
        )}
      </div>
      <p className="text-xs text-secondary">
        Last updated {format(parseISO(new Date().toISOString()), 'd MMM yyyy HH:mm')}. Charts refresh automatically when anyone changes the project.
      </p>
    </div>
  );
}
