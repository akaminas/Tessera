import { useRouteError, Link } from 'react-router';

export function RouteError() {
  const err = useRouteError() as { message?: string; statusText?: string } | undefined;
  const isChunk = /Failed to fetch dynamically imported module|Importing a module script failed/i.test(err?.message ?? '');
  return (
    <main className="mx-auto max-w-lg px-4 py-16">
      <h1 className="text-2xl">{isChunk ? 'Tessera was updated' : 'Something went wrong'}</h1>
      <p className="mt-2 text-sm text-secondary">
        {isChunk
          ? 'A newer version is available. Reload the page to continue.'
          : err?.message || err?.statusText || 'An unexpected error occurred.'}
      </p>
      <div className="mt-4 flex gap-3 text-sm">
        <button className="h-9 rounded-[4px] border border-accent bg-accent px-3 text-accent-ink" onClick={() => window.location.reload()}>
          Reload
        </button>
        <Link className="flex h-9 items-center rounded-[4px] border border-rule px-3" to="/">
          Go home
        </Link>
      </div>
    </main>
  );
}
