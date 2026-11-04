import {
  forwardRef,
  useId,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, CircleDot, Loader2, OctagonAlert, Circle } from 'lucide-react';
import { cn } from '@/lib/cn';
import { humanError } from '@/data/errors';
import type { CardStatus, Family, LabelColor, Priority } from '@/data/types';

/* ------------------------------------------------------------------ Buttons */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'quiet';
type Size = 'sm' | 'md';

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-accent-ink border border-accent hover:opacity-90',
  secondary: 'bg-surface text-ink border border-rule hover:bg-hover',
  ghost: 'bg-transparent text-secondary border border-transparent hover:bg-hover hover:text-ink',
  quiet: 'bg-transparent text-ink border border-transparent hover:bg-hover',
  danger: 'bg-surface text-critical border border-rule hover:bg-hover',
};
const sizes: Record<Size, string> = {
  sm: 'h-7 px-2 text-[13px] gap-1',
  md: 'h-9 px-3 text-sm gap-1.5',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-[4px] whitespace-nowrap transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export const IconButton = forwardRef<HTMLButtonElement, ButtonProps & { label: string }>(function IconButton(
  { label, className, size = 'sm', variant = 'ghost', children, ...rest },
  ref,
) {
  return (
    <Button
      ref={ref}
      aria-label={label}
      title={label}
      variant={variant}
      size={size}
      className={cn(size === 'sm' ? 'w-7 px-0' : 'w-9 px-0', className)}
      {...rest}
    >
      {children}
    </Button>
  );
});

/* ------------------------------------------------------------------- Inputs */

const fieldBase =
  'w-full rounded-[4px] border border-rule bg-surface px-2.5 text-ink placeholder:text-muted focus:outline-none focus:border-teal focus:ring-1 focus:ring-teal disabled:opacity-60';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={cn(fieldBase, 'h-9', className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...rest }, ref) {
    return <textarea ref={ref} className={cn(fieldBase, 'min-h-[80px] py-2 leading-relaxed', className)} {...rest} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...rest },
  ref,
) {
  return (
    <select ref={ref} className={cn(fieldBase, 'h-9 pr-7', className)} {...rest}>
      {children}
    </select>
  );
});

export function Field({
  label,
  hint,
  error,
  children,
  className,
  htmlFor,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label htmlFor={htmlFor} className="text-[13px] font-bold text-ink">
        {label}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-secondary">{hint}</p>}
      {error && (
        <p className="text-xs text-critical" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  disabled,
  className,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className={cn('inline-flex items-center gap-2 select-none', disabled && 'opacity-60', className)}>
      <input
        id={id}
        type="checkbox"
        className="size-4 accent-[var(--v-teal-deep)]"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

/* ---------------------------------------------------------- Labels & badges */

/**
 * Labels use a pastel set. The stored names predate it, so each maps to a
 * display colour (teal is shown as sky, moss as green, and so on).
 */
const LABEL_VAR: Record<LabelColor, string> = {
  moss: 'green',
  ochre: 'yellow',
  terracotta: 'orange',
  red: 'red',
  mauve: 'purple',
  indigo: 'blue',
  teal: 'sky',
  lime: 'lime',
  pink: 'pink',
  grey: 'grey',
};
/** Display order and names, for colour pickers and unnamed labels. */
export const LABEL_COLORS: LabelColor[] = ['moss', 'ochre', 'terracotta', 'red', 'mauve', 'indigo', 'teal', 'lime', 'pink', 'grey'];
export const LABEL_NAME: Record<LabelColor, string> = {
  moss: 'Green',
  ochre: 'Yellow',
  terracotta: 'Orange',
  red: 'Red',
  mauve: 'Purple',
  indigo: 'Blue',
  teal: 'Sky',
  lime: 'Lime',
  pink: 'Pink',
  grey: 'Grey',
};
export function labelStyle(color: LabelColor): React.CSSProperties {
  const v = LABEL_VAR[color] ?? 'grey';
  return { background: `var(--lbl-${v})`, color: `var(--lbl-${v}-ink)` };
}
/** Solid colour bars (project colours, card covers) in the same pastel set. */
export const familyBar: Record<LabelColor, string> = {
  moss: 'bg-[var(--lbl-green)]',
  ochre: 'bg-[var(--lbl-yellow)]',
  terracotta: 'bg-[var(--lbl-orange)]',
  red: 'bg-[var(--lbl-red)]',
  mauve: 'bg-[var(--lbl-purple)]',
  indigo: 'bg-[var(--lbl-blue)]',
  teal: 'bg-[var(--lbl-sky)]',
  lime: 'bg-[var(--lbl-lime)]',
  pink: 'bg-[var(--lbl-pink)]',
  grey: 'bg-[var(--lbl-grey)]',
};

export function Tag({ color = 'grey', children, className, title }: { color?: LabelColor; children: ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      style={labelStyle(color)}
      className={cn('inline-flex h-5 min-w-10 max-w-full items-center truncate rounded-[4px] px-2 text-xs font-medium leading-5', className)}
    >
      {children}
    </span>
  );
}

export function Avatar({
  name,
  color = 'teal',
  size = 24,
  className,
}: {
  name: string;
  color?: Family;
  size?: number;
  className?: string;
}) {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join('') || '?';
  return (
    <span
      title={name}
      aria-label={name}
      className={cn('inline-flex shrink-0 items-center justify-center rounded-full font-semibold', className)}
      style={{ ...labelStyle(color), width: size, height: size, fontSize: Math.max(9, size * 0.4) }}
    >
      {initials}
    </span>
  );
}

export function AvatarStack({ people, max = 4, size = 22 }: { people: { name: string; color: Family }[]; max?: number; size?: number }) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <span className="inline-flex -space-x-1.5">
      {shown.map((p, i) => (
        <Avatar key={i} name={p.name} color={p.color} size={size} className="ring-2 ring-[var(--v-surface)]" />
      ))}
      {rest > 0 && (
        <span
          className="inline-flex items-center justify-center rounded-full bg-grid text-[10px] text-ink ring-2 ring-[var(--v-surface)]"
          style={{ width: size, height: size }}
        >
          +{rest}
        </span>
      )}
    </span>
  );
}

/* ------------------------------------------------------- Status & priority */

const statusMeta: Record<CardStatus, { label: string; icon: ReactNode; cls: string }> = {
  open: { label: 'Open', icon: <Circle className="size-3.5" aria-hidden />, cls: 'text-secondary' },
  in_progress: { label: 'In progress', icon: <CircleDot className="size-3.5" aria-hidden />, cls: 'text-teal-deep' },
  blocked: { label: 'Blocked', icon: <OctagonAlert className="size-3.5" aria-hidden />, cls: 'text-critical' },
  done: { label: 'Done', icon: <CheckCircle2 className="size-3.5" aria-hidden />, cls: 'text-good' },
};
export const STATUS_LABEL: Record<CardStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  blocked: 'Blocked',
  done: 'Done',
};

/** Status colours appear only on small marks with an icon and a word (Vellum). */
export function StatusPill({ status, className }: { status: CardStatus; className?: string }) {
  const m = statusMeta[status];
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs', m.cls, className)}>
      {m.icon}
      <span className="text-ink">{m.label}</span>
    </span>
  );
}

export const PRIORITY_LABEL: Record<Priority, string> = {
  none: 'No priority',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};

export function PriorityMark({ priority, withLabel }: { priority: Priority; withLabel?: boolean }) {
  if (priority === 'none') return null;
  const bars = { low: 1, medium: 2, high: 3, urgent: 3 }[priority];
  const color = priority === 'urgent' ? 'bg-critical' : priority === 'high' ? 'bg-serious' : 'bg-secondary';
  return (
    <span className="inline-flex items-center gap-1 text-xs text-ink" title={`Priority: ${PRIORITY_LABEL[priority]}`}>
      <span className="inline-flex items-end gap-[2px]" aria-hidden>
        {[1, 2, 3].map((i) => (
          <span key={i} className={cn('w-[3px] rounded-[1px]', i <= bars ? color : 'bg-grid')} style={{ height: 3 + i * 3 }} />
        ))}
      </span>
      {(withLabel || priority === 'urgent') && <span>{PRIORITY_LABEL[priority]}</span>}
    </span>
  );
}

/* ---------------------------------------------------------------- Feedback */

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-secondary">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      <span className="text-sm">{label}…</span>
    </span>
  );
}

export function PageLoading() {
  return (
    <div className="flex h-full min-h-[40vh] items-center justify-center">
      <Spinner />
    </div>
  );
}

export function ErrorNote({ error, retry }: { error: unknown; retry?: () => void }) {
  const msg = humanError(error);
  return (
    <div role="alert" className="flex items-start gap-2 rounded-[4px] border border-rule bg-card p-3 text-sm">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-serious" aria-hidden />
      <div className="flex-1">
        <p className="font-bold">Could not load this</p>
        <p className="text-secondary">{msg}</p>
      </div>
      {retry && (
        <Button size="sm" onClick={retry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-[4px] border border-dashed border-rule p-5">
      <p className="font-bold">{title}</p>
      {children && <div className="text-sm text-secondary">{children}</div>}
      {action}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex min-w-[1.4em] items-center justify-center rounded-[3px] border border-rule bg-card px-1 font-mono text-[11px] text-ink">
      {children}
    </kbd>
  );
}

/* --------------------------------------------------------------- Sections */

export function Section({
  id,
  title,
  actions,
  children,
  defaultOpen = true,
  collapsible = true,
  count,
}: {
  id?: string;
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  collapsible?: boolean;
  count?: number;
}) {
  const storageKey = id ? `tessera.section.${id}` : null;
  const [open, setOpen] = useState(() => {
    if (!storageKey) return defaultOpen;
    try {
      const v = localStorage.getItem(storageKey);
      return v === null ? defaultOpen : v === '1';
    } catch {
      return defaultOpen;
    }
  });
  const toggle = () => {
    setOpen((o) => {
      if (storageKey) {
        try {
          localStorage.setItem(storageKey, o ? '0' : '1');
        } catch {
          /* ignore */
        }
      }
      return !o;
    });
  };
  return (
    <section className="panel flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        {collapsible ? (
          <button type="button" onClick={toggle} aria-expanded={open} className="flex items-center gap-1 text-left">
            {open ? <ChevronDown className="size-4 text-muted" aria-hidden /> : <ChevronRight className="size-4 text-muted" aria-hidden />}
            <h2 className="text-base">{title}</h2>
          </button>
        ) : (
          <h2 className="text-base">{title}</h2>
        )}
        {count !== undefined && <span className="text-xs text-secondary num">{count}</span>}
        <div className="ml-auto flex items-center gap-1">{actions}</div>
      </div>
      {open && children}
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end gap-3 pb-1">
      <div className="min-w-0 flex-1">
        {eyebrow && <div className="text-xs text-secondary">{eyebrow}</div>}
        <h1 className="truncate text-2xl leading-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-secondary">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
