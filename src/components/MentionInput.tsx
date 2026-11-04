import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Avatar } from '@/components/ui';
import type { Person } from '@/data/types';

/** Extract mentioned user ids from text written with @[Name](user:uuid) tokens. */
export function extractMentions(text: string): string[] {
  const ids = new Set<string>();
  for (const m of text.matchAll(/@\[[^\]]+\]\(user:([0-9a-f-]{36})\)/gi)) ids.add(m[1]);
  return [...ids];
}

export interface MentionInputHandle {
  focus(): void;
}

/**
 * Textarea with @-mention autocomplete. Selecting a person inserts a token
 * that renders as a highlighted name and notifies that person on save.
 */
export const MentionInput = forwardRef<
  MentionInputHandle,
  {
    value: string;
    onChange: (v: string) => void;
    people: Person[];
    placeholder?: string;
    onSubmit?: () => void;
    rows?: number;
    ariaLabel?: string;
  }
>(function MentionInput({ value, onChange, people, placeholder, onSubmit, rows = 3, ariaLabel }, ref) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  useImperativeHandle(ref, () => ({ focus: () => ta.current?.focus() }));

  const matches = useMemo(() => {
    if (query === null) return [];
    const q = query.toLowerCase();
    return people.filter((p) => p.display_name.toLowerCase().includes(q) || (p.email ?? '').toLowerCase().startsWith(q)).slice(0, 6);
  }, [people, query]);

  const detect = (text: string, caret: number) => {
    const before = text.slice(0, caret);
    const m = before.match(/(?:^|\s)@([\p{L}\p{N}._-]{0,30})$/u);
    setQuery(m ? m[1] : null);
    setActive(0);
  };

  const insert = (p: Person) => {
    const el = ta.current!;
    const caret = el.selectionStart;
    const before = value.slice(0, caret).replace(/@([\p{L}\p{N}._-]{0,30})$/u, '');
    const token = `@[${p.display_name.replace(/[[\]]/g, '')}](user:${p.user_id}) `;
    const next = before + token + value.slice(caret);
    onChange(next);
    setQuery(null);
    requestAnimationFrame(() => {
      el.focus();
      const pos = (before + token).length;
      el.setSelectionRange(pos, pos);
    });
  };

  return (
    <div className="relative">
      <textarea
        ref={ta}
        value={value}
        rows={rows}
        aria-label={ariaLabel ?? 'Comment'}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          detect(e.target.value, e.target.selectionStart);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (query !== null && matches.length) {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => (a + 1) % matches.length);
              return;
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => (a - 1 + matches.length) % matches.length);
              return;
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault();
              insert(matches[active]);
              return;
            }
            if (e.key === 'Escape') {
              setQuery(null);
              return;
            }
          }
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            onSubmit?.();
          }
        }}
        className="w-full rounded-[4px] border border-rule bg-surface p-2 text-sm leading-relaxed placeholder:text-muted focus:border-teal focus:outline-none focus:ring-1 focus:ring-teal"
      />
      {query !== null && matches.length > 0 && (
        <ul role="listbox" aria-label="Mention someone" className="absolute left-2 top-full z-20 mt-1 w-64 rounded-[4px] border border-rule bg-surface p-1 text-sm">
          {matches.map((p, i) => (
            <li
              key={p.user_id}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                insert(p);
              }}
              className={`flex cursor-pointer items-center gap-2 rounded-[3px] px-2 py-1 ${i === active ? 'bg-hover' : ''}`}
            >
              <Avatar name={p.display_name} color={p.avatar_color} size={20} />
              <span className="truncate">{p.display_name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});
