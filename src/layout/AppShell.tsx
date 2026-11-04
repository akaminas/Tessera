import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router';
import {
  Bell,
  BookMarked,
  Briefcase,
  CalendarDays,
  ChevronDown,
  FileBarChart,
  Home,
  Inbox,
  ListChecks,
  LogOut,
  Menu as MenuIcon,
  Moon,
  Plus,
  Search,
  Settings,
  Square,
  Sun,
  Timer,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { WorkspaceProvider, useWorkspaceCtx } from './WorkspaceContext';
import { ShortcutProvider, useShortcuts } from './shortcuts';
import { Logo } from './Logo';
import { Avatar, Button, IconButton, PageLoading, familyBar } from '@/components/ui';
import { MenuContent, MenuItem, MenuLabel, MenuRoot, MenuSeparator, MenuTrigger } from '@/components/ui/Menu';
import { cn } from '@/lib/cn';
import { startChangeFeed, type SyncState } from '@/data/realtime';
import { useBookmarks, useNotifications, useRunningTimer, stopTimer, removeBookmark } from '@/data/personal';
import { useAllProjects } from '@/data/core';
import { applyUiPrefs, readUiPrefs, resolvedTheme } from '@/lib/prefs';
import { QuickAddDialog } from './QuickAdd';
import { Onboarding } from './Onboarding';
import { useToast } from '@/components/ui/Toast';
import { FocusProvider, useFocusMode } from './focus';

const NAV = [
  { to: '/', label: 'Home', icon: Home, end: true, keys: 'g h' },
  { to: '/my-work', label: 'My Work', icon: ListChecks, keys: 'g m' },
  { to: '/inbox', label: 'Inbox', icon: Inbox, keys: 'g i' },
  { to: '/projects', label: 'Projects', icon: Briefcase, keys: 'g p' },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays, keys: 'g c' },
  { to: '/reports', label: 'Reports', icon: FileBarChart, keys: 'g r' },
  { to: '/workspace', label: 'Workspace', icon: Users, keys: 'g w' },
  { to: '/settings', label: 'Settings', icon: Settings, keys: 'g s' },
];

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <WorkspaceProvider>
      <ShortcutProvider>
        <FocusProvider>
          <ShellInner>{children}</ShellInner>
        </FocusProvider>
      </ShortcutProvider>
    </WorkspaceProvider>
  );
}

function ShellInner({ children }: { children: ReactNode }) {
  const { user, profile } = useAuth();
  const { current, workspaces, loading } = useWorkspaceCtx();
  const [sync, setSync] = useState<SyncState>('connecting');
  const [navOpen, setNavOpen] = useState(false);
  const [quickAdd, setQuickAdd] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const { focus, setFocus } = useFocusMode();
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user) return;
    return startChangeFeed(user.id, setSync);
  }, [user]);

  useEffect(() => setNavOpen(false), [location.pathname]);

  useShortcuts(
    [
      ...NAV.map((n) => ({ keys: n.keys, description: `Go to ${n.label}`, group: 'Navigation' as const, handler: () => navigate(n.to) })),
      { keys: '/', description: 'Search', group: 'General', handler: () => searchRef.current?.focus() },
      { keys: 'q', description: 'Quick add a task', group: 'General', handler: () => setQuickAdd(true) },
      {
        keys: 'z',
        description: 'Undo last action',
        group: 'General',
        handler: async () => {
          if (!(await toast.undoLast())) toast.show('Nothing to undo');
        },
      },
      { keys: 'F', description: 'Toggle focus mode', group: 'General', handler: () => setFocus(!focus) },
    ],
    [navigate, focus],
  );

  if (loading) return <PageLoading />;
  if (workspaces.length === 0 || !current) {
    // An invitation link must open its own page, even before the person has a workspace.
    if (location.pathname.includes('/invite/')) return <>{children}</>;
    return <Onboarding />;
  }

  return (
    <div className="flex h-dvh min-h-0 flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:bg-surface focus:p-2">
        Skip to content
      </a>
      <TopBar
        onMenu={() => setNavOpen((o) => !o)}
        onQuickAdd={() => setQuickAdd(true)}
        sync={sync}
        searchRef={searchRef}
        hidden={focus}
        profileName={profile?.display_name ?? user?.email ?? ''}
        profileColor={profile?.avatar_color ?? 'teal'}
      />
      <div className="flex min-h-0 flex-1">
        {!focus && (
          <>
            <aside
              className={cn(
                'no-print scroll-thin z-30 w-60 shrink-0 overflow-y-auto border-r border-grid bg-surface',
                'fixed inset-y-0 left-0 top-12 transition-transform lg:static lg:translate-x-0',
                navOpen ? 'translate-x-0' : '-translate-x-full',
              )}
              aria-label="Main navigation"
            >
              <Sidebar />
            </aside>
            {navOpen && <div className="fixed inset-0 top-12 z-20 bg-[rgba(42,40,37,0.25)] lg:hidden" onClick={() => setNavOpen(false)} />}
          </>
        )}
        <main id="main" className="scroll-thin min-w-0 flex-1 overflow-auto">
          {focus && (
            <div className="no-print sticky top-0 z-10 flex items-center justify-between border-b border-grid bg-surface px-4 py-1.5 text-sm">
              <span className="text-secondary">Focus mode: navigation and notifications are hidden.</span>
              <Button size="sm" variant="ghost" onClick={() => setFocus(false)} icon={<X className="size-4" />}>
                Exit focus
              </Button>
            </div>
          )}
          {children}
        </main>
      </div>
      <QuickAddDialog open={quickAdd} onOpenChange={setQuickAdd} />
    </div>
  );
}

function SyncIndicator({ state }: { state: SyncState }) {
  const meta = {
    live: { dot: 'bg-good', label: 'Live' },
    connecting: { dot: 'bg-warning', label: 'Connecting' },
    offline: { dot: 'bg-critical', label: 'Offline' },
  }[state];
  return (
    <span
      className="hidden items-center gap-1.5 text-xs text-secondary sm:inline-flex"
      title={state === 'live' ? 'Changes from others appear automatically' : state === 'offline' ? 'Live updates paused. Data refreshes when you return to the tab.' : 'Connecting to live updates'}
    >
      <span className={cn('size-2 rounded-full', meta.dot)} aria-hidden />
      {meta.label}
    </span>
  );
}

function TopBar({
  onMenu,
  onQuickAdd,
  sync,
  searchRef,
  hidden,
  profileName,
  profileColor,
}: {
  onMenu: () => void;
  onQuickAdd: () => void;
  sync: SyncState;
  searchRef: React.RefObject<HTMLInputElement | null>;
  hidden: boolean;
  profileName: string;
  profileColor: import('@/data/types').Family;
}) {
  const navigate = useNavigate();
  const { signOut, user } = useAuth();
  const [q, setQ] = useState('');
  const notifications = useNotifications(!hidden);
  const unread = (notifications.data ?? []).filter((n) => !n.read_at).length;
  const timer = useRunningTimer(user?.id);
  const toast = useToast();
  const [theme, setTheme] = useState(() => resolvedTheme(readUiPrefs().theme));

  return (
    <header className="no-print flex h-12 shrink-0 items-center gap-2 border-b border-grid bg-surface px-2 sm:px-3">
      <IconButton label="Toggle navigation" className="lg:hidden" onClick={onMenu}>
        <MenuIcon className="size-5" />
      </IconButton>
      <Link to="/" className="mr-2 hidden sm:block" aria-label="Tessera home">
        <Logo />
      </Link>
      <Link to="/" className="sm:hidden" aria-label="Tessera home">
        <Logo compact />
      </Link>
      <form
        role="search"
        className="relative max-w-md flex-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) navigate(`/search?q=${encodeURIComponent(q.trim())}`);
        }}
      >
        <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
        <input
          ref={searchRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search tasks, projects, comments"
          aria-label="Search"
          className="h-8 w-full rounded-[4px] border border-grid bg-surface pl-8 pr-2 text-sm placeholder:text-muted focus:border-teal focus:outline-none"
        />
      </form>
      <div className="ml-auto flex items-center gap-1 sm:gap-2">
        {timer.data && (
          <Button
            size="sm"
            variant="secondary"
            icon={<Square className="size-3.5" />}
            title="Stop timer"
            onClick={() => stopTimer(timer.data!).then(() => toast.show('Timer stopped and time logged')).catch(toast.error)}
          >
            <Timer className="size-3.5" aria-hidden />
            <TimerClock since={timer.data.started_at!} />
            <span className="hidden max-w-[140px] truncate md:inline">{timer.data.cards?.title}</span>
          </Button>
        )}
        <SyncIndicator state={sync} />
        <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={onQuickAdd} title="Quick add (q)">
          <span className="hidden sm:inline">Add task</span>
        </Button>
        <Link
          to="/inbox"
          className="relative inline-flex size-8 items-center justify-center rounded-[4px] text-secondary hover:bg-hover"
          aria-label={unread ? `Inbox, ${unread} unread` : 'Inbox'}
        >
          <Bell className="size-4" />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-terracotta px-1 text-center text-[10px] leading-4 text-white">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </Link>
        <MenuRoot>
          <MenuTrigger asChild>
            <button className="flex items-center gap-1 rounded-[4px] p-1 hover:bg-hover" aria-label="Account menu">
              <Avatar name={profileName} color={profileColor} size={26} />
              <ChevronDown className="hidden size-3.5 text-muted sm:block" />
            </button>
          </MenuTrigger>
          <MenuContent>
            <MenuLabel>{profileName}</MenuLabel>
            <MenuItem icon={<Settings className="size-4" />} onSelect={() => navigate('/settings')}>
              Settings
            </MenuItem>
            <MenuItem
              icon={theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
              onSelect={() => {
                const next = theme === 'dark' ? 'light' : 'dark';
                applyUiPrefs({ theme: next });
                setTheme(next);
              }}
            >
              {theme === 'dark' ? 'Light theme' : 'Dark theme'}
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={<LogOut className="size-4" />} onSelect={() => signOut()}>
              Sign out
            </MenuItem>
          </MenuContent>
        </MenuRoot>
      </div>
    </header>
  );
}

function TimerClock({ since }: { since: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const secs = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return <span className="num">{h > 0 ? `${h}:${String(m).padStart(2, '0')}` : m}:{String(s).padStart(2, '0')}</span>;
}

function Sidebar() {
  const { current, workspaces, setCurrent } = useWorkspaceCtx();
  const navigate = useNavigate();
  const bookmarks = useBookmarks();
  const projects = useAllProjects();
  const notifications = useNotifications();
  const unread = (notifications.data ?? []).filter((n) => !n.read_at).length;
  const wsProjects = useMemo(
    () => (projects.data ?? []).filter((p) => p.workspace_id === current?.id && !p.personal_owner),
    [projects.data, current?.id],
  );

  return (
    <nav className="flex flex-col gap-4 p-3 text-sm">
      <MenuRoot>
        <MenuTrigger asChild>
          <button className="flex w-full items-center gap-2 rounded-[4px] border border-grid px-2 py-1.5 text-left hover:bg-hover">
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] text-secondary">Workspace</span>
              <span className="block truncate font-bold">{current?.name}</span>
            </span>
            <ChevronDown className="size-4 text-muted" />
          </button>
        </MenuTrigger>
        <MenuContent align="start">
          <MenuLabel>Switch workspace</MenuLabel>
          {workspaces.map((w) => (
            <MenuItem key={w.id} onSelect={() => setCurrent(w.id)} icon={w.id === current?.id ? <span>•</span> : null}>
              {w.name}
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuItem icon={<Plus className="size-4" />} onSelect={() => navigate('/workspace?new=1')}>
            New workspace
          </MenuItem>
        </MenuContent>
      </MenuRoot>

      <ul className="flex flex-col gap-0.5">
        {NAV.map((n) => (
          <li key={n.to}>
            <NavLink
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                cn(
                  'flex h-8 items-center gap-2.5 rounded-[4px] px-2 text-ink hover:bg-hover',
                  isActive && 'bg-selected font-bold',
                )
              }
            >
              <n.icon className="size-4 text-secondary" aria-hidden />
              <span className="flex-1">{n.label}</span>
              {n.to === '/inbox' && unread > 0 && <span className="num text-xs text-secondary">{unread}</span>}
            </NavLink>
          </li>
        ))}
      </ul>

      {(bookmarks.data?.length ?? 0) > 0 && (
        <div>
          <h2 className="mb-1 flex items-center gap-1.5 px-2 font-sans text-xs font-bold text-secondary">
            <BookMarked className="size-3.5" aria-hidden /> Bookmarks
          </h2>
          <ul className="flex flex-col gap-0.5">
            {bookmarks.data!.map((b) => (
              <li key={b.id} className="group flex items-center">
                {b.kind === 'url' ? (
                  <a href={b.url!} target="_blank" rel="noopener noreferrer" className="flex h-7 min-w-0 flex-1 items-center rounded-[4px] px-2 hover:bg-hover">
                    <span className="truncate">{b.label || b.url}</span>
                  </a>
                ) : (
                  <Link to={bookmarkHref(b)} className="flex h-7 min-w-0 flex-1 items-center rounded-[4px] px-2 hover:bg-hover">
                    <span className="truncate">{b.label}</span>
                  </Link>
                )}
                <button
                  aria-label={`Remove bookmark ${b.label}`}
                  className="invisible p-1 text-muted hover:text-ink group-hover:visible focus:visible"
                  onClick={() => removeBookmark(b.id)}
                >
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <div className="mb-1 flex items-center justify-between px-2">
          <h2 className="font-sans text-xs font-bold text-secondary">Projects</h2>
          <Link to="/projects?new=1" className="text-muted hover:text-ink" aria-label="New project">
            <Plus className="size-4" />
          </Link>
        </div>
        <ul className="flex flex-col gap-0.5">
          {wsProjects.map((p) => (
            <li key={p.id}>
              <NavLink
                to={`/p/${p.id}`}
                className={({ isActive }) => cn('flex h-7 items-center gap-2 rounded-[4px] px-2 hover:bg-hover', isActive && 'bg-selected')}
              >
                <span className={cn('size-2 shrink-0 rounded-[2px]', familyBar[p.color])} aria-hidden />
                <span className="truncate">{p.acronym || p.name}</span>
              </NavLink>
            </li>
          ))}
          {wsProjects.length === 0 && !projects.isLoading && <li className="px-2 text-xs text-secondary">No projects yet</li>}
        </ul>
      </div>
    </nav>
  );
}

export function bookmarkHref(b: { kind: string; target_id: string | null; project_id: string | null }): string {
  if (b.kind === 'project') return `/p/${b.target_id}`;
  if (b.kind === 'board') return `/p/${b.project_id}/board/${b.target_id}`;
  if (b.kind === 'card') return `/c/${b.target_id}`;
  return '/';
}
