import { describe, expect, it } from 'vitest';
import { buildICS, escapeText, foldLine } from './ical';

describe('ical', () => {
  const now = new Date('2026-11-04T10:20:30.123Z');

  it('writes all-day events with an exclusive end date and CRLF line endings', () => {
    const ics = buildICS([{ uid: 'card-1', title: 'Report', start: '2026-12-30', end: '2026-12-31', url: 'https://example.org/c/1' }], 'Mine', now);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics).toContain('DTSTART;VALUE=DATE:20261230\r\n');
    expect(ics).toContain('DTEND;VALUE=DATE:20270101\r\n');
    expect(ics).toContain('DTSTAMP:20261104T102030Z\r\n');
    expect(ics).toContain('X-WR-CALNAME:Mine\r\n');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.split('\r\n').every((l) => !l.includes('\n'))).toBe(true);
  });

  it('defaults the end to the start (single day)', () => {
    expect(buildICS([{ uid: 'x', title: 't', start: '2026-02-28' }], 'C', now)).toContain('DTEND;VALUE=DATE:20260301');
  });

  it('escapes text values', () => {
    expect(escapeText('a, b; c\\d\nnext')).toBe('a\\, b\\; c\\\\d\\nnext');
  });

  it('folds long lines at 75 octets without splitting characters', () => {
    const long = 'SUMMARY:' + 'é'.repeat(80);
    const folded = foldLine(long);
    const physical = folded.split('\r\n');
    expect(physical.length).toBeGreaterThan(1);
    const enc = new TextEncoder();
    for (const p of physical) expect(enc.encode(p).length).toBeLessThanOrEqual(75);
    expect(physical.slice(1).every((p) => p.startsWith(' '))).toBe(true);
    expect(physical.map((p, i) => (i ? p.slice(1) : p)).join('')).toBe(long);
  });
});
