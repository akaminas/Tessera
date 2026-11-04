import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { format, parseISO } from 'date-fns';
import { CalendarPlus, Download } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { useWorkspaceCtx } from '@/layout/WorkspaceContext';
import { useGlobalCalendar } from '@/data/views';
import { CalendarGrid, CalendarToolbar, calendarRange, type CalEvent } from '@/features/views/CalendarView';
import { downloadICS } from '@/lib/ical';
import { appUrl } from '@/lib/env';
import { usePersistentState } from '@/lib/usePersistentState';
import { Button, ErrorNote, PageHeader, Spinner, familyBar } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { Family } from '@/data/types';

export default function CalendarPage() {
  const { user } = useAuth();
  const { current } = useWorkspaceCtx();
  const navigate = useNavigate();
  const [view, setView] = usePersistentState<'month' | 'week'>('global-cal-view', 'month');
  const [mine, setMine] = usePersistentState('global-cal-mine', true);
  const [anchor, setAnchor] = useState(new Date());
  const { from, to } = calendarRange(view, anchor);
  const q = useGlobalCalendar(current?.id, from, to, mine, user!.id);
  const today = format(new Date(), 'yyyy-MM-dd');

  const items = useMemo(() => q.data ?? [], [q.data]);
  const events: CalEvent[] = useMemo(
    () =>
      items.map((i) => ({
        id: i.id,
        kind: i.kind,
        title: i.title,
        start: i.start,
        end: i.end,
        color: i.project_color,
        done: i.status === 'done',
        overdue: i.end < today && !['done', 'cancelled'].includes(i.status),
        sub: i.project_name,
      })),
    [items, today],
  );
  const projects = useMemo(() => {
    const m = new Map<string, { name: string; color: Family; n: number }>();
    for (const i of items) {
      const p = m.get(i.project_id) ?? { name: i.project_name, color: i.project_color, n: 0 };
      p.n++;
      m.set(i.project_id, p);
    }
    return [...m.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  }, [items]);
  const byKey = useMemo(() => new Map(items.map((i) => [`${i.kind}:${i.id}`, i])), [items]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6 sm:px-6">
      <PageHeader
        title="Calendar"
        subtitle={mine ? 'Tasks assigned to you and milestones of your projects' : `All dated tasks and milestones in ${current?.name ?? 'this workspace'}`}
        actions={
          <>
            <div role="group" aria-label="Whose tasks" className="flex overflow-hidden rounded-[4px] border border-rule">
              <button aria-pressed={mine} onClick={() => setMine(true)} className={cn('h-8 px-3 text-sm', mine ? 'bg-accent text-accent-ink' : 'hover:bg-hover')}>
                My tasks
              </button>
              <button aria-pressed={!mine} onClick={() => setMine(false)} className={cn('h-8 px-3 text-sm', !mine ? 'bg-accent text-accent-ink' : 'hover:bg-hover')}>
                Everyone
              </button>
            </div>
            <Button
              size="sm"
              icon={<Download className="size-3.5" />}
              disabled={!items.length}
              onClick={() =>
                downloadICS(
                  `tessera-${from}-to-${to}`,
                  items.map((i) => ({
                    uid: `${i.kind}-${i.id}@tessera`,
                    title: i.kind === 'milestone' ? `◆ ${i.title}` : i.title,
                    start: i.start,
                    end: i.end,
                    description: `${i.project_name}${i.kind === 'milestone' ? ' · milestone' : ''}`,
                    url: appUrl(i.kind === 'card' ? `c/${i.id}` : `p/${i.project_id}/milestones`),
                  })),
                  `Tessera ${format(parseISO(from), 'd MMM')} – ${format(parseISO(to), 'd MMM yyyy')}`,
                )
              }
            >
              Download .ics
            </Button>
          </>
        }
      />
      <CalendarToolbar view={view} setView={setView} anchor={anchor} setAnchor={setAnchor}>
        {q.isFetching && <Spinner label="Updating" />}
      </CalendarToolbar>
      {projects.length > 0 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Projects shown">
          {projects.map(([id, p]) => (
            <li key={id} className="flex items-center gap-1.5">
              <span className={cn('size-2 rounded-[2px]', familyBar[p.color])} aria-hidden />
              <Link to={`/p/${id}`} className="hover:underline">
                {p.name}
              </Link>
              <span className="num text-secondary">{p.n}</span>
            </li>
          ))}
        </ul>
      )}
      {q.error && <ErrorNote error={q.error} retry={() => q.refetch()} />}
      <div className="scroll-thin overflow-x-auto">
        <CalendarGrid
          view={view}
          anchor={anchor}
          events={events}
          onOpen={(e) => {
            const item = byKey.get(`${e.kind}:${e.id}`);
            if (!item) return;
            if (item.kind === 'card') navigate(`/p/${item.project_id}/board/${item.board_id}?card=${item.id}`);
            else navigate(`/p/${item.project_id}/milestones`);
          }}
        />
      </div>
      {!q.isLoading && items.length === 0 && <p className="text-sm text-secondary">Nothing dated in this period.</p>}
      <p className="flex items-start gap-2 border-l-2 border-teal bg-card px-3 py-2 text-sm">
        <CalendarPlus className="mt-0.5 size-4 shrink-0 text-secondary" aria-hidden />
        <span>
          The download is a one-time snapshot. To see your tasks in Google Calendar, Outlook or Apple Calendar and keep them updated, subscribe to your private
          feed from{' '}
          <Link to="/settings/calendar" className="text-link underline-offset-2 hover:underline">
            Settings → Calendar feed
          </Link>
          .
        </span>
      </p>
    </div>
  );
}
