import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { sb } from '@/lib/supabase';
import { Spinner } from '@/components/ui';

/** Landing page for email confirmation and sign-in links (PKCE code exchange). */
export default function AuthCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    const errDesc = url.searchParams.get('error_description');
    if (errDesc) {
      setError(errDesc);
      return;
    }
    const code = url.searchParams.get('code');
    const next = url.searchParams.get('next') || '/';
    (async () => {
      try {
        if (code) {
          const { error: e } = await sb().auth.exchangeCodeForSession(code);
          // A code may already have been exchanged automatically (detectSessionInUrl)
          if (e && !(await sb().auth.getSession()).data.session) throw e;
        }
        const { data } = await sb().auth.getSession();
        if (!data.session) throw new Error('The link is invalid or has expired.');
        navigate(next, { replace: true });
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [navigate]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 px-4">
      {error ? (
        <>
          <h1 className="text-2xl">This link did not work</h1>
          <p className="text-sm text-secondary">{error}</p>
          <Link className="text-link underline" to="/login">
            Back to sign in
          </Link>
        </>
      ) : (
        <Spinner label="Signing you in" />
      )}
    </main>
  );
}
