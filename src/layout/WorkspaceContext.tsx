import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { useMyWorkspaces, type MyWorkspace } from '@/data/core';

interface WorkspaceCtx {
  workspaces: MyWorkspace[];
  current: MyWorkspace | null;
  setCurrent(id: string): void;
  loading: boolean;
  error: unknown;
}

const Ctx = createContext<WorkspaceCtx | null>(null);
const KEY = 'tessera.workspace';

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const q = useMyWorkspaces(user?.id);
  const [currentId, setCurrentId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  });

  const workspaces = useMemo(() => q.data ?? [], [q.data]);
  const current = workspaces.find((w) => w.id === currentId) ?? workspaces[0] ?? null;

  useEffect(() => {
    if (current && current.id !== currentId) setCurrentId(current.id);
  }, [current, currentId]);

  const setCurrent = useCallback((id: string) => {
    setCurrentId(id);
    try {
      localStorage.setItem(KEY, id);
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <Ctx.Provider value={{ workspaces, current, setCurrent, loading: q.isLoading, error: q.error }}>{children}</Ctx.Provider>
  );
}

export function useWorkspaceCtx(): WorkspaceCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useWorkspaceCtx outside provider');
  return c;
}
