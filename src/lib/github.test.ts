import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearGitHubCache, fetchGitHubState, parseGitHubUrl } from './github';

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

describe('parseGitHubUrl', () => {
  it('parses issues and pull requests', () => {
    expect(parseGitHubUrl('https://github.com/akaminas/Tessera/issues/12')).toEqual({ owner: 'akaminas', repo: 'Tessera', number: 12, type: 'issue' });
    expect(parseGitHubUrl('https://github.com/a-b/c.d/pull/7/files#diff')).toEqual({ owner: 'a-b', repo: 'c.d', number: 7, type: 'pull' });
  });
  it('rejects other URLs', () => {
    expect(parseGitHubUrl('https://github.com/a/b')).toBeNull();
    expect(parseGitHubUrl('https://gitlab.com/a/b/issues/1')).toBeNull();
    expect(parseGitHubUrl('https://github.com.evil.example/a/b/issues/1')).toBeNull();
  });
});

describe('fetchGitHubState', () => {
  beforeEach(() => clearGitHubCache());

  it('reports open issues and caches the result', async () => {
    const f = vi.fn(async () => json({ state: 'open', title: 'Bug' }));
    const url = 'https://github.com/o/r/issues/1';
    expect(await fetchGitHubState(url, f)).toEqual({ state: 'open', title: 'Bug', type: 'issue', url });
    await fetchGitHubState(url, f);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('detects merged pull requests', async () => {
    const f = vi.fn(async (u: string) => (u.endsWith('/pulls/5') ? json({ merged_at: '2026-01-01T00:00:00Z' }) : json({ state: 'closed', title: 'Feature', pull_request: {} })));
    const s = await fetchGitHubState('https://github.com/o/r/pull/5', f);
    expect(s?.state).toBe('merged');
    expect(s?.type).toBe('pull');
  });

  it('returns closed for closed but unmerged pull requests', async () => {
    const f = vi.fn(async (u: string) => (u.endsWith('/pulls/6') ? json({ merged_at: null }) : json({ state: 'closed', title: 'Nope', pull_request: {} })));
    expect((await fetchGitHubState('https://github.com/o/r/pull/6', f))?.state).toBe('closed');
  });

  it('backs off after hitting the rate limit and returns null on failure', async () => {
    const reset = Math.floor(Date.now() / 1000) + 600;
    const f = vi.fn(async () => json({ message: 'rate limited' }, 403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) }));
    expect(await fetchGitHubState('https://github.com/o/r/issues/2', f)).toBeNull();
    expect(await fetchGitHubState('https://github.com/o/r/issues/3', f)).toBeNull();
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('returns null for network errors and unknown URLs', async () => {
    const f = vi.fn(async () => {
      throw new Error('offline');
    });
    expect(await fetchGitHubState('https://github.com/o/r/issues/9', f)).toBeNull();
    expect(await fetchGitHubState('https://example.org', f)).toBeNull();
  });
});
