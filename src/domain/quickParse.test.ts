import { describe, expect, it } from 'vitest';
import { parseQuickAdd } from './quickParse';

// Wednesday 4 November 2026
const today = new Date(2026, 10, 4);

describe('parseQuickAdd', () => {
  it('keeps plain titles', () => {
    expect(parseQuickAdd('Write the budget narrative', today)).toEqual({
      title: 'Write the budget narrative',
      due_date: null,
      priority: 'none',
    });
  });
  it('parses trailing dates and priorities in any order', () => {
    expect(parseQuickAdd('Send report fri !high', today)).toEqual({ title: 'Send report', due_date: '2026-11-06', priority: 'high' });
    expect(parseQuickAdd('Send report !urgent tomorrow', today)).toEqual({ title: 'Send report', due_date: '2026-11-05', priority: 'urgent' });
    expect(parseQuickAdd('Renew licence 2027-01-15', today).due_date).toBe('2027-01-15');
    expect(parseQuickAdd('Follow up +10d', today).due_date).toBe('2026-11-14');
  });
  it('treats the same weekday as next week', () => {
    expect(parseQuickAdd('Standup wed', today).due_date).toBe('2026-11-11');
  });
  it('does not consume words inside the title or a lone token', () => {
    expect(parseQuickAdd('Plan friday social', today).title).toBe('Plan friday social');
    expect(parseQuickAdd('today', today)).toEqual({ title: 'today', due_date: null, priority: 'none' });
  });
});
