import { Logo } from '@/layout/Logo';

/**
 * Shown when the build has no backend configuration. Tessera never falls back
 * to simulated data: without a backend there is nothing truthful to show.
 */
export function BackendMissing() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 px-4 py-10">
      <Logo />
      <div className="border-l-2 border-teal bg-card p-5">
        <h1 className="text-2xl">The backend is not connected</h1>
        <p className="mt-2 text-sm text-secondary">
          This copy of Tessera was built without a Supabase project URL and public key, so it cannot sign you in or
          load data. Tessera does not show sample or simulated data in place of a real backend.
        </p>
        <p className="mt-3 text-sm">
          Administrators: set <code className="font-mono">VITE_SUPABASE_URL</code> and{' '}
          <code className="font-mono">VITE_SUPABASE_ANON_KEY</code> as repository variables and redeploy. See{' '}
          <a className="text-link underline" href="https://github.com/akaminas/Tessera/blob/main/docs/DEPLOYMENT.md">
            the deployment guide
          </a>
          .
        </p>
      </div>
    </main>
  );
}
