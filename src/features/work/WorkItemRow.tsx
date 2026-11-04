import { Link } from 'react-router';
import { format, parseISO } from 'date-fns';
import { CornerDownRight } from 'lucide-react';
import { PriorityMark, familyBar } from '@/components/ui';
import { DueBadge } from '@/features/board/CardTile';
import { useToast } from '@/components/ui/Toast';
import { sb } from '@/lib/supabase';
import { must } from '@/data/errors';
import { updateCard } from '@/data/cards';
import { queryClient } from '@/data/queryClient';
import type { Card } from '@/data/types';
import type { WorkItem } from '@/data/personal';
import { cn } from '@/lib/cn';

export function workHref(w: { project_id: string; board_id: string; card_id: string }) {
  return `/p/${w.project_id}/board/${w.board_id}?card=${w.card_id}`;
}

/** A single row in My Work / Home lists, with an inline completion checkbox. */
export function WorkItemRow({ item, showProject = true }: { item: WorkItem; showProject?: boolean }) {
  const toast = useToast();
  const done = item.status === 'done';
  const toggle = async () => {
    try {
      if (item.source === 'checklist_item') {
        must(await sb().from('checklist_items').update({ done: !done }).eq('id', item.checklist_item_id!));
      } else {
        const card = must(await sb().from('cards').select('*').eq('id', item.card_id).single()) as Card;
        const res = await updateCard(card, { status: done ? 'open' : 'done' });
        if (!done)
          toast.show(`Completed “${item.title}”`, {
            undo: async () => {
              await updateCard(res, { status: card.status });
            },
          });
      }
      queryClient.invalidateQueries({ queryKey: ['me', 'work'] });
    } catch (err) {
      toast.error(err);
    }
  };
  return (
    <li className="flex items-center gap-2.5 py-1.5">
      <input
        type="checkbox"
        className="size-4 shrink-0 accent-[var(--v-teal-deep)]"
        checked={done}
        onChange={toggle}
        aria-label={`${done ? 'Reopen' : 'Complete'} ${item.title}`}
      />
      <div className="min-w-0 flex-1">
        <Link to={workHref(item)} className={cn('block truncate text-sm hover:underline', done && 'text-secondary line-through')}>
          {item.source === 'checklist_item' && <CornerDownRight className="mr-1 inline size-3.5 text-secondary" aria-label="Checklist item" />}
          {item.title}
        </Link>
        {showProject && (
          <span className="flex items-center gap-1.5 truncate text-xs text-secondary">
            <span className={cn('size-1.5 rounded-[1px]', familyBar[item.project_color])} aria-hidden />
            {item.project_name} · {item.source === 'checklist_item' ? `in “${item.list_name}”` : item.list_name}
          </span>
        )}
      </div>
      <PriorityMark priority={item.priority} />
      {item.due_date ? (
        <DueBadge due={item.due_date} status={item.status} time={item.due_time} />
      ) : item.start_date ? (
        <span className="text-xs text-secondary">from {format(parseISO(item.start_date), 'd MMM')}</span>
      ) : null}
    </li>
  );
}
