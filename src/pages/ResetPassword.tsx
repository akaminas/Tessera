import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { Button, Field, Input, Spinner } from '@/components/ui';
import { humanError } from '@/data/errors';
import { sb } from '@/lib/supabase';
import { Logo } from '@/layout/Logo';

export default function ResetPassword() {
  const { updatePassword } = useAuth();
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const code = new URL(window.location.href).searchParams.get('code');
    (async () => {
      if (code) await sb().auth.exchangeCodeForSession(code).catch(() => undefined);
      const { data } = await sb().auth.getSession();
      if (!data.session) setError('This reset link is invalid or has expired. Request a new one.');
      setReady(true);
    })();
  }, []);

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-5 px-4">
      <Logo />
      <h1 className="text-2xl">Choose a new password</h1>
      {!ready ? (
        <Spinner />
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (password.length < 8) return setError('Use at least 8 characters.');
            setBusy(true);
            try {
              await updatePassword(password);
              navigate('/', { replace: true });
            } catch (err) {
              setError(humanError(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="New password" htmlFor="pw" hint="At least 8 characters." error={error}>
            <Input id="pw" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Button type="submit" variant="primary" loading={busy}>
            Save password
          </Button>
        </form>
      )}
    </main>
  );
}
