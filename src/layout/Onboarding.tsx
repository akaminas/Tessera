import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { acceptInvitation, createWorkspace, useMyInvitations } from '@/data/core';
import { Button, Field, Input } from '@/components/ui';
import { useToast } from '@/components/ui/Toast';
import { Logo } from './Logo';
import { useWorkspaceCtx } from './WorkspaceContext';

/** First run: create a workspace or accept a pending invitation. */
export function Onboarding() {
  const { profile, signOut } = useAuth();
  const { setCurrent } = useWorkspaceCtx();
  const invites = useMyInvitations(true);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const navigate = useNavigate();

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-6 px-4 py-10">
      <Logo />
      <div>
        <h1 className="text-2xl">Welcome{profile?.display_name ? `, ${profile.display_name}` : ''}</h1>
        <p className="mt-1 text-sm text-secondary">A workspace holds your projects and the people you work with.</p>
      </div>
      {(invites.data?.length ?? 0) > 0 && (
        <section className="flex flex-col gap-2 border-l-2 border-teal bg-card p-4">
          <h2 className="text-lg">You have been invited</h2>
          {invites.data!.map((i) => (
            <div key={i.id} className="flex items-center gap-3 text-sm">
              <span className="flex-1">
                <b>{i.workspace_name}</b>
                {i.project_name && <> · {i.project_name}</>}
                {i.invited_by_name && <span className="text-secondary"> from {i.invited_by_name}</span>}
              </span>
              <Button
                size="sm"
                variant="primary"
                onClick={async () => {
                  try {
                    const ws = await acceptInvitation(i.token);
                    setCurrent(ws);
                    navigate(i.project_id ? `/p/${i.project_id}` : '/');
                  } catch (e) {
                    toast.error(e);
                  }
                }}
              >
                Join
              </Button>
            </div>
          ))}
        </section>
      )}
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          setBusy(true);
          try {
            const id = await createWorkspace(name.trim());
            setCurrent(id);
          } catch (err) {
            toast.error(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Create a workspace" htmlFor="ws-name" hint="For example your office, team or organisation. You can rename it later.">
          <Input id="ws-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="My office" maxLength={120} autoFocus />
        </Field>
        <div className="flex gap-2">
          <Button type="submit" variant="primary" loading={busy} disabled={!name.trim()}>
            Create workspace
          </Button>
          <Button variant="ghost" onClick={() => signOut()}>
            Sign out
          </Button>
        </div>
      </form>
    </main>
  );
}
