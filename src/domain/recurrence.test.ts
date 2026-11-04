import { describe, expect, it } from 'vitest';
import { describeRecurrence, nextOccurrence } from './recurrence';

// These cases mirror tests/db/productivity.test.ts so client previews and the
// server's next_occurrence() agree.
describe('nextOccurrence', () => {
  it('daily, weekly, monthly, until', () => {
    expect(nextOccurrence('2026-11-04', { freq: 'daily', interval: 2 })).toBe('2026-11-06');
    expect(nextOccurrence('2026-11-04', { freq: 'weekly', interval: 1, byweekday: [0, 4] })).toBe('2026-11-06');
    expect(nextOccurrence('2026-11-06', { freq: 'weekly', interval: 1, byweekday: [0, 4] })).toBe('2026-11-09');
    expect(nextOccurrence('2026-11-04', { freq: 'weekly', interval: 1 })).toBe('2026-11-11');
    expect(nextOccurrence('2026-01-31', { freq: 'monthly', interval: 1 })).toBe('2026-02-28');
    expect(nextOccurrence('2026-11-04', { freq: 'daily', interval: 1, until: '2026-11-04' })).toBeNull();
  });
  it('every two weeks on Monday', () => {
    expect(nextOccurrence('2026-11-02', { freq: 'weekly', interval: 2, byweekday: [0] })).toBe('2026-11-16');
  });
});

describe('describeRecurrence', () => {
  it('reads naturally', () => {
    expect(describeRecurrence({ freq: 'weekly', interval: 1, byweekday: [0, 2] })).toBe('Every week on Mon, Wed');
    expect(describeRecurrence({ freq: 'monthly', interval: 3 })).toBe('Every 3 months');
  });
});
