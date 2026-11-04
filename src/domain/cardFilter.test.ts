import { describe, expect, it } from 'vitest';
import { dueState, isFilterActive, matchesFilter, sortCards, type FilterableCard } from './cardFilter';

const today = new Date(2026, 10, 4); // Wed 4 Nov 2026
const base: FilterableCard = {
  title: 'Prepare interim report',
  description: 'Collect partner cost statements',
  status: 'open',
  priority: 'none',
  due_date: null,
  card_assignees: [],
  card_labels: [],
};

describe('matchesFilter', () => {
  it('matches all words of free text across title and description', () => {
    expect(matchesFilter(base, { text: 'interim cost' }, 'me', today)).toBe(true);
    expect(matchesFilter(base, { text: 'interim budget' }, 'me', today)).toBe(false);
  });

  it('resolves "me" and "none" for assignees', () => {
    const mine = { ...base, card_assignees: [{ user_id: 'u1' }] };
    expect(matchesFilter(mine, { assignees: ['me'] }, 'u1', today)).toBe(true);
    expect(matchesFilter(mine, { assignees: ['none'] }, 'u1', today)).toBe(false);
    expect(matchesFilter(base, { assignees: ['none'] }, 'u1', today)).toBe(true);
  });

  it('supports any/all matching for labels', () => {
    const c = { ...base, card_labels: [{ label_id: 'a' }] };
    expect(matchesFilter(c, { labels: ['a', 'b'] }, 'me', today)).toBe(true);
    expect(matchesFilter(c, { labels: ['a', 'b'], match: 'all' }, 'me', today)).toBe(false);
  });

  it('filters by due windows', () => {
    const overdue = { ...base, due_date: '2026-11-01' };
    const fri = { ...base, due_date: '2026-11-06' };
    expect(matchesFilter(overdue, { due: 'overdue' }, 'me', today)).toBe(true);
    expect(matchesFilter({ ...overdue, status: 'done' }, { due: 'overdue' }, 'me', today)).toBe(false);
    expect(matchesFilter(fri, { due: 'week' }, 'me', today)).toBe(true);
    expect(matchesFilter({ ...base, due_date: '2026-11-10' }, { due: 'week' }, 'me', today)).toBe(false);
    expect(matchesFilter(base, { due: 'none' }, 'me', today)).toBe(true);
  });

  it('hides done tasks when requested', () => {
    expect(matchesFilter({ ...base, status: 'done' }, { showDone: false }, 'me', today)).toBe(false);
    expect(isFilterActive({ showDone: false })).toBe(true);
    expect(isFilterActive({ due: 'any' })).toBe(false);
  });
});

describe('dueState', () => {
  it('classifies due dates', () => {
    expect(dueState('2026-11-03', 'open', today)).toBe('overdue');
    expect(dueState('2026-11-04', 'open', today)).toBe('today');
    expect(dueState('2026-11-06', 'open', today)).toBe('soon');
    expect(dueState('2026-12-06', 'open', today)).toBe('later');
    expect(dueState('2026-11-03', 'done', today)).toBe('done');
    expect(dueState(null, 'open', today)).toBe('none');
  });
});

describe('sortCards', () => {
  it('sorts by due date with undated tasks last', () => {
    const cards = [
      { ...base, title: 'b', due_date: null },
      { ...base, title: 'a', due_date: '2026-12-01' },
      { ...base, title: 'c', due_date: '2026-11-10' },
    ];
    expect(sortCards(cards, 'due').map((c) => c.title)).toEqual(['c', 'a', 'b']);
    expect(sortCards(cards, 'due', 'desc').map((c) => c.title)).toEqual(['a', 'c', 'b']);
  });
  it('sorts by priority', () => {
    const cards = [
      { ...base, title: 'low', priority: 'low' as const },
      { ...base, title: 'urgent', priority: 'urgent' as const },
    ];
    expect(sortCards(cards, 'priority')[0].title).toBe('urgent');
  });
});
