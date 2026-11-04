/**
 * The connection code is what Tessera shows once, next to a new access key:
 * everything the plugin needs in one paste. It contains the key, so it is
 * as private as a password.
 */

export interface Connection {
  /** Supabase URL */
  url: string;
  /** Supabase publishable (anon) key, public by design */
  anonKey: string;
  /** access key (tsr_…) */
  token: string;
  /** address of the Tessera website, for links back to tasks */
  site: string;
}

const PREFIX = 'tessera:';

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function encodeConnection(c: Connection): string {
  const json = JSON.stringify({ v: 1, u: c.url, k: c.anonKey, t: c.token, s: c.site });
  return PREFIX + toBase64Url(new TextEncoder().encode(json));
}

/** Returns the connection, or an error message fit to show a person. */
export function decodeConnection(code: string): { ok: true; connection: Connection } | { ok: false; error: string } {
  const raw = code.trim().replace(/\s+/g, '');
  if (!raw.startsWith(PREFIX)) return { ok: false, error: 'That is not a Tessera connection code. It starts with “tessera:”.' };
  try {
    const obj = JSON.parse(new TextDecoder().decode(fromBase64Url(raw.slice(PREFIX.length))));
    if (obj?.v !== 1 || typeof obj.u !== 'string' || typeof obj.k !== 'string' || typeof obj.t !== 'string' || typeof obj.s !== 'string') {
      return { ok: false, error: 'This connection code is incomplete. Create a new one in Tessera.' };
    }
    if (!/^https:\/\/[^\s]+$/.test(obj.u) || !/^https?:\/\/[^\s]+$/.test(obj.s)) {
      return { ok: false, error: 'This connection code has an invalid address. Create a new one in Tessera.' };
    }
    return { ok: true, connection: { url: obj.u.replace(/\/+$/, ''), anonKey: obj.k, token: obj.t, site: obj.s.replace(/\/+$/, '') } };
  } catch {
    return { ok: false, error: 'This connection code could not be read. Copy it again from Tessera, all of it.' };
  }
}
