import { useState } from 'react';
import { Link } from 'react-router';
import { format, parseISO } from 'date-fns';
import { useActivityPage } from '@/data/controls';
import { useProjectCtx } from '@/features/project/context';
import { Avatar, Button, EmptyState, ErrorNote, PageHeader, PageLoading, Select } from '@/components/ui';
import { groupByDay } from './helpers';

const ENTITY_TYPES: { value: string; label: string }[] = [
  { value: '', label: 'Everything' },
  { value: 'card', label: 'Tasks' },
  { value: 'comment', label: 'Comments' },
  { value: 'assignee', label: 'Assignments' },
  { value: 'checklist', label: 'Checklists' },
  { value: 'attachment', label: 'Attachments' },
  { value: 'list', label: 'Lists' },
  { value: 'board', label: 'Boards' },
  { value: 'project', label: 'Project settings' },
  { value: 'work package', label: 'Work packages' },
  { value: 'milestone', label: 'Milestones' },
  { value: 'evidence', label: 'Evidence' },
  { value: 'risk', label: 'Risks and issues' },
  { value: 'meeting', label: 'Meetings' },
  { value: 'KPI', label: 'KPIs' },
  { value: 'KPI measurement', label: 'KPI measurements' },
  { value: 'member', label: 'Members' },
];

const PAGE = 50;

export default function ActivityPage() {
  const { project, people } = useProjectCtx();
  const [entityType, setEntityType] = useState('');
  const [actorId, setActorId] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const q = useActivityPage(project.id, { entityType: entityType || undefined, actorId: actorId || undefined, limit });
  const rows = q.data?.rows ?? [];
  const groups = groupByDay(rows);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 px-3 py-4 sm:px-5">
      <PageHeader title="Activity" subtitle="A permanent record of changes in this project. Financial amounts are recorded in the separate finance audit." />
      <div className="flex flex-wrap items-center gap-2">
        <Select value={entityType} onChange={(e) => (setEntityType(e.target.value), setLimit(PAGE))} className="h-8 w-48" aria-label="What changed">
          {ENTITY_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
        <Select value={actorId} onChange={(e) => (setActorId(e.target.value), setLimit(PAGE))} className="h-8 w-48" aria-label="Who">
          <option value="">Anyone</option>
          {people.map((p) => (
            <option key={p.user_id} value={p.user_id}>
              {p.display_name}
            </option>
          ))}
        </Select>
      </div>
      {q.isLoading && <PageLoading />}
      {q.error && <ErrorNote error={q.error} retry={() => q.refetch()} />}
      {!q.isLoading && rows.length === 0 && <EmptyState title="No activity matches" />}
      {groups.map((g) => (
        <section key={g.day}>
          <h2 className="mb-1 border-b border-grid pb-1 font-sans text-xs font-bold text-secondary">{format(parseISO(g.day), 'EEEE d MMMM yyyy')}</h2>
          <ol className="flex flex-col">
            {g.items.map((a) => {
              const actor = people.find((p) => p.user_id === a.actor_id);
              const name = actor?.display_name ?? (a.actor_id ? 'Former member' : 'Automation');
              return (
                <li key={a.id} className="flex items-start gap-2 py-1.5 text-sm">
                  <Avatar name={name} color={actor?.avatar_color ?? 'indigo'} size={22} />
                  <p className="min-w-0 flex-1">
                    <b>{name}</b> {a.summary}
                    {a.card_id && (
                      <>
                        {' '}
                        <Link to={`/c/${a.card_id}`} className="text-xs text-link hover:underline">
                          open task
                        </Link>
                      </>
                    )}
                  </p>
                  <time className="num shrink-0 text-xs text-secondary" dateTime={a.created_at}>
                    {format(parseISO(a.created_at), 'HH:mm')}
                  </time>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
      {q.data?.more && (
        <div>
          <Button onClick={() => setLimit((l) => l + PAGE)} loading={q.isFetching}>
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
