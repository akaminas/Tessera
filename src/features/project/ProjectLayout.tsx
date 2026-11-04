import { useCallback, useMemo, useState } from 'react';
import { NavLink, Outlet, useNavigate, useParams, useSearchParams } from 'react-router';
import { Settings2, Star } from 'lucide-react';
import { useBoards, useProject, useProjectPeople, useProjectRole, updateProject } from '@/data/core';
import { useBookmarks, toggleBookmark } from '@/data/personal';
import { AvatarStack, ErrorNote, IconButton, PageLoading, familyBar } from '@/components/ui';
import { Popover } from '@/components/ui/Menu';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';
import type { ProjectModule } from '@/data/types';
import { MODULES, type ProjectCtx } from './context';
import { CardDialog } from '@/features/card/CardDialog';
import { useFocusMode } from '@/layout/focus';

const STATUS_LABEL = { planning: 'Planning', active: 'Active', on_hold: 'On hold', completed: 'Completed', cancelled: 'Cancelled' };

export default function ProjectLayout() {
  const { projectId } = useParams();
  const project = useProject(projectId);
  const role = useProjectRole(projectId);
  const people = useProjectPeople(projectId);
  const boards = useBoards(projectId);
  const bookmarks = useBookmarks();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { focus } = useFocusMode();
  const [modulesOpen, setModulesOpen] = useState(false);

  const openCard = useCallback(
    (cardId: string) => {
      const next = new URLSearchParams(params);
      next.set('card', cardId);
      setParams(next);
    },
    [params, setParams],
  );

  const ctx = useMemo<ProjectCtx | null>(() => {
    if (!project.data || !role.data) return null;
    const r = role.data.role;
    return {
      project: project.data,
      role: r,
      finance: role.data.finance,
      people: people.data ?? [],
      canEdit: r === 'manager' || r === 'member' || r === 'collaborator',
      canManage: r === 'manager',
      openCard,
      has: (m: ProjectModule) => project.data!.modules.includes(m),
    };
  }, [project.data, role.data, people.data, openCard]);

  if (project.isLoading || role.isLoading) return <PageLoading />;
  if (project.error || !project.data || !ctx)
    return (
      <div className="p-6">
        <ErrorNote error={project.error ?? new Error('Project not found, or you no longer have access.')} />
      </div>
    );

  const p = project.data;
  const firstBoard = (boards.data ?? []).find((b) => !b.archived_at);
  const starred = (bookmarks.data ?? []).some((b) => b.kind === 'project' && b.target_id === p.id);
  const cardId = params.get('card');

  const tabs: { to: string; label: string; module?: ProjectModule; end?: boolean }[] = [
    // Views of the same tasks first, then the project's own pages.
    ...(firstBoard ? [{ to: `board/${firstBoard.id}`, label: 'Board', module: 'board' as const }] : []),
    { to: 'table', label: 'Table', module: 'table' },
    { to: 'timeline', label: 'Timeline', module: 'timeline' },
    { to: 'calendar', label: 'Calendar', module: 'calendar' },
    { to: 'dashboard', label: 'Dashboard', module: 'dashboard' },
    { to: 'map', label: 'Map', module: 'map' },
    { to: 'overview', label: 'Overview' },
    { to: 'workpackages', label: 'Work packages', module: 'workpackages' },
    { to: 'milestones', label: 'Milestones', module: 'milestones' },
    { to: 'budget', label: 'Budget', module: 'budget' },
    { to: 'kpis', label: 'KPIs', module: 'kpis' },
    { to: 'risks', label: 'Risks & issues', module: 'risks' },
    { to: 'meetings', label: 'Meetings', module: 'meetings' },
    { to: 'files', label: 'Files', module: 'files' },
    { to: 'activity', label: 'Activity', module: 'activity' },
    { to: 'automations', label: 'Automations', module: 'automations' },
  ];
  const visibleTabs = tabs.filter((t) => !t.module || p.modules.includes(t.module));

  const toggleModule = async (m: ProjectModule, on: boolean) => {
    const modules = on ? [...new Set([...p.modules, m])] : p.modules.filter((x) => x !== m);
    try {
      await updateProject(p, { modules });
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!focus && (
        <div className="project-bar no-print border-b border-grid bg-surface px-3 pt-3 sm:px-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn('size-3 rounded-[3px]', familyBar[p.color])} aria-hidden />
            <h1 className="min-w-0 truncate text-xl leading-tight sm:text-2xl">{p.name}</h1>
            {p.acronym && <span className="text-sm text-secondary">{p.acronym}</span>}
            {p.status !== 'active' && <span className="text-xs text-secondary">· {STATUS_LABEL[p.status]}</span>}
            {p.personal_owner && <span className="text-xs text-secondary">· Private to you</span>}
            <IconButton
              label={starred ? 'Remove bookmark' : 'Bookmark project'}
              onClick={() => toggleBookmark({ kind: 'project', target_id: p.id, project_id: p.id, label: p.acronym || p.name }, !starred).catch(toast.error)}
            >
              <Star className={cn('size-4', starred && 'fill-[var(--v-ochre)] text-ochre')} />
            </IconButton>
            <div className="ml-auto flex items-center gap-2">
              <AvatarStack people={(people.data ?? []).map((x) => ({ name: x.display_name, color: x.avatar_color }))} max={5} />
              {ctx.canManage && (
                <Popover
                  open={modulesOpen}
                  onOpenChange={setModulesOpen}
                  align="end"
                  className="w-80"
                  trigger={
                    <IconButton label="Choose project modules">
                      <Settings2 className="size-4" />
                    </IconButton>
                  }
                >
                  <p className="mb-2 font-bold">Modules</p>
                  <p className="mb-2 text-xs text-secondary">Show only what this project needs. Hidden modules keep their data.</p>
                  <ul className="flex flex-col gap-1.5">
                    {MODULES.map((m) => (
                      <li key={m.id}>
                        <label className="flex items-start gap-2">
                          <input
                            type="checkbox"
                            className="mt-1 accent-[var(--v-teal-deep)]"
                            checked={p.modules.includes(m.id)}
                            onChange={(e) => toggleModule(m.id, e.target.checked)}
                          />
                          <span>
                            <span className="block text-sm">{m.label}</span>
                            <span className="block text-xs text-secondary">{m.description}</span>
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                  <button className="mt-3 text-sm text-link underline" onClick={() => navigate(`/p/${p.id}/settings`)}>
                    Project settings
                  </button>
                </Popover>
              )}
            </div>
          </div>
          <nav aria-label="Project" className="scroll-thin -mb-px mt-2 flex gap-1 overflow-x-auto">
            {visibleTabs.map((t) => (
              <NavLink
                key={t.label}
                to={t.to}
                end={t.end}
                className={({ isActive }) =>
                  cn(
                    'whitespace-nowrap border-b-2 px-2.5 py-2 text-sm',
                    isActive ? 'border-teal-deep font-bold text-ink' : 'border-transparent text-secondary hover:text-ink',
                  )
                }
              >
                {t.label}
              </NavLink>
            ))}
          </nav>
        </div>
      )}
      <div className="min-h-0 flex-1">
        <Outlet context={ctx} />
      </div>
      {cardId && (
        <CardDialog
          cardId={cardId}
          ctx={ctx}
          onClose={() => {
            const next = new URLSearchParams(params);
            next.delete('card');
            setParams(next);
          }}
        />
      )}
    </div>
  );
}
