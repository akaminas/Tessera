import { describe, expect, it } from 'vitest';
import {
  alignRange,
  cellState,
  cycleCell,
  dateScale,
  dragDates,
  headerCells,
  monthColumns,
  monthCount,
  monthEnd,
  monthOf,
  monthScale,
  monthStart,
  scheduleProgress,
  scheduleRange,
} from './timeline';

describe('project months', () => {
  // Same cases as tests/db/controls.test.ts for the SQL functions
  it('mirrors the SQL month functions', () => {
    expect(monthStart('2026-09-01', 1)).toBe('2026-09-01');
    expect(monthEnd('2026-09-01', 1)).toBe('2026-09-30');
    expect(monthEnd('2026-09-01', 24)).toBe('2028-08-31');
    expect(monthOf('2026-09-01', '2027-03-31')).toBe(7);
    expect(monthOf('2026-09-01', '2026-08-31')).toBeNull();
  });
  it('handles mid-month starts and arbitrary durations', () => {
    expect(monthStart('2026-01-15', 2)).toBe('2026-02-15');
    expect(monthEnd('2026-01-15', 1)).toBe('2026-02-14');
    expect(monthOf('2026-01-15', '2026-02-14')).toBe(1);
    expect(monthOf('2026-01-15', '2026-02-15')).toBe(2);
    expect(monthCount('2026-09-01', '2028-08-31')).toBe(24);
    expect(monthCount('2026-01-15', '2026-04-20')).toBe(4);
    const cols = monthColumns('2026-09-01', 3);
    expect(cols.map((c) => c.label)).toEqual(['M1', 'M2', 'M3']);
    expect(cols[2]).toMatchObject({ start: '2026-11-01', end: '2026-11-30', calendarLabel: 'Nov 26' });
  });
});

describe('schedule cells', () => {
  it('cycles none → planned → due → done → none', () => {
    let s = cycleCell(null, 3);
    expect(s).toEqual({ planned: [3] });
    s = cycleCell(s, 3);
    expect(s).toEqual({ due: [3] });
    s = cycleCell(s, 3);
    expect(s).toEqual({ done: [3] });
    s = cycleCell(s, 3);
    expect(s).toBeNull();
  });
  it('keeps other months and reports state with precedence', () => {
    const s = { planned: [1, 2], due: [2], done: [1] };
    expect(cellState(s, 1)).toBe('done');
    expect(cellState(s, 2)).toBe('due');
    expect(cellState(s, 5)).toBeNull();
    expect(cycleCell({ planned: [4, 2] }, 3)).toEqual({ planned: [2, 3, 4] });
    expect(scheduleProgress({ planned: [3, 4], done: [1, 2] })).toEqual({ months: 4, done: 2 });
    expect(scheduleRange('2026-09-01', { planned: [3], due: [7] })).toEqual({ start: '2026-11-01', end: '2027-03-31' });
  });
});

describe('scales', () => {
  it('maps dates to pixels and back', () => {
    const s = dateScale('2026-11-02', '2026-11-30', 24);
    expect(s.days).toBe(29);
    expect(s.x('2026-11-04')).toBe(48);
    expect(s.dateAt(50)).toBe('2026-11-04');
  });
  it('aligns ranges and builds headers', () => {
    expect(alignRange('2026-11-04', '2026-11-20', 'weeks')).toEqual({ from: '2026-11-02', to: '2026-11-22' });
    expect(alignRange('2026-11-04', '2027-02-10', 'quarters')).toEqual({ from: '2026-10-01', to: '2027-03-31' });
    expect(headerCells('2026-10-01', '2027-03-31', 'quarters').map((h) => h.label)).toEqual(['Q4 2026', 'Q1 2027']);
    expect(headerCells('2026-11-01', '2026-12-31', 'months').map((h) => h.end)).toEqual(['2026-11-30', '2026-12-31']);
  });
  it('maps dates proportionally inside month columns', () => {
    const s = monthScale('2026-09-01', 24, 40);
    expect(s.width).toBe(960);
    expect(s.x('2026-09-01')).toBe(0);
    expect(s.x('2026-10-01')).toBe(40);
    expect(s.x('2026-10-16')).toBeCloseTo(40 + (15 / 31) * 40, 5);
    expect(s.dateAt(41)).toBe('2026-10-01');
  });
});

describe('dragging bars', () => {
  it('moves, resizes and clamps', () => {
    expect(dragDates('2026-11-02', '2026-11-06', 'move', 3)).toEqual({ start_date: '2026-11-05', due_date: '2026-11-09' });
    expect(dragDates(null, '2026-11-06', 'move', -2)).toEqual({ start_date: null, due_date: '2026-11-04' });
    expect(dragDates('2026-11-02', '2026-11-06', 'end', -10)).toEqual({ start_date: '2026-11-02', due_date: '2026-11-02' });
    expect(dragDates('2026-11-02', '2026-11-06', 'start', 2)).toEqual({ start_date: '2026-11-04', due_date: '2026-11-06' });
    expect(dragDates(null, '2026-11-06', 'start', -3)).toEqual({ start_date: '2026-11-03', due_date: '2026-11-06' });
  });
});
