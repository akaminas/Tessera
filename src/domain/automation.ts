/**
 * Automation rules: shared types, validation, plain-English descriptions and
 * the preset examples. Mirrors the engine in
 * supabase/migrations/20261104000600_automation.sql.
 */

export type RuleKind = 'rule' | 'scheduled' | 'due_date' | 'card_button' | 'board_button';

export type EventType =
  | 'card.created'
  | 'card.moved'
  | 'card.status_changed'
  | 'card.completed'
  | 'card.assigned'
  | 'card.label_added'
  | 'card.due_changed'
  | 'checklist.completed'
  | 'comment.added'
  | 'milestone.status_changed';

export type ConditionField =
  | 'list'
  | 'status'
  | 'priority'
  | 'label'
  | 'assignee'
  | 'has_assignee'
  | 'title_contains'
  | 'work_package'
  | 'overdue'
  | 'has_due'
  | 'is_subtask';

export type ConditionOp = 'is' | 'is_not' | 'has' | 'not_has';

export interface Condition {
  field: ConditionField;
  op: ConditionOp;
  value?: string;
}

export type ActionType =
  | 'move_to_list'
  | 'set_status'
  | 'set_priority'
  | 'complete'
  | 'archive'
  | 'assign'
  | 'unassign_all'
  | 'add_label'
  | 'remove_label'
  | 'set_due'
  | 'clear_due'
  | 'add_checklist'
  | 'add_comment'
  | 'complete_parent'
  | 'set_wp_status'
  | 'create_card'
  | 'notify'
  | 'request_evidence'
  | 'notify_missing_submissions'
  | 'webhook';

export interface Action {
  type: ActionType;
  list_id?: string;
  status?: string;
  priority?: string;
  user?: string;
  label_id?: string;
  days?: number;
  title?: string;
  items?: string[];
  text?: string;
  due_in_days?: number;
  assign_to?: string;
  checklist?: string[];
  description?: string;
  to?: string;
  body?: string;
  integration_id?: string;
}

export interface Schedule {
  freq: 'daily' | 'weekly' | 'monthly';
  time: string;
  weekday?: number;
  monthday?: number;
  tz: string;
}

export interface Trigger {
  type?: EventType;
  list_id?: string;
  from_list?: string;
  label_id?: string;
  to?: string;
  user_id?: string;
  /** scheduled */
  scope?: 'once' | 'cards';
  /** due_date */
  target?: 'cards' | 'milestones' | 'reporting_periods';
  offset_days?: number;
}

export interface RuleDraft {
  id?: string;
  name: string;
  kind: RuleKind;
  board_id: string | null;
  enabled: boolean;
  trigger: Trigger;
  conditions: Condition[];
  actions: Action[];
  schedule: Schedule | null;
}

export interface RuleContext {
  lists: { id: string; name: string; board_id?: string }[];
  labels: { id: string; name: string; color?: string }[];
  people: { user_id: string; display_name: string }[];
  integrations?: { id: string; name: string }[];
  workPackages?: { id: string; code: string; name: string }[];
}

/* ------------------------------------------------------------- Vocabulary */

export const KIND_LABEL: Record<RuleKind, string> = {
  rule: 'When something happens',
  scheduled: 'On a schedule',
  due_date: 'Around a due date',
  card_button: 'Task button',
  board_button: 'Board button',
};

export const EVENT_LABEL: Record<EventType, string> = {
  'card.created': 'a task is created',
  'card.moved': 'a task is moved',
  'card.status_changed': 'a task’s status changes',
  'card.completed': 'a task is completed',
  'card.assigned': 'someone is assigned to a task',
  'card.label_added': 'a label is added to a task',
  'card.due_changed': 'a task’s due date changes',
  'checklist.completed': 'a checklist is completed',
  'comment.added': 'a comment is added',
  'milestone.status_changed': 'a milestone’s status changes',
};

export const CONDITION_LABEL: Record<ConditionField, string> = {
  list: 'is in list',
  status: 'has status',
  priority: 'has priority',
  label: 'has label',
  assignee: 'is assigned to',
  has_assignee: 'has someone assigned',
  title_contains: 'title contains',
  work_package: 'is in work package',
  overdue: 'is overdue',
  has_due: 'has a due date',
  is_subtask: 'is a subtask',
};

/** Fields that need no value. */
export const VALUELESS_FIELDS: ConditionField[] = ['has_assignee', 'overdue', 'has_due', 'is_subtask'];

export const ACTION_LABEL: Record<ActionType, string> = {
  move_to_list: 'Move the task to a list',
  set_status: 'Set status',
  set_priority: 'Set priority',
  complete: 'Mark the task done',
  archive: 'Archive the task',
  assign: 'Assign someone',
  unassign_all: 'Remove all assignees',
  add_label: 'Add a label',
  remove_label: 'Remove a label',
  set_due: 'Set the due date',
  clear_due: 'Remove the due date',
  add_checklist: 'Add a checklist',
  add_comment: 'Add a comment',
  complete_parent: 'Complete the parent task when all its subtasks are done',
  set_wp_status: 'Update the work package status from its tasks',
  create_card: 'Create a task',
  notify: 'Send a notification',
  request_evidence: 'Request evidence for the milestone',
  notify_missing_submissions: 'Remind members about missing submissions',
  webhook: 'Send to an integration',
};

/** Actions that operate on a task and therefore need task context. */
export const CARD_ACTIONS: ActionType[] = [
  'move_to_list',
  'set_status',
  'set_priority',
  'complete',
  'archive',
  'assign',
  'unassign_all',
  'add_label',
  'remove_label',
  'set_due',
  'clear_due',
  'add_checklist',
  'add_comment',
  'complete_parent',
  'set_wp_status',
];

const STATUS_WORD: Record<string, string> = { open: 'Open', in_progress: 'In progress', blocked: 'Blocked', done: 'Done' };
const PRIORITY_WORD: Record<string, string> = { none: 'No priority', low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' };
const DAY = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Which actions make sense for a kind (and, for due-date rules, a target). */
export function actionsForKind(kind: RuleKind, trigger: Trigger): ActionType[] {
  const general: ActionType[] = ['create_card', 'notify', 'webhook'];
  if (kind === 'due_date' && trigger.target === 'milestones') return ['request_evidence', 'notify', 'create_card', 'webhook'];
  if (kind === 'due_date' && trigger.target === 'reporting_periods') return ['notify_missing_submissions', 'notify', 'create_card', 'webhook'];
  if (kind === 'rule' && trigger.type === 'milestone.status_changed') return ['request_evidence', 'notify_missing_submissions', ...general];
  if (kind === 'scheduled' && trigger.scope !== 'cards') return ['notify_missing_submissions', ...general];
  if (kind === 'board_button') return [...CARD_ACTIONS, ...general];
  return [...CARD_ACTIONS, ...general];
}

/** Whether the rule's actions run against tasks (so conditions are meaningful). */
export function hasTaskContext(kind: RuleKind, trigger: Trigger): boolean {
  if (kind === 'card_button' || kind === 'board_button') return true;
  if (kind === 'scheduled') return trigger.scope === 'cards';
  if (kind === 'due_date') return (trigger.target ?? 'cards') === 'cards';
  return trigger.type !== 'milestone.status_changed';
}

/* -------------------------------------------------------------- Validation */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function emptyDraft(kind: RuleKind = 'rule', tz = 'UTC'): RuleDraft {
  return {
    name: '',
    kind,
    board_id: null,
    enabled: true,
    trigger: kind === 'rule' ? { type: 'card.moved' } : kind === 'due_date' ? { target: 'cards', offset_days: 1 } : kind === 'scheduled' ? { scope: 'once' } : {},
    conditions: [],
    actions: [],
    schedule: kind === 'scheduled' || kind === 'due_date' ? { freq: kind === 'scheduled' ? 'weekly' : 'daily', time: '08:00', weekday: 0, tz } : null,
  };
}

/** Returns a list of human-readable problems; empty when the draft can be saved. */
export function validateRule(d: RuleDraft, ctx: RuleContext): string[] {
  const errors: string[] = [];
  const listIds = new Set(ctx.lists.map((l) => l.id));
  const labelIds = new Set(ctx.labels.map((l) => l.id));
  const peopleIds = new Set(ctx.people.map((p) => p.user_id));
  const integrationIds = new Set((ctx.integrations ?? []).map((i) => i.id));
  if (!d.name.trim()) errors.push('Give the automation a name.');
  if (d.name.trim().length > 200) errors.push('The name is too long (200 characters at most).');

  if (d.kind === 'rule') {
    if (!d.trigger.type || !(d.trigger.type in EVENT_LABEL)) errors.push('Choose what should trigger the rule.');
    if (d.trigger.list_id && !listIds.has(d.trigger.list_id)) errors.push('The trigger list no longer exists.');
    if (d.trigger.from_list && !listIds.has(d.trigger.from_list)) errors.push('The “from” list no longer exists.');
    if (d.trigger.type === 'card.label_added' && d.trigger.label_id && !labelIds.has(d.trigger.label_id)) errors.push('The trigger label no longer exists.');
  }
  if (d.kind === 'scheduled' || d.kind === 'due_date') {
    const s = d.schedule;
    if (!s) errors.push('Set when the automation runs.');
    else {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s.time)) errors.push('Enter the time as HH:MM.');
      if (s.freq === 'weekly' && (s.weekday == null || s.weekday < 0 || s.weekday > 6)) errors.push('Choose a weekday.');
      if (s.freq === 'monthly' && (s.monthday == null || s.monthday < 1 || s.monthday > 28)) errors.push('Choose a day of the month between 1 and 28.');
      if (!s.tz) errors.push('Choose a time zone.');
    }
  }
  if (d.kind === 'due_date') {
    if (!d.trigger.target) errors.push('Choose whether the rule watches tasks, milestones or reporting periods.');
    const off = d.trigger.offset_days;
    if (off == null || !Number.isInteger(off) || Math.abs(off) > 365) errors.push('Enter a whole number of days (up to 365) before or after the date.');
  }

  if (d.actions.length === 0) errors.push('Add at least one action.');
  if (d.actions.length > 20) errors.push('Use at most 20 actions in one automation.');
  const allowed = new Set(actionsForKind(d.kind, d.trigger));
  d.actions.forEach((a, i) => {
    const n = `Action ${i + 1}`;
    if (!allowed.has(a.type)) {
      errors.push(`${n}: “${ACTION_LABEL[a.type] ?? a.type}” is not available for this kind of automation.`);
      return;
    }
    switch (a.type) {
      case 'move_to_list':
      case 'create_card':
        if (!a.list_id || !listIds.has(a.list_id)) errors.push(`${n}: choose a list.`);
        if (a.type === 'create_card' && !a.title?.trim()) errors.push(`${n}: give the new task a title.`);
        if (a.type === 'create_card' && a.assign_to && !peopleIds.has(a.assign_to)) errors.push(`${n}: the assignee is no longer in the project.`);
        if (a.type === 'create_card' && a.due_in_days != null && (!Number.isInteger(a.due_in_days) || a.due_in_days < 0 || a.due_in_days > 365))
          errors.push(`${n}: due in days must be a whole number from 0 to 365.`);
        break;
      case 'set_status':
        if (!a.status || !(a.status in STATUS_WORD)) errors.push(`${n}: choose a status.`);
        break;
      case 'set_priority':
        if (!a.priority || !(a.priority in PRIORITY_WORD)) errors.push(`${n}: choose a priority.`);
        break;
      case 'assign':
        if (!a.user || !(a.user === 'actor' || a.user === 'creator' || peopleIds.has(a.user))) errors.push(`${n}: choose who to assign.`);
        break;
      case 'add_label':
      case 'remove_label':
        if (!a.label_id || !labelIds.has(a.label_id)) errors.push(`${n}: choose a label.`);
        break;
      case 'set_due':
        if (a.days == null || !Number.isInteger(a.days) || a.days < 0 || a.days > 365) errors.push(`${n}: enter a number of days from 0 to 365.`);
        break;
      case 'add_checklist':
        if (!a.items?.filter((x) => x.trim()).length) errors.push(`${n}: add at least one checklist item.`);
        break;
      case 'add_comment':
        if (!a.text?.trim()) errors.push(`${n}: write the comment.`);
        break;
      case 'notify':
        if (!a.to || !(['assignees', 'watchers', 'creator', 'managers', 'members'].includes(a.to) || (UUID.test(a.to) && peopleIds.has(a.to))))
          errors.push(`${n}: choose who to notify.`);
        if (!a.title?.trim()) errors.push(`${n}: write the notification title.`);
        if (['assignees', 'watchers', 'creator'].includes(a.to ?? '') && !hasTaskContext(d.kind, d.trigger))
          errors.push(`${n}: there is no task here, so notify managers, members or a person instead.`);
        break;
      case 'webhook':
        if (!a.integration_id || !integrationIds.has(a.integration_id)) errors.push(`${n}: choose an integration.`);
        break;
    }
  });

  if (d.conditions.length && !hasTaskContext(d.kind, d.trigger)) errors.push('Conditions apply to tasks; this automation has no task to check.');
  d.conditions.forEach((c, i) => {
    if (!(c.field in CONDITION_LABEL)) errors.push(`Condition ${i + 1}: unknown field.`);
    else if (!VALUELESS_FIELDS.includes(c.field) && !c.value?.trim()) errors.push(`Condition ${i + 1}: choose a value.`);
    else if (c.field === 'list' && !listIds.has(c.value!)) errors.push(`Condition ${i + 1}: the list no longer exists.`);
    else if (c.field === 'label' && !labelIds.has(c.value!)) errors.push(`Condition ${i + 1}: the label no longer exists.`);
  });
  return errors;
}

/* ------------------------------------------------------------ Description */

function name(arr: { id: string; name: string }[], id?: string) {
  return arr.find((x) => x.id === id)?.name ?? 'a deleted item';
}

function person(ctx: RuleContext, id?: string) {
  if (id === 'actor') return 'the person who triggered it';
  if (id === 'creator') return 'the task’s creator';
  return ctx.people.find((p) => p.user_id === id)?.display_name ?? 'a former member';
}

export function describeSchedule(s: Schedule | null): string {
  if (!s) return '';
  const at = `at ${s.time}${s.tz && s.tz !== 'UTC' ? ` (${s.tz})` : ' UTC'}`;
  if (s.freq === 'daily') return `every day ${at}`;
  if (s.freq === 'weekly') return `every ${DAY[s.weekday ?? 0]} ${at}`;
  return `on day ${s.monthday ?? 1} of every month ${at}`;
}

function describeTrigger(d: RuleDraft, ctx: RuleContext): string {
  const t = d.trigger;
  switch (d.kind) {
    case 'rule': {
      if (t.type === 'card.moved') {
        let s = 'When a task is moved';
        if (t.from_list) s += ` from ${name(ctx.lists, t.from_list)}`;
        if (t.list_id) s += ` to ${name(ctx.lists, t.list_id)}`;
        return s;
      }
      if (t.type === 'card.created') return `When a task is created${t.list_id ? ` in ${name(ctx.lists, t.list_id)}` : ''}`;
      if (t.type === 'card.status_changed') return `When a task’s status changes${t.to ? ` to ${STATUS_WORD[t.to] ?? t.to}` : ''}`;
      if (t.type === 'card.label_added') return `When ${t.label_id ? `the label “${name(ctx.labels, t.label_id)}”` : 'a label'} is added to a task`;
      if (t.type === 'card.assigned') return `When ${t.user_id ? person(ctx, t.user_id) : 'someone'} is assigned to a task`;
      if (t.type === 'milestone.status_changed') return `When a milestone’s status changes${t.to ? ` to ${t.to.replace('_', ' ')}` : ''}`;
      return `When ${t.type ? EVENT_LABEL[t.type] : 'something happens'}`;
    }
    case 'scheduled':
      return `${describeSchedule(d.schedule).replace(/^./, (c) => c.toUpperCase())}${t.scope === 'cards' ? ', for each matching task' : ''}`;
    case 'due_date': {
      const off = t.offset_days ?? 0;
      const n = Math.abs(off);
      const days = `${n} day${n === 1 ? '' : 's'}`;
      if (t.target === 'reporting_periods') {
        if (off === 0) return 'On the day a reporting period ends';
        return `${days} ${off < 0 ? 'before' : 'after'} a reporting period ends`.replace(/^./, (c) => c.toUpperCase());
      }
      const what = t.target === 'milestones' ? 'a milestone’s due date' : 'a task’s due date';
      if (off === 0) return `On ${what}`;
      if (off > 0 && (t.target ?? 'cards') === 'cards') return `When a task is ${days} overdue`;
      return `${days} ${off < 0 ? 'before' : 'after'} ${what}`.replace(/^./, (c) => c.toUpperCase());
    }
    case 'card_button':
      return 'When the task button is pressed';
    case 'board_button':
      return 'When the board button is pressed';
  }
}

export function describeAction(a: Action, ctx: RuleContext): string {
  switch (a.type) {
    case 'move_to_list':
      return `move it to ${name(ctx.lists, a.list_id)}`;
    case 'set_status':
      return `set status to ${STATUS_WORD[a.status ?? ''] ?? a.status}`;
    case 'set_priority':
      return `set priority to ${PRIORITY_WORD[a.priority ?? ''] ?? a.priority}`;
    case 'complete':
      return 'mark it done';
    case 'archive':
      return 'archive it';
    case 'assign':
      return `assign ${person(ctx, a.user)}`;
    case 'unassign_all':
      return 'remove all assignees';
    case 'add_label':
      return `add the label “${name(ctx.labels, a.label_id)}”`;
    case 'remove_label':
      return `remove the label “${name(ctx.labels, a.label_id)}”`;
    case 'set_due':
      return a.days === 0 ? 'make it due today' : `make it due in ${a.days} day${a.days === 1 ? '' : 's'}`;
    case 'clear_due':
      return 'remove the due date';
    case 'add_checklist':
      return `add the checklist “${a.title || 'Checklist'}” (${a.items?.length ?? 0} item${a.items?.length === 1 ? '' : 's'})`;
    case 'add_comment':
      return 'add a comment';
    case 'complete_parent':
      return 'complete the parent task when all its subtasks are done';
    case 'set_wp_status':
      return 'update the work package status';
    case 'create_card':
      return `create the task “${a.title ?? ''}” in ${name(ctx.lists, a.list_id)}`;
    case 'notify': {
      const who: Record<string, string> = {
        assignees: 'assignees',
        watchers: 'watchers',
        creator: 'the task’s creator',
        managers: 'project managers',
        members: 'project members',
      };
      return `notify ${who[a.to ?? ''] ?? person(ctx, a.to)}`;
    }
    case 'request_evidence':
      return 'request the milestone’s evidence from its owner and managers';
    case 'notify_missing_submissions':
      return 'remind members about missing required submissions';
    case 'webhook':
      return `send it to ${name(ctx.integrations ?? [], a.integration_id)}`;
  }
}

function joinWords(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

export function describeCondition(c: Condition, ctx: RuleContext): string {
  const neg = c.op === 'is_not' || c.op === 'not_has';
  const v = (() => {
    switch (c.field) {
      case 'list':
        return `is${neg ? ' not' : ''} in ${name(ctx.lists, c.value)}`;
      case 'label':
        return `${neg ? 'does not have' : 'has'} the label “${name(ctx.labels, c.value)}”`;
      case 'assignee':
        return c.value === 'none' ? (neg ? 'is assigned' : 'is unassigned') : `is${neg ? ' not' : ''} assigned to ${person(ctx, c.value)}`;
      case 'status':
        return `${neg ? 'is not' : 'is'} ${STATUS_WORD[c.value ?? ''] ?? c.value}`;
      case 'priority':
        return `${neg ? 'is not' : 'is'} ${PRIORITY_WORD[c.value ?? '']?.toLowerCase() ?? c.value} priority`;
      case 'title_contains':
        return `title ${neg ? 'does not contain' : 'contains'} “${c.value}”`;
      case 'work_package': {
        const wp = ctx.workPackages?.find((w) => w.id === c.value);
        return `is${neg ? ' not' : ''} in ${wp ? `${wp.code} ${wp.name}` : 'a deleted work package'}`;
      }
      case 'has_assignee':
        return neg ? 'has nobody assigned' : 'has someone assigned';
      case 'overdue':
        return neg ? 'is not overdue' : 'is overdue';
      case 'has_due':
        return neg ? 'has no due date' : 'has a due date';
      case 'is_subtask':
        return neg ? 'is not a subtask' : 'is a subtask';
    }
  })();
  return v;
}

/** "When a task is moved to Done, set status to Done and notify assignees." */
export function describeRule(d: RuleDraft, ctx: RuleContext): string {
  let s = describeTrigger(d, ctx);
  if (d.conditions.length) s += ` and the task ${joinWords(d.conditions.map((c) => describeCondition(c, ctx)))}`;
  const acts = d.actions.map((a) => describeAction(a, ctx));
  s += acts.length ? `, ${joinWords(acts)}.` : '.';
  return s;
}

/* ---------------------------------------------------------------- Presets */

export interface Preset {
  id: string;
  title: string;
  description: string;
  build(ctx: RuleContext & { tz: string }): RuleDraft;
}

function firstList(ctx: RuleContext, ...names: string[]): string {
  for (const n of names) {
    const hit = ctx.lists.find((l) => l.name.toLowerCase() === n.toLowerCase());
    if (hit) return hit.id;
  }
  return ctx.lists[0]?.id ?? '';
}

export const PRESETS: Preset[] = [
  {
    id: 'overdue-notify',
    title: 'Notify owners of overdue tasks',
    description: 'Each morning, tell assignees about tasks that became overdue yesterday.',
    build: ({ tz }) => ({
      ...emptyDraft('due_date', tz),
      name: 'Overdue task reminder',
      trigger: { target: 'cards', offset_days: 1 },
      schedule: { freq: 'daily', time: '08:00', tz },
      actions: [{ type: 'notify', to: 'assignees', title: '“{card}” is overdue', body: 'It was due yesterday. Update the date or mark it done.' }],
    }),
  },
  {
    id: 'checklist-complete',
    title: 'Finish the task when its checklist is done',
    description: 'When every item of a checklist is ticked, mark the task done.',
    build: ({ tz }) => ({
      ...emptyDraft('rule', tz),
      name: 'Checklist completed → task done',
      trigger: { type: 'checklist.completed' },
      actions: [{ type: 'complete' }],
    }),
  },
  {
    id: 'weekly-coordination',
    title: 'Weekly coordination task',
    description: 'Every Monday morning, create a coordination task with an agenda checklist.',
    build: (ctx) => ({
      ...emptyDraft('scheduled', ctx.tz),
      name: 'Monday coordination task',
      trigger: { scope: 'once' },
      schedule: { freq: 'weekly', weekday: 0, time: '08:00', tz: ctx.tz },
      actions: [
        {
          type: 'create_card',
          list_id: firstList(ctx, 'To do', 'This week', 'Upcoming', 'Inbox'),
          title: 'Coordination meeting {date}',
          due_in_days: 0,
          checklist: ['Review last week’s actions', 'Check upcoming deadlines', 'Agree this week’s priorities'],
        },
      ],
    }),
  },
  {
    id: 'milestone-evidence',
    title: 'Request evidence before a milestone',
    description: 'Seven days before a milestone is due, ask its owner and the managers for the required evidence.',
    build: ({ tz }) => ({
      ...emptyDraft('due_date', tz),
      name: 'Evidence request 7 days before milestones',
      trigger: { target: 'milestones', offset_days: -7 },
      schedule: { freq: 'daily', time: '08:00', tz },
      actions: [{ type: 'request_evidence' }],
    }),
  },
  {
    id: 'progress-on-complete',
    title: 'Update progress when a task is completed',
    description: 'Refresh the work package status and close a parent task once all its subtasks are done.',
    build: ({ tz }) => ({
      ...emptyDraft('rule', tz),
      name: 'Task completed → update progress',
      trigger: { type: 'card.completed' },
      actions: [{ type: 'set_wp_status' }, { type: 'complete_parent' }],
    }),
  },
  {
    id: 'period-end-reminder',
    title: 'Reporting period reminder',
    description: 'Fourteen days before a reporting period ends, remind members about required submissions that are still missing.',
    build: ({ tz }) => ({
      ...emptyDraft('due_date', tz),
      name: 'Missing submissions before period end',
      trigger: { target: 'reporting_periods', offset_days: -14 },
      schedule: { freq: 'daily', time: '09:00', tz },
      actions: [{ type: 'notify_missing_submissions' }],
    }),
  },
];

/** Convert a stored row to a draft (tolerating missing fields). */
export function rowToDraft(row: {
  id: string;
  name: string;
  kind: RuleKind;
  board_id: string | null;
  enabled: boolean;
  trigger: Trigger | null;
  conditions: Condition[] | null;
  actions: Action[] | null;
  schedule: Schedule | null;
}): RuleDraft {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    board_id: row.board_id,
    enabled: row.enabled,
    trigger: row.trigger ?? {},
    conditions: row.conditions ?? [],
    actions: row.actions ?? [],
    schedule: row.schedule,
  };
}

/** Remove empty optional values before saving. */
export function cleanDraft(d: RuleDraft): RuleDraft {
  const strip = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v !== undefined && v !== null)) as T;
  return {
    ...d,
    name: d.name.trim(),
    trigger: strip(d.trigger),
    conditions: d.conditions.map((c) => strip(c)),
    actions: d.actions.map((a) => {
      const x = strip(a);
      if (x.items) x.items = x.items.map((i) => i.trim()).filter(Boolean);
      if (x.checklist) x.checklist = x.checklist.map((i) => i.trim()).filter(Boolean);
      return x;
    }),
    schedule: d.kind === 'scheduled' || d.kind === 'due_date' ? d.schedule : null,
  };
}
