import { describe, expect, it } from 'vitest';
import { cardUrl, noteDescription, parseTasks, parseTaskText, withCardLink, withChecked } from './parse';

const SITE = 'https://example.github.io/Tessera';
const ID = '3f2b8c1e-5a4d-4e6f-9b7a-0c1d2e3f4a5b';

describe('parseTasks', () => {
  it('finds checkbox lines in any list style and keeps their line numbers', () => {
    const note = ['# Plan', '', '- [ ] First', '* [x] Second', '1. [ ] Third', '   - [ ] Nested', 'Not a task', '- [-] Dropped'].join('\n');
    const t = parseTasks(note);
    expect(t.map((x) => [x.line, x.title, x.checked, x.cancelled])).toEqual([
      [2, 'First', false, false],
      [3, 'Second', true, false],
      [4, 'Third', false, false],
      [5, 'Nested', false, false],
      [7, 'Dropped', false, true],
    ]);
  });

  it('skips front matter and code blocks', () => {
    const note = ['---', 'tags: [a]', '- [ ] in front matter', '---', '- [ ] real', '```', '- [ ] in code', '```', '~~~md', '- [ ] in tilde code', '~~~', '- [ ] also real'].join('\n');
    expect(parseTasks(note).map((x) => x.title)).toEqual(['real', 'also real']);
  });

  it('reads Tasks-plugin dates and priority and removes them from the title', () => {
    const [t] = parseTasks('- [ ] Draft budget ⏫ 🛫 2026-11-02 📅 2026-11-20 ➕ 2026-10-01 🔁 every week');
    expect(t).toMatchObject({ title: 'Draft budget', due: '2026-11-20', start: '2026-11-02', priority: 'high' });
  });

  it('understands every priority mark', () => {
    const p = (m: string) => parseTasks(`- [ ] x ${m}`)[0].priority;
    expect([p('🔺'), p('⏫'), p('🔼'), p('🔽'), p('⏬')]).toEqual(['urgent', 'high', 'medium', 'low', 'low']);
  });

  it('reads Dataview-style fields in brackets and bare', () => {
    expect(parseTasks('- [ ] Call back [due:: 2026-12-01] [priority:: high]')[0]).toMatchObject({ title: 'Call back', due: '2026-12-01', priority: 'high' });
    expect(parseTasks('- [ ] Write due:: 2026-12-02 start:: 2026-11-30')[0]).toMatchObject({ title: 'Write', due: '2026-12-02', start: '2026-11-30' });
  });

  it('ignores impossible dates', () => {
    expect(parseTasks('- [ ] Odd 📅 2026-13-45')[0].due).toBeUndefined();
    expect(parseTasks('- [ ] Odd 📅 2026-02-30')[0].due).toBeUndefined();
  });

  it('shows wiki links as plain text', () => {
    expect(parseTasks('- [ ] Email [[Maria Lopez|Maria]] about [[Budget 2027]]')[0].title).toBe('Email Maria about Budget 2027');
  });

  it('recognises a task sent before by its card link', () => {
    const t = parseTasks(`- [ ] Draft budget [↗](${SITE}/c/${ID}) 📅 2026-11-20`)[0];
    expect(t).toMatchObject({ title: 'Draft budget', cardId: ID, due: '2026-11-20' });
  });
});

describe('withCardLink', () => {
  it('puts the link before the dates so the Tasks plugin still reads them', () => {
    const out = withCardLink('- [ ] Draft budget ⏫ 📅 2026-11-20', SITE, ID);
    expect(out).toBe(`- [ ] Draft budget [↗](${SITE}/c/${ID}) ⏫ 📅 2026-11-20`);
  });
  it('appends the link when there are no marks, and never twice', () => {
    const once = withCardLink('- [ ] Plain task', SITE, ID);
    expect(once).toBe(`- [ ] Plain task [↗](${SITE}/c/${ID})`);
    expect(withCardLink(once, SITE, ID)).toBe(once);
  });
  it('keeps indentation and the bullet', () => {
    expect(withCardLink('    1. [ ] Nested', SITE, ID)).toBe(`    1. [ ] Nested [↗](${SITE}/c/${ID})`);
  });
  it('round-trips through the parser', () => {
    const line = withCardLink('- [ ] Send invoice 📅 2026-11-21', SITE, ID);
    expect(parseTaskText(line.replace(/^- \[ \] /, ''))).toMatchObject({ title: 'Send invoice', cardId: ID, due: '2026-11-21' });
  });
});

describe('withChecked', () => {
  it('ticks and unticks without touching the rest of the line', () => {
    expect(withChecked('  - [ ] Thing 📅 2026-11-20', true)).toBe('  - [x] Thing 📅 2026-11-20');
    expect(withChecked('  - [x] Thing', false)).toBe('  - [ ] Thing');
    expect(withChecked('not a task', true)).toBe('not a task');
  });
});

describe('small helpers', () => {
  it('builds card addresses without doubled slashes', () => {
    expect(cardUrl('https://a.b/Tessera/', ID)).toBe(`https://a.b/Tessera/c/${ID}`);
  });
  it('describes where a task came from', () => {
    expect(noteDescription('Weekly plan')).toBe('From Obsidian note “Weekly plan”.');
  });
});
