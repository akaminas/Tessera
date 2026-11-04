import { useQuery } from '@tanstack/react-query';
import { CircleDot, CircleCheck, GitMerge } from 'lucide-react';
import { fetchGitHubState, parseGitHubUrl } from '@/lib/github';

/**
 * Live state of a linked GitHub issue or pull request (public repositories).
 * Renders nothing when the state cannot be fetched (private repo, rate limit,
 * offline) — the link itself still works.
 */
export function GitHubLinkStatus({ url }: { url: string }) {
  const ref = parseGitHubUrl(url);
  const q = useQuery({
    queryKey: ['github', url],
    enabled: Boolean(ref),
    staleTime: 10 * 60_000,
    retry: false,
    queryFn: () => fetchGitHubState(url),
  });
  if (!ref || !q.data) return null;
  const meta = {
    open: { icon: <CircleDot className="size-3.5 text-good" aria-hidden />, word: 'Open' },
    closed: { icon: <CircleCheck className="size-3.5 text-secondary" aria-hidden />, word: 'Closed' },
    merged: { icon: <GitMerge className="size-3.5 text-mauve" aria-hidden />, word: 'Merged' },
  }[q.data.state];
  return (
    <span className="inline-flex items-center gap-1 text-xs" title={`${q.data.type === 'pull' ? 'Pull request' : 'Issue'} #${ref.number}: ${q.data.title}`}>
      {meta.icon}
      <span className="text-ink">{meta.word}</span>
    </span>
  );
}
