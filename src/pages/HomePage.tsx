import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { format, formatDistanceToNow, parseISO } from 'date-fns';
import { Plus } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { useMyWork, usePersonalInbox } from '@/data/personal';
import { useActivity, useAllProjects, useBoardData } from '@/data/core';
import { createCard } from '@/data/cards';
import { keyAfterLast } from '@/domain/ordering';
import { parseQuickAdd } from '@/domain/quickParse';
import { groupWork, BUCKET_LABEL } from '@/domain/workGroups';
import { Button, EmptyState, ErrorNote, Input, PageLoading, Section, familyBar } from '@/components/ui';
import { useToast } from '@/components/ui/Toast';
import { useWorkspaceCtx } from '@/layout/WorkspaceContext';
import { WorkItemRow } from '@/features/work/WorkItemRow';
import { cn } from '@/lib/cn';

export default function HomePage() {
  const { profile } = useAuth();
  const { current } = useWorkspaceCtx();
  const work = useMyWork(false);
  const projects = useAllProjects();
  const activity = useActivity({ workspaceId: current?.id }, 15);
  const inbox = usePersonalInbox(current?.id);
  const inboxBoard = useBoardData(inbox.data?.project_id, inbox.data?.board_id);
  const toast = useToast();
  const [capture, setCapture] = useState('');

  const groups = useMemo(() => groupWork(work.data ?? []), [work.data]);
  const overdue = groups.find((g) => g.bucket === 'overdue')?.items ?? [];
  const today = groups.find((g) => g.bucket === 'today')?.items ?? [];
  const week = groups.find((g) => g.bucket === 'week')?.items ?? [];
  const inboxCount = inbox.data ? (inboxBoard.data?.cards ?? []).filter((c) => c.list_id === inbox.data!.list_id && c.status !== 'done').length : 0;
  const priorities = useMemo(
    () => [...today, ...week, ...overdue].filter((w) => w.priority === 'urgent' || w.priority === 'high').slice(0, 5),
    [today, week, overdue],
  );
  const wsProjects = (projects.data ?? []).filter((p) => p.workspace_id === current?.id && !p.personal_owner);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  if (work.isLoading) return <PageLoading />;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-7 px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-end gap-3">
        <div className="flex-1">
          <p className="text-sm text-secondary">{format(new Date(), 'EEEE d MMMM yyyy')}</p>
          <h1 className="text-3xl">
            {greeting}
            {profile?.display_name ? `, ${profile.display_name.split(' ')[0]}` : ''}
          </h1>
        </div>
        <form
          className="flex w-full gap-2 sm:w-[420px]"
          onSubmit={async (e) => {
            e.preventDefault();
            const parsed = parseQuickAdd(capture);
            if (!parsed.title || !inbox.data) return;
            try {
              await createCard({
                ...inbox.data,
                title: parsed.title,
                due_date: parsed.due_date,
                priority: parsed.priority,
                position: keyAfterLast((inboxBoard.data?.cards ?? []).filter((c) => c.list_id === inbox.data!.list_id)),
              });
              setCapture('');
              toast.show('Captured in your Inbox');
            } catch (err) {
              toast.error(err);
            }
          }}
        >
          <Input value={capture} onChange={(e) => setCapture(e.target.value)} placeholder="Capture a task… e.g. “Call Maria tomorrow”" aria-label="Capture a task" />
          <Button type="submit" variant="primary" icon={<Plus className="size-4" />} disabled={!capture.trim() || !inbox.data}>
            Add
          </Button>
        </form>
      </header>

      {work.error && <ErrorNote error={work.error} retry={() => work.refetch()} />}

      <div className="grid gap-x-8 gap-y-7 lg:grid-cols-[1fr_300px]">
        <div className="flex flex-col gap-7">
          {priorities.length > 0 && (
            <Section id="home-priorities" title="Today’s priorities" count={priorities.length}>
              <ul className="divide-y divide-grid">
                {priorities.map((w) => (
                  <WorkItemRow key={w.card_id + (w.checklist_item_id ?? '')} item={w} />
                ))}
              </ul>
            </Section>
          )}
          {overdue.length > 0 && (
            <Section id="home-overdue" title={BUCKET_LABEL.overdue} count={overdue.length}>
              <ul className="divide-y divide-grid">
                {overdue.map((w) => (
                  <WorkItemRow key={w.card_id + (w.checklist_item_id ?? '')} item={w} />
                ))}
              </ul>
            </Section>
          )}
          <Section id="home-today" title="Due today" count={today.length}>
            {today.length ? (
              <ul className="divide-y divide-grid">
                {today.map((w) => (
                  <WorkItemRow key={w.card_id + (w.checklist_item_id ?? '')} item={w} />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-secondary">Nothing is due today.</p>
            )}
          </Section>
          <Section id="home-upcoming" title="Upcoming deadlines" count={week.length}>
            {week.length ? (
              <ul className="divide-y divide-grid">
                {week.map((w) => (
                  <WorkItemRow key={w.card_id + (w.checklist_item_id ?? '')} item={w} />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-secondary">No deadlines in the next 7 days.</p>
            )}
          </Section>
          <p className="text-sm">
            <Link to="/my-work" className="text-link underline-offset-2 hover:underline">
              See all my work
            </Link>
          </p>
        </div>

        <aside className="flex flex-col gap-7">
          <Section id="home-inbox" title="Inbox" collapsible={false}>
            <p className="text-sm">
              {inboxCount ? (
                <>
                  <b className="num">{inboxCount}</b> captured task{inboxCount === 1 ? '' : 's'} to sort.{' '}
                </>
              ) : (
                'Your Inbox is empty. '
              )}
              {inbox.data && (
                <Link to={`/p/${inbox.data.project_id}/board/${inbox.data.board_id}`} className="text-link underline-offset-2 hover:underline">
                  Open personal board
                </Link>
              )}
            </p>
          </Section>
          <Section id="home-projects" title="Projects" count={wsProjects.length}>
            {wsProjects.length ? (
              <ul className="flex flex-col gap-1">
                {wsProjects.slice(0, 8).map((p) => (
                  <li key={p.id}>
                    <Link to={`/p/${p.id}`} className="flex items-center gap-2 rounded-[3px] px-1 py-1 text-sm hover:bg-hover">
                      <span className={cn('size-2 rounded-[2px]', familyBar[p.color])} aria-hidden />
                      <span className="truncate">{p.name}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No projects yet" action={<Link className="text-sm text-link underline" to="/projects?new=1">Create a project</Link>} />
            )}
          </Section>
          <Section id="home-activity" title="Recent activity" defaultOpen={false}>
            <ul className="flex flex-col gap-2 text-xs">
              {(activity.data ?? []).map((a) => (
                <li key={a.id}>
                  <span className="text-ink">{a.summary}</span>{' '}
                  <span className="text-secondary">{formatDistanceToNow(parseISO(a.created_at), { addSuffix: true })}</span>
                </li>
              ))}
              {activity.data?.length === 0 && <li className="text-secondary">No activity yet.</li>}
            </ul>
          </Section>
        </aside>
      </div>
    </div>
  );
}
