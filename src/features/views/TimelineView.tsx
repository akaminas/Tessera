import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { format, parseISO } from 'date-fns';
import { AlertCircle, ChevronDown, ChevronRight, CornerDownRight, Diamond } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { useProjectCtx } from '@/features/project/context';
import { useProjectCards, useProjectMilestones, useProjectStructure, useReportingPeriods, updateCardEverywhere } from '@/data/views';
import { useDependencies } from '@/data/cardExtras';
import { useWorkPackagesLite } from '@/data/lite';
import { matchesFilter, type CardFilter } from '@/domain/cardFilter';
import {
  DAY_WIDTH,
  addDaysIso,
  alignRange,
  cellState,
  cycleCell,
  dateScale,
  dragDates,
  headerCells,
  monthColumns,
  monthCount,
  monthOf,
  monthScale,
  scheduleProgress,
  scheduleRange,
  type DateScale,
  type DragMode,
  type Zoom,
} from '@/domain/timeline';
import { usePersistentState } from '@/lib/usePersistentState';
import { Checkbox, EmptyState, ErrorNote, PageLoading, Select } from '@/components/ui';
import { useToast } from '@/components/ui/Toast';
import { FilterBar } from './FilterBar';
import { cn } from '@/lib/cn';
import type { CardWithRelations, MonthSchedule } from '@/data/types';

type Mode = 'dates' | 'months';
type GroupKey = 'wp' | 'list' | 'assignee' | 'none';

const ROW_H = 34;
const GROUP_H = 28;
const HEADER_H = 46;
const MONTH_COL = 44;

type RowItem =
  | { type: 'group'; key: string; label: string; count: number }
  | { type: 'milestones'; key: string }
  | { type: 'card'; key: string; card: CardWithRelations; depth: number };

export default function TimelineView() {
  const ctx = useProjectCtx();
  const { project, people, canEdit, openCard } = ctx;
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const cardsQ = useProjectCards(project.id);
  const structQ = useProjectStructure(project.id);
  const msQ = useProjectMilestones(project.id, ctx.has('milestones'));
  const periodsQ = useReportingPeriods(project.id);
  const depsQ = useDependencies(project.id);
  const wps = useWorkPackagesLite(project.id, ctx.has('workpackages'));
  const canMonths = Boolean(project.start_date);
  const [modePref, setMode] = usePersistentState<Mode>(`tl-mode:${project.id}`, ctx.has('workpackages') && canMonths ? 'months' : 'dates');
  const mode: Mode = modePref === 'months' && !canMonths ? 'dates' : modePref;
  const [zoom, setZoom] = usePersistentState<Zoom>(`tl-zoom:${project.id}`, 'months');
  const [group, setGroup] = usePersistentState<GroupKey>(`tl-group:${project.id}`, ctx.has('workpackages') ? 'wp' : 'list');
  const [filter, setFilter] = usePersistentState<CardFilter>(`tl-filter:${project.id}`, {}, 'session');
  const [planEdit, setPlanEdit] = useState(false);
  const [showDeps, setShowDeps] = usePersistentState(`tl-deps:${project.id}`, true);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const today = format(new Date(), 'yyyy-MM-dd');
  const nameW = 240;

  const all = useMemo(() => cardsQ.data ?? [], [cardsQ.data]);
  const cards = useMemo(() => all.filter((c) => matchesFilter(c, filter, user!.id)), [all, filter, user]);
  const lists = useMemo(() => structQ.data?.lists ?? [], [structQ.data]);
  const boards = useMemo(() => structQ.data?.boards ?? [], [structQ.data]);

  /* ---------------------------------------------------------- scale */
  const scale: DateScale = useMemo(() => {
    const dated = all.flatMap((c) => [c.start_date, c.due_date].filter(Boolean) as string[]);
    const msDates = (msQ.data ?? []).map((m) => m.due_date).filter(Boolean) as string[];
    if (mode === 'months' && project.start_date) {
      const starts = project.start_date;
      const lastDate = [project.end_date, ...dated, ...msDates].filter(Boolean).sort().pop() ?? starts;
      const schedMax = Math.max(0, ...all.flatMap((c) => [...(c.schedule?.planned ?? []), ...(c.schedule?.due ?? []), ...(c.schedule?.done ?? [])]));
      const count = Math.max(project.end_date ? monthCount(starts, project.end_date) : 12, monthOf(starts, lastDate) ?? 1, schedMax);
      return monthScale(starts, Math.min(count, 240), MONTH_COL);
    }
    const pool = [today, ...dated, ...msDates, ...(project.start_date ? [project.start_date] : []), ...(project.end_date ? [project.end_date] : [])].sort();
    const r = alignRange(addDaysIso(pool[0], -7), addDaysIso(pool[pool.length - 1], 21), zoom);
    return dateScale(r.from, r.to, DAY_WIDTH[zoom]);
  }, [mode, zoom, all, msQ.data, project.start_date, project.end_date, today]);

  const columns = useMemo(() => {
    if (mode === 'months' && project.start_date) {
      return monthColumns(project.start_date, Math.round(scale.width / MONTH_COL)).map((m) => ({ key: m.label, label: m.label, sub: m.calendarLabel, start: m.start, end: m.end }));
    }
    return headerCells(scale.origin, addDaysIso(scale.origin, scale.days - 1), zoom).map((h) => ({ key: h.start, label: h.label, sub: '', start: h.start, end: h.end }));
  }, [mode, project.start_date, scale, zoom]);

  /* ----------------------------------------------------------- rows */
  const rows: RowItem[] = useMemo(() => {
    const out: RowItem[] = [];
    if (ctx.has('milestones') && (msQ.data ?? []).some((m) => m.due_date)) out.push({ type: 'milestones', key: 'milestones' });
    const orderKey = (c: CardWithRelations) => c.start_date ?? c.due_date ?? scheduleRange(project.start_date ?? today, c.schedule)?.start ?? '￿';
    const hierarchy = (set: CardWithRelations[], gkey: string) => {
      const ids = new Set(set.map((c) => c.id));
      const kids = new Map<string, CardWithRelations[]>();
      const roots: CardWithRelations[] = [];
      for (const c of set) {
        if (c.parent_id && ids.has(c.parent_id)) kids.set(c.parent_id, [...(kids.get(c.parent_id) ?? []), c]);
        else roots.push(c);
      }
      const byPos = (a: CardWithRelations, b: CardWithRelations) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0);
      const byDate = (a: CardWithRelations, b: CardWithRelations) => (orderKey(a) < orderKey(b) ? -1 : orderKey(a) > orderKey(b) ? 1 : byPos(a, b));
      const walk = (c: CardWithRelations, depth: number) => {
        out.push({ type: 'card', key: `${gkey}:${c.id}`, card: c, depth });
        for (const k of (kids.get(c.id) ?? []).sort(byPos)) walk(k, depth + 1);
      };
      // keep manual order (as on the board / imported plan) inside a work package
      for (const r of roots.sort(group === 'wp' ? byPos : byDate)) walk(r, 0);
    };
    const groups: { key: string; label: string; cards: CardWithRelations[] }[] = [];
    if (group === 'none') groups.push({ key: 'all', label: '', cards });
    else if (group === 'wp') {
      for (const w of wps.data ?? []) groups.push({ key: w.id, label: `${w.code} ${w.name}`, cards: cards.filter((c) => c.work_package_id === w.id) });
      groups.push({ key: 'none', label: 'No work package', cards: cards.filter((c) => !c.work_package_id) });
    } else if (group === 'list') {
      for (const l of lists) {
        const b = boards.find((x) => x.id === l.board_id);
        groups.push({ key: l.id, label: boards.length > 1 ? `${b?.name} · ${l.name}` : l.name, cards: cards.filter((c) => c.list_id === l.id) });
      }
    } else {
      for (const p of people) groups.push({ key: p.user_id, label: p.display_name, cards: cards.filter((c) => c.card_assignees.some((a) => a.user_id === p.user_id)) });
      groups.push({ key: 'none', label: 'Unassigned', cards: cards.filter((c) => c.card_assignees.length === 0) });
    }
    for (const g of groups) {
      if (!g.cards.length) continue;
      if (g.label) out.push({ type: 'group', key: `g:${g.key}`, label: g.label, count: g.cards.length });
      if (!collapsed.has(`g:${g.key}`)) hierarchy(g.cards, g.key);
    }
    return out;
  }, [cards, group, wps.data, lists, boards, people, collapsed, msQ.data, ctx, project.start_date, today]);

  const rowTops = useMemo(() => {
    const tops: number[] = [];
    let y = 0;
    for (const r of rows) {
      tops.push(y);
      y += r.type === 'group' ? GROUP_H : ROW_H;
    }
    return { tops, height: y };
  }, [rows]);

  /* -------------------------------------------------------- actions */
  const saveDates = async (card: CardWithRelations, patch: { start_date: string | null; due_date: string | null }) => {
    const before = { start_date: card.start_date, due_date: card.due_date };
    if (before.start_date === patch.start_date && before.due_date === patch.due_date) return;
    try {
      const res = await updateCardEverywhere(card, patch);
      toast.show(`Rescheduled “${card.title}”`, { undo: () => updateCardEverywhere(res, before).then(() => undefined) });
    } catch (err) {
      toast.error(err);
    }
  };
  const cycle = async (card: CardWithRelations, m: number) => {
    if (!project.start_date) return;
    const schedule = cycleCell(card.schedule, m);
    const range = scheduleRange(project.start_date, schedule);
    const patch: Partial<CardWithRelations> = { schedule: schedule as MonthSchedule | null };
    if (range) {
      patch.start_date = range.start;
      patch.due_date = range.end;
    }
    try {
      await updateCardEverywhere(card, patch);
    } catch (err) {
      toast.error(err);
    }
  };

  if (cardsQ.isLoading || structQ.isLoading) return <PageLoading />;
  if (cardsQ.error) return <div className="p-6"><ErrorNote error={cardsQ.error} retry={() => cardsQ.refetch()} /></div>;

  const xBar = (c: CardWithRelations) => {
    const s = c.start_date ?? c.due_date;
    const e = c.due_date ?? c.start_date;
    if (!s || !e) return null;
    const x1 = scale.x(s);
    const x2 = Math.max(x1 + 6, scale.x(addDaysIso(e, 1)));
    return { x1, x2 };
  };
  const cardIndex = new Map<string, number>();
  rows.forEach((r, i) => {
    if (r.type === 'card' && !cardIndex.has(r.card.id)) cardIndex.set(r.card.id, i);
  });
  const todayX = today >= scale.origin ? scale.x(today) : -1;
  const periods = periodsQ.data ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="no-print flex flex-wrap items-center gap-2 border-b border-grid px-3 py-2 sm:px-5">
        <div role="group" aria-label="Timeline scale" className="flex overflow-hidden rounded-[4px] border border-rule">
          <button aria-pressed={mode === 'dates'} onClick={() => setMode('dates')} className={cn('h-7 px-2.5 text-[13px]', mode === 'dates' ? 'bg-accent text-accent-ink' : 'hover:bg-hover')}>
            Calendar dates
          </button>
          <button
            aria-pressed={mode === 'months'}
            disabled={!canMonths}
            title={canMonths ? undefined : 'Set the project start date in project settings to plan by project month'}
            onClick={() => setMode('months')}
            className={cn('h-7 px-2.5 text-[13px] disabled:opacity-50', mode === 'months' ? 'bg-accent text-accent-ink' : 'hover:bg-hover')}
          >
            Project months
          </button>
        </div>
        {mode === 'dates' && (
          <Select value={zoom} onChange={(e) => setZoom(e.target.value as Zoom)} className="h-8 w-32" aria-label="Zoom">
            <option value="weeks">Weeks</option>
            <option value="months">Months</option>
            <option value="quarters">Quarters</option>
          </Select>
        )}
        <Select value={group} onChange={(e) => setGroup(e.target.value as GroupKey)} className="h-8 w-44" aria-label="Group rows by">
          {ctx.has('workpackages') && <option value="wp">By work package</option>}
          <option value="list">By list</option>
          <option value="assignee">By assignee</option>
          <option value="none">No grouping</option>
        </Select>
        <Checkbox checked={showDeps} onChange={setShowDeps} label="Dependencies" />
        {mode === 'months' && canEdit && <Checkbox checked={planEdit} onChange={setPlanEdit} label="Plan by month" />}
        <div className="ml-auto">
          <FilterBar filter={filter} onChange={setFilter} people={people} labels={structQ.data?.labels} workPackages={wps.data} view="timeline" projectId={project.id} />
        </div>
      </div>
      {mode === 'months' && (
        <div className="flex flex-wrap items-center gap-4 border-b border-grid px-3 py-1.5 text-xs text-secondary sm:px-5" aria-label="Legend">
          <Legend swatch="bg-teal-tint" label="Planned / ongoing" />
          <Legend swatch="bg-ochre-tint" label="Due (milestone, deliverable or report)" text="due" />
          <Legend swatch="bg-moss-tint" label="Completed" text="✓" />
          <span>{canEdit ? 'Click a month cell to cycle planned → due → done → empty. Turn on “Plan by month” to plan tasks that have no month plan yet.' : ''}</span>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="p-6">
          <EmptyState title={all.length ? 'No tasks match these filters' : 'Nothing to show yet'}>Tasks with start or due dates, month plans and milestones appear here.</EmptyState>
        </div>
      ) : (
        <div className="scroll-thin min-h-0 flex-1 overflow-auto" role="region" aria-label="Timeline">
          <div className="relative" style={{ width: nameW + scale.width, minWidth: '100%' }}>
            {/* header */}
            <div className="sticky top-0 z-20 flex border-b border-rule bg-surface" style={{ height: HEADER_H }}>
              <div className="sticky left-0 z-30 flex shrink-0 items-end border-r border-grid bg-surface px-3 pb-1 text-xs font-bold text-secondary" style={{ width: nameW }}>
                Task
              </div>
              <div className="relative" style={{ width: scale.width }}>
                {periods.map((p) => {
                  const x1 = Math.max(0, scale.x(p.start_date));
                  const x2 = Math.min(scale.width, scale.x(addDaysIso(p.end_date, 1)));
                  if (x2 <= 0 || x1 >= scale.width) return null;
                  return (
                    <div key={p.id} className="absolute top-0 truncate border-l border-rule px-1 text-[10px] text-muted" style={{ left: x1, width: x2 - x1 }} title={`${p.code} ${p.name}`}>
                      {p.code}
                    </div>
                  );
                })}
                {columns.map((c) => {
                  const x1 = scale.x(c.start);
                  const x2 = scale.x(addDaysIso(c.end, 1));
                  return (
                    <div key={c.key} className="absolute bottom-0 border-l border-grid px-1 pb-1 leading-tight" style={{ left: x1, width: x2 - x1 }}>
                      <div className="truncate text-[11px] font-bold text-ink">{c.label}</div>
                      {c.sub && <div className="truncate text-[9px] text-muted">{c.sub}</div>}
                    </div>
                  );
                })}
                {todayX >= 0 && todayX <= scale.width && (
                  <div className="absolute top-0 text-[10px] text-ochre-deep" style={{ left: todayX + 3 }}>
                    Today
                  </div>
                )}
              </div>
            </div>

            {/* background: period bands, column lines, today */}
            <div className="pointer-events-none absolute" style={{ left: nameW, top: HEADER_H, width: scale.width, height: rowTops.height }}>
              {periods.map((p, i) => {
                const x1 = Math.max(0, scale.x(p.start_date));
                const x2 = Math.min(scale.width, scale.x(addDaysIso(p.end_date, 1)));
                return i % 2 === 1 && x2 > x1 ? <div key={p.id} className="absolute inset-y-0 bg-card" style={{ left: x1, width: x2 - x1 }} /> : null;
              })}
              {columns.map((c) => (
                <div key={c.key} className="absolute inset-y-0 border-l border-grid" style={{ left: scale.x(c.start) }} />
              ))}
              {todayX >= 0 && todayX <= scale.width && <div className="absolute inset-y-0 border-l border-dotted border-ochre" style={{ left: todayX }} />}
            </div>

            {/* rows */}
            <div className="relative">
              {rows.map((r) => {
                if (r.type === 'group')
                  return (
                    <div key={r.key} className="flex border-b border-grid bg-card/70" style={{ height: GROUP_H }}>
                      <button
                        className="sticky left-0 z-10 flex shrink-0 items-center gap-1 border-r border-grid bg-card px-2 text-left text-[13px] font-bold"
                        style={{ width: nameW }}
                        aria-expanded={!collapsed.has(r.key)}
                        onClick={() =>
                          setCollapsed((s) => {
                            const n = new Set(s);
                            if (n.has(r.key)) n.delete(r.key);
                            else n.add(r.key);
                            return n;
                          })
                        }
                      >
                        {collapsed.has(r.key) ? <ChevronRight className="size-3.5 text-muted" /> : <ChevronDown className="size-3.5 text-muted" />}
                        <span className="truncate">{r.label}</span>
                        <span className="num ml-auto text-xs font-normal text-secondary">{r.count}</span>
                      </button>
                    </div>
                  );
                if (r.type === 'milestones')
                  return (
                    <div key={r.key} className="flex border-b border-grid" style={{ height: ROW_H }}>
                      <div className="sticky left-0 z-10 flex shrink-0 items-center gap-1.5 border-r border-grid bg-surface px-3 text-[13px] font-bold" style={{ width: nameW }}>
                        <Diamond className="size-3.5 fill-[var(--v-ochre)] text-ochre" aria-hidden /> Milestones
                      </div>
                      <div className="relative" style={{ width: scale.width }}>
                        {(msQ.data ?? [])
                          .filter((m) => m.due_date)
                          .map((m) => {
                            const x = scale.x(m.due_date!) + scale.dayWidth / 2;
                            const late = m.due_date! < today && m.status !== 'done' && m.status !== 'cancelled';
                            return (
                              <button
                                key={m.id}
                                className="absolute top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center"
                                style={{ left: x }}
                                title={`${m.code ? m.code + ' ' : ''}${m.title} · due ${format(parseISO(m.due_date!), 'd MMM yyyy')} · ${m.status.replace('_', ' ')}${late ? ' (overdue)' : ''}`}
                                aria-label={`Milestone ${m.title}, due ${m.due_date}, ${m.status}`}
                                onClick={() => navigate(`/p/${project.id}/milestones`)}
                              >
                                <Diamond className={cn('size-4', m.status === 'done' ? 'fill-[var(--v-moss)] text-moss' : late ? 'fill-[var(--v-terracotta)] text-terracotta' : 'fill-[var(--v-ochre)] text-ochre')} />
                              </button>
                            );
                          })}
                      </div>
                    </div>
                  );
                const c = r.card;
                const overdue = Boolean(c.due_date && c.due_date < today && c.status !== 'done');
                const sched = mode === 'months' && (c.schedule || planEdit);
                const prog = scheduleProgress(c.schedule);
                return (
                  <div key={r.key} className="group flex border-b border-grid hover:bg-hover/60" style={{ height: ROW_H }}>
                    <div className="sticky left-0 z-10 flex shrink-0 items-center gap-1 border-r border-grid bg-surface px-2 group-hover:bg-hover" style={{ width: nameW, paddingLeft: 8 + r.depth * 14 }}>
                      {r.depth > 0 && <CornerDownRight className="size-3 shrink-0 text-muted" aria-hidden />}
                      <button className={cn('min-w-0 flex-1 truncate text-left text-[13px] hover:underline', c.status === 'done' && 'text-secondary line-through decoration-rule')} onClick={() => openCard(c.id)} title={c.title}>
                        {c.title}
                      </button>
                      {overdue && (
                        <span className="flex shrink-0 items-center gap-0.5 text-[11px] text-critical">
                          <AlertCircle className="size-3" aria-hidden />
                          <span className="text-ink">Overdue</span>
                        </span>
                      )}
                      {mode === 'months' && prog.months > 0 && (
                        <span className="num shrink-0 text-[11px] text-secondary" title="Months completed out of months in the plan">
                          {prog.done}/{prog.months}
                        </span>
                      )}
                    </div>
                    <div className="relative" style={{ width: scale.width }}>
                      {sched && project.start_date ? (
                        <MonthCells card={c} count={columns.length} canEdit={canEdit} onCycle={(m) => cycle(c, m)} />
                      ) : (
                        (() => {
                          const g = xBar(c);
                          if (!g) return <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-muted">No dates</span>;
                          return <Bar card={c} x1={g.x1} x2={g.x2} scale={scale} canEdit={canEdit} overdue={overdue} onOpen={() => openCard(c.id)} onCommit={(p) => saveDates(c, p)} />;
                        })()
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* dependency arrows */}
            {showDeps && (depsQ.data?.length ?? 0) > 0 && (
              <svg className="pointer-events-none absolute" style={{ left: nameW, top: HEADER_H, width: scale.width, height: rowTops.height }} aria-hidden>
                <defs>
                  <marker id="tl-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                    <path d="M0,0 L8,4 L0,8 z" fill="var(--v-secondary)" />
                  </marker>
                  <marker id="tl-arrow-bad" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                    <path d="M0,0 L8,4 L0,8 z" fill="var(--v-status-critical)" />
                  </marker>
                </defs>
                {(depsQ.data ?? []).map((d) => {
                  const pi = cardIndex.get(d.predecessor_id);
                  const si = cardIndex.get(d.successor_id);
                  if (pi === undefined || si === undefined) return null;
                  const pr = rows[pi] as Extract<RowItem, { type: 'card' }>;
                  const sr = rows[si] as Extract<RowItem, { type: 'card' }>;
                  const pg = xBar(pr.card);
                  const sg = xBar(sr.card);
                  if (!pg || !sg) return null;
                  const y1 = rowTops.tops[pi] + ROW_H / 2;
                  const y2 = rowTops.tops[si] + ROW_H / 2;
                  const fromX = d.kind === 'start_to_start' ? pg.x1 : pg.x2;
                  const toX = d.kind === 'finish_to_finish' ? sg.x2 : sg.x1;
                  const bad = d.kind === 'finish_to_start' && sg.x1 < pg.x2 - 1;
                  const midX = Math.max(fromX + 8, Math.min(toX - 8, fromX + 8));
                  const path = `M${fromX},${y1} H${midX} V${y2} H${toX - 1}`;
                  return (
                    <path key={d.id} d={path} fill="none" stroke={bad ? 'var(--v-status-critical)' : 'var(--v-secondary)'} strokeWidth={1} markerEnd={`url(#${bad ? 'tl-arrow-bad' : 'tl-arrow'})`}>
                      <title>{bad ? 'Starts before its predecessor finishes' : 'Dependency'}</title>
                    </path>
                  );
                })}
              </svg>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Legend({ swatch, label, text }: { swatch: string; label: string; text?: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn('inline-flex h-3.5 w-6 items-center justify-center rounded-[2px] text-[9px] text-ink', swatch)}>{text}</span>
      {label}
    </span>
  );
}

function MonthCells({ card, count, canEdit, onCycle }: { card: CardWithRelations; count: number; canEdit: boolean; onCycle: (m: number) => void }) {
  return (
    <div className="absolute inset-y-1 left-0 flex" role="group" aria-label={`Month plan for ${card.title}`}>
      {Array.from({ length: count }, (_, i) => {
        const m = i + 1;
        const st = cellState(card.schedule, m);
        const label = `M${m} ${st ?? 'not planned'}`;
        const cls =
          st === 'done' ? 'bg-moss-tint text-moss-deep' : st === 'due' ? 'bg-ochre-tint text-ochre-deep' : st === 'planned' ? 'bg-teal-tint text-teal-deep' : canEdit ? 'hover:bg-hover' : '';
        const content = st === 'due' ? 'due' : st === 'done' ? '✓' : '';
        return canEdit ? (
          <button key={m} title={label} aria-label={label} onClick={() => onCycle(m)} className={cn('flex h-full items-center justify-center border-r border-surface text-[9px]', cls)} style={{ width: MONTH_COL }}>
            {content}
          </button>
        ) : (
          <span key={m} title={label} aria-label={label} className={cn('flex h-full items-center justify-center border-r border-surface text-[9px]', cls)} style={{ width: MONTH_COL }}>
            {content}
          </span>
        );
      })}
    </div>
  );
}

function Bar({
  card,
  x1,
  x2,
  scale,
  canEdit,
  overdue,
  onOpen,
  onCommit,
}: {
  card: CardWithRelations;
  x1: number;
  x2: number;
  scale: DateScale;
  canEdit: boolean;
  overdue: boolean;
  onOpen: () => void;
  onCommit: (p: { start_date: string | null; due_date: string | null }) => void;
}) {
  const [drag, setDrag] = useState<{ mode: DragMode; startX: number; dx: number } | null>(null);
  const days = drag ? Math.round(drag.dx / scale.dayWidth) : 0;
  const dx = drag ? days * scale.dayWidth : 0;
  let left = x1;
  let width = x2 - x1;
  if (drag?.mode === 'move') left += dx;
  if (drag?.mode === 'start') {
    left += Math.min(dx, width - 6);
    width -= Math.min(dx, width - 6);
  }
  if (drag?.mode === 'end') width = Math.max(6, width + dx);
  const preview = drag && days !== 0 ? dragDates(card.start_date, card.due_date, drag.mode, days) : null;

  const begin = (mode: DragMode) => (e: React.PointerEvent) => {
    if (!canEdit || e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ mode, startX: e.clientX, dx: 0 });
  };
  const moveDrag = (e: React.PointerEvent) => {
    if (drag) setDrag({ ...drag, dx: e.clientX - drag.startX });
  };
  const end = () => {
    if (!drag) return;
    const d = days;
    const mode = drag.mode;
    setDrag(null);
    if (d === 0) {
      if (mode === 'move') onOpen();
      return;
    }
    onCommit(dragDates(card.start_date, card.due_date, mode, d));
  };
  const label = `${card.title}: ${card.start_date ? format(parseISO(card.start_date), 'd MMM yyyy') + ' – ' : ''}${card.due_date ? format(parseISO(card.due_date), 'd MMM yyyy') : ''}`;
  const keyMove = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      onOpen();
      return;
    }
    if (!canEdit) return;
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    onCommit(dragDates(card.start_date, card.due_date, e.shiftKey ? 'end' : 'move', step));
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${label}. ${canEdit ? 'Arrow keys move by a day, Shift+arrow changes the end date, Enter opens.' : 'Enter opens.'}`}
      title={preview ? `${preview.start_date ?? ''} → ${preview.due_date ?? ''}` : label}
      onKeyDown={keyMove}
      onPointerDown={begin('move')}
      onPointerMove={moveDrag}
      onPointerUp={end}
      onPointerCancel={() => setDrag(null)}
      className={cn(
        'absolute top-[7px] flex h-5 select-none items-center overflow-hidden rounded-[3px] border text-[11px] leading-none',
        card.status === 'done' ? 'border-moss bg-moss-tint text-moss-deep' : overdue ? 'border-terracotta bg-terracotta-tint text-terracotta-deep' : 'border-teal bg-teal-tint text-teal-deep',
        canEdit ? (drag ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-pointer',
        drag && 'ring-1 ring-teal',
      )}
      style={{ left, width, touchAction: 'none' }}
    >
      {canEdit && <span onPointerDown={begin('start')} className="h-full w-1.5 shrink-0 cursor-ew-resize bg-[rgba(0,0,0,0.08)]" aria-hidden />}
      <span className="min-w-0 flex-1 truncate px-1">{preview ? `${preview.start_date ? format(parseISO(preview.start_date), 'd MMM') + ' – ' : ''}${preview.due_date ? format(parseISO(preview.due_date), 'd MMM') : ''}` : width > 60 ? card.title : ''}</span>
      {canEdit && <span onPointerDown={begin('end')} className="h-full w-1.5 shrink-0 cursor-ew-resize bg-[rgba(0,0,0,0.08)]" aria-hidden />}
    </div>
  );
}
