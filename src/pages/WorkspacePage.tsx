import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { addDays, format, formatDistanceToNow, parseISO } from 'date-fns';
import { Copy, Mail, Plus, Trash2, UserMinus } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import {
  createInvitation,
  createWorkspace,
  deleteOrganization,
  removeWorkspaceMember,
  revokeInvitation,
  saveOrganization,
  setWorkspaceMember,
  updateWorkspace,
  useActivity,
  useOrganizations,
  useWorkspaceInvitations,
  useWorkspacePeople,
  useWorkspaceProjects,
} from '@/data/core';
import { sb } from '@/lib/supabase';
import { must } from '@/data/errors';
import { appUrl } from '@/lib/env';
import { Avatar, Button, EmptyState, Field, IconButton, Input, PageHeader, PageLoading, Select, Textarea, familyBar } from '@/components/ui';
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog';
import { useToast } from '@/components/ui/Toast';
import { useWorkspaceCtx } from '@/layout/WorkspaceContext';
import { cn } from '@/lib/cn';
import type { Organization, WorkspaceRole } from '@/data/types';
import { Meter } from '@/components/charts';

type Tab = 'overview' | 'members' | 'organisations' | 'workload' | 'activity' | 'settings';
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'members', label: 'Members' },
  { id: 'organisations', label: 'Organisations' },
  { id: 'workload', label: 'Workload' },
  { id: 'activity', label: 'Activity' },
  { id: 'settings', label: 'Settings' },
];
const ROLE_LABEL: Record<WorkspaceRole, string> = { owner: 'Owner', admin: 'Administrator', member: 'Member', guest: 'Guest' };

export default function WorkspacePage() {
  const { workspaceId, tab = 'overview' } = useParams();
  const { current, workspaces, setCurrent } = useWorkspaceCtx();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const ws = workspaces.find((w) => w.id === (workspaceId ?? current?.id)) ?? current;

  useEffect(() => {
    if (workspaceId && workspaceId !== current?.id && workspaces.some((w) => w.id === workspaceId)) setCurrent(workspaceId);
  }, [workspaceId, current?.id, workspaces, setCurrent]);

  if (!ws) return <PageLoading />;
  const isAdmin = ws.my_role === 'owner' || ws.my_role === 'admin';

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-6 sm:px-6">
      <PageHeader
        eyebrow="Workspace"
        title={ws.name}
        subtitle={ws.description || `You are ${ROLE_LABEL[ws.my_role].toLowerCase()} of this workspace.`}
        actions={
          <Button icon={<Plus className="size-4" />} onClick={() => setParams({ new: '1' })}>
            New workspace
          </Button>
        }
      />
      <nav className="scroll-thin -mt-2 flex gap-1 overflow-x-auto border-b border-grid" aria-label="Workspace sections">
        {TABS.map((t) => (
          <Link
            key={t.id}
            to={`/workspace/${ws.id}/${t.id}`}
            className={cn('-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm', tab === t.id ? 'border-teal-deep font-bold' : 'border-transparent text-secondary hover:text-ink')}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {tab === 'overview' && <Overview workspaceId={ws.id} />}
      {tab === 'members' && <Members workspaceId={ws.id} isAdmin={isAdmin} myRole={ws.my_role} />}
      {tab === 'organisations' && <Organisations workspaceId={ws.id} canEdit={ws.my_role !== 'guest'} isAdmin={isAdmin} />}
      {tab === 'workload' && <Workload workspaceId={ws.id} />}
      {tab === 'activity' && <WorkspaceActivity workspaceId={ws.id} />}
      {tab === 'settings' && <Settings ws={ws} isOwner={ws.my_role === 'owner'} isAdmin={isAdmin} onDeleted={() => navigate('/')} />}
      {params.get('new') === '1' && <NewWorkspaceDialog onClose={() => setParams({})} />}
    </div>
  );
}

/* ---------------------------------------------------------------- Overview */

function Overview({ workspaceId }: { workspaceId: string }) {
  const projects = useWorkspaceProjects(workspaceId);
  const ids = (projects.data ?? []).filter((p) => !p.personal_owner).map((p) => p.id);
  const summaries = useQuery({
    queryKey: ['ws', workspaceId, 'summaries', ids.join(',')],
    enabled: ids.length > 0,
    queryFn: async () => {
      const out: Record<string, { tasks_total: number; tasks_done: number; tasks_overdue: number; milestones_overdue: number; risks_high: number; evidence_missing: number }> = {};
      await Promise.all(
        ids.map(async (id) => {
          const rows = must(await sb().rpc('project_summary', { p_project: id })) as (typeof out)[string][];
          out[id] = rows[0];
        }),
      );
      return out;
    },
  });
  const list = (projects.data ?? []).filter((p) => !p.personal_owner);
  if (projects.isLoading) return <PageLoading />;
  if (!list.length) return <EmptyState title="No projects in this workspace" action={<Link to="/projects?new=1" className="text-sm text-link underline">Create one</Link>} />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-rule text-left">
            <th className="py-2 pr-3">Project</th>
            <th className="py-2 pr-3">Status</th>
            <th className="py-2 pr-3">Ends</th>
            <th className="py-2 pr-3">Tasks done</th>
            <th className="py-2 pr-3 text-right">Overdue tasks</th>
            <th className="py-2 pr-3 text-right">Overdue milestones</th>
            <th className="py-2 pr-3 text-right">High risks</th>
            <th className="py-2 text-right">Missing evidence</th>
          </tr>
        </thead>
        <tbody>
          {list.map((p) => {
            const s = summaries.data?.[p.id];
            const pct = s && s.tasks_total ? (100 * s.tasks_done) / s.tasks_total : 0;
            return (
              <tr key={p.id} className="border-b border-grid">
                <td className="py-2 pr-3">
                  <Link to={`/p/${p.id}`} className="flex items-center gap-2 hover:underline">
                    <span className={cn('size-2.5 rounded-[2px]', familyBar[p.color])} aria-hidden />
                    {p.name}
                  </Link>
                </td>
                <td className="py-2 pr-3 capitalize">{p.status.replace('_', ' ')}</td>
                <td className="num py-2 pr-3 text-secondary">{p.end_date ? format(parseISO(p.end_date), 'd MMM yyyy') : '—'}</td>
                <td className="w-44 py-2 pr-3">{s ? <Meter value={pct} label={`${p.name} tasks done`} /> : '…'}</td>
                <td className={cn('num py-2 pr-3 text-right', s?.tasks_overdue ? 'text-critical' : '')}>{s?.tasks_overdue ?? '…'}</td>
                <td className={cn('num py-2 pr-3 text-right', s?.milestones_overdue ? 'text-critical' : '')}>{s?.milestones_overdue ?? '…'}</td>
                <td className="num py-2 pr-3 text-right">{s?.risks_high ?? '…'}</td>
                <td className="num py-2 text-right">{s?.evidence_missing ?? '…'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-muted">Counts come from each project’s live records. Overdue means past the due date and not done.</p>
    </div>
  );
}

/* ----------------------------------------------------------------- Members */

function Members({ workspaceId, isAdmin, myRole }: { workspaceId: string; isAdmin: boolean; myRole: WorkspaceRole }) {
  const { user } = useAuth();
  const people = useWorkspacePeople(workspaceId);
  const orgs = useOrganizations(workspaceId);
  const invites = useWorkspaceInvitations(workspaceId, isAdmin);
  const projects = useWorkspaceProjects(workspaceId);
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'member' | 'guest'>('member');
  const [projectId, setProjectId] = useState('');
  const [projectRole, setProjectRole] = useState<'manager' | 'member' | 'collaborator' | 'viewer'>('member');
  const [finance, setFinance] = useState<'none' | 'view' | 'edit'>('none');
  const [busy, setBusy] = useState(false);
  const [lastLink, setLastLink] = useState<string | null>(null);
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);

  return (
    <div className="flex flex-col gap-6">
      {isAdmin && (
        <section className="border-l-2 border-teal bg-card p-4">
          <h2 className="mb-2 text-lg">Invite someone</h2>
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                const inv = await createInvitation({
                  workspace_id: workspaceId,
                  email: email.trim(),
                  role,
                  project_id: projectId || null,
                  project_role: projectId ? projectRole : null,
                  finance_access: projectId ? finance : 'none',
                });
                const link = appUrl(`invite/${inv.token}`);
                setLastLink(link);
                setEmail('');
                toast.show('Invitation created. Share the link with the person.');
              } catch (err) {
                toast.error(err);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label="Email address" htmlFor="inv-email">
              <Input id="inv-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </Field>
            <Field label="Workspace role" htmlFor="inv-role" hint="Guests only see projects they are added to.">
              <Select id="inv-role" value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
                <option value="member">Member</option>
                <option value="guest">Guest (external)</option>
                {myRole === 'owner' || myRole === 'admin' ? <option value="admin">Administrator</option> : null}
              </Select>
            </Field>
            <Field label="Also add to a project (optional)" htmlFor="inv-proj">
              <Select id="inv-proj" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">No project</option>
                {(projects.data ?? []).filter((p) => !p.personal_owner).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            {projectId && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Project role" htmlFor="inv-prole">
                  <Select id="inv-prole" value={projectRole} onChange={(e) => setProjectRole(e.target.value as typeof projectRole)}>
                    <option value="manager">Project manager</option>
                    <option value="member">Member</option>
                    <option value="collaborator">External collaborator</option>
                    <option value="viewer">Read-only</option>
                  </Select>
                </Field>
                <Field label="Budget access" htmlFor="inv-fin">
                  <Select id="inv-fin" value={finance} onChange={(e) => setFinance(e.target.value as typeof finance)}>
                    <option value="none">No access</option>
                    <option value="view">View</option>
                    <option value="edit">Edit</option>
                  </Select>
                </Field>
              </div>
            )}
            <div className="sm:col-span-2">
              <Button type="submit" variant="primary" loading={busy} icon={<Mail className="size-4" />} disabled={!email.trim()}>
                Create invitation
              </Button>
            </div>
          </form>
          {lastLink && (
            <div className="mt-3 flex items-center gap-2 text-sm">
              <code className="min-w-0 flex-1 truncate rounded-[3px] border border-grid bg-surface px-2 py-1 font-mono text-xs">{lastLink}</code>
              <Button size="sm" icon={<Copy className="size-3.5" />} onClick={() => navigator.clipboard.writeText(lastLink).then(() => toast.show('Link copied'))}>
                Copy link
              </Button>
            </div>
          )}
          <p className="mt-2 text-xs text-secondary">
            The person signs up (or signs in) with this email address and opens the link, or finds the invitation in their Inbox. Links expire after 14 days.
          </p>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-lg">Members</h2>
        {people.isLoading && <PageLoading />}
        <ul className="divide-y divide-grid">
          {(people.data ?? []).map((p) => (
            <li key={p.user_id} className="flex flex-wrap items-center gap-3 py-2">
              <Avatar name={p.display_name} color={p.avatar_color} size={28} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold">
                  {p.display_name} {p.user_id === user?.id && <span className="font-normal text-secondary">(you)</span>}
                </p>
                <p className="truncate text-xs text-secondary">{p.email}</p>
              </div>
              <Select
                aria-label={`Organisation of ${p.display_name}`}
                className="h-8 w-48"
                value={p.organization_id ?? ''}
                disabled={!isAdmin}
                onChange={(e) => setWorkspaceMember(workspaceId, p.user_id, { organization_id: e.target.value || null }).catch(toast.error)}
              >
                <option value="">No organisation</option>
                {(orgs.data ?? []).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.short_name || o.name}
                  </option>
                ))}
              </Select>
              <Select
                aria-label={`Role of ${p.display_name}`}
                className="h-8 w-40"
                value={p.role}
                disabled={!isAdmin || (p.role === 'owner' && myRole !== 'owner')}
                onChange={(e) => setWorkspaceMember(workspaceId, p.user_id, { role: e.target.value as WorkspaceRole }).catch(toast.error)}
              >
                {(['owner', 'admin', 'member', 'guest'] as WorkspaceRole[])
                  .filter((r) => r !== 'owner' || myRole === 'owner' || p.role === 'owner')
                  .map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
              </Select>
              {(isAdmin || p.user_id === user?.id) && (
                <IconButton label={p.user_id === user?.id ? 'Leave workspace' : `Remove ${p.display_name}`} onClick={() => setRemoving({ id: p.user_id, name: p.display_name })}>
                  <UserMinus className="size-4" />
                </IconButton>
              )}
            </li>
          ))}
        </ul>
      </section>

      {isAdmin && (invites.data?.length ?? 0) > 0 && (
        <section>
          <h2 className="mb-2 text-lg">Pending invitations</h2>
          <ul className="divide-y divide-grid">
            {invites.data!.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">
                  {i.email} <span className="text-secondary">· {ROLE_LABEL[i.role]} · expires {format(parseISO(i.expires_at), 'd MMM')}</span>
                </span>
                <Button size="sm" icon={<Copy className="size-3.5" />} onClick={() => navigator.clipboard.writeText(appUrl(`invite/${i.token}`)).then(() => toast.show('Link copied'))}>
                  Copy link
                </Button>
                <Button size="sm" variant="danger" onClick={() => revokeInvitation(i).catch(toast.error)}>
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={removing?.id === user?.id ? 'Leave this workspace?' : `Remove ${removing?.name}?`}
        danger
        confirmLabel={removing?.id === user?.id ? 'Leave' : 'Remove'}
        body="They lose access to every project in this workspace. Their past comments and activity stay, attributed to them."
        onConfirm={() =>
          removeWorkspaceMember(workspaceId, removing!.id)
            .then(() => setRemoving(null))
            .catch(toast.error)
        }
      />
    </div>
  );
}

/* ----------------------------------------------------------- Organisations */

function Organisations({ workspaceId, canEdit, isAdmin }: { workspaceId: string; canEdit: boolean; isAdmin: boolean }) {
  const orgs = useOrganizations(workspaceId);
  const [editing, setEditing] = useState<Partial<Organization> | null>(null);
  const toast = useToast();
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-secondary">Partner organisations and teams. Projects list their partners from here.</p>
        {canEdit && (
          <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEditing({ workspace_id: workspaceId, kind: 'university', name: '', short_name: '', country: '', website: '' })}>
            Add organisation
          </Button>
        )}
      </div>
      {orgs.data?.length === 0 && <EmptyState title="No organisations yet">Add the partners and teams you work with.</EmptyState>}
      <ul className="divide-y divide-grid">
        {(orgs.data ?? []).map((o) => (
          <li key={o.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
            <span className="min-w-0 flex-1">
              <b>{o.name}</b> {o.short_name && <span className="text-secondary">({o.short_name})</span>}
              <span className="block text-xs text-secondary">
                {[o.kind, o.country, o.website].filter(Boolean).join(' · ')}
              </span>
            </span>
            {canEdit && (
              <Button size="sm" onClick={() => setEditing(o)}>
                Edit
              </Button>
            )}
            {isAdmin && (
              <IconButton label={`Delete ${o.name}`} onClick={() => deleteOrganization(o).catch((e) => toast.error(/foreign key|violates/i.test(String(e?.message)) ? new Error('This organisation is a partner in a project. Remove it from the project first.') : e))}>
                <Trash2 className="size-4" />
              </IconButton>
            )}
          </li>
        ))}
      </ul>
      {editing && (
        <Dialog
          open
          onOpenChange={() => setEditing(null)}
          title={editing.id ? 'Edit organisation' : 'Add organisation'}
          footer={
            <Button
              variant="primary"
              disabled={!editing.name?.trim()}
              onClick={() =>
                saveOrganization({ ...editing, workspace_id: workspaceId, name: editing.name!.trim() } as Organization)
                  .then(() => setEditing(null))
                  .catch(toast.error)
              }
            >
              Save
            </Button>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" htmlFor="o-name" className="sm:col-span-2">
              <Input id="o-name" value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </Field>
            <Field label="Short name" htmlFor="o-short">
              <Input id="o-short" value={editing.short_name ?? ''} onChange={(e) => setEditing({ ...editing, short_name: e.target.value })} />
            </Field>
            <Field label="Type" htmlFor="o-kind">
              <Select id="o-kind" value={editing.kind ?? 'other'} onChange={(e) => setEditing({ ...editing, kind: e.target.value as Organization['kind'] })}>
                <option value="university">University / higher education</option>
                <option value="research">Research organisation</option>
                <option value="company">Company</option>
                <option value="public">Public body</option>
                <option value="ngo">Non-profit</option>
                <option value="other">Other</option>
              </Select>
            </Field>
            <Field label="Country" htmlFor="o-country">
              <Input id="o-country" value={editing.country ?? ''} onChange={(e) => setEditing({ ...editing, country: e.target.value })} />
            </Field>
            <Field label="Website" htmlFor="o-web">
              <Input id="o-web" type="url" value={editing.website ?? ''} onChange={(e) => setEditing({ ...editing, website: e.target.value })} />
            </Field>
          </div>
        </Dialog>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------- Workload */

function Workload({ workspaceId }: { workspaceId: string }) {
  const [days, setDays] = useState(14);
  const people = useWorkspacePeople(workspaceId);
  const projects = useWorkspaceProjects(workspaceId);
  const from = format(new Date(), 'yyyy-MM-dd');
  const to = format(addDays(new Date(), days), 'yyyy-MM-dd');
  const load = useQuery({
    queryKey: ['global', 'workload', workspaceId, from, to],
    queryFn: async () => {
      const [w, e] = await Promise.all([
        sb().rpc('workload', { p_workspace: workspaceId, p_from: from, p_to: to }),
        sb().rpc('planned_effort', { p_workspace: workspaceId }),
      ]);
      return {
        work: must(w) as { user_id: string; project_id: string; open_tasks: number; due_in_window: number; overdue: number; estimate_minutes: number; logged_minutes: number }[],
        effort: must(e) as { user_id: string; project_id: string; planned_pm: string; reported_pm: string }[],
      };
    },
  });
  const projectName = new Map((projects.data ?? []).map((p) => [p.id, p.name]));
  const rows = useMemo(() => {
    const byUser = new Map<string, { open: number; due: number; overdue: number; est: number; logged: number; pm: number; projects: Set<string> }>();
    for (const r of load.data?.work ?? []) {
      const u = byUser.get(r.user_id) ?? { open: 0, due: 0, overdue: 0, est: 0, logged: 0, pm: 0, projects: new Set<string>() };
      u.open += r.open_tasks;
      u.due += r.due_in_window;
      u.overdue += r.overdue;
      u.est += Number(r.estimate_minutes);
      u.logged += Number(r.logged_minutes);
      if (r.open_tasks) u.projects.add(r.project_id);
      byUser.set(r.user_id, u);
    }
    for (const e of load.data?.effort ?? []) {
      const u = byUser.get(e.user_id) ?? { open: 0, due: 0, overdue: 0, est: 0, logged: 0, pm: 0, projects: new Set<string>() };
      u.pm += Number(e.planned_pm);
      byUser.set(e.user_id, u);
    }
    return (people.data ?? []).map((p) => ({ p, w: byUser.get(p.user_id) })).sort((a, b) => (b.w?.due ?? 0) - (a.w?.due ?? 0));
  }, [load.data, people.data]);
  const maxDue = Math.max(1, ...rows.map((r) => r.w?.due ?? 0));

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-secondary">Window</span>
        <Select value={String(days)} onChange={(e) => setDays(parseInt(e.target.value, 10))} className="h-8 w-40" aria-label="Window">
          <option value="7">Next 7 days</option>
          <option value="14">Next 14 days</option>
          <option value="30">Next 30 days</option>
          <option value="90">Next 90 days</option>
        </Select>
        <span className="text-xs text-muted">Only projects you can see are counted. Personal projects are excluded.</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-rule text-left">
              <th className="py-2 pr-3">Person</th>
              <th className="py-2 pr-3">Due in window</th>
              <th className="py-2 pr-3 text-right">Open tasks</th>
              <th className="py-2 pr-3 text-right">Overdue</th>
              <th className="py-2 pr-3 text-right">Estimated h</th>
              <th className="py-2 pr-3 text-right">Logged h (window)</th>
              <th className="py-2 pr-3 text-right">Planned PM</th>
              <th className="py-2">Projects</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ p, w }) => (
              <tr key={p.user_id} className="border-b border-grid">
                <td className="py-2 pr-3">
                  <span className="flex items-center gap-2">
                    <Avatar name={p.display_name} color={p.avatar_color} size={22} />
                    {p.display_name}
                  </span>
                </td>
                <td className="w-48 py-2 pr-3">
                  <div className="flex items-center gap-2">
                    <div className="h-2 flex-1 bg-grid">
                      <div className="h-2 bg-teal" style={{ width: `${((w?.due ?? 0) / maxDue) * 100}%` }} />
                    </div>
                    <span className="num w-6 text-right">{w?.due ?? 0}</span>
                  </div>
                </td>
                <td className="num py-2 pr-3 text-right">{w?.open ?? 0}</td>
                <td className={cn('num py-2 pr-3 text-right', w?.overdue ? 'text-critical' : '')}>{w?.overdue ?? 0}</td>
                <td className="num py-2 pr-3 text-right">{((w?.est ?? 0) / 60).toFixed(1)}</td>
                <td className="num py-2 pr-3 text-right">{((w?.logged ?? 0) / 60).toFixed(1)}</td>
                <td className="num py-2 pr-3 text-right">{(w?.pm ?? 0).toFixed(2)}</td>
                <td className="py-2 text-xs text-secondary">{[...(w?.projects ?? [])].map((id) => projectName.get(id)).filter(Boolean).join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- Activity */

function WorkspaceActivity({ workspaceId }: { workspaceId: string }) {
  const [limit, setLimit] = useState(50);
  const activity = useActivity({ workspaceId }, limit);
  const people = useWorkspacePeople(workspaceId);
  const name = (id: string | null) => people.data?.find((p) => p.user_id === id)?.display_name ?? 'Someone';
  return (
    <section>
      <ul className="flex flex-col divide-y divide-grid">
        {(activity.data ?? []).map((a) => (
          <li key={a.id} className="py-2 text-sm">
            <b>{name(a.actor_id)}</b> {a.summary}{' '}
            <span className="text-xs text-secondary">{formatDistanceToNow(parseISO(a.created_at), { addSuffix: true })}</span>
            {a.card_id && (
              <Link to={`/c/${a.card_id}`} className="ml-2 text-xs text-link underline-offset-2 hover:underline">
                open
              </Link>
            )}
          </li>
        ))}
      </ul>
      {(activity.data?.length ?? 0) >= limit && (
        <Button size="sm" variant="ghost" onClick={() => setLimit((l) => l + 50)} className="mt-2">
          Load more
        </Button>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------- Settings */

function Settings({ ws, isOwner, isAdmin, onDeleted }: { ws: import('@/data/core').MyWorkspace; isOwner: boolean; isAdmin: boolean; onDeleted: () => void }) {
  const [name, setName] = useState(ws.name);
  const [description, setDescription] = useState(ws.description);
  const [confirm, setConfirm] = useState(false);
  const [typed, setTyped] = useState('');
  const toast = useToast();
  return (
    <section className="flex max-w-xl flex-col gap-4">
      <Field label="Name" htmlFor="ws-n">
        <Input id="ws-n" value={name} onChange={(e) => setName(e.target.value)} disabled={!isAdmin} maxLength={120} />
      </Field>
      <Field label="Description" htmlFor="ws-d">
        <Textarea id="ws-d" value={description} onChange={(e) => setDescription(e.target.value)} disabled={!isAdmin} rows={3} />
      </Field>
      {isAdmin && (
        <div>
          <Button variant="primary" disabled={!name.trim()} onClick={() => updateWorkspace(ws, { name: name.trim(), description }).then(() => toast.show('Saved')).catch(toast.error)}>
            Save
          </Button>
        </div>
      )}
      {isOwner && (
        <div className="mt-6 border-t border-grid pt-4">
          <h2 className="text-lg">Delete workspace</h2>
          <p className="mt-1 text-sm text-secondary">Deletes every project, board, task, file record and budget in this workspace. Export what you need first (project Import &amp; export page, Reports).</p>
          <Button variant="danger" className="mt-2" onClick={() => setConfirm(true)}>
            Delete workspace…
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Delete this workspace permanently?"
        danger
        confirmLabel="Delete everything"
        body={
          <div className="flex flex-col gap-2">
            <p>
              Type <b>{ws.name}</b> to confirm.
            </p>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Workspace name" />
          </div>
        }
        onConfirm={async () => {
          if (typed !== ws.name) return toast.error(new Error('The name does not match.'));
          try {
            must(await sb().from('workspaces').delete().eq('id', ws.id));
            onDeleted();
            window.location.reload();
          } catch (err) {
            toast.error(err);
          }
        }}
      />
    </section>
  );
}

function NewWorkspaceDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const { setCurrent } = useWorkspaceCtx();
  const navigate = useNavigate();
  const toast = useToast();
  return (
    <Dialog
      open
      onOpenChange={onClose}
      title="New workspace"
      width={420}
      footer={
        <Button
          variant="primary"
          disabled={!name.trim()}
          onClick={async () => {
            try {
              const id = await createWorkspace(name.trim());
              setCurrent(id);
              onClose();
              navigate(`/workspace/${id}`);
            } catch (err) {
              toast.error(err);
            }
          }}
        >
          Create
        </Button>
      }
    >
      <Field label="Name" htmlFor="nw-name">
        <Input id="nw-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
      </Field>
    </Dialog>
  );
}
