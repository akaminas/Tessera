import { useEffect, useState } from 'react';
import { Filter, Save, Search, Trash2, X } from 'lucide-react';
import { Button, Checkbox, Input, Select, Tag } from '@/components/ui';
import { Popover } from '@/components/ui/Menu';
import { useToast } from '@/components/ui/Toast';
import { isFilterActive, type CardFilter, type DueFilter } from '@/domain/cardFilter';
import { deleteView, saveView, useSavedViews, type SavedView } from '@/data/personal';
import type { CardStatus, Label, Person, Priority } from '@/data/types';
import { STATUS_LABEL, PRIORITY_LABEL, LABEL_NAME } from '@/components/ui';

const DUE_OPTIONS: { value: DueFilter; label: string }[] = [
  { value: 'any', label: 'Any date' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Due today' },
  { value: 'week', label: 'Due this week' },
  { value: 'month', label: 'Due this month' },
  { value: 'has', label: 'Has a due date' },
  { value: 'none', label: 'No due date' },
];

function toggle<T>(arr: T[] | undefined, v: T): T[] {
  const a = arr ?? [];
  return a.includes(v) ? a.filter((x) => x !== v) : [...a, v];
}

/**
 * One "Filter" button, as on a Trello board. Keyword, people, labels, dates and
 * saved filters all live in its popover; the button shows how many are active.
 */
export function FilterBar({
  filter,
  onChange,
  people,
  labels,
  workPackages,
  view,
  projectId,
  extra,
  openRef,
}: {
  filter: CardFilter;
  onChange: (f: CardFilter) => void;
  people: Person[];
  labels?: Label[];
  workPackages?: { id: string; code: string; name: string }[];
  view: string;
  projectId?: string;
  extra?: React.ReactNode;
  /** Receives a function that opens the filter (used by the `f` shortcut). */
  openRef?: React.MutableRefObject<(() => void) | null>;
}) {
  const [open, setOpen] = useState(false);
  const active = isFilterActive(filter);
  const count =
    (filter.text?.trim() ? 1 : 0) +
    (filter.assignees?.length ?? 0) +
    (filter.labels?.length ?? 0) +
    (filter.status?.length ?? 0) +
    (filter.priority?.length ?? 0) +
    (filter.workPackages?.length ?? 0) +
    (filter.due && filter.due !== 'any' ? 1 : 0) +
    (filter.showDone === false ? 1 : 0);

  useEffect(() => {
    if (!openRef) return;
    openRef.current = () => setOpen(true);
    return () => {
      openRef.current = null;
    };
  }, [openRef]);

  return (
    <div className="flex items-center gap-1">
      <Popover
        open={open}
        onOpenChange={setOpen}
        className="w-[min(92vw,380px)]"
        trigger={
          <Button size="sm" variant={active ? 'secondary' : 'ghost'} icon={<Filter className="size-3.5" />} aria-label="Filter tasks">
            Filter{count > 0 && <span className="num"> · {count}</span>}
          </Button>
        }
      >
        <div className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto text-sm">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input
              autoFocus
              value={filter.text ?? ''}
              onChange={(e) => onChange({ ...filter, text: e.target.value })}
              placeholder="Keyword"
              aria-label="Filter tasks by text"
              className="h-8 pl-7 text-sm"
            />
          </div>
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 font-bold">Members</legend>
            <Checkbox checked={filter.assignees?.includes('me') ?? false} onChange={() => onChange({ ...filter, assignees: toggle(filter.assignees, 'me') })} label="Assigned to me" />
            <Checkbox checked={filter.assignees?.includes('none') ?? false} onChange={() => onChange({ ...filter, assignees: toggle(filter.assignees, 'none') })} label="No members" />
            {people.length > 1 && (
              <div className="flex max-h-28 flex-col gap-1 overflow-y-auto">
                {people.map((p) => (
                  <Checkbox
                    key={p.user_id}
                    checked={filter.assignees?.includes(p.user_id) ?? false}
                    onChange={() => onChange({ ...filter, assignees: toggle(filter.assignees, p.user_id) })}
                    label={p.display_name}
                  />
                ))}
              </div>
            )}
          </fieldset>
          <fieldset>
            <legend className="mb-1 font-bold">Due date</legend>
            <Select value={filter.due ?? 'any'} onChange={(e) => onChange({ ...filter, due: e.target.value as DueFilter })} className="h-8" aria-label="Due date">
              {DUE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </fieldset>
          {labels && labels.length > 0 && (
            <fieldset>
              <legend className="mb-1 font-bold">Labels</legend>
              <div className="flex flex-wrap gap-1.5">
                {labels.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    aria-pressed={filter.labels?.includes(l.id)}
                    onClick={() => onChange({ ...filter, labels: toggle(filter.labels, l.id) })}
                    className={filter.labels?.includes(l.id) ? 'rounded-[3px] ring-2 ring-teal' : 'opacity-80 hover:opacity-100'}
                  >
                    <Tag color={l.color}>{l.name || LABEL_NAME[l.color]}</Tag>
                  </button>
                ))}
              </div>
            </fieldset>
          )}
          <details className="group" open={(filter.status?.length ?? 0) + (filter.priority?.length ?? 0) + (filter.workPackages?.length ?? 0) > 0}>
            <summary className="cursor-pointer select-none font-bold text-secondary hover:text-ink">More filters</summary>
            <div className="mt-2 flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <fieldset>
                  <legend className="mb-1 font-bold">Status</legend>
                  {(Object.keys(STATUS_LABEL) as CardStatus[]).map((s) => (
                    <Checkbox key={s} checked={filter.status?.includes(s) ?? false} onChange={() => onChange({ ...filter, status: toggle(filter.status, s) })} label={STATUS_LABEL[s]} />
                  ))}
                </fieldset>
                <fieldset>
                  <legend className="mb-1 font-bold">Priority</legend>
                  {(['urgent', 'high', 'medium', 'low', 'none'] as Priority[]).map((s) => (
                    <Checkbox key={s} checked={filter.priority?.includes(s) ?? false} onChange={() => onChange({ ...filter, priority: toggle(filter.priority, s) })} label={PRIORITY_LABEL[s]} />
                  ))}
                </fieldset>
              </div>
              {workPackages && workPackages.length > 0 && (
                <fieldset>
                  <legend className="mb-1 font-bold">Work package</legend>
                  <div className="flex max-h-28 flex-col gap-1 overflow-y-auto">
                    {workPackages.map((w) => (
                      <Checkbox
                        key={w.id}
                        checked={filter.workPackages?.includes(w.id) ?? false}
                        onChange={() => onChange({ ...filter, workPackages: toggle(filter.workPackages, w.id) })}
                        label={`${w.code} ${w.name}`}
                      />
                    ))}
                    <Checkbox checked={filter.workPackages?.includes('none') ?? false} onChange={() => onChange({ ...filter, workPackages: toggle(filter.workPackages, 'none') })} label="Not in a work package" />
                  </div>
                </fieldset>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Checkbox checked={filter.showDone !== false} onChange={(v) => onChange({ ...filter, showDone: v })} label="Show completed" />
                <Checkbox checked={filter.match === 'all'} onChange={(v) => onChange({ ...filter, match: v ? 'all' : 'any' })} label="Match all selected" />
              </div>
            </div>
          </details>
          <SavedFilters view={view} projectId={projectId} filter={filter} active={active} onApply={(f) => (onChange(f), setOpen(false))} />
        </div>
      </Popover>
      {active && (
        <Button size="sm" variant="ghost" icon={<X className="size-3.5" />} onClick={() => onChange({})} title="Clear filters (x)" aria-label="Clear filters" />
      )}
      {extra}
    </div>
  );
}

function SavedFilters({
  view,
  projectId,
  filter,
  active,
  onApply,
}: {
  view: string;
  projectId?: string;
  filter: CardFilter;
  active: boolean;
  onApply: (f: CardFilter) => void;
}) {
  const views = useSavedViews({ projectId, view });
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  const toast = useToast();
  const list = views.data ?? [];
  if (!list.length && !active) return null;
  return (
    <section className="flex flex-col gap-2 border-t border-grid pt-3">
      <h3 className="font-sans text-sm font-bold">Saved filters</h3>
      {list.length > 0 && (
        <ul className="flex flex-col">
          {list.map((v: SavedView) => (
            <li key={v.id} className="flex items-center gap-1">
              <button className="flex-1 truncate rounded-[3px] px-1.5 py-1 text-left hover:bg-hover" onClick={() => onApply((v.config.filter as CardFilter) ?? {})}>
                {v.name}
                {v.shared && <span className="text-xs text-secondary"> · shared</span>}
              </button>
              <button aria-label={`Delete saved filter ${v.name}`} className="p-1 text-muted hover:text-critical" onClick={() => deleteView(v).catch(toast.error)}>
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {active && (
        <form
          className="flex flex-col gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim()) return;
            try {
              await saveView({ name: name.trim(), view, project_id: projectId ?? null, config: { filter }, shared });
              setName('');
              toast.show('Filter saved');
            } catch (err) {
              toast.error(err);
            }
          }}
        >
          <div className="flex gap-1.5">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name this filter" className="h-8" aria-label="Filter name" />
            <Button size="sm" type="submit" icon={<Save className="size-3.5" />} disabled={!name.trim()}>
              Save
            </Button>
          </div>
          {projectId && <Checkbox checked={shared} onChange={setShared} label="Share with the project" />}
        </form>
      )}
    </section>
  );
}
