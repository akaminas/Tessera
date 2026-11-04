import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router';
import {
  BookOpen,
  Bell,
  ChevronDown,
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
import { Avatar, Button, PageLoading, familyBar } from '@/components/ui';
import { MenuContent, MenuItem, MenuLabel, MenuRoot, MenuSeparator, MenuTrigger } from '@/components/ui/Menu';
import { cn } from '@/lib/cn';
import { startChangeFeed, type SyncState } from '@/data/realtime';
import { useBookmarks, useNotifications, useRunningTimer, stopTimer } from '@/data/personal';
import { useAllProjects } from '@/data/core';
import { applyUiPrefs, readUiPrefs, resolvedTheme } from '@/lib/prefs';
import { boardBackground } from '@/domain/backgrounds';
import { QuickAddDialog } from './QuickAdd';
import { Onboarding } from './Onboarding';
import { useToast } from '@/components/ui/Toast';
import { FocusProvider, useFocusMode } from './focus';
import { Tour } from './Tour';
import { ShellBackgroundContext } from './shellBackground';

/** Everything reachable from the top bar. Inbox is the bell; Settings is in the account menu. */
const NAV = [
  { to: '/', label: 'Home', end: true, keys: 'g h' },
  { to: '/my-work', label: 'My Work', keys: 'g m' },
  { to: '/projects', label: 'Projects', keys: 'g p' },
  { to: '/calendar', label: 'Calendar', keys: 'g c' },
  { to: '/reports', label: 'Reports', keys: 'g r' },
];
const MORE_SHORTCUTS = [
  { to: '/inbox', label: 'Inbox', keys: 'g i' },
  { to: '/workspace', label: 'Workspace', keys: 'g w' },
  { to: '/settings', label: 'Settings', keys: 'g s' },
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
  const [quickAdd, setQuickAdd] = useState(false);
  const [backgroundId, setBackgroundId] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const { focus, setFocus } = useFocusMode();
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user) return;
    return startChangeFeed(user.id, setSync);
  }, [user]);

  useShortcuts(
    [
      ...[...NAV, ...MORE_SHORTCUTS].map((n) => ({ keys: n.keys, description: `Go to ${n.label}`, group: 'Navigation' as const, handler: () => navigate(n.to) })),
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

  const bg = backgroundId ? boardBackground(backgroundId) : null;
  const onImage = Boolean(bg?.onImage);

  return (
    <ShellBackgroundContext.Provider value={setBackgroundId}>
      <div className={cn('flex h-dvh min-h-0 flex-col', onImage && 'shell-on-image')} style={onImage ? bg!.style : undefined}>
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:bg-surface focus:p-2">
          Skip to content
        </a>
        {!focus && (
          <TopBar
            onQuickAdd={() => setQuickAdd(true)}
            sync={sync}
            searchRef={searchRef}
            onImage={onImage}
            profileName={profile?.display_name ?? user?.email ?? ''}
            profileColor={profile?.avatar_color ?? 'teal'}
          />
        )}
        <main id="main" className={cn('scroll-thin min-h-0 min-w-0 flex-1 overflow-auto', !onImage && 'bg-canvas')}>
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
        <QuickAddDialog open={quickAdd} onOpenChange={setQuickAdd} />
        <Tour />
      </div>
    </ShellBackgroundContext.Provider>
  );
}

/** Silent while live updates work; speaks up only when they stop. */
function SyncIndicator({ state }: { state: SyncState }) {
  if (state !== 'offline') return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs" role="status" title="Live updates paused. Data refreshes when you return to the tab.">
      <span className="size-2 rounded-full bg-[var(--v-status-critical)]" aria-hidden />
      Offline
    </span>
  );
}

const barButton = 'inline-flex h-8 items-center gap-1 rounded-[6px] px-2.5 text-sm font-medium';

function TopBar({
  onQuickAdd,
  sync,
  searchRef,
  onImage,
  profileName,
  profileColor,
}: {
  onQuickAdd: () => void;
  sync: SyncState;
  searchRef: React.RefObject<HTMLInputElement | null>;
  onImage: boolean;
  profileName: string;
  profileColor: import('@/data/types').Family;
}) {
  const navigate = useNavigate();
  const { signOut, user } = useAuth();
  const [q, setQ] = useState('');
  const notifications = useNotifications(true);
  const unread = (notifications.data ?? []).filter((n) => !n.read_at).length;
  const timer = useRunningTimer(user?.id);
  const toast = useToast();
  const [theme, setTheme] = useState(() => resolvedTheme(readUiPrefs().theme));

  return (
    <header
      className={cn(
        'top-bar no-print relative z-20 flex h-12 shrink-0 items-center gap-1 px-2 sm:px-3',
        onImage ? 'bg-black/35 backdrop-blur-[3px]' : 'bg-bar',
      )}
    >
      <PhoneMenu />
      <Link to="/" className={cn(barButton, 'mr-1 px-1.5')} aria-label="Tessera home">
        <Logo onDark className="hidden sm:inline-flex" />
        <Logo onDark compact className="sm:hidden" />
      </Link>
      <WorkspaceMenu />

      <nav aria-label="Main" data-tour="nav" className="hidden items-center gap-0.5 lg:flex">
        {NAV.map((n) =>
          n.to === '/projects' ? (
            <ProjectsMenu key={n.to} />
          ) : (
            <NavLink key={n.to} to={n.to} end={n.end} className={barButton}>
              {n.label}
            </NavLink>
          ),
        )}
      </nav>

      <form
        role="search"
        data-tour="search"
        className="relative ml-auto min-w-0 flex-1 sm:w-56 sm:flex-none lg:w-64"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) navigate(`/search?q=${encodeURIComponent(q.trim())}`);
        }}
      >
        <Search className="bar-search-icon pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2" aria-hidden />
        <input
          ref={searchRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search"
          aria-label="Search"
          className="bar-search h-8 w-full rounded-[6px] border pl-8 pr-2 text-sm focus:outline-none"
        />
      </form>

      <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
        {timer.data && (
          <button
            className={barButton}
            title="Stop timer"
            onClick={() => stopTimer(timer.data!).then(() => toast.show('Timer stopped and time logged')).catch(toast.error)}
          >
            <Square className="size-3.5" aria-hidden />
            <Timer className="size-3.5" aria-hidden />
            <TimerClock since={timer.data.started_at!} />
            <span className="hidden max-w-[140px] truncate md:inline">{timer.data.cards?.title}</span>
          </button>
        )}
        <SyncIndicator state={sync} />
        <button className={cn(barButton, 'bar-cta')} onClick={onQuickAdd} title="Add a task (q)" data-tour="add-task">
          <Plus className="size-4" aria-hidden />
          <span className="hidden sm:inline">Add task</span>
          <span className="sr-only sm:hidden">Add task</span>
        </button>
        <Link to="/inbox" className={cn(barButton, 'relative w-8 justify-center px-0')} aria-label={unread ? `Inbox, ${unread} unread` : 'Inbox'} data-tour="inbox">
          <Bell className="size-4" />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-[var(--v-status-serious)] px-1 text-center text-[10px] font-semibold leading-4 text-white">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </Link>
        <MenuRoot>
          <MenuTrigger asChild>
            <button className="flex items-center gap-1 rounded-[6px] p-1" aria-label="Account menu" data-tour="account">
              <Avatar name={profileName} color={profileColor} size={26} />
              <ChevronDown className="hidden size-3.5 opacity-80 sm:block" />
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
            <MenuItem icon={<BookOpen className="size-4" />} onSelect={() => navigate('/guide')}>
              How to use Tessera
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

/** Current workspace: switch, open its members and settings, or start another. */
function WorkspaceMenu() {
  const { current, workspaces, setCurrent } = useWorkspaceCtx();
  const navigate = useNavigate();
  return (
    <MenuRoot>
      <MenuTrigger asChild>
        <button data-tour="workspace" className="hidden h-8 max-w-[12rem] items-center gap-1 rounded-[6px] px-2.5 text-sm font-medium md:inline-flex" aria-label={`Workspace: ${current?.name}`}>
          <span className="truncate">{current?.name}</span>
          <ChevronDown className="size-3.5 shrink-0 opacity-80" aria-hidden />
        </button>
      </MenuTrigger>
      <MenuContent align="start">
        <MenuLabel>Workspaces</MenuLabel>
        {workspaces.map((w) => (
          <MenuItem key={w.id} onSelect={() => setCurrent(w.id)} icon={w.id === current?.id ? <span aria-hidden>•</span> : null}>
            {w.name}
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem icon={<Users className="size-4" />} onSelect={() => navigate('/workspace')}>
          Members and settings
        </MenuItem>
        <MenuItem icon={<Plus className="size-4" />} onSelect={() => navigate('/workspace?new=1')}>
          New workspace
        </MenuItem>
      </MenuContent>
    </MenuRoot>
  );
}

function useWorkspaceProjectList() {
  const { current } = useWorkspaceCtx();
  const projects = useAllProjects();
  return useMemo(
    () => (projects.data ?? []).filter((p) => p.workspace_id === current?.id && !p.personal_owner && !p.archived_at),
    [projects.data, current?.id],
  );
}

/** "Projects ▾": jump to any project or bookmark, see all, or start one. */
function ProjectsMenu() {
  const navigate = useNavigate();
  const location = useLocation();
  const list = useWorkspaceProjectList();
  const bookmarks = useBookmarks();
  const active = location.pathname.startsWith('/projects') || location.pathname.startsWith('/p/');
  return (
    <MenuRoot>
      <MenuTrigger asChild>
        <button className={cn(barButton, active && 'bg-white/20')} data-tour="projects">
          Projects <ChevronDown className="size-3.5 opacity-80" aria-hidden />
        </button>
      </MenuTrigger>
      <MenuContent align="start" className="max-h-[70vh] w-72 overflow-y-auto">
        {list.length > 0 && <MenuLabel>Projects</MenuLabel>}
        {list.slice(0, 12).map((p) => (
          <MenuItem key={p.id} onSelect={() => navigate(`/p/${p.id}`)} icon={<span className={cn('size-3 rounded-[3px]', familyBar[p.color])} aria-hidden />}>
            <span className="truncate">{p.name}</span>
          </MenuItem>
        ))}
        {(bookmarks.data?.length ?? 0) > 0 && (
          <>
            <MenuSeparator />
            <MenuLabel>Bookmarks</MenuLabel>
            {bookmarks.data!.slice(0, 8).map((b) =>
              b.kind === 'url' ? (
                <MenuItem key={b.id} onSelect={() => window.open(b.url!, '_blank', 'noopener,noreferrer')}>
                  {b.label || b.url}
                </MenuItem>
              ) : (
                <MenuItem key={b.id} onSelect={() => navigate(bookmarkHref(b))}>
                  {b.label}
                </MenuItem>
              ),
            )}
          </>
        )}
        {list.length > 0 && <MenuSeparator />}
        <MenuItem onSelect={() => navigate('/projects')}>All projects</MenuItem>
        <MenuItem icon={<Plus className="size-4" />} onSelect={() => navigate('/projects?new=1')}>
          New project
        </MenuItem>
      </MenuContent>
    </MenuRoot>
  );
}

/** On narrow screens the navigation folds into one menu. */
function PhoneMenu() {
  const navigate = useNavigate();
  const { current, workspaces, setCurrent } = useWorkspaceCtx();
  const list = useWorkspaceProjectList();
  return (
    <MenuRoot>
      <MenuTrigger asChild>
        <button className={cn(barButton, 'w-8 justify-center px-0 lg:hidden')} aria-label="Toggle navigation">
          <MenuIcon className="size-5" />
        </button>
      </MenuTrigger>
      <MenuContent align="start" className="max-h-[80vh] w-64 overflow-y-auto">
        {[...NAV, { to: '/inbox', label: 'Inbox' }].map((n) => (
          <MenuItem key={n.to} onSelect={() => navigate(n.to)}>
            {n.label}
          </MenuItem>
        ))}
        {list.length > 0 && (
          <>
            <MenuSeparator />
            <MenuLabel>Projects</MenuLabel>
            {list.slice(0, 8).map((p) => (
              <MenuItem key={p.id} onSelect={() => navigate(`/p/${p.id}`)} icon={<span className={cn('size-3 rounded-[3px]', familyBar[p.color])} aria-hidden />}>
                <span className="truncate">{p.name}</span>
              </MenuItem>
            ))}
          </>
        )}
        <MenuSeparator />
        <MenuLabel>Workspace: {current?.name}</MenuLabel>
        {workspaces
          .filter((w) => w.id !== current?.id)
          .map((w) => (
            <MenuItem key={w.id} onSelect={() => setCurrent(w.id)}>
              Switch to {w.name}
            </MenuItem>
          ))}
        <MenuItem icon={<Users className="size-4" />} onSelect={() => navigate('/workspace')}>
          Members and settings
        </MenuItem>
      </MenuContent>
    </MenuRoot>
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

export function bookmarkHref(b: { kind: string; target_id: string | null; project_id: string | null }): string {
  if (b.kind === 'project') return `/p/${b.target_id}`;
  if (b.kind === 'board') return `/p/${b.project_id}/board/${b.target_id}`;
  if (b.kind === 'card') return `/c/${b.target_id}`;
  return '/';
}
