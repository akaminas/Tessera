// Minimal RFC 5545 calendar builder (all-day events). Runs on Deno.

export interface CalendarEvent {
  uid: string;
  title: string;
  /** YYYY-MM-DD (inclusive) */
  starts: string;
  /** YYYY-MM-DD (inclusive); defaults to starts */
  ends?: string | null;
  description?: string | null;
  url?: string | null;
}

/** Escape TEXT values (RFC 5545 §3.3.11). */
export function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

const enc = new TextEncoder();

/** Fold a content line at 75 octets without splitting UTF-8 characters (§3.1). */
export function foldLine(line: string): string {
  if (enc.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  let size = 0;
  let limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (size + n > limit) {
      parts.push(current);
      current = '';
      size = 0;
      limit = 74; // continuation lines start with a space
    }
    current += ch;
    size += n;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

function compactDate(d: string): string {
  return d.replace(/-/g, '');
}

function nextDay(d: string): string {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10).replace(/-/g, '');
}

function stamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export function buildCalendar(events: CalendarEvent[], opts: { name: string; domain: string; now?: Date }): string {
  const now = stamp(opts.now ?? new Date());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Tessera//Project calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(opts.name)}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ];
  for (const e of events) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.starts)) continue;
    const end = e.ends && /^\d{4}-\d{2}-\d{2}$/.test(e.ends) && e.ends >= e.starts ? e.ends : e.starts;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}@${opts.domain}`,
      `DTSTAMP:${now}`,
      `DTSTART;VALUE=DATE:${compactDate(e.starts)}`,
      `DTEND;VALUE=DATE:${nextDay(end)}`,
      `SUMMARY:${escapeText(e.title)}`,
    );
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    lines.push('TRANSP:TRANSPARENT', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
