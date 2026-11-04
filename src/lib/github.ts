/**
 * GitHub issue / pull request status for linked documents. Uses the public,
 * unauthenticated REST API (60 requests per hour per IP), so it works for
 * public repositories only. Results are cached in memory for 10 minutes and
 * requests stop until the rate-limit window resets.
 */

export interface GitHubRef {
  owner: string;
  repo: string;
  number: number;
  type: 'issue' | 'pull';
}

export interface GitHubState {
  state: 'open' | 'closed' | 'merged';
  title: string;
  type: 'issue' | 'pull';
  url: string;
}

const RE = /^https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})\/(issues|pull)\/(\d{1,9})(?:[/?#].*)?$/;

export function parseGitHubUrl(url: string): GitHubRef | null {
  const m = url.trim().match(RE);
  if (!m) return null;
  return { owner: m[1], repo: m[2].replace(/\.git$/, ''), number: Number(m[4]), type: m[3] === 'pull' ? 'pull' : 'issue' };
}

const TTL = 10 * 60_000;
const cache = new Map<string, { at: number; value: Promise<GitHubState | null> }>();
let blockedUntil = 0;

export function clearGitHubCache() {
  cache.clear();
  blockedUntil = 0;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

function noteRateLimit(res: Response) {
  if (res.status === 403 || res.status === 429) {
    const remaining = res.headers.get('x-ratelimit-remaining');
    const reset = Number(res.headers.get('x-ratelimit-reset'));
    const retryAfter = Number(res.headers.get('retry-after'));
    if (remaining === '0' && Number.isFinite(reset) && reset > 0) blockedUntil = reset * 1000;
    else if (Number.isFinite(retryAfter) && retryAfter > 0) blockedUntil = Date.now() + retryAfter * 1000;
    else blockedUntil = Date.now() + 60_000;
  }
}

async function load(ref: GitHubRef, url: string, f: Fetch): Promise<GitHubState | null> {
  const base = `https://api.github.com/repos/${ref.owner}/${ref.repo}`;
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  try {
    const res = await f(`${base}/issues/${ref.number}`, { headers });
    if (!res.ok) {
      noteRateLimit(res);
      return null;
    }
    const issue = (await res.json()) as { state?: string; title?: string; pull_request?: unknown };
    const isPull = Boolean(issue.pull_request) || ref.type === 'pull';
    let state: GitHubState['state'] = issue.state === 'closed' ? 'closed' : 'open';
    if (isPull && state === 'closed') {
      const pr = await f(`${base}/pulls/${ref.number}`, { headers });
      if (pr.ok) {
        const body = (await pr.json()) as { merged_at?: string | null };
        if (body.merged_at) state = 'merged';
      } else noteRateLimit(pr);
    }
    return { state, title: String(issue.title ?? ''), type: isPull ? 'pull' : 'issue', url };
  } catch {
    return null;
  }
}

/** Current state of a GitHub issue or pull request, or null if unavailable. */
export function fetchGitHubState(url: string, f: Fetch = (i, init) => fetch(i, init)): Promise<GitHubState | null> {
  const ref = parseGitHubUrl(url);
  if (!ref) return Promise.resolve(null);
  const key = `${ref.owner}/${ref.repo}#${ref.number}`.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  if (Date.now() < blockedUntil) return Promise.resolve(null);
  const value = load(ref, url, f);
  cache.set(key, { at: Date.now(), value });
  // Do not keep failures for the full TTL
  value.then((v) => {
    if (!v) cache.delete(key);
  });
  return value;
}
