import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from 'react';
import { Link, useParams } from 'react-router';
import { PageLoading } from '@/components/ui';
import { useProjectCtx, MODULES } from './context';
import type { ProjectModule } from '@/data/types';

const pages: Record<string, { module?: ProjectModule; component: LazyExoticComponent<ComponentType> }> = {
  table: { module: 'table', component: lazy(() => import('@/features/views/TableView')) },
  calendar: { module: 'calendar', component: lazy(() => import('@/features/views/CalendarView')) },
  timeline: { module: 'timeline', component: lazy(() => import('@/features/views/TimelineView')) },
  dashboard: { module: 'dashboard', component: lazy(() => import('@/features/views/DashboardView')) },
  map: { module: 'map', component: lazy(() => import('@/features/views/MapView')) },
  workpackages: { module: 'workpackages', component: lazy(() => import('@/features/controls/WorkPackagesPage')) },
  milestones: { module: 'milestones', component: lazy(() => import('@/features/controls/MilestonesPage')) },
  risks: { module: 'risks', component: lazy(() => import('@/features/controls/RisksPage')) },
  meetings: { module: 'meetings', component: lazy(() => import('@/features/controls/MeetingsPage')) },
  files: { module: 'files', component: lazy(() => import('@/features/controls/FilesPage')) },
  activity: { module: 'activity', component: lazy(() => import('@/features/controls/ActivityPage')) },
  budget: { module: 'budget', component: lazy(() => import('@/features/finance/BudgetPage')) },
  kpis: { module: 'kpis', component: lazy(() => import('@/features/finance/KpisPage')) },
  automations: { module: 'automations', component: lazy(() => import('@/features/automation/AutomationsPage')) },
  import: { component: lazy(() => import('@/features/import/ImportPage')) },
  settings: { component: lazy(() => import('./ProjectSettings')) },
};

/** Routes /p/:projectId/:module to the module's page, respecting enabled modules. */
export default function ProjectModulePage() {
  const { module } = useParams();
  const ctx = useProjectCtx();
  const entry = module ? pages[module] : undefined;
  if (!entry)
    return (
      <div className="p-6 text-sm">
        Unknown page. <Link className="text-link underline" to={`/p/${ctx.project.id}`}>Back to the project</Link>
      </div>
    );
  if (entry.module && !ctx.has(entry.module)) {
    const meta = MODULES.find((m) => m.id === entry.module);
    return (
      <div className="mx-auto max-w-xl p-6">
        <h2 className="text-xl">{meta?.label} is turned off for this project</h2>
        <p className="mt-2 text-sm text-secondary">
          {ctx.canManage ? 'Turn it on from the module settings (gear icon in the project header).' : 'A project manager can turn it on.'}
        </p>
      </div>
    );
  }
  const Page = entry.component;
  return (
    <Suspense fallback={<PageLoading />}>
      <Page />
    </Suspense>
  );
}
