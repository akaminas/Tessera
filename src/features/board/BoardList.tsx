import { useRef, useState } from 'react';
import { useSortable, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Archive, ArrowRightLeft, GripVertical, MoreHorizontal, Plus, SortAsc, Gauge } from 'lucide-react';
import { Button, IconButton, Input, Select } from '@/components/ui';
import { MenuContent, MenuItem, MenuLabel, MenuRoot, MenuSeparator, MenuTrigger } from '@/components/ui/Menu';
import { Dialog } from '@/components/ui/Dialog';
import { cn } from '@/lib/cn';
import type { Board, CardWithRelations, Label, List, Person } from '@/data/types';
import { SortableCardTile } from './CardTile';

export interface ListActions {
  rename(list: List, name: string): void;
  setWip(list: List, limit: number | null): void;
  archive(list: List): void;
  archiveCards(list: List): void;
  sort(list: List, by: 'due' | 'priority' | 'title' | 'created'): void;
  moveToBoard(list: List, boardId: string): void;
  /** Resolves with the titles that could not be saved (empty on success). */
  addCards(list: List, titles: string[], atTop?: boolean): Promise<string[]>;
  renameCard(card: CardWithRelations, title: string): void;
}

export function BoardList({
  list,
  cards,
  totalCount,
  labels,
  people,
  parents,
  canEdit,
  selectMode,
  selected,
  onToggleSelect,
  onOpenCard,
  onHover,
  actions,
  boards,
  editingCard,
  setEditingCard,
  composerOpen,
  setComposerOpen,
}: {
  list: List;
  cards: CardWithRelations[];
  totalCount: number;
  labels: Map<string, Label>;
  people: Map<string, Person>;
  parents: Map<string, string>;
  canEdit: boolean;
  selectMode: boolean;
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  onOpenCard: (id: string) => void;
  onHover: (id: string | null) => void;
  actions: ListActions;
  boards: Board[];
  editingCard: string | null;
  setEditingCard: (id: string | null) => void;
  composerOpen: boolean;
  setComposerOpen: (v: boolean) => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: `list:${list.id}`,
    data: { type: 'list' },
    disabled: !canEdit,
  });
  const { setNodeRef: setDropRef } = useDroppable({ id: `col:${list.id}`, data: { type: 'column', listId: list.id } });
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(list.name);
  const [wipOpen, setWipOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const overWip = list.wip_limit != null && totalCount > list.wip_limit;

  return (
    <section
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn('group/list flex max-h-full w-[272px] shrink-0 flex-col rounded-[12px] bg-list shadow-[var(--t-tile-shadow)]', isDragging && 'opacity-50')}
      aria-label={`List ${list.name}`}
    >
      {/* The whole header drags the list; the grip appears for keyboard users and on hover. */}
      <header className={cn('relative flex items-center gap-1 px-2 pt-2', canEdit && 'cursor-grab active:cursor-grabbing')}
        onPointerDown={(e) => {
          // Fields, buttons and menus inside the header keep their own behaviour.
          if (!canEdit || (e.target as HTMLElement).closest('input, textarea, button')) return;
          listeners?.onPointerDown?.(e);
        }}
      >
        {canEdit && (
          <button
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            className="absolute -left-0.5 top-2.5 rounded-[3px] p-0.5 text-muted opacity-0 hover:bg-hover focus-visible:opacity-100 group-hover/list:opacity-60"
            aria-label={`Reorder list ${list.name}`}
          >
            <GripVertical className="size-3.5" />
          </button>
        )}
        {renaming ? (
          <form
            className="flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim() && name.trim() !== list.name) actions.rename(list, name.trim());
              setRenaming(false);
            }}
          >
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => {
                if (name.trim() && name.trim() !== list.name) actions.rename(list, name.trim());
                setRenaming(false);
              }}
              onKeyDown={(e) => e.key === 'Escape' && setRenaming(false)}
              className="h-7 text-sm font-bold"
              aria-label="List name"
              maxLength={200}
            />
          </form>
        ) : (
          <h2
            className="min-w-0 flex-1 cursor-pointer truncate px-1.5 py-1 font-sans text-sm font-bold"
            onClick={() => canEdit && (setName(list.name), setRenaming(true))}
            title={list.name}
          >
            {list.name}
          </h2>
        )}
        {/* Counts appear only when they say something: a filter is hiding tasks, or a limit is set. */}
        {(cards.length !== totalCount || list.wip_limit != null) && (
          <span
            className={cn('num text-xs', overWip ? 'font-bold text-critical' : 'text-secondary')}
            title={list.wip_limit ? `Work-in-progress limit ${list.wip_limit}` : `${cards.length} of ${totalCount} tasks match the filter`}
          >
            {cards.length !== totalCount ? `${cards.length}/${totalCount}` : totalCount}
            {list.wip_limit ? ` / ${list.wip_limit}` : ''}
          </span>
        )}
        {canEdit && (
          <MenuRoot>
            <MenuTrigger asChild>
              <IconButton label={`List actions for ${list.name}`}>
                <MoreHorizontal className="size-4" />
              </IconButton>
            </MenuTrigger>
            <MenuContent>
              <MenuItem icon={<Plus className="size-4" />} onSelect={() => setComposerOpen(true)}>
                Add a task
              </MenuItem>
              <MenuItem onSelect={() => (setName(list.name), setRenaming(true))}>Rename list</MenuItem>
              <MenuItem icon={<Gauge className="size-4" />} onSelect={() => setWipOpen(true)}>
                Work-in-progress limit…
              </MenuItem>
              <MenuSeparator />
              <MenuLabel>Sort tasks by</MenuLabel>
              <MenuItem icon={<SortAsc className="size-4" />} onSelect={() => actions.sort(list, 'due')}>
                Due date
              </MenuItem>
              <MenuItem onSelect={() => actions.sort(list, 'priority')}>Priority</MenuItem>
              <MenuItem onSelect={() => actions.sort(list, 'title')}>Title</MenuItem>
              <MenuItem onSelect={() => actions.sort(list, 'created')}>Date created</MenuItem>
              <MenuSeparator />
              {boards.length > 1 && (
                <MenuItem icon={<ArrowRightLeft className="size-4" />} onSelect={() => setMoveOpen(true)}>
                  Move list to another board…
                </MenuItem>
              )}
              <MenuItem icon={<Archive className="size-4" />} onSelect={() => actions.archiveCards(list)}>
                Archive all tasks in this list
              </MenuItem>
              <MenuItem icon={<Archive className="size-4" />} onSelect={() => actions.archive(list)}>
                Archive this list
              </MenuItem>
            </MenuContent>
          </MenuRoot>
        )}
      </header>
      <div ref={setDropRef} className="scroll-thin min-h-10 flex-1 overflow-y-auto px-2 pb-1 pt-2">
        <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          <ul className="flex flex-col gap-2">
            {cards.map((c) => (
              <SortableCardTile
                key={c.id}
                card={c}
                labels={labels}
                people={people}
                parentTitle={c.parent_id ? parents.get(c.parent_id) : undefined}
                selectMode={selectMode}
                selected={selected.has(c.id)}
                onToggleSelect={() => onToggleSelect(c.id)}
                onOpen={() => onOpenCard(c.id)}
                onHover={onHover}
                dragDisabled={!canEdit}
                editing={editingCard === c.id}
                onEditingChange={(v) => setEditingCard(v ? c.id : null)}
                onRename={(t) => actions.renameCard(c, t)}
              />
            ))}
          </ul>
        </SortableContext>
      </div>
      {canEdit && (
        <div className="px-2 pb-2">
          {composerOpen ? (
            <Composer onSubmit={(titles) => actions.addCards(list, titles)} onClose={() => setComposerOpen(false)} />
          ) : (
            <Button size="sm" variant="ghost" className="w-full justify-start text-secondary hover:text-ink" icon={<Plus className="size-4" />} onClick={() => setComposerOpen(true)}>
              Add a task
            </Button>
          )}
        </div>
      )}
      <Dialog open={wipOpen} onOpenChange={setWipOpen} title="Work-in-progress limit" width={380}>
        <WipForm
          initial={list.wip_limit}
          onSave={(v) => {
            actions.setWip(list, v);
            setWipOpen(false);
          }}
        />
      </Dialog>
      <Dialog open={moveOpen} onOpenChange={setMoveOpen} title={`Move “${list.name}”`} width={380}>
        <MoveListForm
          boards={boards.filter((b) => b.id !== list.board_id && !b.archived_at)}
          onMove={(b) => {
            actions.moveToBoard(list, b);
            setMoveOpen(false);
          }}
        />
      </Dialog>
    </section>
  );
}

function WipForm({ initial, onSave }: { initial: number | null; onSave: (v: number | null) => void }) {
  const [v, setV] = useState(initial ? String(initial) : '');
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const n = parseInt(v, 10);
        onSave(Number.isFinite(n) && n > 0 ? n : null);
      }}
    >
      <p className="text-sm text-secondary">The count turns red when the list holds more tasks than this. Leave empty for no limit.</p>
      <Input type="number" min={1} value={v} onChange={(e) => setV(e.target.value)} aria-label="Limit" />
      <Button type="submit" variant="primary">
        Save
      </Button>
    </form>
  );
}

function MoveListForm({ boards, onMove }: { boards: Board[]; onMove: (id: string) => void }) {
  const [b, setB] = useState(boards[0]?.id ?? '');
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (b) onMove(b);
      }}
    >
      <p className="text-sm text-secondary">Labels and custom-field values are board-specific and are removed from moved tasks.</p>
      <Select value={b} onChange={(e) => setB(e.target.value)} aria-label="Target board">
        {boards.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name}
          </option>
        ))}
      </Select>
      <Button type="submit" variant="primary" disabled={!b}>
        Move list
      </Button>
    </form>
  );
}

/** Task composer. Pasting several lines offers to create one task per line. */
function Composer({ onSubmit, onClose }: { onSubmit: (titles: string[]) => Promise<string[]>; onClose: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/^[-*•]\s+/, '').trim())
    .filter(Boolean);
  const submit = async (multi: boolean) => {
    if (!lines.length || busy) return;
    const previous = text;
    // Clear at once so a second Enter cannot create duplicates; restore on failure.
    setText('');
    setBusy(true);
    try {
      const unsaved = await onSubmit(multi ? lines : [lines.join(' ')]);
      if (unsaved.length) setText((t) => t || unsaved.join('\n'));
      ref.current?.focus();
    } catch {
      setText((t) => t || previous);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-1.5">
      <textarea
        ref={ref}
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit(lines.length > 1);
          }
          if (e.key === 'Escape') onClose();
        }}
        placeholder="Task title. Paste several lines to add several tasks."
        aria-label="New task title"
        rows={2}
        className="w-full resize-none rounded-[6px] border border-teal bg-tile p-2 text-sm focus:outline-none"
      />
      <div className="flex items-center gap-1.5">
        <Button size="sm" variant="primary" loading={busy} disabled={!lines.length} onClick={() => submit(lines.length > 1)}>
          {lines.length > 1 ? `Add ${lines.length} tasks` : 'Add task'}
        </Button>
        {lines.length > 1 && (
          <Button size="sm" variant="ghost" onClick={() => submit(false)}>
            Add as one
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
