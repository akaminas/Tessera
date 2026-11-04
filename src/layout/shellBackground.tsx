import { createContext, useContext, useEffect } from 'react';

/**
 * Lets a page (the board) put its background photo behind the whole app
 * frame, so the top bar and project header float over it.
 */
export const ShellBackgroundContext = createContext<(backgroundId: string | null) => void>(() => {});

export function useShellBackground(backgroundId: string | null) {
  const set = useContext(ShellBackgroundContext);
  useEffect(() => {
    set(backgroundId);
    return () => set(null);
  }, [set, backgroundId]);
}
