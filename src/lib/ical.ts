/**
 * Minimal RFC 5545 calendar writer for all-day events.
 * - DTEND is exclusive (end date + 1 day) as the standard requires.
 * - Text values escape backslash, semicolon, comma and newlines.
 * - Lines are folded at 75 octets (UTF-8) with CRLF + space.
 */
export interface IcsEvent {
  uid: string;
  title: string;
  /** YYYY-MM-DD */
  start: string;
  /** inclusive last day, YYYY-MM-DD (defaults to start) */
  end?: string;
  description?: string;
  url?: string;
}

export function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
}

const enc = new TextEncoder();

/** Fold a content line to ≤ 75 octets per physical line, never splitting a UTF-8 character. */
export function foldLine(line: string): string {
  if (enc.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > limit) {
      parts.push(current);
      current = '';
      bytes = 0;
      limit = 74; // continuation lines start with a space
    }
    current += ch;
    bytes += n;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

function ymd(date: string): string {
  return date.replace(/-/g, '');
}

function nextDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  return t.toISOString().slice(0, 10);
}

function stamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export function buildICS(events: IcsEvent[], calendarName = 'Tessera', now: Date = new Date()): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Tessera//Project calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(calendarName)}`,
  ];
  const dtstamp = stamp(now);
  for (const e of events) {
    const end = e.end && e.end >= e.start ? e.end : e.start;
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${escapeText(e.uid)}`);
    lines.push(`DTSTAMP:${dtstamp}`);
    lines.push(`DTSTART;VALUE=DATE:${ymd(e.start)}`);
    lines.push(`DTEND;VALUE=DATE:${ymd(nextDay(end))}`);
    lines.push(`SUMMARY:${escapeText(e.title)}`);
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    lines.push('TRANSP:TRANSPARENT');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

export function downloadICS(filename: string, events: IcsEvent[], calendarName?: string) {
  const blob = new Blob([buildICS(events, calendarName)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.ics') ? filename : `${filename}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
