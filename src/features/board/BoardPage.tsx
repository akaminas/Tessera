import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { CheckSquare, ChevronDown, Plus, Star, Users } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { useBoardData, useBoards } from '@/data/core';
import {
  createCard,
  createList,
  moveCard,
  moveList,
  moveListToBoard,
  setAssignee,
  setCardsArchived,
  updateCard,
  updateList,
} from '@/data/cards';
import { useBoardPresence } from '@/data/realtime';
import { toggleBookmark, useBookmarks } from '@/data/personal';
import { useProjectCtx } from '@/features/project/context';
import { Avatar, Button, ErrorNote, Input, PageLoading } from '@/components/ui';
import { MenuContent, MenuItem, MenuLabel, MenuRoot, MenuSeparator, MenuTrigger } from '@/components/ui/Menu';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';
import { matchesFilter, sortCards, type CardFilter } from '@/domain/cardFilter';
import { keysAfter, sortByPosition } from '@/domain/ordering';
import { generateNKeysBetween } from 'fractional-indexing';
import { useShortcuts } from '@/layout/shortcuts';
import type { CardWithRelations, List } from '@/data/types';
import { FilterBar } from '@/features/views/FilterBar';
import { BoardList, type ListActions } from './BoardList';
import { CardTileOverlay } from './CardTile';
import { BoardMenu } from './BoardMenu';
import { BulkBar } from './BulkBar';
import { NewBoardDialog } from './NewBoardDialog';
import { usePersistentState } from '@/lib/usePersistentState';
import { useWorkPackagesLite } from '@/data/lite';

const BACKGROUNDS: Record<string, string> = {
  plain: 'bg-surface',
  cream: 'bg-card',
  teal: 'bg-[color-mix(in_oklab,var(--v-teal-tint)_22%,var(--v-surface))]',
  indigo: 'bg-[color-mix(in_oklab,var(--v-indigo-tint)_22%,var(--v-surface))]',
  moss: 'bg-[color-mix(in_oklab,var(--v-moss-tint)_22%,var(--v-surface))]',
  ochre: 'bg-[color-mix(in_oklab,var(--v-ochre-tint)_22%,var(--v-surface))]',
  terracotta: 'bg-[color-mix(in_oklab,var(--v-terracotta-tint)_20%,var(--v-surface))]',
  mauve: 'bg-[color-mix(in_oklab,var(--v-mauve-tint)_20%,var(--v-surface))]',
};

export default function BoardPage() {
  const { boardId } = useParams();
  const ctx = useProjectCtx();
  const { project, people, canEdit, openCard } = ctx;
  const { user, profile } = useAuth();
  const me = user!.id;
  const boards = useBoards(project.id);
  const data = useBoardData(project.id, boardId);
  const wps = useWorkPackagesLite(project.id, ctx.has('workpackages'));
  const board = boards.data?.find((b) => b.id === boardId);
  const toast = useToast();
  const navigate = useNavigate();
  const bookmarks = useBookmarks();
  const presenceMe = useMemo(() => (profile ? { id: profile.id, name: profile.display_name } : null), [profile]);
  const others = useBoardPresence(boardId, presenceMe);
  const [filter, setFilter] = usePersistentState<CardFilter>(`board-filter:${boardId}`, {}, 'session');
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [hovered, setHovered] = useState<string | null>(null);
  const [editingCard, setEditingCard] = useState<string | null>(null);
  const [composerFor, setComposerFor] = useState<string | null>(null);
  const [newBoardOpen, setNewBoardOpen] = useState(false);
  const [addingList, setAddingList] = useState(false);
  const [listName, setListName] = useState('');
  const filterRef = useRef<HTMLInputElement>(null);

  const lists = useMemo(() => sortByPosition(data.data?.lists ?? []), [data.data?.lists]);
  const allCards = useMemo(() => data.data?.cards ?? [], [data.data?.cards]);
  const labelMap = useMemo(() => new Map((data.data?.labels ?? []).map((l) => [l.id, l])), [data.data?.labels]);
  const peopleMap = useMemo(() => new Map(people.map((p) => [p.user_id, p])), [people]);
  const parents = useMemo(() => new Map(allCards.map((c) => [c.id, c.title])), [allCards]);

  // Visible column contents (filtered, manual order)
  const derived = useMemo(() => {
    const cols: Record<string, string[]> = {};
    const totals: Record<string, number> = {};
    for (const l of lists) {
      const inList = sortCards(allCards.filter((c) => c.list_id === l.id), 'manual');
      totals[l.id] = inList.length;
      cols[l.id] = inList.filter((c) => matchesFilter(c, filter, me)).map((c) => c.id);
    }
    return { cols, totals };
  }, [lists, allCards, filter, me]);

  // During a drag we keep a local copy of the columns for live preview.
  const [dragCols, setDragCols] = useState<Record<string, string[]> | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const cols = dragCols ?? derived.cols;
  const cardById = useMemo(() => new Map(allCards.map((c) => [c.id, c])), [allCards]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const findContainer = useCallback(
    (id: string, source: Record<string, string[]>): string | null => {
      if (id.startsWith('col:')) return id.slice(4);
      if (id.startsWith('list:')) return id.slice(5);
      for (const [lid, ids] of Object.entries(source)) if (ids.includes(id)) return lid;
      return null;
    },
    [],
  );

  const onDragStart = (e: DragStartEvent) => {
    setActiveId(String(e.active.id));
    if (!String(e.active.id).startsWith('list:')) setDragCols(structuredClone(derived.cols));
  };

  const onDragOver = (e: DragOverEvent) => {
    const active = String(e.active.id);
    const over = e.over ? String(e.over.id) : null;
    if (!over || active.startsWith('list:') || !dragCols) return;
    const from = findContainer(active, dragCols);
    const to = findContainer(over, dragCols);
    if (!from || !to || from === to) return;
    setDragCols((prev) => {
      if (!prev) return prev;
      const next = { ...prev, [from]: prev[from].filter((x) => x !== active) };
      const target = [...prev[to]];
      const overIndex = target.indexOf(over);
      target.splice(overIndex >= 0 ? overIndex : target.length, 0, active);
      next[to] = target;
      return next;
    });
  };

  const onDragEnd = async (e: DragEndEvent) => {
    const active = String(e.active.id);
    const over = e.over ? String(e.over.id) : null;
    const snapshot = dragCols;
    setActiveId(null);
    if (active.startsWith('list:')) {
      setDragCols(null);
      if (!over || !over.startsWith('list:') || over === active) return;
      const list = lists.find((l) => `list:${l.id}` === active)!;
      const newIndex = lists.findIndex((l) => `list:${l.id}` === over);
      try {
        await moveList(list, newIndex, lists);
      } catch (err) {
        toast.error(err);
      }
      return;
    }
    if (!snapshot || !over) {
      setDragCols(null);
      return;
    }
    const to = findContainer(over, snapshot) ?? findContainer(active, snapshot);
    if (!to) {
      setDragCols(null);
      return;
    }
    const ids = [...snapshot[to]];
    const oldIndex = ids.indexOf(active);
    let newIndex = over.startsWith('col:') ? ids.length - 1 : ids.indexOf(over);
    if (newIndex < 0) newIndex = ids.length - 1;
    ids.splice(oldIndex, 1);
    ids.splice(newIndex, 0, active);
    setDragCols({ ...snapshot, [to]: ids });
    const card = cardById.get(active)!;
    const visibleSiblings = ids.map((id) => cardById.get(id)!).filter(Boolean);
    const index = ids.indexOf(active);
    if (card.list_id === to && derived.cols[to]?.indexOf(active) === index) {
      setDragCols(null);
      return;
    }
    const before = { list_id: card.list_id, position: card.position };
    try {
      const moved = await moveCard(card, to, index, visibleSiblings);
      if (card.list_id !== to) {
        const toName = lists.find((l) => l.id === to)?.name;
        toast.show(`Moved to ${toName}`, {
          undo: async () => {
            await updateCard(moved, before);
          },
        });
      }
    } catch (err) {
      toast.error(err);
    } finally {
      setDragCols(null);
    }
  };

  const listActions: ListActions = {
    rename: (l, name) => updateList(l, { name }).catch(toast.error),
    setWip: (l, wip_limit) => updateList(l, { wip_limit }).catch(toast.error),
    archive: async (l) => {
      try {
        const res = await updateList(l, { archived_at: new Date().toISOString() });
        toast.show(`Archived list “${l.name}”`, { undo: () => updateList(res, { archived_at: null }).then(() => undefined) });
      } catch (err) {
        toast.error(err);
      }
    },
    archiveCards: async (l) => {
      const cards = allCards.filter((c) => c.list_id === l.id);
      if (!cards.length) return;
      try {
        await setCardsArchived(cards, true);
        toast.show(`Archived ${cards.length} task${cards.length === 1 ? '' : 's'}`, {
          undo: async () => {
            const { fetchCard } = await import('@/data/cards');
            const fresh = (await Promise.all(cards.map((c) => fetchCard(c.id)))).filter(Boolean) as CardWithRelations[];
            await setCardsArchived(fresh, false);
          },
        });
      } catch (err) {
        toast.error(err);
      }
    },
    sort: async (l, by) => {
      const inList = allCards.filter((c) => c.list_id === l.id);
      const sorted = sortCards(inList, by === 'created' ? 'created' : by);
      const keys = generateNKeysBetween(null, null, sorted.length);
      try {
        for (let i = 0; i < sorted.length; i++) if (sorted[i].position !== keys[i]) await updateCard(sorted[i], { position: keys[i] });
        toast.show('List sorted');
      } catch (err) {
        toast.error(err);
      }
    },
    moveToBoard: (l, b) =>
      moveListToBoard(l, b)
        .then(() => toast.show('List moved'))
        .catch(toast.error),
    addCards: async (l, titles) => {
      const inList = allCards.filter((c) => c.list_id === l.id);
      const keys = keysAfter(inList, titles.length);
      try {
        for (let i = 0; i < titles.length; i++) {
          await createCard({ project_id: project.id, board_id: l.board_id, list_id: l.id, title: titles[i].slice(0, 500), position: keys[i] });
        }
      } catch (err) {
        toast.error(err);
      }
    },
    renameCard: (c, title) => updateCard(c, { title }).catch(toast.error),
  };

  const hoveredCard = hovered ? cardById.get(hovered) : undefined;
  const moveHovered = async (dir: -1 | 1) => {
    if (!hoveredCard || !canEdit) return;
    const idx = lists.findIndex((l) => l.id === hoveredCard.list_id);
    const target = lists[idx + dir];
    if (!target) return;
    const siblings = allCards.filter((c) => c.list_id === target.id);
    await moveCard(hoveredCard, target.id, siblings.length, siblings).catch(toast.error);
  };

  useShortcuts(
    [
      { keys: 'f', description: 'Focus the filter', group: 'Board', handler: () => filterRef.current?.focus() },
      { keys: 'x', description: 'Clear filters', group: 'Board', handler: () => setFilter({}) },
      { keys: 'Enter', description: 'Open hovered task', group: 'Card', handler: () => hoveredCard && openCard(hoveredCard.id) },
      { keys: 'e', description: 'Edit title of hovered task', group: 'Card', handler: () => hoveredCard && canEdit && setEditingCard(hoveredCard.id) },
      {
        keys: 'space',
        description: 'Assign or unassign yourself',
        group: 'Card',
        handler: () => {
          if (!hoveredCard || !canEdit) return;
          const on = !hoveredCard.card_assignees.some((a) => a.user_id === me);
          setAssignee(hoveredCard, me, on).catch(toast.error);
        },
      },
      {
        keys: 'd',
        description: 'Mark hovered task done / not done',
        group: 'Card',
        handler: () => hoveredCard && canEdit && updateCard(hoveredCard, { status: hoveredCard.status === 'done' ? 'open' : 'done' }).catch(toast.error),
      },
      {
        keys: 'c',
        description: 'Archive hovered task',
        group: 'Card',
        handler: async () => {
          if (!hoveredCard || !canEdit) return;
          try {
            await setCardsArchived([hoveredCard], true);
            toast.show(`Archived “${hoveredCard.title}”`, {
              undo: async () => {
                const { fetchCard } = await import('@/data/cards');
                const fresh = await fetchCard(hoveredCard.id);
                if (fresh) await setCardsArchived([fresh], false);
              },
            });
          } catch (err) {
            toast.error(err);
          }
        },
      },
      { keys: ',', description: 'Move hovered task to the previous list', group: 'Card', handler: () => moveHovered(-1) },
      { keys: '.', description: 'Move hovered task to the next list', group: 'Card', handler: () => moveHovered(1) },
      { keys: 'n', description: 'Add a task to the hovered list', group: 'Board', handler: () => canEdit && setComposerFor(hoveredCard?.list_id ?? lists[0]?.id ?? null) },
      { keys: 's', description: 'Toggle selection mode', group: 'Board', handler: () => setSelectMode((v) => !v) },
    ],
    [hoveredCard, lists, allCards, canEdit, me],
  );

  useEffect(() => {
    if (!selectMode) setSelected(new Set());
  }, [selectMode]);

  if (boards.isLoading || data.isLoading) return <PageLoading />;
  if (data.error) return <div className="p-6"><ErrorNote error={data.error} retry={() => data.refetch()} /></div>;
  if (!board) return <div className="p-6"><ErrorNote error={new Error('This board was deleted or you no longer have access.')} /></div>;

  const starred = (bookmarks.data ?? []).some((b) => b.kind === 'board' && b.target_id === board.id);
  const activeCard = activeId && !activeId.startsWith('list:') ? cardById.get(activeId) : undefined;
  const activeBoards = (boards.data ?? []).filter((b) => !b.archived_at);
  const selectedCards = [...selected].map((id) => cardById.get(id)).filter(Boolean) as CardWithRelations[];

  return (
    <div className={cn('flex h-full min-h-0 flex-col', BACKGROUNDS[board.background] ?? 'bg-surface')}>
      <div className="no-print flex flex-wrap items-center gap-2 border-b border-grid px-3 py-2 sm:px-5">
        <MenuRoot>
          <MenuTrigger asChild>
            <button className="flex items-center gap-1 rounded-[4px] px-1.5 py-1 hover:bg-hover" aria-label="Switch board">
              <h2 className="text-lg leading-none">{board.name}</h2>
              <ChevronDown className="size-4 text-muted" />
            </button>
          </MenuTrigger>
          <MenuContent align="start">
            <MenuLabel>Boards in this project</MenuLabel>
            {activeBoards.map((b) => (
              <MenuItem key={b.id} onSelect={() => navigate(`/p/${project.id}/board/${b.id}`)} icon={b.id === board.id ? <span>•</span> : null}>
                {b.name}
              </MenuItem>
            ))}
            {canEdit && (
              <>
                <MenuSeparator />
                <MenuItem icon={<Plus className="size-4" />} onSelect={() => setNewBoardOpen(true)}>
                  New board
                </MenuItem>
              </>
            )}
          </MenuContent>
        </MenuRoot>
        <button
          aria-label={starred ? 'Remove board bookmark' : 'Bookmark board'}
          className="rounded-[4px] p-1 hover:bg-hover"
          onClick={() => toggleBookmark({ kind: 'board', target_id: board.id, project_id: project.id, label: board.name }, !starred).catch(toast.error)}
        >
          <Star className={cn('size-4', starred ? 'fill-[var(--v-ochre)] text-ochre' : 'text-muted')} />
        </button>
        {others.length > 0 && (
          <span className="flex items-center gap-1 text-xs text-secondary" title={`Also viewing: ${others.map((o) => o.name).join(', ')}`}>
            <Users className="size-3.5" aria-hidden />
            {others.slice(0, 4).map((o) => (
              <Avatar key={o.id} name={o.name} color={peopleMap.get(o.id)?.avatar_color ?? 'indigo'} size={20} />
            ))}
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <FilterBar
            filter={filter}
            onChange={setFilter}
            people={people}
            labels={data.data?.labels}
            workPackages={wps.data}
            view="board"
            projectId={project.id}
            textRef={filterRef}
          />
          {canEdit && (
            <Button size="sm" variant={selectMode ? 'primary' : 'ghost'} icon={<CheckSquare className="size-3.5" />} onClick={() => setSelectMode((v) => !v)} aria-pressed={selectMode}>
              Select
            </Button>
          )}
          <BoardMenu board={board} labels={data.data?.labels ?? []} lists={lists} />
        </div>
      </div>

      {board.description && <p className="px-5 pt-2 text-sm text-secondary">{board.description}</p>}

      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={() => (setActiveId(null), setDragCols(null))}>
        <div className="scroll-thin flex min-h-0 flex-1 items-start gap-3 overflow-x-auto px-3 py-3 sm:px-5">
          <SortableContext items={lists.map((l) => `list:${l.id}`)} strategy={horizontalListSortingStrategy}>
            {lists.map((l: List) => (
              <BoardList
                key={l.id}
                list={l}
                cards={(cols[l.id] ?? []).map((id) => cardById.get(id)!).filter(Boolean)}
                totalCount={derived.totals[l.id] ?? 0}
                labels={labelMap}
                people={peopleMap}
                parents={parents}
                canEdit={canEdit}
                selectMode={selectMode}
                selected={selected}
                onToggleSelect={(id) =>
                  setSelected((s) => {
                    const n = new Set(s);
                    if (n.has(id)) n.delete(id);
                    else n.add(id);
                    if (!selectMode) setSelectMode(true);
                    return n;
                  })
                }
                onOpenCard={openCard}
                onHover={setHovered}
                actions={listActions}
                boards={activeBoards}
                editingCard={editingCard}
                setEditingCard={setEditingCard}
                composerOpen={composerFor === l.id}
                setComposerOpen={(v) => setComposerFor(v ? l.id : null)}
              />
            ))}
          </SortableContext>
          {canEdit && (
            <div className="w-[288px] shrink-0">
              {addingList ? (
                <form
                  className="flex flex-col gap-2 rounded-[6px] border border-grid bg-surface p-2"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (!listName.trim()) return;
                    try {
                      await createList(project.id, board.id, listName.trim(), lists);
                      setListName('');
                    } catch (err) {
                      toast.error(err);
                    }
                  }}
                >
                  <Input autoFocus value={listName} onChange={(e) => setListName(e.target.value)} placeholder="List name" aria-label="List name" maxLength={200} onKeyDown={(e) => e.key === 'Escape' && setAddingList(false)} />
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="primary" type="submit" disabled={!listName.trim()}>
                      Add list
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setAddingList(false)}>
                      Cancel
                    </Button>
                  </div>
                </form>
              ) : (
                <Button variant="ghost" className="w-full justify-start border border-dashed border-rule" icon={<Plus className="size-4" />} onClick={() => setAddingList(true)}>
                  Add a list
                </Button>
              )}
            </div>
          )}
        </div>
        <DragOverlay dropAnimation={null}>
          {activeCard ? <CardTileOverlay card={activeCard} labels={labelMap} people={peopleMap} onOpen={() => {}} /> : null}
        </DragOverlay>
      </DndContext>

      {selectMode && selectedCards.length > 0 && (
        <BulkBar cards={selectedCards} allCards={allCards} lists={lists} labels={data.data?.labels ?? []} people={people} onDone={() => setSelected(new Set())} />
      )}
      <NewBoardDialog open={newBoardOpen} onOpenChange={setNewBoardOpen} projectId={project.id} boards={boards.data ?? []} />
    </div>
  );
}
