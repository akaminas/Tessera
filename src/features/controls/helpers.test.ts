import { describe, expect, it } from 'vitest';
import {
  emberStep,
  emberText,
  evidenceState,
  formatCents,
  groupByDay,
  isOverdue,
  monthRangeLabel,
  projectMonthEnd,
  projectMonthOf,
  projectMonthStart,
  riskLevel,
  riskMatrix,
} from './helpers';

describe('project months (mirror of SQL project_month_*)', () => {
  it('maps dates to months and back', () => {
    expect(projectMonthOf('2026-09-01', '2026-09-01')).toBe(1);
    expect(projectMonthOf('2026-09-01', '2027-03-31')).toBe(7);
    expect(projectMonthOf('2026-09-01', '2028-08-31')).toBe(24);
    expect(projectMonthOf('2026-09-01', '2026-08-31')).toBeNull();
    expect(projectMonthOf('2026-09-15', '2026-10-14')).toBe(1);
    expect(projectMonthOf('2026-09-15', '2026-10-15')).toBe(2);
    expect(projectMonthStart('2026-09-01', 7)).toBe('2027-03-01');
    expect(projectMonthEnd('2026-09-01', 1)).toBe('2026-09-30');
    expect(projectMonthEnd('2026-09-01', 24)).toBe('2028-08-31');
  });
  it('labels ranges', () => {
    expect(monthRangeLabel('2026-09-01', '2026-09-01', '2028-08-31')).toBe('M1–M24');
    expect(monthRangeLabel('2026-09-01', '2027-03-01', '2027-03-31')).toBe('M7');
    expect(monthRangeLabel(null, '2027-03-01', '2027-03-31')).toBe('');
  });
});

describe('risk matrix', () => {
  it('counts by impact row and probability column', () => {
    const m = riskMatrix([
      { probability: 4, impact: 4 },
      { probability: 4, impact: 4 },
      { probability: 1, impact: 2 },
    ]);
    expect(m[3][3]).toBe(2);
    expect(m[1][0]).toBe(1);
    expect(m.flat().reduce((a, b) => a + b, 0)).toBe(3);
  });
  it('maps scores to ember steps and readable text', () => {
    expect(emberStep(1)).toBe(0);
    expect(emberStep(25)).toBe(8);
    expect(emberStep(13)).toBe(4);
    expect(emberText(8, false)).toBe('#FFFFFF');
    expect(emberText(0, false)).toBe('#2A2825');
    expect(riskLevel(16)).toBe('high');
    expect(riskLevel(20)).toBe('critical');
    expect(riskLevel(4)).toBe('low');
  });
});

describe('milestones and evidence', () => {
  it('detects overdue items', () => {
    expect(isOverdue({ status: 'planned', due_date: '2026-11-01' }, '2026-11-04')).toBe(true);
    expect(isOverdue({ status: 'done', due_date: '2026-11-01' }, '2026-11-04')).toBe(false);
    expect(isOverdue({ status: 'planned', due_date: null }, '2026-11-04')).toBe(false);
  });
  it('summarises evidence state', () => {
    expect(evidenceState([], false)).toBe('none');
    expect(evidenceState([], true)).toBe('missing');
    expect(evidenceState([{ required: true, status: 'submitted' }, { required: true, status: 'missing' }], true)).toBe('missing');
    expect(evidenceState([{ required: true, status: 'verified' }, { required: false, status: 'missing' }], true)).toBe('verified');
    expect(evidenceState([{ required: true, status: 'submitted' }], true)).toBe('submitted');
  });
});

describe('formatting', () => {
  it('formats cents exactly', () => {
    expect(formatCents(1999445)).toBe('19,994.45');
    expect(formatCents(-5)).toBe('−0.05');
    expect(formatCents(100, 'EUR')).toBe('EUR 1.00');
  });
  it('groups by day', () => {
    const g = groupByDay([{ created_at: '2026-11-04T10:00:00Z' }, { created_at: '2026-11-04T09:00:00Z' }, { created_at: '2026-11-03T09:00:00Z' }]);
    expect(g.map((x) => x.items.length)).toEqual([2, 1]);
  });
});
