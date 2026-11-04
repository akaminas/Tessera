import { describe, expect, it } from 'vitest';
import { bucketOf, groupWork } from './workGroups';

const today = new Date(2026, 10, 4);

describe('work grouping', () => {
  it('assigns buckets', () => {
    expect(bucketOf({ due_date: '2026-11-03', status: 'open' }, today)).toBe('overdue');
    expect(bucketOf({ due_date: '2026-11-04', status: 'open' }, today)).toBe('today');
    expect(bucketOf({ due_date: '2026-11-11', status: 'open' }, today)).toBe('week');
    expect(bucketOf({ due_date: '2026-11-12', status: 'open' }, today)).toBe('later');
    expect(bucketOf({ due_date: null, status: 'open' }, today)).toBe('nodate');
    expect(bucketOf({ due_date: '2026-11-01', status: 'done' }, today)).toBe('done');
  });
  it('orders groups and sorts by date then priority', () => {
    const g = groupWork(
      [
        { due_date: '2026-11-04', status: 'open', priority: 'low', id: 'a' },
        { due_date: '2026-11-04', status: 'open', priority: 'urgent', id: 'b' },
        { due_date: '2026-11-01', status: 'open', priority: 'none', id: 'c' },
      ],
      today,
    );
    expect(g.map((x) => x.bucket)).toEqual(['overdue', 'today']);
    expect(g[1].items.map((x) => x.id)).toEqual(['b', 'a']);
  });
});
