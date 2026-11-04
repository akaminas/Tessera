import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { addDays, differenceInCalendarMonths, format, formatDistanceToNow, parseISO } from 'date-fns';
import { Archive, LayoutGrid, Pencil, Plus, RotateCcw } from 'lucide-react';
import { useActivity, useBoards, updateBoard, updateProject } from '@/data/core';
import { sb } from '@/lib/supabase';
import { must } from '@/data/errors';
import { Avatar, Button, EmptyState, Section, Textarea } from '@/components/ui';
import { Markdown } from '@/components/ui/Markdown';
import { StatTile, Meter } from '@/components/charts';
import { useToast } from '@/components/ui/Toast';
import { DueBadge } from '@/features/board/CardTile';
import { NewBoardDialog } from '@/features/board/NewBoardDialog';
import { useProjectCtx } from './context';

interface Summary {
  tasks_total: number;
  tasks_done: number;
  tasks_overdue: number;
  tasks_blocked: number;
  tasks_unassigned: number;
  milestones_total: number;
  milestones_done: number;
  milestones_overdue: number;
  milestones_at_risk: number;
  evidence_missing: number;
  risks_open: number;
  risks_high: number;
  issues_open: number;
}

export default function ProjectOverview() {
  const ctx = useProjectCtx();
  const { project, people, canEdit, canManage } = ctx;
  const boards = useBoards(project.id);
  const activity = useActivity({ projectId: project.id }, 12);
  const toast = useToast();
  const [newBoard, setNewBoard] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<null | 'description' | 'objectives' | 'outcomes'>(null);
  const [draft, setDraft] = useState('');

  const summary = useQuery({
    queryKey: ['p', project.id, 'summary'],
    queryFn: async () => (must(await sb().rpc('project_summary', { p_project: project.id })) as Summary[])[0],
  });
  const upcoming = useQuery({
    queryKey: ['p', project.id, 'upcoming'],
    queryFn: async () => {
      const today = format(new Date(), 'yyyy-MM-dd');
      const until = format(addDays(new Date(), 21), 'yyyy-MM-dd');
      const [cards, ms] = await Promise.all([
        sb()
          .from('cards')
          .select('id, title, due_date, status, board_id')
          .eq('project_id', project.id)
          .is('deleted_at', null)
          .is('archived_at', null)
          .eq('is_template', false)
          .neq('status', 'done')
          .lte('due_date', until)
          .order('due_date')
          .limit(12),
        ctx.has('milestones')
          ? sb().from('milestones').select('id, code, title, due_date, status').eq('project_id', project.id).is('deleted_at', null).not('status', 'in', '(done,cancelled)').lte('due_date', until).order('due_date').limit(8)
          : Promise.resolve({ data: [], error: null }),
      ]);
      return {
        cards: must(cards) as { id: string; title: string; due_date: string; status: 'open'; board_id: string }[],
        milestones: (must(ms) ?? []) as { id: string; code: string; title: string; due_date: string; status: string }[],
        today,
      };
    },
  });

  const months = project.start_date && project.end_date ? differenceInCalendarMonths(parseISO(project.end_date), parseISO(project.start_date)) + 1 : null;
  const currentMonth = project.start_date ? differenceInCalendarMonths(new Date(), parseISO(project.start_date)) + 1 : null;
  const elapsed = months && currentMonth ? Math.max(0, Math.min(100, (currentMonth / months) * 100)) : null;
  const s = summary.data;
  const activeBoards = (boards.data ?? []).filter((b) => !b.archived_at && !b.is_template);
  const archivedBoards = (boards.data ?? []).filter((b) => b.archived_at);

  const saveText = (field: 'description' | 'objectives' | 'outcomes') =>
    updateProject(project, { [field]: draft })
      .then(() => setEditing(null))
      .catch(toast.error);

  const TextBlock = ({ field, title, empty }: { field: 'description' | 'objectives' | 'outcomes'; title: string; empty: string }) => (
    <Section
      id={`overview-${field}`}
      title={title}
      actions={
        canManage && editing !== field ? (
          <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => (setDraft(project[field]), setEditing(field))}>
            Edit
          </Button>
        ) : null
      }
    >
      {editing === field ? (
        <div className="flex flex-col gap-2">
          <Textarea autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} rows={6} aria-label={title} />
          <div className="flex gap-2">
            <Button size="sm" variant="primary" onClick={() => saveText(field)}>
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : project[field].trim() ? (
        <Markdown source={project[field]} />
      ) : (
        <p className="text-sm text-secondary">{empty}</p>
      )}
    </Section>
  );

  return (
    <div className="mx-auto grid max-w-6xl gap-x-8 gap-y-6 px-4 py-5 sm:px-6 lg:grid-cols-[1fr_320px]">
      <div className="flex min-w-0 flex-col gap-6">
        {s && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Tasks done" value={`${s.tasks_done} / ${s.tasks_total}`} note={s.tasks_total ? `${Math.round((100 * s.tasks_done) / s.tasks_total)} %` : undefined} />
            <StatTile label="Overdue tasks" value={s.tasks_overdue} tone={s.tasks_overdue ? 'critical' : undefined} note={s.tasks_blocked ? `${s.tasks_blocked} blocked` : undefined} />
            {ctx.has('milestones') ? (
              <StatTile label="Milestones done" value={`${s.milestones_done} / ${s.milestones_total}`} note={s.milestones_overdue ? `${s.milestones_overdue} overdue` : s.milestones_at_risk ? `${s.milestones_at_risk} at risk` : undefined} />
            ) : (
              <StatTile label="Unassigned open tasks" value={s.tasks_unassigned} />
            )}
            {ctx.has('risks') ? (
              <StatTile label="High risks open" value={s.risks_high} tone={s.risks_high ? 'serious' : undefined} note={`${s.issues_open} open issues`} />
            ) : (
              <StatTile label="Missing evidence" value={s.evidence_missing} />
            )}
          </div>
        )}

        {ctx.has('board') && (
          <Section
            id="overview-boards"
            title="Boards"
            count={activeBoards.length}
            actions={
              canEdit ? (
                <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setNewBoard(true)}>
                  New board
                </Button>
              ) : null
            }
          >
            {activeBoards.length === 0 ? (
              <EmptyState title="No boards yet" action={canEdit ? <Button size="sm" variant="primary" onClick={() => setNewBoard(true)}>Create a board</Button> : undefined} />
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {activeBoards.map((b) => (
                  <li key={b.id}>
                    <Link to={`board/${b.id}`} className="flex items-center gap-2 rounded-[4px] border border-grid bg-card px-3 py-2 hover:border-rule">
                      <LayoutGrid className="size-4 text-secondary" aria-hidden />
                      <span className="flex-1 truncate">{b.name}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {archivedBoards.length > 0 && (
              <div className="mt-2">
                <button className="text-xs text-secondary underline" onClick={() => setShowArchived((v) => !v)}>
                  {showArchived ? 'Hide' : 'Show'} {archivedBoards.length} archived board{archivedBoards.length > 1 ? 's' : ''}
                </button>
                {showArchived && (
                  <ul className="mt-1 flex flex-col gap-1">
                    {archivedBoards.map((b) => (
                      <li key={b.id} className="flex items-center gap-2 text-sm">
                        <Archive className="size-3.5 text-muted" aria-hidden />
                        <span className="flex-1">{b.name}</span>
                        {canEdit && (
                          <Button size="sm" icon={<RotateCcw className="size-3.5" />} onClick={() => updateBoard(b, { archived_at: null }).catch(toast.error)}>
                            Restore
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Section>
        )}

        <Section id="overview-upcoming" title="Coming up in the next three weeks">
          {upcoming.data && upcoming.data.cards.length + upcoming.data.milestones.length === 0 && <p className="text-sm text-secondary">No deadlines in the next three weeks.</p>}
          <ul className="divide-y divide-grid">
            {(upcoming.data?.milestones ?? []).map((m) => (
              <li key={m.id} className="flex items-center gap-2 py-1.5 text-sm">
                <span className="w-16 shrink-0 text-xs text-secondary">Milestone</span>
                <Link to="milestones" className="flex-1 truncate hover:underline">
                  {m.code && <b>{m.code} </b>}
                  {m.title}
                </Link>
                <DueBadge due={m.due_date} status={m.status === 'done' ? 'done' : 'open'} />
              </li>
            ))}
            {(upcoming.data?.cards ?? []).map((c) => (
              <li key={c.id} className="flex items-center gap-2 py-1.5 text-sm">
                <span className="w-16 shrink-0 text-xs text-secondary">Task</span>
                <button className="flex-1 truncate text-left hover:underline" onClick={() => ctx.openCard(c.id)}>
                  {c.title}
                </button>
                <DueBadge due={c.due_date} status={c.status} />
              </li>
            ))}
          </ul>
        </Section>

        <TextBlock field="description" title="About" empty="No description yet." />
        <TextBlock field="objectives" title="Objectives" empty="Objectives help everyone see why the work matters." />
        <TextBlock field="outcomes" title="Expected outcomes" empty="No outcomes recorded." />
      </div>

      <aside className="flex flex-col gap-6">
        <Section id="overview-facts" title="Key facts" collapsible={false}>
          <dl className="grid grid-cols-[110px_1fr] gap-y-1.5 text-sm">
            <dt className="text-secondary">Status</dt>
            <dd className="capitalize">{project.status.replace('_', ' ')}</dd>
            <dt className="text-secondary">Dates</dt>
            <dd className="num">
              {project.start_date ? format(parseISO(project.start_date), 'd MMM yyyy') : 'Not set'} – {project.end_date ? format(parseISO(project.end_date), 'd MMM yyyy') : 'Not set'}
            </dd>
            {months && (
              <>
                <dt className="text-secondary">Duration</dt>
                <dd className="num">
                  {months} months{currentMonth && currentMonth >= 1 && currentMonth <= months ? ` · now M${currentMonth}` : ''}
                </dd>
              </>
            )}
            {project.funding.programme && (
              <>
                <dt className="text-secondary">Programme</dt>
                <dd>{project.funding.programme}</dd>
              </>
            )}
            {project.funding.grant_number && (
              <>
                <dt className="text-secondary">Grant</dt>
                <dd>{project.funding.grant_number}</dd>
              </>
            )}
            <dt className="text-secondary">Visible to</dt>
            <dd>{project.personal_owner ? 'Only you' : project.visibility === 'private' ? 'Project members' : 'Whole workspace'}</dd>
          </dl>
          {elapsed != null && (
            <div className="mt-3">
              <p className="mb-1 text-xs text-secondary">Time elapsed</p>
              <Meter value={elapsed} label="Time elapsed" />
            </div>
          )}
          {canManage && (
            <div className="mt-3 flex flex-col gap-1 text-sm">
              <Link to="settings" className="text-link underline-offset-2 hover:underline">
                Project settings
              </Link>
              <Link to="import" className="text-link underline-offset-2 hover:underline">
                Import or export workbooks
              </Link>
            </div>
          )}
        </Section>

        <Section id="overview-team" title="People" count={people.length}>
          <ul className="flex flex-col gap-1.5">
            {people.map((p) => (
              <li key={p.user_id} className="flex items-center gap-2 text-sm">
                <Avatar name={p.display_name} color={p.avatar_color} size={22} />
                <span className="flex-1 truncate">{p.display_name}</span>
                <span className="text-xs capitalize text-secondary">{p.role}</span>
              </li>
            ))}
          </ul>
        </Section>

        {ctx.has('activity') && (
          <Section id="overview-activity" title="Recent activity">
            <ul className="flex flex-col gap-2 text-xs">
              {(activity.data ?? []).map((a) => (
                <li key={a.id}>
                  <b>{people.find((p) => p.user_id === a.actor_id)?.display_name ?? 'Someone'}</b> {a.summary}{' '}
                  <span className="text-secondary">{formatDistanceToNow(parseISO(a.created_at), { addSuffix: true })}</span>
                </li>
              ))}
            </ul>
            <Link to="activity" className="mt-2 inline-block text-sm text-link underline-offset-2 hover:underline">
              All activity
            </Link>
          </Section>
        )}
      </aside>
      <NewBoardDialog open={newBoard} onOpenChange={setNewBoard} projectId={project.id} boards={boards.data ?? []} />
    </div>
  );
}
