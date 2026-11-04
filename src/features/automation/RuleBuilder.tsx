import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Button, Field, IconButton, Input, Select, Textarea } from '@/components/ui';
import { Dialog } from '@/components/ui/Dialog';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';
import {
  ACTION_LABEL,
  CONDITION_LABEL,
  EVENT_LABEL,
  KIND_LABEL,
  VALUELESS_FIELDS,
  actionsForKind,
  describeRule,
  emptyDraft,
  hasTaskContext,
  validateRule,
  type Action,
  type ActionType,
  type Condition,
  type ConditionField,
  type EventType,
  type RuleContext,
  type RuleDraft,
  type RuleKind,
  type Schedule,
} from '@/domain/automation';
import { saveRule } from '@/data/automation';
import type { Person } from '@/data/types';

export interface Structure {
  boards: { id: string; name: string }[];
  lists: { id: string; name: string; board_id: string; label: string }[];
  labels: { id: string; name: string; board_id: string; label: string }[];
  workPackages: { id: string; code: string; name: string }[];
}

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function timeZones(): string[] {
  try {
    const list = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone');
    if (list?.length) return list.includes('UTC') ? list : ['UTC', ...list];
  } catch {
    /* fall back below */
  }
  return ['UTC', 'Europe/London', 'Europe/Athens', 'Europe/Berlin', 'Europe/Paris', 'America/New_York'];
}

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const STATUSES = [
  ['open', 'Open'],
  ['in_progress', 'In progress'],
  ['blocked', 'Blocked'],
  ['done', 'Done'],
] as const;
const PRIORITIES = [
  ['none', 'No priority'],
  ['low', 'Low'],
  ['medium', 'Medium'],
  ['high', 'High'],
  ['urgent', 'Urgent'],
] as const;
const MILESTONE_STATUSES = ['planned', 'on_track', 'at_risk', 'delayed', 'done', 'cancelled'];

export function RuleBuilder({
  projectId,
  initial,
  structure,
  people,
  integrations,
  onClose,
}: {
  projectId: string;
  initial: RuleDraft;
  structure: Structure;
  people: Person[];
  integrations: { id: string; name: string }[];
  onClose: () => void;
}) {
  const [d, setD] = useState<RuleDraft>(initial);
  const [busy, setBusy] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const toast = useToast();

  // Lists/labels limited to the chosen board when the rule is board-scoped
  const lists = useMemo(() => structure.lists.filter((l) => !d.board_id || l.board_id === d.board_id), [structure.lists, d.board_id]);
  const labels = useMemo(() => structure.labels.filter((l) => !d.board_id || l.board_id === d.board_id), [structure.labels, d.board_id]);
  const ctx: RuleContext = useMemo(
    () => ({
      lists: structure.lists.map((l) => ({ id: l.id, name: l.name })),
      labels: structure.labels.map((l) => ({ id: l.id, name: l.name })),
      people: people.map((p) => ({ user_id: p.user_id, display_name: p.display_name })),
      integrations,
      workPackages: structure.workPackages,
    }),
    [structure, people, integrations],
  );
  const errors = useMemo(() => {
    const e = validateRule(d, { ...ctx, lists: lists.map((l) => ({ id: l.id, name: l.name })), labels: labels.map((l) => ({ id: l.id, name: l.name })) });
    return e;
  }, [d, ctx, lists, labels]);
  const allowedActions = actionsForKind(d.kind, d.trigger);
  const taskContext = hasTaskContext(d.kind, d.trigger);
  const set = (patch: Partial<RuleDraft>) => setD((x) => ({ ...x, ...patch }));

  const changeKind = (kind: RuleKind) => {
    const base = emptyDraft(kind, d.schedule?.tz ?? browserTimeZone());
    setD({ ...base, id: d.id, name: d.name, enabled: d.enabled, board_id: kind === 'scheduled' && d.trigger.scope !== 'cards' ? null : d.board_id });
  };

  const save = async () => {
    if (errors.length) {
      setShowErrors(true);
      return;
    }
    setBusy(true);
    try {
      await saveRule(projectId, d);
      toast.show(d.id ? 'Automation updated' : 'Automation created');
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={d.id ? 'Edit automation' : 'New automation'}
      width={760}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={save}>
            {d.id ? 'Save changes' : 'Create automation'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <Field label="Name" htmlFor="rule-name">
          <Input id="rule-name" value={d.name} onChange={(e) => set({ name: e.target.value })} maxLength={200} placeholder="e.g. Done list completes tasks" />
        </Field>

        <fieldset>
          <legend className="mb-1.5 text-[13px] font-bold">Kind</legend>
          <div className="grid gap-1.5 sm:grid-cols-5" role="radiogroup">
            {(Object.keys(KIND_LABEL) as RuleKind[]).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={d.kind === k}
                onClick={() => d.kind !== k && changeKind(k)}
                className={cn('rounded-[4px] border px-2 py-1.5 text-left text-xs', d.kind === k ? 'border-teal bg-accent-soft font-bold' : 'border-grid hover:bg-hover')}
              >
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
        </fieldset>

        {(taskContext || d.kind === 'rule') && structure.boards.length > 1 && (
          <Field label="Applies to" htmlFor="rule-board" hint="Board-specific automations only see that board’s lists and labels.">
            <Select id="rule-board" value={d.board_id ?? ''} onChange={(e) => set({ board_id: e.target.value || null })}>
              <option value="">All boards in this project</option>
              {structure.boards.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <section className="flex flex-col gap-2">
          <h3 className="text-sm">{d.kind === 'card_button' || d.kind === 'board_button' ? 'Button' : 'When'}</h3>
          <TriggerEditor d={d} set={set} lists={lists} labels={labels} people={people} />
        </section>

        {taskContext && (
          <section className="flex flex-col gap-2">
            <h3 className="text-sm">Only if the task… <span className="font-normal text-secondary">(optional)</span></h3>
            <ConditionsEditor
              conditions={d.conditions}
              onChange={(conditions) => set({ conditions })}
              lists={lists}
              labels={labels}
              people={people}
              workPackages={structure.workPackages}
            />
            {d.kind === 'board_button' && (
              <p className="text-xs text-secondary">
                With conditions, the actions run on every matching task on the board. Without conditions, only actions that do not need a task (create a task, notify, send to an integration) run.
              </p>
            )}
          </section>
        )}

        <section className="flex flex-col gap-2">
          <h3 className="text-sm">Then</h3>
          <ActionsEditor
            actions={d.actions}
            allowed={allowedActions}
            onChange={(actions) => set({ actions })}
            lists={lists}
            labels={labels}
            people={people}
            integrations={integrations}
            taskContext={taskContext}
          />
        </section>

        <section className="border-l-2 border-teal bg-card px-3 py-2 text-sm">
          <p className="text-xs text-secondary">In words</p>
          <p>{describeRule(d, ctx)}</p>
        </section>

        {showErrors && errors.length > 0 && (
          <ul role="alert" className="flex flex-col gap-0.5 text-sm text-critical">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}

/* ----------------------------------------------------------------- Trigger */

function TriggerEditor({
  d,
  set,
  lists,
  labels,
  people,
}: {
  d: RuleDraft;
  set: (p: Partial<RuleDraft>) => void;
  lists: Structure['lists'];
  labels: Structure['labels'];
  people: Person[];
}) {
  const t = d.trigger;
  const setT = (patch: Partial<RuleDraft['trigger']>) => set({ trigger: { ...t, ...patch } });

  if (d.kind === 'card_button')
    return <p className="text-sm text-secondary">A button appears in the side panel of every task{d.board_id ? ' on the chosen board' : ''}. Pressing it runs the actions on that task.</p>;
  if (d.kind === 'board_button') return <p className="text-sm text-secondary">A button appears in the board header{d.board_id ? ' of the chosen board' : ''}.</p>;

  if (d.kind === 'rule') {
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Event" htmlFor="tr-type">
          <Select id="tr-type" value={t.type ?? ''} onChange={(e) => set({ trigger: { type: e.target.value as EventType } })}>
            {(Object.keys(EVENT_LABEL) as EventType[]).map((ev) => (
              <option key={ev} value={ev}>
                {EVENT_LABEL[ev].replace(/^./, (c) => c.toUpperCase())}
              </option>
            ))}
          </Select>
        </Field>
        {t.type === 'card.moved' && (
          <>
            <Field label="To list (optional)" htmlFor="tr-to">
              <ListSelect id="tr-to" value={t.list_id} lists={lists} anyLabel="Any list" onChange={(v) => setT({ list_id: v })} />
            </Field>
            <Field label="From list (optional)" htmlFor="tr-from">
              <ListSelect id="tr-from" value={t.from_list} lists={lists} anyLabel="Any list" onChange={(v) => setT({ from_list: v })} />
            </Field>
          </>
        )}
        {t.type === 'card.created' && (
          <Field label="In list (optional)" htmlFor="tr-list">
            <ListSelect id="tr-list" value={t.list_id} lists={lists} anyLabel="Any list" onChange={(v) => setT({ list_id: v })} />
          </Field>
        )}
        {t.type === 'card.status_changed' && (
          <Field label="New status (optional)" htmlFor="tr-st">
            <Select id="tr-st" value={t.to ?? ''} onChange={(e) => setT({ to: e.target.value || undefined })}>
              <option value="">Any status</option>
              {STATUSES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {t.type === 'card.label_added' && (
          <Field label="Label (optional)" htmlFor="tr-lbl">
            <Select id="tr-lbl" value={t.label_id ?? ''} onChange={(e) => setT({ label_id: e.target.value || undefined })}>
              <option value="">Any label</option>
              {labels.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {t.type === 'card.assigned' && (
          <Field label="Person (optional)" htmlFor="tr-user">
            <Select id="tr-user" value={t.user_id ?? ''} onChange={(e) => setT({ user_id: e.target.value || undefined })}>
              <option value="">Anyone</option>
              {people.map((p) => (
                <option key={p.user_id} value={p.user_id}>
                  {p.display_name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {t.type === 'milestone.status_changed' && (
          <Field label="New status (optional)" htmlFor="tr-ms">
            <Select id="tr-ms" value={t.to ?? ''} onChange={(e) => setT({ to: e.target.value || undefined })}>
              <option value="">Any status</option>
              {MILESTONE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replace('_', ' ').replace(/^./, (c) => c.toUpperCase())}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
    );
  }

  if (d.kind === 'scheduled') {
    return (
      <div className="flex flex-col gap-2">
        <ScheduleEditor schedule={d.schedule!} onChange={(schedule) => set({ schedule })} />
        <Field label="Run the actions" htmlFor="tr-scope">
          <Select
            id="tr-scope"
            value={t.scope ?? 'once'}
            onChange={(e) => set({ trigger: { scope: e.target.value as 'once' | 'cards' }, actions: [], conditions: [] })}
          >
            <option value="once">Once (e.g. create a task, send a reminder)</option>
            <option value="cards">For each task matching the conditions</option>
          </Select>
        </Field>
      </div>
    );
  }

  // due_date
  const off = t.offset_days ?? 0;
  return (
    <div className="flex flex-col gap-2">
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="Watch" htmlFor="tr-target">
          <Select
            id="tr-target"
            value={t.target ?? 'cards'}
            onChange={(e) => set({ trigger: { target: e.target.value as 'cards' | 'milestones' | 'reporting_periods', offset_days: off }, actions: [], conditions: [] })}
          >
            <option value="cards">Task due dates</option>
            <option value="milestones">Milestone due dates</option>
            <option value="reporting_periods">Reporting period end dates</option>
          </Select>
        </Field>
        <Field label="Days" htmlFor="tr-days">
          <Input
            id="tr-days"
            type="number"
            min={0}
            max={365}
            value={Math.abs(off)}
            onChange={(e) => {
              const n = Math.max(0, Math.min(365, parseInt(e.target.value, 10) || 0));
              setT({ offset_days: off < 0 ? -n : n });
            }}
          />
        </Field>
        <Field label="Relative to the date" htmlFor="tr-rel">
          <Select id="tr-rel" value={off < 0 ? 'before' : off > 0 ? 'after' : 'on'} onChange={(e) => setT({ offset_days: e.target.value === 'before' ? -Math.abs(off || 1) : e.target.value === 'after' ? Math.abs(off || 1) : 0 })}>
            <option value="before">before</option>
            <option value="on">on the day</option>
            <option value="after">after (overdue)</option>
          </Select>
        </Field>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Check daily at" htmlFor="tr-time">
          <Input id="tr-time" type="time" value={d.schedule?.time ?? '08:00'} onChange={(e) => set({ schedule: { ...(d.schedule ?? { freq: 'daily', tz: browserTimeZone(), time: '08:00' }), freq: 'daily', time: e.target.value } })} />
        </Field>
        <TzField schedule={d.schedule ?? { freq: 'daily', time: '08:00', tz: browserTimeZone() }} onChange={(schedule) => set({ schedule })} />
      </div>
      <p className="text-xs text-secondary">Each task, milestone or period triggers the rule at most once for a given date.</p>
    </div>
  );
}

function ScheduleEditor({ schedule, onChange }: { schedule: Schedule; onChange: (s: Schedule) => void }) {
  return (
    <div className="grid gap-2 sm:grid-cols-4">
      <Field label="Repeat" htmlFor="sc-freq">
        <Select id="sc-freq" value={schedule.freq} onChange={(e) => onChange({ ...schedule, freq: e.target.value as Schedule['freq'], weekday: schedule.weekday ?? 0, monthday: schedule.monthday ?? 1 })}>
          <option value="daily">Every day</option>
          <option value="weekly">Every week</option>
          <option value="monthly">Every month</option>
        </Select>
      </Field>
      {schedule.freq === 'weekly' && (
        <Field label="On" htmlFor="sc-wd">
          <Select id="sc-wd" value={schedule.weekday ?? 0} onChange={(e) => onChange({ ...schedule, weekday: Number(e.target.value) })}>
            {DAYS.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {schedule.freq === 'monthly' && (
        <Field label="On day" htmlFor="sc-md">
          <Input id="sc-md" type="number" min={1} max={28} value={schedule.monthday ?? 1} onChange={(e) => onChange({ ...schedule, monthday: Number(e.target.value) })} />
        </Field>
      )}
      <Field label="At" htmlFor="sc-time">
        <Input id="sc-time" type="time" value={schedule.time} onChange={(e) => onChange({ ...schedule, time: e.target.value })} />
      </Field>
      <TzField schedule={schedule} onChange={onChange} />
    </div>
  );
}

function TzField({ schedule, onChange }: { schedule: Schedule; onChange: (s: Schedule) => void }) {
  const zones = useMemo(timeZones, []);
  return (
    <Field label="Time zone" htmlFor="sc-tz">
      <Select id="sc-tz" value={schedule.tz} onChange={(e) => onChange({ ...schedule, tz: e.target.value })}>
        {!zones.includes(schedule.tz) && <option value={schedule.tz}>{schedule.tz}</option>}
        {zones.map((z) => (
          <option key={z} value={z}>
            {z}
          </option>
        ))}
      </Select>
    </Field>
  );
}

function ListSelect({ id, value, lists, onChange, anyLabel, ariaLabel }: { id?: string; value?: string; lists: Structure['lists']; onChange: (v: string | undefined) => void; anyLabel?: string; ariaLabel?: string }) {
  return (
    <Select id={id} aria-label={ariaLabel} className={id ? undefined : 'h-8'} value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
      <option value="">{anyLabel ?? 'Choose a list'}</option>
      {lists.map((l) => (
        <option key={l.id} value={l.id}>
          {l.label}
        </option>
      ))}
    </Select>
  );
}

/* -------------------------------------------------------------- Conditions */

const CONDITION_FIELDS = Object.keys(CONDITION_LABEL) as ConditionField[];
const usesHas = (f: ConditionField) => f === 'label' || f === 'title_contains';

function ConditionsEditor({
  conditions,
  onChange,
  lists,
  labels,
  people,
  workPackages,
}: {
  conditions: Condition[];
  onChange: (c: Condition[]) => void;
  lists: Structure['lists'];
  labels: Structure['labels'];
  people: Person[];
  workPackages: Structure['workPackages'];
}) {
  const update = (i: number, patch: Partial<Condition>) => onChange(conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  return (
    <div className="flex flex-col gap-1.5">
      {conditions.map((c, i) => {
        const negated = c.op === 'is_not' || c.op === 'not_has';
        return (
          <div key={i} className="flex flex-wrap items-center gap-1.5">
            <Select
              aria-label="Condition"
              value={c.field}
              className="h-8 w-48"
              onChange={(e) => {
                const field = e.target.value as ConditionField;
                update(i, { field, op: usesHas(field) ? (negated ? 'not_has' : 'has') : negated ? 'is_not' : 'is', value: undefined });
              }}
            >
              {CONDITION_FIELDS.filter((f) => f !== 'work_package' || workPackages.length > 0).map((f) => (
                <option key={f} value={f}>
                  {CONDITION_LABEL[f]}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Match"
              value={negated ? 'not' : 'yes'}
              className="h-8 w-24"
              onChange={(e) => update(i, { op: e.target.value === 'not' ? (usesHas(c.field) ? 'not_has' : 'is_not') : usesHas(c.field) ? 'has' : 'is' })}
            >
              <option value="yes">yes</option>
              <option value="not">not</option>
            </Select>
            {!VALUELESS_FIELDS.includes(c.field) && (
              <ConditionValue c={c} onChange={(value) => update(i, { value })} lists={lists} labels={labels} people={people} workPackages={workPackages} />
            )}
            <IconButton label="Remove condition" onClick={() => onChange(conditions.filter((_, j) => j !== i))}>
              <Trash2 className="size-4" />
            </IconButton>
          </div>
        );
      })}
      <div>
        <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => onChange([...conditions, { field: 'list', op: 'is' }])}>
          Add condition
        </Button>
      </div>
    </div>
  );
}

function ConditionValue({
  c,
  onChange,
  lists,
  labels,
  people,
  workPackages,
}: {
  c: Condition;
  onChange: (v: string | undefined) => void;
  lists: Structure['lists'];
  labels: Structure['labels'];
  people: Person[];
  workPackages: Structure['workPackages'];
}) {
  const common = { className: 'h-8 min-w-0 flex-1', 'aria-label': 'Value', value: c.value ?? '', onChange: (e: React.ChangeEvent<HTMLSelectElement>) => onChange(e.target.value || undefined) };
  switch (c.field) {
    case 'list':
      return (
        <Select {...common}>
          <option value="">Choose…</option>
          {lists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </Select>
      );
    case 'label':
      return (
        <Select {...common}>
          <option value="">Choose…</option>
          {labels.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </Select>
      );
    case 'status':
      return (
        <Select {...common}>
          <option value="">Choose…</option>
          {STATUSES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
      );
    case 'priority':
      return (
        <Select {...common}>
          <option value="">Choose…</option>
          {PRIORITIES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
      );
    case 'assignee':
      return (
        <Select {...common}>
          <option value="">Choose…</option>
          <option value="none">Nobody (unassigned)</option>
          {people.map((p) => (
            <option key={p.user_id} value={p.user_id}>
              {p.display_name}
            </option>
          ))}
        </Select>
      );
    case 'work_package':
      return (
        <Select {...common}>
          <option value="">Choose…</option>
          {workPackages.map((w) => (
            <option key={w.id} value={w.id}>
              {w.code} {w.name}
            </option>
          ))}
        </Select>
      );
    default:
      return <Input className="h-8 min-w-0 flex-1" aria-label="Text" value={c.value ?? ''} onChange={(e) => onChange(e.target.value)} maxLength={200} />;
  }
}

/* ----------------------------------------------------------------- Actions */

function ActionsEditor({
  actions,
  allowed,
  onChange,
  lists,
  labels,
  people,
  integrations,
  taskContext,
}: {
  actions: Action[];
  allowed: ActionType[];
  onChange: (a: Action[]) => void;
  lists: Structure['lists'];
  labels: Structure['labels'];
  people: Person[];
  integrations: { id: string; name: string }[];
  taskContext: boolean;
}) {
  const update = (i: number, a: Action) => onChange(actions.map((x, j) => (j === i ? a : x)));
  const move = (i: number, dir: -1 | 1) => {
    const next = [...actions];
    const [x] = next.splice(i, 1);
    next.splice(i + dir, 0, x);
    onChange(next);
  };
  const usable = allowed.filter((a) => a !== 'webhook' || integrations.length > 0);
  return (
    <div className="flex flex-col gap-2">
      <ol className="flex flex-col gap-2">
        {actions.map((a, i) => (
          <li key={i} className="flex flex-col gap-1.5 rounded-[4px] border border-grid p-2">
            <div className="flex items-center gap-1.5">
              <span className="num w-5 text-xs text-secondary">{i + 1}.</span>
              <Select aria-label={`Action ${i + 1}`} className="h-8 min-w-0 flex-1" value={a.type} onChange={(e) => update(i, defaultAction(e.target.value as ActionType))}>
                {!usable.includes(a.type) && <option value={a.type}>{ACTION_LABEL[a.type]} (not available here)</option>}
                {usable.map((t) => (
                  <option key={t} value={t}>
                    {ACTION_LABEL[t]}
                  </option>
                ))}
              </Select>
              <IconButton label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                <ArrowUp className="size-4" />
              </IconButton>
              <IconButton label="Move down" disabled={i === actions.length - 1} onClick={() => move(i, 1)}>
                <ArrowDown className="size-4" />
              </IconButton>
              <IconButton label="Remove action" onClick={() => onChange(actions.filter((_, j) => j !== i))}>
                <Trash2 className="size-4" />
              </IconButton>
            </div>
            <ActionParams a={a} onChange={(x) => update(i, x)} lists={lists} labels={labels} people={people} integrations={integrations} taskContext={taskContext} />
          </li>
        ))}
      </ol>
      <div>
        <Button
          size="sm"
          variant="ghost"
          icon={<Plus className="size-3.5" />}
          disabled={actions.length >= 20}
          onClick={() => onChange([...actions, defaultAction(usable[0])])}
        >
          Add action
        </Button>
      </div>
    </div>
  );
}

function defaultAction(type: ActionType): Action {
  switch (type) {
    case 'set_status':
      return { type, status: 'done' };
    case 'set_priority':
      return { type, priority: 'high' };
    case 'assign':
      return { type, user: 'actor' };
    case 'set_due':
      return { type, days: 7 };
    case 'add_checklist':
      return { type, title: 'Checklist', items: [] };
    case 'notify':
      return { type, to: 'managers', title: '{rule}: {card}' };
    case 'create_card':
      return { type, title: '', due_in_days: 0 };
    default:
      return { type };
  }
}

function ActionParams({
  a,
  onChange,
  lists,
  labels,
  people,
  integrations,
  taskContext,
}: {
  a: Action;
  onChange: (a: Action) => void;
  lists: Structure['lists'];
  labels: Structure['labels'];
  people: Person[];
  integrations: { id: string; name: string }[];
  taskContext: boolean;
}) {
  const p = (patch: Partial<Action>) => onChange({ ...a, ...patch });
  const row = 'grid gap-1.5 pl-6 sm:grid-cols-2';
  switch (a.type) {
    case 'move_to_list':
      return (
        <div className={row}>
          <ListSelect ariaLabel="Target list" value={a.list_id} lists={lists} onChange={(v) => p({ list_id: v })} />
          <span className="self-center text-xs text-secondary">Moved tasks go to the bottom of the list.</span>
        </div>
      );
    case 'set_status':
      return (
        <div className={row}>
          <Select aria-label="Status" className="h-8" value={a.status ?? ''} onChange={(e) => p({ status: e.target.value })}>
            {STATUSES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </div>
      );
    case 'set_priority':
      return (
        <div className={row}>
          <Select aria-label="Priority" className="h-8" value={a.priority ?? ''} onChange={(e) => p({ priority: e.target.value })}>
            {PRIORITIES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </div>
      );
    case 'assign':
      return (
        <div className={row}>
          <Select aria-label="Who" className="h-8" value={a.user ?? ''} onChange={(e) => p({ user: e.target.value })}>
            <option value="actor">The person who triggered it</option>
            <option value="creator">The task’s creator</option>
            {people.map((x) => (
              <option key={x.user_id} value={x.user_id}>
                {x.display_name}
              </option>
            ))}
          </Select>
        </div>
      );
    case 'add_label':
    case 'remove_label':
      return (
        <div className={row}>
          <Select aria-label="Label" className="h-8" value={a.label_id ?? ''} onChange={(e) => p({ label_id: e.target.value || undefined })}>
            <option value="">Choose a label</option>
            {labels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </Select>
        </div>
      );
    case 'set_due':
      return (
        <div className="flex items-center gap-1.5 pl-6 text-sm">
          <span>Due</span>
          <Input aria-label="Days from today" type="number" min={0} max={365} className="h-8 w-20" value={a.days ?? 0} onChange={(e) => p({ days: parseInt(e.target.value, 10) || 0 })} />
          <span>days from the day it runs</span>
        </div>
      );
    case 'add_checklist':
      return (
        <div className="flex flex-col gap-1.5 pl-6">
          <Input aria-label="Checklist title" className="h-8" value={a.title ?? ''} onChange={(e) => p({ title: e.target.value })} placeholder="Checklist title" />
          <Textarea
            aria-label="Checklist items, one per line"
            rows={3}
            value={(a.items ?? []).join('\n')}
            onChange={(e) => p({ items: e.target.value.split('\n') })}
            placeholder="One item per line"
          />
        </div>
      );
    case 'add_comment':
      return (
        <div className="pl-6">
          <Textarea aria-label="Comment" rows={2} value={a.text ?? ''} onChange={(e) => p({ text: e.target.value })} placeholder="The comment is posted as an automation." />
        </div>
      );
    case 'create_card':
      return (
        <div className="flex flex-col gap-1.5 pl-6">
          <div className="grid gap-1.5 sm:grid-cols-2">
            <Input aria-label="New task title" className="h-8" value={a.title ?? ''} onChange={(e) => p({ title: e.target.value })} placeholder="Title ({date} inserts today’s date)" />
            <ListSelect ariaLabel="List for the new task" value={a.list_id} lists={lists} onChange={(v) => p({ list_id: v })} />
          </div>
          <div className="grid gap-1.5 sm:grid-cols-2">
            <label className="flex items-center gap-1.5 text-sm">
              Due in
              <Input
                type="number"
                min={0}
                max={365}
                className="h-8 w-20"
                value={a.due_in_days ?? ''}
                onChange={(e) => p({ due_in_days: e.target.value === '' ? undefined : parseInt(e.target.value, 10) })}
                aria-label="Due in days"
              />
              days
            </label>
            <Select aria-label="Assign to" className="h-8" value={a.assign_to ?? ''} onChange={(e) => p({ assign_to: e.target.value || undefined })}>
              <option value="">Nobody</option>
              {people.map((x) => (
                <option key={x.user_id} value={x.user_id}>
                  {x.display_name}
                </option>
              ))}
            </Select>
          </div>
          <Textarea
            aria-label="Checklist for the new task, one item per line"
            rows={2}
            value={(a.checklist ?? []).join('\n')}
            onChange={(e) => p({ checklist: e.target.value.split('\n') })}
            placeholder="Optional checklist, one item per line"
          />
        </div>
      );
    case 'notify':
      return (
        <div className="flex flex-col gap-1.5 pl-6">
          <Select aria-label="Recipients" className="h-8" value={a.to ?? ''} onChange={(e) => p({ to: e.target.value })}>
            {taskContext && <option value="assignees">The task’s assignees</option>}
            {taskContext && <option value="watchers">The task’s watchers</option>}
            {taskContext && <option value="creator">The task’s creator</option>}
            <option value="managers">Project managers</option>
            <option value="members">All project members</option>
            {people.map((x) => (
              <option key={x.user_id} value={x.user_id}>
                {x.display_name}
              </option>
            ))}
          </Select>
          <Input aria-label="Notification title" className="h-8" value={a.title ?? ''} onChange={(e) => p({ title: e.target.value })} placeholder="Title. {card} = task title, {rule} = automation name" maxLength={300} />
          <Input aria-label="Notification text" className="h-8" value={a.body ?? ''} onChange={(e) => p({ body: e.target.value })} placeholder="Optional details" maxLength={1000} />
        </div>
      );
    case 'webhook':
      return (
        <div className={row}>
          <Select aria-label="Integration" className="h-8" value={a.integration_id ?? ''} onChange={(e) => p({ integration_id: e.target.value || undefined })}>
            <option value="">Choose an integration</option>
            {integrations.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </Select>
        </div>
      );
    case 'request_evidence':
      return <p className="pl-6 text-xs text-secondary">Creates a missing-evidence item from the milestone’s verification requirement and notifies its owner and the project managers.</p>;
    case 'notify_missing_submissions':
      return <p className="pl-6 text-xs text-secondary">Counts required evidence that is missing or rejected and notifies every project member if anything is outstanding.</p>;
    case 'complete_parent':
      return <p className="pl-6 text-xs text-secondary">Only acts when the task is a subtask and all of its sibling subtasks are done.</p>;
    case 'set_wp_status':
      return <p className="pl-6 text-xs text-secondary">Sets the task’s work package to In progress, or Completed once all its tasks are done.</p>;
    default:
      return null;
  }
}
