import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { Kbd } from '@/components/ui';

/**
 * Keyboard shortcuts. Single keys act when focus is not in a text field;
 * "g" starts a two-key navigation sequence. All shortcuts can be turned off
 * in Settings → Preferences.
 */
export interface Shortcut {
  keys: string; // e.g. "q", "g h", "?"
  description: string;
  group: 'Navigation' | 'Board' | 'Card' | 'General';
  handler?: () => void;
}

interface Ctx {
  register(s: Shortcut[]): () => void;
  openHelp(): void;
  enabled: boolean;
  setEnabled(v: boolean): void;
}

const ShortcutCtx = createContext<Ctx | null>(null);

function isTyping(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}

export function ShortcutProvider({ children }: { children: ReactNode }) {
  const registry = useRef<Shortcut[][]>([]);
  const [helpOpen, setHelpOpen] = useState(false);
  const [enabled, setEnabledState] = useState(() => {
    try {
      return localStorage.getItem('tessera.shortcuts') !== 'off';
    } catch {
      return true;
    }
  });
  const [, force] = useState(0);
  const pendingG = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTyping(e.target)) return;
      if (document.querySelector('[role="dialog"]') && e.key !== 'Escape' && e.key !== '?') return;
      const all = registry.current.flat();
      let combo = e.key === ' ' ? 'space' : e.key;
      if (pendingG.current !== null) {
        window.clearTimeout(pendingG.current);
        pendingG.current = null;
        combo = `g ${combo}`;
      } else if (combo === 'g') {
        pendingG.current = window.setTimeout(() => (pendingG.current = null), 1200);
        e.preventDefault();
        return;
      }
      if (combo === '?') {
        e.preventDefault();
        setHelpOpen(true);
        return;
      }
      // latest registration wins (page-level overrides global)
      for (let i = all.length - 1; i >= 0; i--) {
        if (all[i].keys === combo && all[i].handler) {
          e.preventDefault();
          all[i].handler!();
          return;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);

  const ctx: Ctx = {
    register(s) {
      registry.current.push(s);
      force((n) => n + 1);
      return () => {
        registry.current = registry.current.filter((x) => x !== s);
      };
    },
    openHelp: () => setHelpOpen(true),
    enabled,
    setEnabled(v) {
      setEnabledState(v);
      try {
        localStorage.setItem('tessera.shortcuts', v ? 'on' : 'off');
      } catch {
        /* ignore */
      }
    },
  };

  const groups = new Map<string, Shortcut[]>();
  for (const s of [
    { keys: '?', description: 'Show this list', group: 'General' } as Shortcut,
    ...registry.current.flat(),
  ]) {
    const list = groups.get(s.group) ?? [];
    if (!list.some((x) => x.keys === s.keys)) list.push(s);
    groups.set(s.group, list);
  }

  return (
    <ShortcutCtx.Provider value={ctx}>
      {children}
      <Dialog open={helpOpen} onOpenChange={setHelpOpen} title="Keyboard shortcuts" width={640}>
        {!enabled && <p className="mb-3 text-sm text-secondary">Shortcuts are turned off. Turn them on in Settings → Preferences.</p>}
        <div className="grid gap-5 sm:grid-cols-2">
          {[...groups.entries()].map(([group, list]) => (
            <div key={group}>
              <h3 className="mb-1 text-sm">{group}</h3>
              <ul className="flex flex-col gap-1">
                {list.map((s) => (
                  <li key={s.keys} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-secondary">{s.description}</span>
                    <span className="flex gap-1">
                      {s.keys.split(' ').map((k, i) => (
                        <Kbd key={i}>{k}</Kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Dialog>
    </ShortcutCtx.Provider>
  );
}

export function useShortcuts(shortcuts: Shortcut[], deps: unknown[]) {
  const ctx = useContext(ShortcutCtx);
  useEffect(() => {
    if (!ctx) return;
    return ctx.register(shortcuts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export function useShortcutSettings() {
  const ctx = useContext(ShortcutCtx);
  return { enabled: ctx?.enabled ?? true, setEnabled: ctx?.setEnabled ?? (() => {}), openHelp: ctx?.openHelp ?? (() => {}) };
}
