import { useState } from 'react';
import { Bookmark, Filter, Save, Search, Trash2, X } from 'lucide-react';
import { Button, Checkbox, Input, Select, Tag } from '@/components/ui';
import { Popover } from '@/components/ui/Menu';
import { useToast } from '@/components/ui/Toast';
import { isFilterActive, type CardFilter, type DueFilter } from '@/domain/cardFilter';
import { deleteView, saveView, useSavedViews, type SavedView } from '@/data/personal';
import type { CardStatus, Label, Person, Priority } from '@/data/types';
import { STATUS_LABEL, PRIORITY_LABEL } from '@/components/ui';

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

export function FilterBar({
  filter,
  onChange,
  people,
  labels,
  workPackages,
  view,
  projectId,
  extra,
  textRef,
}: {
  filter: CardFilter;
  onChange: (f: CardFilter) => void;
  people: Person[];
  labels?: Label[];
  workPackages?: { id: string; code: string; name: string }[];
  view: string;
  projectId?: string;
  extra?: React.ReactNode;
  textRef?: React.RefObject<HTMLInputElement | null>;
}) {
  const [open, setOpen] = useState(false);
  const active = isFilterActive(filter);
  const count =
    (filter.assignees?.length ?? 0) +
    (filter.labels?.length ?? 0) +
    (filter.status?.length ?? 0) +
    (filter.priority?.length ?? 0) +
    (filter.workPackages?.length ?? 0) +
    (filter.due && filter.due !== 'any' ? 1 : 0) +
    (filter.showDone === false ? 1 : 0);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-48 sm:w-60">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
        <Input
          ref={textRef}
          value={filter.text ?? ''}
          onChange={(e) => onChange({ ...filter, text: e.target.value })}
          placeholder="Filter tasks"
          aria-label="Filter tasks by text"
          className="h-8 pl-7 text-sm"
        />
      </div>
      <Button
        size="sm"
        variant={filter.assignees?.includes('me') ? 'primary' : 'secondary'}
        onClick={() => onChange({ ...filter, assignees: toggle(filter.assignees, 'me') })}
        aria-pressed={filter.assignees?.includes('me')}
      >
        My tasks
      </Button>
      <Popover
        open={open}
        onOpenChange={setOpen}
        className="w-[min(92vw,420px)]"
        trigger={
          <Button size="sm" icon={<Filter className="size-3.5" />} aria-label="More filters">
            Filters{count > 0 && <span className="num"> · {count}</span>}
          </Button>
        }
      >
        <div className="flex flex-col gap-3 text-sm">
          <fieldset>
            <legend className="mb-1 font-bold">Due</legend>
            <Select value={filter.due ?? 'any'} onChange={(e) => onChange({ ...filter, due: e.target.value as DueFilter })} className="h-8">
              {DUE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </fieldset>
          <fieldset>
            <legend className="mb-1 font-bold">Assigned to</legend>
            <div className="flex max-h-32 flex-col gap-1 overflow-y-auto">
              <Checkbox checked={filter.assignees?.includes('none') ?? false} onChange={() => onChange({ ...filter, assignees: toggle(filter.assignees, 'none') })} label="Nobody" />
              {people.map((p) => (
                <Checkbox
                  key={p.user_id}
                  checked={filter.assignees?.includes(p.user_id) ?? false}
                  onChange={() => onChange({ ...filter, assignees: toggle(filter.assignees, p.user_id) })}
                  label={p.display_name}
                />
              ))}
            </div>
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
                    <Tag color={l.color}>{l.name || 'Unnamed'}</Tag>
                  </button>
                ))}
              </div>
            </fieldset>
          )}
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
          <div className="flex items-center justify-between border-t border-grid pt-2">
            <Checkbox checked={filter.showDone !== false} onChange={(v) => onChange({ ...filter, showDone: v })} label="Show completed" />
            <Checkbox checked={filter.match === 'all'} onChange={(v) => onChange({ ...filter, match: v ? 'all' : 'any' })} label="Match all selected" />
          </div>
        </div>
      </Popover>
      {active && (
        <Button size="sm" variant="ghost" icon={<X className="size-3.5" />} onClick={() => onChange({})} title="Clear filters (x)">
          Clear
        </Button>
      )}
      <SavedFilters view={view} projectId={projectId} filter={filter} onApply={onChange} />
      {extra}
    </div>
  );
}

function SavedFilters({ view, projectId, filter, onApply }: { view: string; projectId?: string; filter: CardFilter; onApply: (f: CardFilter) => void }) {
  const views = useSavedViews({ projectId, view });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  const toast = useToast();
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button size="sm" variant="ghost" icon={<Bookmark className="size-3.5" />}>
          Saved views{views.data?.length ? <span className="num"> · {views.data.length}</span> : null}
        </Button>
      }
    >
      <div className="flex flex-col gap-2 text-sm">
        {(views.data ?? []).length === 0 && <p className="text-secondary">No saved views yet.</p>}
        <ul className="flex flex-col">
          {(views.data ?? []).map((v: SavedView) => (
            <li key={v.id} className="flex items-center gap-1">
              <button
                className="flex-1 truncate rounded-[3px] px-1.5 py-1 text-left hover:bg-hover"
                onClick={() => {
                  onApply((v.config.filter as CardFilter) ?? {});
                  setOpen(false);
                }}
              >
                {v.name}
                {v.shared && <span className="text-xs text-secondary"> · shared</span>}
              </button>
              <button aria-label={`Delete view ${v.name}`} className="p-1 text-muted hover:text-critical" onClick={() => deleteView(v).catch(toast.error)}>
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
        <form
          className="flex flex-col gap-2 border-t border-grid pt-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim()) return;
            try {
              await saveView({ name: name.trim(), view, project_id: projectId ?? null, config: { filter }, shared });
              setName('');
              toast.show('View saved');
            } catch (err) {
              toast.error(err);
            }
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name this view" className="h-8" aria-label="View name" />
          <div className="flex items-center justify-between">
            {projectId ? <Checkbox checked={shared} onChange={setShared} label="Share with project" /> : <span />}
            <Button size="sm" type="submit" icon={<Save className="size-3.5" />} disabled={!name.trim()}>
              Save current
            </Button>
          </div>
        </form>
      </div>
    </Popover>
  );
}
