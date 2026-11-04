/**
 * Reading tasks out of a note. Pure functions, no Obsidian imports, so they
 * are tested on their own.
 *
 * Recognised: `- [ ] text`, `* [x] text`, `1. [ ] text`, with the common
 * Tasks-plugin emoji (📅 due, 🛫 start, ⏫ 🔼 🔽 🔺 priority) or Dataview-style
 * `[due:: 2026-11-20]` fields. A task that was sent earlier carries a small
 * link to its card, `[↗](https://…/c/<id>)`, which is how it is recognised.
 */

export type Priority = 'none' | 'low' | 'medium' | 'high' | 'urgent';

export interface NoteTask {
  /** 0-based line in the note */
  line: number;
  checked: boolean;
  /** `[-]` */
  cancelled: boolean;
  /** text without dates, priority marks and the card link */
  title: string;
  due?: string;
  start?: string;
  priority?: Priority;
  /** present when this line was sent before */
  cardId?: string;
}

const TASK_LINE = /^(\s*(?:[-*+]|\d+[.)])\s+)\[(.)\](\s+)(.*)$/;
const CARD_LINK = /\[[^\]]*\]\([^)\s]*\/c\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)/;
const CARD_LINK_G = new RegExp(CARD_LINK.source, 'g');

const VS = '\\uFE0F?';
const DATE = '(\\d{4}-\\d{2}-\\d{2})';
const EMOJI_DATE = (emoji: string) => new RegExp(`${emoji}${VS}\\s*${DATE}`, 'u');
const DUE_EMOJI = EMOJI_DATE('\\u{1F4C5}'); // 📅
const START_EMOJI = EMOJI_DATE('\\u{1F6EB}'); // 🛫
const OTHER_DATE_EMOJI = new RegExp(`[\\u23F3\\u2705\\u2795\\u274C]${VS}\\s*${DATE}`, 'gu'); // ⏳ ✅ ➕ ❌
const RECURRENCE = /\u{1F501}️?\s*[^\u{1F4C5}\u{1F6EB}⏳✅➕❌⏫\u{1F53C}\u{1F53D}\u{1F53A}⏬[]*/gu; // 🔁 every …
const PRIORITY_EMOJI: [RegExp, Priority][] = [
  [new RegExp(`\\u{1F53A}${VS}`, 'u'), 'urgent'], // 🔺
  [new RegExp(`\\u23EB${VS}`, 'u'), 'high'], // ⏫
  [new RegExp(`\\u{1F53C}${VS}`, 'u'), 'medium'], // 🔼
  [new RegExp(`\\u{1F53D}${VS}`, 'u'), 'low'], // 🔽
  [new RegExp(`\\u23EC${VS}`, 'u'), 'low'], // ⏬
];
const FIELD = /[[(]\s*([A-Za-z]+)::\s*([^\])]*?)\s*[\])]/g; // [due:: 2026-11-20]
const BARE_FIELD = /(?:^|\s)(due|start|priority)::\s*(\S+)/gi;

export function isRealDate(s: string | undefined): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function priorityFromWord(w: string): Priority | undefined {
  const x = w.trim().toLowerCase();
  if (['highest', 'urgent'].includes(x)) return 'urgent';
  if (x === 'high') return 'high';
  if (x === 'medium') return 'medium';
  if (['low', 'lowest'].includes(x)) return 'low';
  return undefined;
}

/** Index of the first date, priority or field mark, so a link can go before them. */
function firstMarkIndex(text: string): number {
  const marks = [
    /[\u{1F4C5}\u{1F6EB}⏳✅➕❌\u{1F501}⏫\u{1F53C}\u{1F53D}\u{1F53A}⏬]/u,
    /[[(]\s*[A-Za-z]+::/,
    /(?:^|\s)(?:due|start|priority)::/i,
  ];
  let best = -1;
  for (const m of marks) {
    const i = text.search(m);
    if (i >= 0 && (best < 0 || i < best)) best = i;
  }
  return best;
}

function plainText(s: string): string {
  return s
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2') // [[note|shown]] → shown
    .replace(/\[\[([^\]]*)\]\]/g, '$1') // [[note]] → note
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseTaskText(rest: string): Omit<NoteTask, 'line' | 'checked' | 'cancelled'> {
  let text = rest;
  const cardId = CARD_LINK.exec(text)?.[1]?.toLowerCase();
  text = text.replace(CARD_LINK_G, ' ');

  let due: string | undefined;
  let start: string | undefined;
  let priority: Priority | undefined;

  const d = DUE_EMOJI.exec(text);
  if (d && isRealDate(d[1])) due = d[1];
  const s = START_EMOJI.exec(text);
  if (s && isRealDate(s[1])) start = s[1];
  text = text.replace(DUE_EMOJI, ' ').replace(START_EMOJI, ' ').replace(OTHER_DATE_EMOJI, ' ').replace(RECURRENCE, ' ');
  for (const [re, p] of PRIORITY_EMOJI) {
    if (re.test(text)) {
      priority ??= p;
      text = text.replace(re, ' ');
    }
  }

  const readField = (name: string, value: string) => {
    const n = name.toLowerCase();
    if (n === 'due' && isRealDate(value)) due ??= value;
    else if (n === 'start' && isRealDate(value)) start ??= value;
    else if (n === 'priority') priority ??= priorityFromWord(value);
  };
  text = text.replace(FIELD, (all, name: string, value: string) => {
    if (!['due', 'start', 'priority'].includes(name.toLowerCase())) return all;
    readField(name, value);
    return ' ';
  });
  text = text.replace(BARE_FIELD, (_all, name: string, value: string) => {
    readField(name, value);
    return ' ';
  });

  return { title: plainText(text), due, start, priority, cardId };
}

/** All checkbox lines of a note, skipping front matter and code blocks. */
export function parseTasks(note: string): NoteTask[] {
  const lines = note.split(/\r?\n/);
  const out: NoteTask[] = [];
  let i = 0;
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((l, n) => n > 0 && (l.trim() === '---' || l.trim() === '...'));
    if (end > 0) i = end + 1;
  }
  let fence: string | null = null;
  for (; i < lines.length; i++) {
    const line = lines[i];
    const f = /^\s*(```+|~~~+)/.exec(line);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      continue;
    }
    if (fence) continue;
    const m = TASK_LINE.exec(line);
    if (!m) continue;
    const mark = m[2];
    const parsed = parseTaskText(m[4]);
    if (!parsed.title) continue;
    out.push({ line: i, checked: mark === 'x' || mark === 'X', cancelled: mark === '-', ...parsed });
  }
  return out;
}

export function cardUrl(site: string, cardId: string): string {
  return `${site.replace(/\/+$/, '')}/c/${cardId}`;
}

/** Add the card link to a task line (before any trailing dates, so the Tasks plugin still reads them). */
export function withCardLink(line: string, site: string, cardId: string): string {
  if (CARD_LINK.test(line)) return line;
  const m = TASK_LINE.exec(line);
  if (!m) return line;
  const rest = m[4];
  const link = `[↗](${cardUrl(site, cardId)})`;
  const at = firstMarkIndex(rest);
  const body = at < 0 ? `${rest.trimEnd()} ${link}` : `${rest.slice(0, at).trimEnd()} ${link} ${rest.slice(at)}`;
  return `${m[1]}[${m[2]}]${m[3]}${body}`;
}

/** Tick or untick a task line. */
export function withChecked(line: string, checked: boolean): string {
  const m = TASK_LINE.exec(line);
  if (!m) return line;
  return `${m[1]}[${checked ? 'x' : ' '}]${m[3]}${m[4]}`;
}

/** Description given to a task created from a note. */
export function noteDescription(noteName: string): string {
  return `From Obsidian note “${noteName}”.`;
}
