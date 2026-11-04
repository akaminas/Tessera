import { describe, expect, it } from 'vitest';
import { decodeConnection, encodeConnection } from './connection';

const conn = { url: 'https://abc.supabase.co', anonKey: 'sb_publishable_xyz', token: 'tsr_' + 'a'.repeat(64), site: 'https://akaminas.github.io/Tessera' };

describe('connection code', () => {
  it('round-trips and is safe to paste (no spaces, no +/=)', () => {
    const code = encodeConnection(conn);
    expect(code.startsWith('tessera:')).toBe(true);
    expect(code.slice('tessera:'.length)).not.toMatch(/[\s+/=]/);
    expect(decodeConnection(code)).toEqual({ ok: true, connection: conn });
  });
  it('tolerates whitespace and line breaks from copying', () => {
    const code = encodeConnection(conn);
    const messy = `  ${code.slice(0, 20)}\n${code.slice(20)}  `;
    expect(decodeConnection(messy)).toEqual({ ok: true, connection: conn });
  });
  it('explains what is wrong', () => {
    expect(decodeConnection('hello')).toMatchObject({ ok: false, error: expect.stringMatching(/starts with/) });
    expect(decodeConnection('tessera:@@@')).toMatchObject({ ok: false });
    const bad = encodeConnection({ ...conn, url: 'http://insecure.example' });
    expect(decodeConnection(bad)).toMatchObject({ ok: false, error: expect.stringMatching(/invalid address/) });
  });
});
