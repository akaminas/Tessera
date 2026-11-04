import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Briefcase, FileText, LayoutGrid, MessageSquare, Search } from 'lucide-react';
import { useSearch, type SearchHit } from '@/data/personal';
import { useAllProjects } from '@/data/core';
import { EmptyState, ErrorNote, Input, PageHeader, Spinner } from '@/components/ui';

const KIND_META: Record<SearchHit['kind'], { label: string; icon: React.ReactNode }> = {
  card: { label: 'Tasks', icon: <FileText className="size-4" aria-hidden /> },
  project: { label: 'Projects', icon: <Briefcase className="size-4" aria-hidden /> },
  board: { label: 'Boards', icon: <LayoutGrid className="size-4" aria-hidden /> },
  comment: { label: 'Comments', icon: <MessageSquare className="size-4" aria-hidden /> },
};

function hrefFor(h: SearchHit) {
  if (h.kind === 'project') return `/p/${h.id}`;
  if (h.kind === 'board') return `/p/${h.project_id}/board/${h.id}`;
  return `/p/${h.project_id}/board/${h.board_id}?card=${h.card_id}`;
}

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const results = useSearch(params.get('q') ?? '');
  const projects = useAllProjects();
  const projectName = new Map((projects.data ?? []).map((p) => [p.id, p.name]));
  useEffect(() => setQ(params.get('q') ?? ''), [params]);

  const groups = (['card', 'project', 'board', 'comment'] as const)
    .map((k) => ({ kind: k, hits: (results.data ?? []).filter((h) => h.kind === k) }))
    .filter((g) => g.hits.length);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-6 sm:px-6">
      <PageHeader title="Search" subtitle="Tasks, descriptions, projects, boards and comments you have access to." />
      <form
        role="search"
        className="relative"
        onSubmit={(e) => {
          e.preventDefault();
          setParams(q.trim() ? { q: q.trim() } : {});
        }}
      >
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
        <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" aria-label="Search" placeholder="Search everything" />
      </form>
      {results.isFetching && <Spinner label="Searching" />}
      {results.error && <ErrorNote error={results.error} />}
      {(params.get('q') ?? '').trim().length >= 2 && !results.isFetching && groups.length === 0 && (
        <EmptyState title="No results">Try fewer or different words. Search covers only projects you can access.</EmptyState>
      )}
      {groups.map((g) => (
        <section key={g.kind}>
          <h2 className="mb-1 flex items-center gap-2 font-sans text-sm font-bold text-secondary">
            {KIND_META[g.kind].icon}
            {KIND_META[g.kind].label} <span className="num font-normal">{g.hits.length}</span>
          </h2>
          <ul className="divide-y divide-grid">
            {g.hits.map((h) => (
              <li key={h.kind + h.id} className="py-2">
                <Link to={hrefFor(h)} className="block hover:underline">
                  <span className="text-sm">{h.title}</span>
                </Link>
                <p className="text-xs text-secondary">
                  {projectName.get(h.project_id) ?? ''}
                  {h.snippet ? ` · ${h.snippet.replace(/@\[([^\]]+)\]\(user:[^)]+\)/g, '@$1').slice(0, 140)}` : ''}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
