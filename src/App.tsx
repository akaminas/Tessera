import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './data/queryClient';
import { isBackendConfigured, env } from './lib/env';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { ToastProvider } from './components/ui/Toast';
import { PageLoading } from './components/ui';
import { BackendMissing } from './pages/BackendMissing';
import { AppShell } from './layout/AppShell';
import { RouteError } from './pages/RouteError';

const AuthPage = lazy(() => import('./pages/AuthPage'));
const AuthCallback = lazy(() => import('./pages/AuthCallback'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const HomePage = lazy(() => import('./pages/HomePage'));
const MyWorkPage = lazy(() => import('./pages/MyWorkPage'));
const InboxPage = lazy(() => import('./pages/InboxPage'));
const ProjectsPage = lazy(() => import('./pages/ProjectsPage'));
const CalendarPage = lazy(() => import('./pages/CalendarPage'));
const ReportsPage = lazy(() => import('./pages/ReportsPage'));
const WorkspacePage = lazy(() => import('./pages/WorkspacePage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const GuidePage = lazy(() => import('./pages/GuidePage'));
const InvitePage = lazy(() => import('./pages/InvitePage'));
const SearchPage = lazy(() => import('./pages/SearchPage'));
const ProjectLayout = lazy(() => import('./features/project/ProjectLayout'));
const ProjectOverview = lazy(() => import('./features/project/ProjectOverview'));
const ProjectIndex = lazy(() => import('./features/project/ProjectIndex'));
const BoardPage = lazy(() => import('./features/board/BoardPage'));
const ProjectModulePage = lazy(() => import('./features/project/ProjectModulePage'));
const CardRedirect = lazy(() => import('./pages/CardRedirect'));

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <PageLoading />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return <>{children}</>;
}

function Lazy({ children }: { children: ReactNode }) {
  return <Suspense fallback={<PageLoading />}>{children}</Suspense>;
}

const router = createBrowserRouter(
  [
    {
      errorElement: <RouteError />,
      children: [
        { path: '/login', element: <Lazy><AuthPage mode="login" /></Lazy> },
        { path: '/signup', element: <Lazy><AuthPage mode="signup" /></Lazy> },
        { path: '/forgot', element: <Lazy><AuthPage mode="forgot" /></Lazy> },
        { path: '/auth/callback', element: <Lazy><AuthCallback /></Lazy> },
        { path: '/auth/reset', element: <Lazy><ResetPassword /></Lazy> },
        {
          element: (
            <RequireAuth>
              <AppShell>
                <Lazy>
                  <Outlet />
                </Lazy>
              </AppShell>
            </RequireAuth>
          ),
          children: [
            { index: true, element: <HomePage /> },
            { path: 'my-work', element: <MyWorkPage /> },
            { path: 'inbox', element: <InboxPage /> },
            { path: 'projects', element: <ProjectsPage /> },
            { path: 'calendar', element: <CalendarPage /> },
            { path: 'reports', element: <ReportsPage /> },
            { path: 'search', element: <SearchPage /> },
            { path: 'workspace', element: <WorkspacePage /> },
            { path: 'workspace/:workspaceId', element: <WorkspacePage /> },
            { path: 'workspace/:workspaceId/:tab', element: <WorkspacePage /> },
            { path: 'settings', element: <SettingsPage /> },
            { path: 'settings/:tab', element: <SettingsPage /> },
            { path: 'guide', element: <GuidePage /> },
            { path: 'invite/:token', element: <InvitePage /> },
            { path: 'c/:cardId', element: <CardRedirect /> },
            {
              path: 'p/:projectId',
              element: <ProjectLayout />,
              children: [
                { index: true, element: <ProjectIndex /> },
                { path: 'overview', element: <ProjectOverview /> },
                { path: 'board/:boardId', element: <BoardPage /> },
                { path: ':module', element: <ProjectModulePage /> },
                { path: ':module/:sub', element: <ProjectModulePage /> },
              ],
            },
            { path: '*', element: <Navigate to="/" replace /> },
          ],
        },
      ],
    },
  ],
  { basename: env.basePath.replace(/\/$/, '') || '/' },
);

export function App() {
  if (!isBackendConfigured) return <BackendMissing />;
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
