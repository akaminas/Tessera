import { memo, useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AlignLeft, CheckSquare, Clock, CornerDownRight, MapPin, MessageSquare, Paperclip, Repeat, AlertCircle, CheckCircle2 } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { Avatar, PriorityMark, Tag, familyBar } from '@/components/ui';
import { cn } from '@/lib/cn';
import { dueState } from '@/domain/cardFilter';
import type { CardWithRelations, Label, LabelColor, Person } from '@/data/types';

export interface TileProps {
  card: CardWithRelations;
  labels: Map<string, Label>;
  people: Map<string, Person>;
  parentTitle?: string;
  selected?: boolean;
  selectMode?: boolean;
  onToggleSelect?: () => void;
  onOpen: () => void;
  onHover?: (id: string | null) => void;
  onRename?: (title: string) => void;
  editing?: boolean;
  onEditingChange?: (v: boolean) => void;
  dragDisabled?: boolean;
}

export function DueBadge({ due, status, time }: { due: string; status: CardWithRelations['status']; time?: string | null }) {
  const state = dueState(due, status);
  const label = format(parseISO(due), 'd MMM');
  const meta: Record<string, { cls: string; icon: React.ReactNode; word?: string }> = {
    done: { cls: 'text-good', icon: <CheckCircle2 className="size-3.5" aria-hidden />, word: 'Done' },
    overdue: { cls: 'text-critical', icon: <AlertCircle className="size-3.5" aria-hidden />, word: 'Overdue' },
    today: { cls: 'text-serious', icon: <Clock className="size-3.5" aria-hidden />, word: 'Today' },
    soon: { cls: 'text-secondary', icon: <Clock className="size-3.5" aria-hidden /> },
    later: { cls: 'text-secondary', icon: <Clock className="size-3.5" aria-hidden /> },
  };
  const m = meta[state] ?? meta.later;
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs', m.cls)} title={`Due ${format(parseISO(due), 'EEEE d MMMM yyyy')}${time ? ` ${time.slice(0, 5)}` : ''}`}>
      {m.icon}
      <span className="text-ink">
        {m.word && state !== 'today' ? `${m.word} · ` : ''}
        {state === 'today' ? 'Today' : label}
      </span>
    </span>
  );
}

function TileBody({ card, labels, people, parentTitle, editing, onRename, onEditingChange }: TileProps) {
  const [draft, setDraft] = useState(card.title);
  const items = card.checklist_items ?? [];
  const doneItems = items.filter((i) => i.done).length;
  const commentCount = card.comments?.[0]?.count ?? 0;
  const attachmentCount = card.attachments?.[0]?.count ?? 0;
  const cardLabels = card.card_labels.map((l) => labels.get(l.label_id)).filter(Boolean) as Label[];
  const assignees = card.card_assignees.map((a) => people.get(a.user_id)).filter(Boolean) as Person[];

  return (
    <>
      {card.cover_color && <div className={cn('-mx-3 -mt-2 mb-2 h-8 rounded-t-[7px]', familyBar[card.cover_color as LabelColor] ?? 'bg-rule')} />}
      {cardLabels.length > 0 && (
        <div className="mb-1 flex flex-wrap gap-1">
          {cardLabels.map((l) => (
            <Tag key={l.id} color={l.color} title={l.name}>
              {l.name || '   '}
            </Tag>
          ))}
        </div>
      )}
      {parentTitle && (
        <div className="mb-0.5 flex items-center gap-1 text-[11px] text-secondary">
          <CornerDownRight className="size-3" aria-hidden />
          <span className="truncate">{parentTitle}</span>
        </div>
      )}
      {editing ? (
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (draft.trim() && draft.trim() !== card.title) onRename?.(draft.trim());
              onEditingChange?.(false);
            }
            if (e.key === 'Escape') onEditingChange?.(false);
          }}
          onBlur={() => {
            if (draft.trim() && draft.trim() !== card.title) onRename?.(draft.trim());
            onEditingChange?.(false);
          }}
          aria-label="Task title"
          className="w-full resize-none rounded-[3px] border border-teal bg-surface p-1 text-sm focus:outline-none"
          rows={2}
        />
      ) : (
        <p className={cn('text-sm leading-snug break-words', card.status === 'done' && 'text-secondary line-through decoration-rule')}>
          {card.title}
        </p>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-secondary empty:hidden">
        {card.due_date && <DueBadge due={card.due_date} status={card.status} time={card.due_time} />}
        {card.status === 'blocked' && (
          <span className="inline-flex items-center gap-1 text-xs text-critical">
            <AlertCircle className="size-3.5" aria-hidden />
            <span className="text-ink">Blocked</span>
          </span>
        )}
        {/* The list already says where a task stands; only high and urgent priority earn a mark. */}
        {(card.priority === 'high' || card.priority === 'urgent') && <PriorityMark priority={card.priority} />}
        {card.recurrence && <Repeat className="size-3.5" aria-label="Repeats" />}
        {card.description?.trim() && <AlignLeft className="size-3.5" aria-label="Has description" />}
        {commentCount > 0 && (
          <span className="inline-flex items-center gap-0.5 text-xs" aria-label={`${commentCount} comments`}>
            <MessageSquare className="size-3.5" aria-hidden />
            <span className="num">{commentCount}</span>
          </span>
        )}
        {attachmentCount > 0 && (
          <span className="inline-flex items-center gap-0.5 text-xs" aria-label={`${attachmentCount} attachments`}>
            <Paperclip className="size-3.5" aria-hidden />
            <span className="num">{attachmentCount}</span>
          </span>
        )}
        {items.length > 0 && (
          <span
            className={cn('inline-flex items-center gap-0.5 text-xs', doneItems === items.length && 'text-good')}
            aria-label={`Checklist ${doneItems} of ${items.length} done`}
          >
            <CheckSquare className="size-3.5" aria-hidden />
            <span className="num text-ink">
              {doneItems}/{items.length}
            </span>
          </span>
        )}
        {card.lat != null && <MapPin className="size-3.5" aria-label="Has location" />}
        {assignees.length > 0 && (
          <span className="ml-auto flex -space-x-1">
            {assignees.slice(0, 3).map((p) => (
              <Avatar key={p.user_id} name={p.display_name} color={p.avatar_color} size={22} className="ring-2 ring-[var(--t-tile)]" />
            ))}
            {assignees.length > 3 && <span className="pl-1.5 text-xs">+{assignees.length - 3}</span>}
          </span>
        )}
      </div>
    </>
  );
}

export const SortableCardTile = memo(function SortableCardTile(props: TileProps) {
  const { card, onOpen, onHover, selectMode, selected, onToggleSelect, dragDisabled, editing } = props;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: { type: 'card', listId: card.list_id },
    disabled: dragDisabled || editing,
  });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
      data-card-id={card.id}
      aria-roledescription="Draggable task"
      aria-label={card.title}
      onMouseEnter={() => onHover?.(card.id)}
      onMouseLeave={() => onHover?.(null)}
      onFocus={() => onHover?.(card.id)}
      onClick={(e) => {
        if (editing) return;
        if (selectMode || e.shiftKey) {
          e.preventDefault();
          onToggleSelect?.();
        } else onOpen();
      }}
      onKeyDown={(e) => {
        if (editing) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        'group relative cursor-pointer list-none rounded-[8px] border bg-tile px-3 py-2 shadow-[var(--t-tile-shadow)] outline-none',
        'focus-visible:ring-2 focus-visible:ring-teal',
        selected ? 'border-teal ring-1 ring-teal' : 'border-transparent hover:border-teal',
        isDragging && 'opacity-40',
      )}
    >
      {selectMode && (
        <input
          type="checkbox"
          checked={selected}
          readOnly
          tabIndex={-1}
          aria-label={`Select ${card.title}`}
          className="absolute right-2 top-2 size-4 accent-[var(--v-teal-deep)]"
        />
      )}
      <TileBody {...props} />
    </li>
  );
});

export function CardTileOverlay(props: TileProps) {
  return (
    <div className="w-[256px] rotate-[2deg] cursor-grabbing rounded-[8px] border border-rule bg-tile px-3 py-2 shadow-[0_8px_16px_rgba(9,30,66,0.25)]">
      <TileBody {...props} />
    </div>
  );
}
