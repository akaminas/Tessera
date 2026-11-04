import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { acceptInvitation } from '@/data/core';
import { humanError } from '@/data/errors';
import { Button } from '@/components/ui';
import { useAuth } from '@/auth/AuthProvider';
import { useWorkspaceCtx } from '@/layout/WorkspaceContext';

export default function InvitePage() {
  const { token } = useParams();
  const { user, signOut } = useAuth();
  const { setCurrent } = useWorkspaceCtx();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="mx-auto max-w-lg px-4 py-12">
      <h1 className="text-2xl">Join a workspace</h1>
      <p className="mt-2 text-sm text-secondary">
        You are signed in as <b className="text-ink">{user?.email}</b>. Invitations only work for the email address they were sent to.
      </p>
      {error && (
        <p role="alert" className="mt-3 text-sm text-critical">
          {error}
        </p>
      )}
      <div className="mt-4 flex gap-2">
        <Button
          variant="primary"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const ws = await acceptInvitation(token!);
              setCurrent(ws);
              navigate('/', { replace: true });
            } catch (err) {
              setError(humanError(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          Accept invitation
        </Button>
        <Button variant="ghost" onClick={() => signOut()}>
          Use another account
        </Button>
      </div>
    </div>
  );
}
