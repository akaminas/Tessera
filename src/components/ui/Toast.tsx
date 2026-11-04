import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { humanError } from '@/data/errors';

interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'error';
  undo?: () => Promise<void> | void;
  timeout: number;
}

interface ToastApi {
  show(message: string, opts?: { undo?: () => Promise<void> | void; timeout?: number }): void;
  error(err: unknown, fallback?: string): void;
  /** Undo the most recent undoable action (keyboard: z). */
  undoLast(): Promise<boolean>;
}

const Ctx = createContext<ToastApi | null>(null);
let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const undoStack = useRef<{ id: number; undo: () => Promise<void> | void }[]>([]);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const api = useMemo<ToastApi>(
    () => ({
      show(message, opts) {
        const id = nextId++;
        const toast: Toast = { id, message, tone: 'info', undo: opts?.undo, timeout: opts?.timeout ?? (opts?.undo ? 8000 : 4000) };
        if (opts?.undo) {
          undoStack.current.push({ id, undo: opts.undo });
          if (undoStack.current.length > 20) undoStack.current.shift();
        }
        setToasts((t) => [...t.slice(-3), toast]);
      },
      error(err, fallback) {
        const id = nextId++;
        const message = humanError(err) || fallback || 'Something went wrong.';
        setToasts((t) => [...t.slice(-3), { id, message, tone: 'error', timeout: 7000 }]);
      },
      async undoLast() {
        const last = undoStack.current.pop();
        if (!last) return false;
        await last.undo();
        setToasts((t) => t.filter((x) => x.id !== last.id));
        return true;
      },
    }),
    [],
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex w-[min(440px,calc(100vw-24px))] -translate-x-1/2 flex-col gap-2">
        {toasts.map((t) => (
          <ToastView
            key={t.id}
            toast={t}
            onDismiss={() => dismiss(t.id)}
            onUndo={async () => {
              undoStack.current = undoStack.current.filter((u) => u.id !== t.id);
              dismiss(t.id);
              try {
                await t.undo?.();
              } catch (err) {
                api.error(err);
              }
            }}
          />
        ))}
      </div>
    </Ctx.Provider>
  );
}

function ToastView({ toast, onDismiss, onUndo }: { toast: Toast; onDismiss: () => void; onUndo: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, toast.timeout);
    return () => clearTimeout(t);
  }, [onDismiss, toast.timeout]);
  return (
    <div
      role={toast.tone === 'error' ? 'alert' : 'status'}
      className="pointer-events-auto flex items-center gap-3 rounded-[4px] border border-rule bg-ink px-3 py-2 text-sm text-surface"
    >
      {toast.tone === 'error' && <span className="font-bold text-[var(--v-terracotta-tint)]">Not saved</span>}
      <span className="flex-1">{toast.message}</span>
      {toast.undo && (
        <button className="font-bold underline underline-offset-2" onClick={onUndo}>
          Undo
        </button>
      )}
      <button aria-label="Dismiss" onClick={onDismiss} className="opacity-70 hover:opacity-100">
        <X className="size-4" />
      </button>
    </div>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useToast outside ToastProvider');
  return ctx;
}
