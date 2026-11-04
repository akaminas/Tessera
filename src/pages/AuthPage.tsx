import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { Button, Field, Input } from '@/components/ui';
import { humanError } from '@/data/errors';
import { Logo } from '@/layout/Logo';

type Mode = 'login' | 'signup' | 'forgot';

export default function AuthPage({ mode }: { mode: Mode }) {
  const { user, signIn, signUp, sendPasswordReset, sendMagicLink } = useAuth();
  const [params] = useSearchParams();
  const next = params.get('next') || '/';
  const navigate = useNavigate();
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (user) return <Navigate to={next} replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (mode === 'login') {
        await signIn(email, password);
        navigate(next, { replace: true });
      } else if (mode === 'signup') {
        if (password.length < 8) throw new Error('Use at least 8 characters for your password.');
        const { needsConfirmation } = await signUp(email, password, name);
        if (needsConfirmation) setNotice('Check your email and follow the link to confirm your account.');
        else navigate(next, { replace: true });
      } else {
        await sendPasswordReset(email);
        setNotice('If an account exists for that address, a reset link is on its way.');
      }
    } catch (err) {
      const msg = humanError(err);
      setError(/Invalid login credentials/i.test(msg) ? 'Email or password is incorrect.' : msg);
    } finally {
      setBusy(false);
    }
  };

  const title = { login: 'Sign in', signup: 'Create your account', forgot: 'Reset your password' }[mode];

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-4 py-10">
      <Logo />
      <div>
        <h1 className="text-2xl">{title}</h1>
        <p className="mt-1 text-sm text-secondary">Collaborative project management.</p>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
        {mode === 'signup' && (
          <Field label="Your name" htmlFor="name">
            <Input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
          </Field>
        )}
        <Field label="Email" htmlFor="email">
          <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        {mode !== 'forgot' && (
          <Field label="Password" htmlFor="password" hint={mode === 'signup' ? 'At least 8 characters.' : undefined}>
            <Input
              id="password"
              type="password"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={mode === 'signup' ? 8 : undefined}
            />
          </Field>
        )}
        {error && (
          <p role="alert" className="text-sm text-critical">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="border-l-2 border-teal bg-card px-3 py-2 text-sm">
            {notice}
          </p>
        )}
        <Button type="submit" variant="primary" loading={busy} disabled={!email || (mode !== 'forgot' && !password)}>
          {mode === 'login' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'}
        </Button>
        {mode === 'login' && (
          <Button
            variant="ghost"
            disabled={!email || busy}
            onClick={async () => {
              setError(null);
              try {
                await sendMagicLink(email);
                setNotice('A sign-in link has been sent to your email.');
              } catch (err) {
                setError(humanError(err));
              }
            }}
          >
            Email me a sign-in link instead
          </Button>
        )}
      </form>
      <nav className="flex flex-col gap-1 text-sm">
        {mode !== 'login' && (
          <Link className="text-link underline-offset-2 hover:underline" to={`/login${params.toString() ? `?${params}` : ''}`}>
            Already have an account? Sign in
          </Link>
        )}
        {mode !== 'signup' && (
          <Link className="text-link underline-offset-2 hover:underline" to={`/signup${params.toString() ? `?${params}` : ''}`}>
            New here? Create an account
          </Link>
        )}
        {mode === 'login' && (
          <Link className="text-link underline-offset-2 hover:underline" to="/forgot">
            Forgot your password?
          </Link>
        )}
      </nav>
    </main>
  );
}
