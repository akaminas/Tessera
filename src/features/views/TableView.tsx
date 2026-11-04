import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Columns3, CornerDownRight, Download, Pencil, UserPlus } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { useAuth } from '@/auth/AuthProvider';
import { useProjectCtx } from '@/features/project/context';
import { useProjectCards, useProjectStructure, updateCardEverywhere } from '@/data/views';
import { setAssignee } from '@/data/cards';
import { useWorkPackagesLite } from '@/data/lite';
import { keyAfterLast } from '@/domain/ordering';
import { matchesFilter, type CardFilter } from '@/domain/cardFilter';
import { usePersistentState } from '@/lib/usePersistentState';
import { downloadCSV, downloadXLSX, type Cell } from '@/lib/exporters';
import { Avatar, Button, Checkbox, EmptyState, ErrorNote, Input, PageLoading, Select, Tag, STATUS_LABEL, PRIORITY_LABEL, PriorityMark } from '@/components/ui';
import { MenuContent, MenuItem, MenuRoot, MenuTrigger, Popover } from '@/components/ui/Menu';
import { useToast } from '@/components/ui/Toast';
import { FilterBar } from './FilterBar';
import { BulkBar } from '@/features/board/BulkBar';
import { DueBadge } from '@/features/board/CardTile';
import { cn } from '@/lib/cn';
import type { CardStatus, CardWithRelations, Label, List, Priority } from '@/data/types';

type ColKey = 'title' | 'board' | 'list' | 'status' | 'priority' | 'assignees' | 'labels' | 'start' | 'due' | 'wp' | 'estimate' | 'updated';
type GroupKey = 'none' | 'list' | 'status' | 'assignee' | 'wp' | 'label';

const COLS: { key: ColKey; label: string; module?: 'workpackages' }[] = [
  { key: 'title', label: 'Task' },
  { key: 'board', label: 'Board' },
  { key: 'list', label: 'List' },
  { key: 'status', label: 'Status' },
  { key: 'priority', label: 'Priority' },
  { key: 'assignees', label: 'Assignees' },
  { key: 'labels', label: 'Labels' },
  { key: 'start', label: 'Start' },
  { key: 'due', label: 'Due' },
  { key: 'wp', label: 'Work package', module: 'workpackages' },
  { key: 'estimate', label: 'Estimate (h)' },
  { key: 'updated', label: 'Updated' },
];
const DEFAULT_HIDDEN: ColKey[] = ['estimate', 'updated', 'board'];
const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };
const STATUS_RANK: Record<CardStatus, number> = { blocked: 0, in_progress: 1, open: 2, done: 3 };

interface Row {
  card: CardWithRelations;
  depth: number;
}

export default function TableView() {
  const ctx = useProjectCtx();
  const { project, people, canEdit, openCard } = ctx;
  const { user } = useAuth();
  const me = user!.id;
  const toast = useToast();
  const cardsQ = useProjectCards(project.id);
  const structQ = useProjectStructure(project.id);
  const wps = useWorkPackagesLite(project.id, ctx.has('workpackages'));
  const [filter, setFilter] = usePersistentState<CardFilter>(`table-filter:${project.id}`, {}, 'session');
  const [sort, setSort] = usePersistentState<{ key: ColKey; dir: 'asc' | 'desc' }>(`table-sort:${project.id}`, { key: 'due', dir: 'asc' });
  const [group, setGroup] = usePersistentState<GroupKey>(`table-group:${project.id}`, 'none');
  const [hidden, setHidden] = usePersistentState<ColKey[]>(`table-cols:${project.id}`, DEFAULT_HIDDEN);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);

  const cards = useMemo(() => cardsQ.data ?? [], [cardsQ.data]);
  const boards = useMemo(() => structQ.data?.boards ?? [], [structQ.data]);
  const lists = useMemo(() => structQ.data?.lists ?? [], [structQ.data]);
  const labels = useMemo(() => structQ.data?.labels ?? [], [structQ.data]);
  const boardName = useMemo(() => new Map(boards.map((b) => [b.id, b.name])), [boards]);
  const listMap = useMemo(() => new Map(lists.map((l) => [l.id, l])), [lists]);
  const labelMap = useMemo(() => new Map(labels.map((l) => [l.id, l])), [labels]);
  const peopleMap = useMemo(() => new Map(people.map((p) => [p.user_id, p])), [people]);
  const wpMap = useMemo(() => new Map((wps.data ?? []).map((w) => [w.id, w])), [wps.data]);
  const visibleCols = COLS.filter((c) => !hidden.includes(c.key) && (!c.module || ctx.has(c.module)));
  const boardsShown = boards.length > 1;

  const visible = useMemo(() => cards.filter((c) => matchesFilter(c, filter, me) && listMap.has(c.list_id)), [cards, filter, me, listMap]);

  const sortValue = (c: CardWithRelations, key: ColKey): string | number => {
    switch (key) {
      case 'title':
        return c.title.toLowerCase();
      case 'board':
        return boardName.get(c.board_id) ?? '';
      case 'list': {
        const l = listMap.get(c.list_id);
        return `${boardName.get(c.board_id) ?? ''}\u0000${l?.position ?? ''}`;
      }
      case 'status':
        return STATUS_RANK[c.status];
      case 'priority':
        return PRIORITY_RANK[c.priority];
      case 'assignees':
        return c.card_assignees.map((a) => peopleMap.get(a.user_id)?.display_name ?? '').sort().join(',') || '￿';
      case 'labels':
        return c.card_labels.map((l) => labelMap.get(l.label_id)?.name ?? '').sort().join(',') || '￿';
      case 'start':
        return c.start_date ?? '￿';
      case 'due':
        return c.due_date ?? '￿';
      case 'wp':
        return (c.work_package_id && wpMap.get(c.work_package_id)?.code) || '￿';
      case 'estimate':
        return c.estimate_minutes ?? Number.MAX_SAFE_INTEGER;
      case 'updated':
        return c.updated_at;
    }
  };
  const cmp = (a: CardWithRelations, b: CardWithRelations) => {
    const va = sortValue(a, sort.key);
    const vb = sortValue(b, sort.key);
    const r = va < vb ? -1 : va > vb ? 1 : a.position < b.position ? -1 : a.position > b.position ? 1 : 0;
    // empty values stay last whichever the direction
    const emptyA = va === '￿' || va === Number.MAX_SAFE_INTEGER;
    const emptyB = vb === '￿' || vb === Number.MAX_SAFE_INTEGER;
    if (emptyA !== emptyB) return emptyA ? 1 : -1;
    return sort.dir === 'asc' ? r : -r;
  };

  /** Order a set of cards with subtasks indented below their parents. */
  const hierarchy = (set: CardWithRelations[]): Row[] => {
    const ids = new Set(set.map((c) => c.id));
    const children = new Map<string, CardWithRelations[]>();
    const roots: CardWithRelations[] = [];
    for (const c of set) {
      if (c.parent_id && ids.has(c.parent_id)) children.set(c.parent_id, [...(children.get(c.parent_id) ?? []), c]);
      else roots.push(c);
    }
    const out: Row[] = [];
    const walk = (c: CardWithRelations, depth: number, seen: Set<string>) => {
      if (seen.has(c.id)) return;
      seen.add(c.id);
      out.push({ card: c, depth });
      if (collapsed.has(c.id)) return;
      for (const k of [...(children.get(c.id) ?? [])].sort(cmp)) walk(k, depth + 1, seen);
    };
    const seen = new Set<string>();
    for (const r of [...roots].sort(cmp)) walk(r, 0, seen);
    return out;
  };
  const childCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of visible) if (c.parent_id) m.set(c.parent_id, (m.get(c.parent_id) ?? 0) + 1);
    return m;
  }, [visible]);

  const groups = useMemo((): { key: string; title: string; rows: Row[] }[] => {
    if (group === 'none') return [{ key: 'all', title: '', rows: hierarchy(visible) }];
    const buckets = new Map<string, { title: string; order: string; cards: CardWithRelations[] }>();
    const add = (key: string, title: string, order: string, c: CardWithRelations) => {
      const b = buckets.get(key) ?? { title, order, cards: [] };
      b.cards.push(c);
      buckets.set(key, b);
    };
    for (const c of visible) {
      if (group === 'list') {
        const l = listMap.get(c.list_id)!;
        add(l.id, boardsShown ? `${boardName.get(l.board_id)} · ${l.name}` : l.name, `${boardName.get(l.board_id)}\u0000${l.position}`, c);
      } else if (group === 'status') add(c.status, STATUS_LABEL[c.status], String(STATUS_RANK[c.status]), c);
      else if (group === 'assignee') {
        if (!c.card_assignees.length) add('none', 'Unassigned', '￿', c);
        for (const a of c.card_assignees) {
          const p = peopleMap.get(a.user_id);
          add(a.user_id, p?.display_name ?? 'Former member', p?.display_name ?? '￾', c);
        }
      } else if (group === 'wp') {
        const w = c.work_package_id ? wpMap.get(c.work_package_id) : undefined;
        add(w?.id ?? 'none', w ? `${w.code} ${w.name}` : 'No work package', w?.code ?? '￿', c);
      } else if (group === 'label') {
        if (!c.card_labels.length) add('none', 'No label', '￿', c);
        for (const l of c.card_labels) {
          const lb = labelMap.get(l.label_id);
          if (lb) add(lb.name || lb.color, lb.name || lb.color, lb.name || lb.color, c);
        }
      }
    }
    return [...buckets.entries()]
      .sort((a, b) => (a[1].order < b[1].order ? -1 : 1))
      .map(([key, b]) => ({ key, title: b.title, rows: hierarchy(b.cards) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, group, sort, collapsed, listMap, peopleMap, wpMap, labelMap, boardName, boardsShown]);

  const save = (card: CardWithRelations, patch: Partial<CardWithRelations>) =>
    updateCardEverywhere(card, patch).catch((err) => {
      toast.error(err);
    });

  const exportRows = (): { header: string[]; rows: Cell[][] } => {
    const header = ['Task', 'Parent', 'Board', 'List', 'Status', 'Priority', 'Assignees', 'Labels', 'Start', 'Due', ...(ctx.has('workpackages') ? ['Work package'] : []), 'Estimate (h)', 'Completed'];
    const rows = groups.flatMap((g) =>
      g.rows.map(({ card: c }) => [
        c.title,
        c.parent_id ? cards.find((x) => x.id === c.parent_id)?.title ?? '' : '',
        boardName.get(c.board_id) ?? '',
        listMap.get(c.list_id)?.name ?? '',
        STATUS_LABEL[c.status],
        PRIORITY_LABEL[c.priority],
        c.card_assignees.map((a) => peopleMap.get(a.user_id)?.display_name ?? '').join('; '),
        c.card_labels.map((l) => labelMap.get(l.label_id)?.name ?? '').join('; '),
        c.start_date ?? '',
        c.due_date ?? '',
        ...(ctx.has('workpackages') ? [(c.work_package_id && wpMap.get(c.work_package_id)?.code) || ''] : []),
        c.estimate_minutes != null ? +(c.estimate_minutes / 60).toFixed(2) : null,
        c.completed_at ? c.completed_at.slice(0, 10) : '',
      ]),
    );
    return { header, rows };
  };

  if (cardsQ.isLoading || structQ.isLoading) return <PageLoading />;
  if (cardsQ.error || structQ.error) return <div className="p-6"><ErrorNote error={cardsQ.error ?? structQ.error} retry={() => (cardsQ.refetch(), structQ.refetch())} /></div>;

  const allRows = groups.flatMap((g) => g.rows);
  const allSelected = allRows.length > 0 && allRows.every((r) => selected.has(r.card.id));
  const selectedCards = cards.filter((c) => selected.has(c.id));
  const bulkBoards = new Set(selectedCards.map((c) => c.board_id));
  const bulkLabels: Label[] = bulkBoards.size === 1 ? labels.filter((l) => bulkBoards.has(l.board_id)) : [];
  const bulkLists: List[] = lists.map((l) => (boardsShown ? { ...l, name: `${boardName.get(l.board_id)}: ${l.name}` } : l));
  const filename = `${(project.acronym || project.name).replace(/[^\w-]+/g, '_')}-tasks-${format(new Date(), 'yyyy-MM-dd')}`;

  const header = (c: (typeof COLS)[number]) => {
    const active = sort.key === c.key;
    return (
      <th key={c.key} scope="col" className={cn('whitespace-nowrap py-2 pr-3 text-left font-bold', c.key === 'title' && 'min-w-[260px]')} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
        <button className="inline-flex items-center gap-1 hover:underline" onClick={() => setSort({ key: c.key, dir: active && sort.dir === 'asc' ? 'desc' : 'asc' })}>
          {c.label}
          {active && (sort.dir === 'asc' ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />)}
        </button>
      </th>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="no-print flex flex-wrap items-center gap-2 border-b border-grid px-3 py-2 sm:px-5">
        <FilterBar filter={filter} onChange={setFilter} people={people} labels={labels} workPackages={wps.data} view="table" projectId={project.id} />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-sm">
            <span className="text-secondary">Group</span>
            <Select value={group} onChange={(e) => setGroup(e.target.value as GroupKey)} className="h-8 w-40" aria-label="Group by">
              <option value="none">None</option>
              <option value="list">List</option>
              <option value="status">Status</option>
              <option value="assignee">Assignee</option>
              {ctx.has('workpackages') && <option value="wp">Work package</option>}
              <option value="label">Label</option>
            </Select>
          </label>
          <Popover
            align="end"
            trigger={
              <Button size="sm" icon={<Columns3 className="size-3.5" />}>
                Columns
              </Button>
            }
          >
            <div className="flex flex-col gap-1">
              {COLS.filter((c) => c.key !== 'title' && (!c.module || ctx.has(c.module))).map((c) => (
                <Checkbox
                  key={c.key}
                  checked={!hidden.includes(c.key)}
                  onChange={(v) => setHidden(v ? hidden.filter((h) => h !== c.key) : [...hidden, c.key])}
                  label={c.label}
                />
              ))}
            </div>
          </Popover>
          <MenuRoot>
            <MenuTrigger asChild>
              <Button size="sm" icon={<Download className="size-3.5" />}>
                Export
              </Button>
            </MenuTrigger>
            <MenuContent>
              <MenuItem
                onSelect={() => {
                  const { header: h, rows } = exportRows();
                  downloadCSV(filename, [h, ...rows]);
                }}
              >
                CSV
              </MenuItem>
              <MenuItem
                onSelect={async () => {
                  try {
                    const { header: h, rows } = exportRows();
                    const est = h.indexOf('Estimate (h)');
                    await downloadXLSX(filename, [{ name: 'Tasks', header: h, rows, formats: h.map((_, i) => (i === est ? '0.00' : undefined)) }]);
                  } catch (err) {
                    toast.error(err);
                  }
                }}
              >
                Excel (.xlsx)
              </MenuItem>
            </MenuContent>
          </MenuRoot>
        </div>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-auto px-3 pb-20 sm:px-5">
        {allRows.length === 0 ? (
          <div className="py-6">
            <EmptyState title={cards.length ? 'No tasks match these filters' : 'No tasks yet'}>
              {cards.length ? 'Clear or change the filters to see more.' : 'Add tasks on a board; they appear here automatically.'}
            </EmptyState>
          </div>
        ) : (
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-surface">
              <tr className="border-b border-rule">
                {canEdit && (
                  <th className="w-8 py-2 pr-2">
                    <input
                      type="checkbox"
                      className="size-4 accent-[var(--v-teal-deep)]"
                      aria-label="Select all visible tasks"
                      checked={allSelected}
                      onChange={(e) => setSelected(e.target.checked ? new Set(allRows.map((r) => r.card.id)) : new Set())}
                    />
                  </th>
                )}
                {visibleCols.map(header)}
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <GroupRows key={g.key} title={g.title} count={g.rows.length} colSpan={visibleCols.length + (canEdit ? 1 : 0)}>
                  {g.rows.map(({ card: c, depth }) => (
                    <tr key={`${g.key}:${c.id}`} className={cn('group border-b border-grid hover:bg-hover', selected.has(c.id) && 'bg-selected')}>
                      {canEdit && (
                        <td className="py-1.5 pr-2 align-middle">
                          <input
                            type="checkbox"
                            className="size-4 accent-[var(--v-teal-deep)]"
                            aria-label={`Select ${c.title}`}
                            checked={selected.has(c.id)}
                            onChange={() =>
                              setSelected((s) => {
                                const n = new Set(s);
                                if (n.has(c.id)) n.delete(c.id);
                                else n.add(c.id);
                                return n;
                              })
                            }
                          />
                        </td>
                      )}
                      {visibleCols.map((col) => (
                        <td key={col.key} className="py-1.5 pr-3 align-middle">
                          {renderCell(col.key, c, depth)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </GroupRows>
              ))}
            </tbody>
          </table>
        )}
        <p className="py-2 text-xs text-secondary">
          <span className="num">{allRows.length}</span> of <span className="num">{cards.length}</span> tasks shown
        </p>
      </div>
      {canEdit && selectedCards.length > 0 && (
        <BulkBar cards={selectedCards} allCards={cards} lists={bulkLists} labels={bulkLabels} people={people} onDone={() => setSelected(new Set())} />
      )}
    </div>
  );

  function renderCell(key: ColKey, c: CardWithRelations, depth: number) {
    switch (key) {
      case 'title': {
        const kids = childCount.get(c.id) ?? 0;
        return (
          <div className="flex items-center gap-1" style={{ paddingLeft: depth * 18 }}>
            {kids > 0 ? (
              <button
                aria-label={collapsed.has(c.id) ? `Show subtasks of ${c.title}` : `Hide subtasks of ${c.title}`}
                aria-expanded={!collapsed.has(c.id)}
                className="text-muted hover:text-ink"
                onClick={() =>
                  setCollapsed((s) => {
                    const n = new Set(s);
                    if (n.has(c.id)) n.delete(c.id);
                    else n.add(c.id);
                    return n;
                  })
                }
              >
                {collapsed.has(c.id) ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
              </button>
            ) : depth > 0 ? (
              <CornerDownRight className="size-3.5 shrink-0 text-muted" aria-label="Subtask" />
            ) : (
              <span className="w-3.5" />
            )}
            {editing === c.id ? (
              <TitleInput
                initial={c.title}
                onDone={(t) => {
                  setEditing(null);
                  if (t && t !== c.title) save(c, { title: t });
                }}
              />
            ) : (
              <>
                <button className={cn('min-w-0 flex-1 truncate text-left hover:underline', c.status === 'done' && 'text-secondary line-through decoration-rule')} onClick={() => openCard(c.id)} title={c.title}>
                  {c.title}
                </button>
                {kids > 0 && <span className="num text-xs text-secondary">{kids}</span>}
                {canEdit && (
                  <button aria-label={`Rename ${c.title}`} className="text-muted opacity-0 hover:text-ink focus:opacity-100 group-hover:opacity-100" onClick={() => setEditing(c.id)}>
                    <Pencil className="size-3.5" />
                  </button>
                )}
              </>
            )}
          </div>
        );
      }
      case 'board':
        return <span className="text-secondary">{boardName.get(c.board_id)}</span>;
      case 'list':
        return canEdit ? (
          <Select
            value={c.list_id}
            aria-label={`List of ${c.title}`}
            className="h-7 w-40 text-[13px]"
            onChange={(e) => {
              const to = e.target.value;
              save(c, { list_id: to, position: keyAfterLast(cards.filter((x) => x.list_id === to && x.id !== c.id)) });
            }}
          >
            {boards.map((b) => (
              <optgroup key={b.id} label={b.name}>
                {lists
                  .filter((l) => l.board_id === b.id)
                  .map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </Select>
        ) : (
          <span>{listMap.get(c.list_id)?.name}</span>
        );
      case 'status':
        return canEdit ? (
          <Select value={c.status} aria-label={`Status of ${c.title}`} className="h-7 w-32 text-[13px]" onChange={(e) => save(c, { status: e.target.value as CardStatus })}>
            {(Object.keys(STATUS_LABEL) as CardStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        ) : (
          <span>{STATUS_LABEL[c.status]}</span>
        );
      case 'priority':
        return canEdit ? (
          <Select value={c.priority} aria-label={`Priority of ${c.title}`} className="h-7 w-28 text-[13px]" onChange={(e) => save(c, { priority: e.target.value as Priority })}>
            {(['none', 'low', 'medium', 'high', 'urgent'] as Priority[]).map((p) => (
              <option key={p} value={p}>
                {p === 'none' ? '—' : PRIORITY_LABEL[p]}
              </option>
            ))}
          </Select>
        ) : (
          <PriorityMark priority={c.priority} withLabel />
        );
      case 'assignees': {
        const ids = new Set(c.card_assignees.map((a) => a.user_id));
        const avatars = (
          <span className="flex -space-x-1">
            {[...ids].slice(0, 4).map((id) => {
              const p = peopleMap.get(id);
              return <Avatar key={id} name={p?.display_name ?? 'Former member'} color={p?.avatar_color ?? 'teal'} size={20} className="ring-2 ring-[var(--v-surface)]" />;
            })}
            {ids.size > 4 && <span className="pl-1.5 text-xs">+{ids.size - 4}</span>}
          </span>
        );
        if (!canEdit) return avatars;
        return (
          <Popover
            trigger={
              <button className="flex min-h-7 items-center gap-1 rounded-[3px] px-1 hover:bg-hover" aria-label={`Assignees of ${c.title}`}>
                {ids.size ? avatars : <UserPlus className="size-3.5 text-muted" />}
              </button>
            }
          >
            <ul className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
              {people.map((p) => (
                <li key={p.user_id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-[3px] px-1 py-1 hover:bg-hover">
                    <input type="checkbox" className="accent-[var(--v-teal-deep)]" checked={ids.has(p.user_id)} onChange={(e) => setAssignee(c, p.user_id, e.target.checked).catch(toast.error)} />
                    <Avatar name={p.display_name} color={p.avatar_color} size={20} />
                    <span className="truncate">{p.display_name}</span>
                  </label>
                </li>
              ))}
            </ul>
          </Popover>
        );
      }
      case 'labels':
        return (
          <span className="flex flex-wrap gap-1">
            {c.card_labels.map((l) => {
              const lb = labelMap.get(l.label_id);
              return lb ? (
                <Tag key={lb.id} color={lb.color}>
                  {lb.name || '  '}
                </Tag>
              ) : null;
            })}
          </span>
        );
      case 'start':
      case 'due': {
        const field = key === 'start' ? 'start_date' : 'due_date';
        const value = c[field];
        if (!canEdit)
          return key === 'due' && value ? <DueBadge due={value} status={c.status} /> : <span className="num">{value ? format(parseISO(value), 'd MMM yyyy') : '—'}</span>;
        return (
          <span className="flex items-center gap-1">
            <Input
              type="date"
              value={value ?? ''}
              aria-label={`${key === 'start' ? 'Start' : 'Due'} date of ${c.title}`}
              className="h-7 w-[136px] px-1.5 text-[13px]"
              onChange={(e) => {
                const v = e.target.value || null;
                const start = key === 'start' ? v : c.start_date;
                const due = key === 'due' ? v : c.due_date;
                if (start && due && due < start) {
                  toast.error(new Error('The due date must be on or after the start date.'));
                  return;
                }
                save(c, { [field]: v } as Partial<CardWithRelations>);
              }}
            />
            {key === 'due' && value && c.status !== 'done' && value < format(new Date(), 'yyyy-MM-dd') && <span className="text-xs text-critical">Overdue</span>}
          </span>
        );
      }
      case 'wp':
        return canEdit ? (
          <Select value={c.work_package_id ?? ''} aria-label={`Work package of ${c.title}`} className="h-7 w-28 text-[13px]" onChange={(e) => save(c, { work_package_id: e.target.value || null })}>
            <option value="">—</option>
            {(wps.data ?? []).map((w) => (
              <option key={w.id} value={w.id}>
                {w.code}
              </option>
            ))}
          </Select>
        ) : (
          <span>{(c.work_package_id && wpMap.get(c.work_package_id)?.code) || '—'}</span>
        );
      case 'estimate':
        return <span className="num">{c.estimate_minutes != null ? (c.estimate_minutes / 60).toFixed(c.estimate_minutes % 60 ? 2 : 0) : '—'}</span>;
      case 'updated':
        return <span className="num text-secondary">{format(parseISO(c.updated_at), 'd MMM yyyy')}</span>;
    }
  }
}

function GroupRows({ title, count, colSpan, children }: { title: string; count: number; colSpan: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  if (!title) return <>{children}</>;
  return (
    <>
      <tr className="border-b border-rule bg-card">
        <th colSpan={colSpan} scope="rowgroup" className="py-1.5 text-left">
          <button className="flex items-center gap-1 font-bold" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? <ChevronDown className="size-4 text-muted" /> : <ChevronRight className="size-4 text-muted" />}
            {title}
            <span className="num ml-1 text-xs font-normal text-secondary">{count}</span>
          </button>
        </th>
      </tr>
      {open && children}
    </>
  );
}

function TitleInput({ initial, onDone }: { initial: string; onDone: (t: string) => void }) {
  const [v, setV] = useState(initial);
  return (
    <Input
      autoFocus
      value={v}
      maxLength={500}
      aria-label="Task title"
      className="h-7 flex-1 text-sm"
      onChange={(e) => setV(e.target.value)}
      onBlur={() => onDone(v.trim())}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') onDone(v.trim());
        if (e.key === 'Escape') onDone(initial);
      }}
    />
  );
}
