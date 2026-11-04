import { describe, expect, it } from 'vitest';
import { PRESETS, cleanDraft, describeRule, emptyDraft, validateRule, type RuleContext, type RuleDraft } from './automation';

const ctx: RuleContext = {
  lists: [
    { id: '11111111-1111-1111-1111-111111111111', name: 'To do' },
    { id: '22222222-2222-2222-2222-222222222222', name: 'Done' },
  ],
  labels: [{ id: '33333333-3333-3333-3333-333333333333', name: 'Urgent' }],
  people: [{ user_id: '44444444-4444-4444-4444-444444444444', display_name: 'Ana Lee' }],
  integrations: [{ id: '55555555-5555-5555-5555-555555555555', name: 'Team channel' }],
};
const DONE = ctx.lists[1].id;

describe('validateRule', () => {
  it('accepts a complete event rule', () => {
    const d: RuleDraft = {
      ...emptyDraft('rule'),
      name: 'Done list',
      trigger: { type: 'card.moved', list_id: DONE },
      actions: [{ type: 'set_status', status: 'done' }, { type: 'notify', to: 'assignees', title: '{card} done' }],
    };
    expect(validateRule(d, ctx)).toEqual([]);
  });

  it('reports missing name, trigger and actions', () => {
    const d: RuleDraft = { ...emptyDraft('rule'), trigger: {} };
    const errs = validateRule(d, ctx);
    expect(errs).toContain('Give the automation a name.');
    expect(errs).toContain('Choose what should trigger the rule.');
    expect(errs).toContain('Add at least one action.');
  });

  it('checks action parameters and referenced ids', () => {
    const d: RuleDraft = {
      ...emptyDraft('rule'),
      name: 'x',
      trigger: { type: 'card.created' },
      actions: [
        { type: 'move_to_list', list_id: 'gone' },
        { type: 'add_label' },
        { type: 'set_due', days: -2 },
        { type: 'webhook', integration_id: '99999999-9999-9999-9999-999999999999' },
      ],
    };
    const errs = validateRule(d, ctx);
    expect(errs).toEqual([
      'Action 1: choose a list.',
      'Action 2: choose a label.',
      'Action 3: enter a number of days from 0 to 365.',
      'Action 4: choose an integration.',
    ]);
  });

  it('limits actions to 20 and rejects task actions without a task', () => {
    const many: RuleDraft = { ...emptyDraft('rule'), name: 'x', trigger: { type: 'card.created' }, actions: Array.from({ length: 21 }, () => ({ type: 'complete' as const })) };
    expect(validateRule(many, ctx)).toContain('Use at most 20 actions in one automation.');
    const sched: RuleDraft = { ...emptyDraft('scheduled', 'UTC'), name: 'x', actions: [{ type: 'complete' }] };
    expect(validateRule(sched, ctx)[0]).toMatch(/not available/);
    const notifyAssignees: RuleDraft = { ...emptyDraft('scheduled', 'UTC'), name: 'x', actions: [{ type: 'notify', to: 'assignees', title: 't' }] };
    expect(validateRule(notifyAssignees, ctx).join(' ')).toMatch(/no task here/);
  });

  it('validates schedules and due offsets', () => {
    const d: RuleDraft = {
      ...emptyDraft('due_date', 'UTC'),
      name: 'x',
      trigger: { target: 'cards', offset_days: 1.5 },
      schedule: { freq: 'monthly', time: '25:00', monthday: 31, tz: 'UTC' },
      actions: [{ type: 'notify', to: 'assignees', title: 't' }],
    };
    const errs = validateRule(d, ctx);
    expect(errs).toContain('Enter the time as HH:MM.');
    expect(errs).toContain('Choose a day of the month between 1 and 28.');
    expect(errs.join(' ')).toMatch(/whole number of days/);
  });

  it('requires values for conditions that need one', () => {
    const d: RuleDraft = {
      ...emptyDraft('rule'),
      name: 'x',
      trigger: { type: 'card.completed' },
      conditions: [{ field: 'label', op: 'has' }, { field: 'is_subtask', op: 'is' }],
      actions: [{ type: 'complete_parent' }],
    };
    expect(validateRule(d, ctx)).toEqual(['Condition 1: choose a value.']);
  });
});

describe('describeRule', () => {
  it('reads as a sentence', () => {
    const d: RuleDraft = {
      ...emptyDraft('rule'),
      name: 'x',
      trigger: { type: 'card.moved', list_id: DONE },
      actions: [{ type: 'set_status', status: 'done' }, { type: 'notify', to: 'assignees', title: 't' }],
    };
    expect(describeRule(d, ctx)).toBe('When a task is moved to Done, set status to Done and notify assignees.');
  });

  it('describes conditions, schedules and due-date rules', () => {
    const cond: RuleDraft = {
      ...emptyDraft('rule'),
      name: 'x',
      trigger: { type: 'card.completed' },
      conditions: [{ field: 'is_subtask', op: 'is' }, { field: 'label', op: 'has', value: ctx.labels[0].id }],
      actions: [{ type: 'complete_parent' }],
    };
    expect(describeRule(cond, ctx)).toBe(
      'When a task is completed and the task is a subtask and has the label “Urgent”, complete the parent task when all its subtasks are done.',
    );
    const weekly = PRESETS.find((p) => p.id === 'weekly-coordination')!.build({ ...ctx, tz: 'Europe/Athens' });
    expect(describeRule(weekly, ctx)).toBe(
      'Every Monday at 08:00 (Europe/Athens), create the task “Coordination meeting {date}” in To do.',
    );
    const overdue = PRESETS.find((p) => p.id === 'overdue-notify')!.build({ ...ctx, tz: 'UTC' });
    expect(describeRule(overdue, ctx)).toBe('When a task is 1 day overdue, notify assignees.');
    const period = PRESETS.find((p) => p.id === 'period-end-reminder')!.build({ ...ctx, tz: 'UTC' });
    expect(describeRule(period, ctx)).toBe('14 days before a reporting period ends, remind members about missing required submissions.');
  });
});

describe('presets', () => {
  it('produces six valid drafts matching the specification examples', () => {
    expect(PRESETS).toHaveLength(6);
    for (const p of PRESETS) {
      const d = cleanDraft(p.build({ ...ctx, tz: 'Europe/Athens' }));
      expect(validateRule(d, ctx), p.id).toEqual([]);
    }
    const milestone = PRESETS.find((p) => p.id === 'milestone-evidence')!.build({ ...ctx, tz: 'UTC' });
    expect(milestone).toMatchObject({ kind: 'due_date', trigger: { target: 'milestones', offset_days: -7 }, actions: [{ type: 'request_evidence' }] });
    const progress = PRESETS.find((p) => p.id === 'progress-on-complete')!.build({ ...ctx, tz: 'UTC' });
    expect(progress.actions.map((a) => a.type)).toEqual(['set_wp_status', 'complete_parent']);
  });

  it('flags the coordination preset when the project has no lists', () => {
    const d = PRESETS.find((p) => p.id === 'weekly-coordination')!.build({ ...ctx, lists: [], tz: 'UTC' });
    expect(validateRule(d, { ...ctx, lists: [] })).toContain('Action 1: choose a list.');
  });
});

describe('cleanDraft', () => {
  it('strips empty values and blank checklist items', () => {
    const d = cleanDraft({
      ...emptyDraft('rule'),
      name: '  Tidy  ',
      trigger: { type: 'card.moved', list_id: '' },
      actions: [{ type: 'add_checklist', title: 'Steps', items: ['a', ' ', 'b '] }],
    });
    expect(d.name).toBe('Tidy');
    expect(d.trigger).toEqual({ type: 'card.moved' });
    expect(d.actions[0].items).toEqual(['a', 'b']);
    expect(d.schedule).toBeNull();
  });
});
