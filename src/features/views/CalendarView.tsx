import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  addDays,
  addMonths,
  addWeeks,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { AlertCircle, CalendarX2, ChevronLeft, ChevronRight, Diamond, Plus } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { useProjectCtx } from '@/features/project/context';
import { useProjectCards, useProjectMilestones, useProjectStructure, updateCardEverywhere } from '@/data/views';
import { createCard } from '@/data/cards';
import { useWorkPackagesLite } from '@/data/lite';
import { matchesFilter, type CardFilter } from '@/domain/cardFilter';
import { addDaysIso, daysBetween } from '@/domain/timeline';
import { keyAfterLast } from '@/domain/ordering';
import { usePersistentState } from '@/lib/usePersistentState';
import { Button, ErrorNote, Field, IconButton, Input, PageLoading, Select } from '@/components/ui';
import { Dialog } from '@/components/ui/Dialog';
import { useToast } from '@/components/ui/Toast';
import { FilterBar } from './FilterBar';
import { cn } from '@/lib/cn';
import type { CardWithRelations, Family } from '@/data/types';

/* ====================================================================
 * Shared calendar grid (also used by the global Calendar page)
 * ==================================================================== */

export interface CalEvent {
  id: string;
  kind: 'card' | 'milestone';
  title: string;
  /** inclusive YYYY-MM-DD */
  start: string;
  end: string;
  color?: Family;
  done?: boolean;
  overdue?: boolean;
  draggable?: boolean;
  sub?: string;
}

const DRAG_TYPE = 'application/x-tessera-card';
const toneBorder: Record<Family, string> = {
  teal: 'border-l-teal',
  terracotta: 'border-l-terracotta',
  indigo: 'border-l-indigo',
  ochre: 'border-l-ochre',
  mauve: 'border-l-mauve',
  moss: 'border-l-moss',
};

export function calendarRange(view: 'month' | 'week', anchor: Date): { from: string; to: string } {
  const from = view === 'month' ? startOfWeek(startOfMonth(anchor), { weekStartsOn: 1 }) : startOfWeek(anchor, { weekStartsOn: 1 });
  const to = view === 'month' ? endOfWeek(endOfMonth(anchor), { weekStartsOn: 1 }) : endOfWeek(anchor, { weekStartsOn: 1 });
  return { from: format(from, 'yyyy-MM-dd'), to: format(to, 'yyyy-MM-dd') };
}

interface Segment {
  ev: CalEvent;
  col: number; // 0-6
  span: number;
  lane: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
}

function layoutWeek(weekStart: string, events: CalEvent[]): Segment[] {
  const weekEnd = addDaysIso(weekStart, 6);
  const inWeek = events
    .filter((e) => e.start <= weekEnd && e.end >= weekStart)
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : daysBetween(b.start, b.end) - daysBetween(a.start, a.end)));
  const laneEnds: string[] = [];
  const out: Segment[] = [];
  for (const ev of inWeek) {
    const s = ev.start < weekStart ? weekStart : ev.start;
    const e = ev.end > weekEnd ? weekEnd : ev.end;
    let lane = laneEnds.findIndex((end) => end < s);
    if (lane < 0) {
      lane = laneEnds.length;
      laneEnds.push(e);
    } else laneEnds[lane] = e;
    out.push({ ev, col: daysBetween(weekStart, s), span: daysBetween(s, e) + 1, lane, continuesBefore: ev.start < weekStart, continuesAfter: ev.end > weekEnd });
  }
  return out;
}

export function CalendarGrid({
  view,
  anchor,
  events,
  onOpen,
  onMove,
  onDropExternal,
  onDayClick,
}: {
  view: 'month' | 'week';
  anchor: Date;
  events: CalEvent[];
  onOpen: (ev: CalEvent) => void;
  onMove?: (ev: CalEvent, start: string, end: string) => void;
  onDropExternal?: (id: string, date: string) => void;
  onDayClick?: (date: string) => void;
}) {
  const { from, to } = calendarRange(view, anchor);
  const weeks: string[] = [];
  for (let w = from; w <= to; w = addDaysIso(w, 7)) weeks.push(w);
  const today = format(new Date(), 'yyyy-MM-dd');
  const byId = useMemo(() => new Map(events.map((e) => [e.id, e])), [events]);
  const [moreDay, setMoreDay] = useState<string | null>(null);
  const maxLanes = view === 'month' ? 3 : 50;
  const laneH = 22;

  const dropDate = (e: React.DragEvent, weekStart: string) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const col = Math.max(0, Math.min(6, Math.floor(((e.clientX - rect.left) / rect.width) * 7)));
    return addDaysIso(weekStart, col);
  };

  return (
    <div className="min-w-[640px]" role="grid" aria-label={view === 'month' ? format(anchor, 'MMMM yyyy') : `Week of ${format(parseISO(from), 'd MMMM yyyy')}`}>
      <div className="grid grid-cols-7 border-b border-rule" role="row">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} role="columnheader" className="px-2 py-1 text-xs font-bold text-secondary">
            {view === 'week' ? format(addDays(parseISO(from), i), 'EEE d MMM') : format(addDays(parseISO(from), i), 'EEE')}
          </div>
        ))}
      </div>
      {weeks.map((ws) => {
        const segs = layoutWeek(ws, events);
        const shown = segs.filter((s) => s.lane < maxLanes);
        const lanes = Math.max(0, ...shown.map((s) => s.lane + 1));
        const hiddenPerDay = Array.from({ length: 7 }, (_, i) => segs.filter((s) => s.lane >= maxLanes && s.col <= i && s.col + s.span > i).length);
        const minH = view === 'month' ? 112 : Math.max(320, 30 + lanes * laneH + 24);
        return (
          <div
            key={ws}
            role="row"
            className="relative border-b border-grid"
            style={{ minHeight: Math.max(minH, 30 + lanes * laneH + 22) }}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes(DRAG_TYPE)) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
              }
            }}
            onDrop={(e) => {
              const raw = e.dataTransfer.getData(DRAG_TYPE);
              if (!raw) return;
              e.preventDefault();
              const { id, offset } = JSON.parse(raw) as { id: string; offset: number };
              const date = dropDate(e, ws);
              const ev = byId.get(id);
              if (ev && onMove) {
                const start = addDaysIso(date, -offset);
                const end = addDaysIso(start, daysBetween(ev.start, ev.end));
                if (start !== ev.start) onMove(ev, start, end);
              } else if (!ev && onDropExternal) onDropExternal(id, date);
            }}
          >
            <div className="absolute inset-0 grid grid-cols-7">
              {Array.from({ length: 7 }, (_, i) => {
                const day = addDaysIso(ws, i);
                const outside = view === 'month' && !isSameMonth(parseISO(day), anchor);
                return (
                  <div key={day} role="gridcell" className={cn('group relative border-r border-grid last:border-r-0', outside && 'bg-card/60')}>
                    <div className="flex items-center justify-between px-1.5 pt-1">
                      <span
                        className={cn(
                          'num inline-flex size-6 items-center justify-center rounded-full text-xs',
                          day === today ? 'bg-accent font-bold text-accent-ink' : outside ? 'text-muted' : 'text-ink',
                        )}
                        aria-label={format(parseISO(day), 'EEEE d MMMM yyyy')}
                      >
                        {format(parseISO(day), 'd')}
                      </span>
                      {onDayClick && (
                        <button
                          className="rounded-[3px] p-0.5 text-muted opacity-0 hover:bg-hover hover:text-ink focus:opacity-100 group-hover:opacity-100"
                          aria-label={`Add a task on ${format(parseISO(day), 'd MMMM yyyy')}`}
                          onClick={() => onDayClick(day)}
                        >
                          <Plus className="size-3.5" />
                        </button>
                      )}
                    </div>
                    {hiddenPerDay[i] > 0 && (
                      <button className="absolute bottom-0.5 left-1.5 text-[11px] text-secondary hover:underline" onClick={() => setMoreDay(day)}>
                        +{hiddenPerDay[i]} more
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="pointer-events-none absolute inset-x-0 top-[30px]">
              {shown.map((s) => (
                <EventBar
                  key={`${s.ev.kind}:${s.ev.id}:${ws}`}
                  seg={s}
                  laneH={laneH}
                  weekStart={ws}
                  onOpen={onOpen}
                  draggable={Boolean(onMove && s.ev.draggable)}
                />
              ))}
            </div>
          </div>
        );
      })}
      {moreDay && (
        <Dialog open onOpenChange={() => setMoreDay(null)} title={format(parseISO(moreDay), 'EEEE d MMMM yyyy')} width={420}>
          <ul className="flex flex-col gap-1">
            {events
              .filter((e) => e.start <= moreDay && e.end >= moreDay)
              .map((e) => (
                <li key={`${e.kind}:${e.id}`}>
                  <button className="flex w-full items-center gap-2 rounded-[3px] px-2 py-1 text-left text-sm hover:bg-hover" onClick={() => (setMoreDay(null), onOpen(e))}>
                    {e.kind === 'milestone' && <Diamond className="size-3.5 text-ochre" aria-label="Milestone" />}
                    <span className={cn('flex-1 truncate', e.done && 'text-secondary line-through')}>{e.title}</span>
                    {e.sub && <span className="text-xs text-secondary">{e.sub}</span>}
                  </button>
                </li>
              ))}
          </ul>
        </Dialog>
      )}
    </div>
  );
}

function EventBar({ seg, laneH, weekStart, onOpen, draggable }: { seg: Segment; laneH: number; weekStart: string; onOpen: (e: CalEvent) => void; draggable: boolean }) {
  const { ev } = seg;
  return (
    <button
      type="button"
      draggable={draggable}
      onDragStart={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const dayIdx = Math.floor(((e.clientX - rect.left) / rect.width) * seg.span);
        const grabDate = addDaysIso(weekStart, seg.col + Math.max(0, Math.min(seg.span - 1, dayIdx)));
        e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ id: ev.id, offset: daysBetween(ev.start, grabDate) }));
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={() => onOpen(ev)}
      title={`${ev.title}${ev.sub ? ` · ${ev.sub}` : ''}`}
      className={cn(
        'pointer-events-auto absolute flex items-center gap-1 overflow-hidden whitespace-nowrap border border-grid px-1.5 text-left text-[12px] leading-none hover:border-rule',
        ev.kind === 'milestone' ? 'bg-surface' : 'border-l-2 bg-card',
        ev.kind === 'card' && toneBorder[ev.color ?? 'teal'],
        seg.continuesBefore ? 'rounded-l-none' : 'rounded-l-[3px]',
        seg.continuesAfter ? 'rounded-r-none' : 'rounded-r-[3px]',
        draggable && 'cursor-grab active:cursor-grabbing',
      )}
      style={{
        left: `calc(${(seg.col / 7) * 100}% + 2px)`,
        width: `calc(${(seg.span / 7) * 100}% - 4px)`,
        top: seg.lane * laneH,
        height: laneH - 3,
      }}
    >
      {ev.kind === 'milestone' && <Diamond className="size-3 shrink-0 fill-[var(--v-ochre)] text-ochre" aria-label="Milestone" />}
      {ev.overdue && <AlertCircle className="size-3 shrink-0 text-critical" aria-label="Overdue" />}
      <span className={cn('truncate', ev.done && 'text-secondary line-through decoration-rule')}>{ev.title}</span>
      {ev.sub && <span className="hidden truncate text-[11px] text-secondary md:inline">· {ev.sub}</span>}
    </button>
  );
}

export function CalendarToolbar({
  view,
  setView,
  anchor,
  setAnchor,
  children,
}: {
  view: 'month' | 'week';
  setView: (v: 'month' | 'week') => void;
  anchor: Date;
  setAnchor: (d: Date) => void;
  children?: React.ReactNode;
}) {
  const step = (dir: 1 | -1) => setAnchor(view === 'month' ? addMonths(anchor, dir) : addWeeks(anchor, dir));
  const { from, to } = calendarRange(view, anchor);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <IconButton label={view === 'month' ? 'Previous month' : 'Previous week'} onClick={() => step(-1)}>
        <ChevronLeft className="size-4" />
      </IconButton>
      <Button size="sm" onClick={() => setAnchor(new Date())}>
        Today
      </Button>
      <IconButton label={view === 'month' ? 'Next month' : 'Next week'} onClick={() => step(1)}>
        <ChevronRight className="size-4" />
      </IconButton>
      <h2 className="min-w-[10rem] text-lg" aria-live="polite">
        {view === 'month' ? format(anchor, 'MMMM yyyy') : `${format(parseISO(from), 'd MMM')} – ${format(parseISO(to), 'd MMM yyyy')}`}
      </h2>
      <div role="group" aria-label="Calendar view" className="flex overflow-hidden rounded-[4px] border border-rule">
        {(['month', 'week'] as const).map((v) => (
          <button key={v} aria-pressed={view === v} onClick={() => setView(v)} className={cn('h-7 px-2.5 text-[13px]', view === v ? 'bg-accent text-accent-ink' : 'hover:bg-hover')}>
            {v === 'month' ? 'Month' : 'Week'}
          </button>
        ))}
      </div>
      {children}
    </div>
  );
}

/* ====================================================================
 * Project calendar view
 * ==================================================================== */

export default function CalendarView() {
  const ctx = useProjectCtx();
  const { project, people, canEdit, openCard } = ctx;
  const { user } = useAuth();
  const toast = useToast();
  const cardsQ = useProjectCards(project.id);
  const structQ = useProjectStructure(project.id);
  const msQ = useProjectMilestones(project.id, ctx.has('milestones'));
  const wps = useWorkPackagesLite(project.id, ctx.has('workpackages'));
  const [view, setView] = usePersistentState<'month' | 'week'>(`cal-view:${project.id}`, 'month');
  const [anchor, setAnchor] = useState(new Date());
  const [filter, setFilter] = usePersistentState<CardFilter>(`cal-filter:${project.id}`, {}, 'session');
  const [drawer, setDrawer] = useState(false);
  const [createOn, setCreateOn] = useState<string | null>(null);
  const textRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const today = format(new Date(), 'yyyy-MM-dd');

  const cards = useMemo(() => (cardsQ.data ?? []).filter((c) => matchesFilter(c, filter, user!.id)), [cardsQ.data, filter, user]);
  const cardMap = useMemo(() => new Map((cardsQ.data ?? []).map((c) => [c.id, c])), [cardsQ.data]);
  const events: CalEvent[] = useMemo(
    () => [
      ...cards
        .filter((c) => c.start_date || c.due_date)
        .map((c) => ({
          id: c.id,
          kind: 'card' as const,
          title: c.title,
          start: c.start_date ?? c.due_date!,
          end: c.due_date ?? c.start_date!,
          done: c.status === 'done',
          overdue: Boolean(c.due_date && c.due_date < today && c.status !== 'done'),
          draggable: canEdit,
        })),
      ...(msQ.data ?? [])
        .filter((m) => m.due_date)
        .map((m) => ({
          id: m.id,
          kind: 'milestone' as const,
          title: `${m.code ? m.code + ' ' : ''}${m.title}`,
          start: m.due_date!,
          end: m.due_date!,
          done: m.status === 'done',
          overdue: m.due_date! < today && m.status !== 'done' && m.status !== 'cancelled',
        })),
    ],
    [cards, msQ.data, today, canEdit],
  );
  const unscheduled = cards.filter((c) => !c.start_date && !c.due_date && c.status !== 'done');

  const moveCard = async (card: CardWithRelations, patch: { start_date: string | null; due_date: string | null }) => {
    const before = { start_date: card.start_date, due_date: card.due_date };
    try {
      const res = await updateCardEverywhere(card, patch);
      toast.show(`Rescheduled “${card.title}”`, { undo: () => updateCardEverywhere(res, before).then(() => undefined) });
    } catch (err) {
      toast.error(err);
    }
  };

  if (cardsQ.isLoading || structQ.isLoading) return <PageLoading />;
  if (cardsQ.error) return <div className="p-6"><ErrorNote error={cardsQ.error} retry={() => cardsQ.refetch()} /></div>;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="no-print flex flex-wrap items-center gap-3 border-b border-grid px-3 py-2 sm:px-5">
        <CalendarToolbar view={view} setView={setView} anchor={anchor} setAnchor={setAnchor} />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <FilterBar filter={filter} onChange={setFilter} people={people} labels={structQ.data?.labels} workPackages={wps.data} view="calendar" projectId={project.id} textRef={textRef} />
          <Button size="sm" variant={drawer ? 'primary' : 'secondary'} icon={<CalendarX2 className="size-3.5" />} onClick={() => setDrawer((d) => !d)} aria-pressed={drawer}>
            Unscheduled <span className="num">{unscheduled.length}</span>
          </Button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="scroll-thin min-w-0 flex-1 overflow-auto px-3 py-3 sm:px-5">
          <CalendarGrid
            view={view}
            anchor={anchor}
            events={events}
            onOpen={(e) => (e.kind === 'card' ? openCard(e.id) : navigate(`/p/${project.id}/milestones`))}
            onMove={
              canEdit
                ? (ev, start, end) => {
                    const card = cardMap.get(ev.id);
                    if (!card) return;
                    if (card.start_date && card.due_date) moveCard(card, { start_date: start, due_date: end });
                    else if (card.due_date) moveCard(card, { start_date: null, due_date: start });
                    else moveCard(card, { start_date: start, due_date: null });
                  }
                : undefined
            }
            onDropExternal={
              canEdit
                ? (id, date) => {
                    const card = cardMap.get(id);
                    if (card) moveCard(card, { start_date: null, due_date: date });
                  }
                : undefined
            }
            onDayClick={canEdit ? setCreateOn : undefined}
          />
          {canEdit && <p className="mt-2 text-xs text-secondary">Drag a task to another day to reschedule it. Use + on a day to add a task due that day.</p>}
        </div>
        {drawer && (
          <aside className="scroll-thin w-64 shrink-0 overflow-y-auto border-l border-grid p-3" aria-label="Unscheduled tasks">
            <h3 className="mb-1 text-sm">Unscheduled</h3>
            <p className="mb-2 text-xs text-secondary">{canEdit ? 'Drag onto a day to set its due date.' : 'Open tasks without dates.'}</p>
            {unscheduled.length === 0 && <p className="text-sm text-secondary">Every open task has a date.</p>}
            <ul className="flex flex-col gap-1">
              {unscheduled.map((c) => (
                <li key={c.id}>
                  <button
                    draggable={canEdit}
                    onDragStart={(e) => {
                      e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ id: c.id, offset: 0 }));
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onClick={() => openCard(c.id)}
                    className={cn('w-full truncate rounded-[3px] border border-grid border-l-2 border-l-teal bg-card px-2 py-1 text-left text-[13px] hover:border-rule', canEdit && 'cursor-grab')}
                  >
                    {c.title}
                  </button>
                </li>
              ))}
            </ul>
          </aside>
        )}
      </div>
      {createOn && <CreateOnDay date={createOn} onClose={() => setCreateOn(null)} />}
    </div>
  );
}

function CreateOnDay({ date, onClose }: { date: string; onClose: () => void }) {
  const { project } = useProjectCtx();
  const structQ = useProjectStructure(project.id);
  const cardsQ = useProjectCards(project.id);
  const lists = structQ.data?.lists ?? [];
  const boards = structQ.data?.boards ?? [];
  const firstList = boards.length ? lists.find((l) => l.board_id === boards[0].id) : undefined;
  const [title, setTitle] = useState('');
  const [listId, setListId] = useState(firstList?.id ?? '');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const submit = async () => {
    const list = lists.find((l) => l.id === (listId || firstList?.id));
    if (!title.trim() || !list) return;
    setBusy(true);
    try {
      await createCard({
        project_id: project.id,
        board_id: list.board_id,
        list_id: list.id,
        title: title.trim(),
        due_date: date,
        position: keyAfterLast((cardsQ.data ?? []).filter((c) => c.list_id === list.id)),
      });
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
      title={`New task due ${format(parseISO(date), 'EEE d MMM yyyy')}`}
      width={440}
      footer={
        <Button variant="primary" loading={busy} disabled={!title.trim() || !lists.length} onClick={submit}>
          Add task
        </Button>
      }
    >
      {lists.length === 0 ? (
        <p className="text-sm text-secondary">This project has no board lists yet. Create a board first.</p>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Field label="Title" htmlFor="cal-new-title">
            <Input id="cal-new-title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={500} />
          </Field>
          <Field label="List" htmlFor="cal-new-list">
            <Select id="cal-new-list" value={listId || firstList?.id} onChange={(e) => setListId(e.target.value)}>
              {boards.map((b) => (
                <optgroup key={b.id} label={b.name}>
                  {lists
                    .filter((l) => l.board_id === b.id)
                    .map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                </optgroup>
              ))}
            </Select>
          </Field>
          <button type="submit" hidden />
        </form>
      )}
    </Dialog>
  );
}
