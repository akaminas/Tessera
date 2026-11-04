import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Download, UserPlus } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { removeProjectMember, setProjectMember, updateProject, useWorkspacePeople } from '@/data/core';
import { saveProjectAsTemplate } from '@/data/templates';
import { downloadJSON, exportProjectJSON } from '@/data/portability';
import { sb } from '@/lib/supabase';
import { must } from '@/data/errors';
import { Avatar, Button, Field, Input, PageHeader, Section, Select } from '@/components/ui';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { useToast } from '@/components/ui/Toast';
import { FAMILIES, type Family, type Project, type ProjectRole } from '@/data/types';
import { useProjectCtx } from './context';
import { PartnersManager } from '@/features/controls/PartnersManager';
import { ReportingPeriodsManager } from '@/features/controls/ReportingPeriods';

export default function ProjectSettings() {
  const ctx = useProjectCtx();
  const { project, canManage } = ctx;
  if (!canManage)
    return (
      <div className="mx-auto max-w-xl p-6 text-sm">
        <h2 className="text-xl">Project settings</h2>
        <p className="mt-2 text-secondary">Only project managers can change settings.</p>
      </div>
    );
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8 px-4 py-6 sm:px-6">
      <PageHeader title="Project settings" subtitle={project.name} />
      <General project={project} />
      {!project.personal_owner && <Members />}
      {!project.personal_owner && (
        <Section id="ps-partners" title="Partner organisations">
          <PartnersManager projectId={project.id} workspaceId={project.workspace_id} canManage={canManage} />
        </Section>
      )}
      <Section id="ps-periods" title="Reporting periods" defaultOpen={ctx.has('workpackages') || ctx.has('budget')}>
        <ReportingPeriodsManager projectId={project.id} canManage={canManage} start={project.start_date} end={project.end_date} />
      </Section>
      <ImportExport />
      <Danger project={project} />
    </div>
  );
}

function General({ project }: { project: Project }) {
  const toast = useToast();
  const [form, setForm] = useState({
    name: project.name,
    acronym: project.acronym,
    status: project.status,
    start_date: project.start_date ?? '',
    end_date: project.end_date ?? '',
    color: project.color,
    visibility: project.visibility,
    currency: project.currency,
    programme: project.funding.programme ?? '',
    call: project.funding.call ?? '',
    grant_number: project.funding.grant_number ?? '',
    funder: project.funding.funder ?? '',
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });
  const invalidDates = form.start_date && form.end_date && form.end_date < form.start_date;
  return (
    <Section id="ps-general" title="General" collapsible={false}>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (invalidDates) return;
          updateProject(project, {
            name: form.name.trim(),
            acronym: form.acronym.trim(),
            status: form.status,
            start_date: form.start_date || null,
            end_date: form.end_date || null,
            color: form.color,
            visibility: form.visibility,
            currency: form.currency.toUpperCase(),
            funding: { ...project.funding, programme: form.programme, call: form.call, grant_number: form.grant_number, funder: form.funder },
          })
            .then(() => toast.show('Project saved'))
            .catch(toast.error);
        }}
      >
        <Field label="Name" htmlFor="ps-name">
          <Input id="ps-name" value={form.name} onChange={set('name')} maxLength={200} required />
        </Field>
        <Field label="Acronym" htmlFor="ps-acr">
          <Input id="ps-acr" value={form.acronym} onChange={set('acronym')} maxLength={30} />
        </Field>
        <Field label="Status" htmlFor="ps-status">
          <Select id="ps-status" value={form.status} onChange={set('status')}>
            <option value="planning">Planning</option>
            <option value="active">Active</option>
            <option value="on_hold">On hold</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </Select>
        </Field>
        <Field label="Colour" htmlFor="ps-color">
          <Select id="ps-color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value as Family })}>
            {FAMILIES.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Start date" htmlFor="ps-start">
          <Input id="ps-start" type="date" value={form.start_date} onChange={set('start_date')} />
        </Field>
        <Field label="End date" htmlFor="ps-end" error={invalidDates ? 'The end date must be after the start date.' : null}>
          <Input id="ps-end" type="date" value={form.end_date} onChange={set('end_date')} />
        </Field>
        {!project.personal_owner && (
          <Field label="Who can see it" htmlFor="ps-vis">
            <Select id="ps-vis" value={form.visibility} onChange={set('visibility')}>
              <option value="workspace">Everyone in the workspace (guests excluded)</option>
              <option value="private">Only project members</option>
            </Select>
          </Field>
        )}
        <Field label="Currency" htmlFor="ps-cur" hint="Three-letter code, e.g. EUR.">
          <Input id="ps-cur" value={form.currency} onChange={set('currency')} maxLength={3} pattern="[A-Za-z]{3}" />
        </Field>
        <Field label="Funding programme" htmlFor="ps-prog">
          <Input id="ps-prog" value={form.programme} onChange={set('programme')} />
        </Field>
        <Field label="Call" htmlFor="ps-call">
          <Input id="ps-call" value={form.call} onChange={set('call')} />
        </Field>
        <Field label="Grant or contract number" htmlFor="ps-grant">
          <Input id="ps-grant" value={form.grant_number} onChange={set('grant_number')} />
        </Field>
        <Field label="Funder" htmlFor="ps-funder">
          <Input id="ps-funder" value={form.funder} onChange={set('funder')} />
        </Field>
        <div className="sm:col-span-2">
          <Button type="submit" variant="primary" disabled={!form.name.trim() || Boolean(invalidDates)}>
            Save
          </Button>
        </div>
      </form>
    </Section>
  );
}

function Members() {
  const { project, people } = useProjectCtx();
  const { user } = useAuth();
  const wsPeople = useWorkspacePeople(project.workspace_id);
  const toast = useToast();
  const [adding, setAdding] = useState('');
  const explicit = people.filter((p) => p.explicit);
  const implicit = people.filter((p) => !p.explicit);
  const candidates = (wsPeople.data ?? []).filter((w) => !explicit.some((e) => e.user_id === w.user_id));
  return (
    <Section id="ps-members" title="Members and permissions">
      <p className="mb-2 text-sm text-secondary">
        Managers can change settings and approve deliverables. Collaborators can work on tasks. Read-only members see everything except budgets. Budget access is granted separately.
      </p>
      <ul className="divide-y divide-grid">
        {explicit.map((p) => (
          <li key={p.user_id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
            <Avatar name={p.display_name} color={p.avatar_color} size={24} />
            <span className="min-w-0 flex-1 truncate">
              {p.display_name} {p.user_id === user?.id && <span className="text-secondary">(you)</span>}
            </span>
            <Select
              aria-label={`Role of ${p.display_name}`}
              className="h-8 w-44"
              value={p.role}
              onChange={(e) => setProjectMember(project.id, p.user_id, { role: e.target.value as ProjectRole }).catch(toast.error)}
            >
              <option value="manager">Project manager</option>
              <option value="member">Member</option>
              <option value="collaborator">External collaborator</option>
              <option value="viewer">Read-only</option>
            </Select>
            <Select
              aria-label={`Budget access of ${p.display_name}`}
              className="h-8 w-36"
              value={p.role === 'manager' ? 'edit' : p.finance_access ?? 'none'}
              disabled={p.role === 'manager'}
              onChange={(e) => setProjectMember(project.id, p.user_id, { finance_access: e.target.value }).catch(toast.error)}
            >
              <option value="none">No budget access</option>
              <option value="view">Budget: view</option>
              <option value="edit">Budget: edit</option>
            </Select>
            <Button size="sm" variant="danger" onClick={() => removeProjectMember(project.id, p.user_id).catch(toast.error)}>
              Remove
            </Button>
          </li>
        ))}
      </ul>
      {implicit.length > 0 && (
        <p className="mt-2 text-xs text-secondary">
          Also with access through the workspace: {implicit.map((p) => p.display_name).join(', ')}.
          {project.visibility === 'workspace' && ' Add them explicitly to set roles or budget access.'}
        </p>
      )}
      <form
        className="mt-3 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!adding) return;
          setProjectMember(project.id, adding, { role: 'member' })
            .then(() => setAdding(''))
            .catch(toast.error);
        }}
      >
        <Select value={adding} onChange={(e) => setAdding(e.target.value)} className="h-9 w-64" aria-label="Workspace member to add">
          <option value="">Add a workspace member…</option>
          {candidates.map((c) => (
            <option key={c.user_id} value={c.user_id}>
              {c.display_name} ({c.role})
            </option>
          ))}
        </Select>
        <Button type="submit" icon={<UserPlus className="size-4" />} disabled={!adding}>
          Add
        </Button>
        <Link to={`/workspace/${project.workspace_id}/members`} className="self-center text-sm text-link underline-offset-2 hover:underline">
          Invite someone new
        </Link>
      </form>
    </Section>
  );
}

function ImportExport() {
  const { project, finance } = useProjectCtx();
  const toast = useToast();
  const [tplName, setTplName] = useState(`${project.name} template`);
  const [tplCategory, setTplCategory] = useState('Saved');
  const [busy, setBusy] = useState(false);
  return (
    <Section id="ps-io" title="Import, export and templates">
      <div className="flex flex-col gap-4 text-sm">
        <p>
          <Link to="../import" relative="path" className="text-link underline-offset-2 hover:underline">
            Import a planning or budget workbook (.xlsx), or export the plan and budget as spreadsheets
          </Link>
        </p>
        <div>
          <Button
            icon={<Download className="size-4" />}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const data = await exportProjectJSON(project.id, finance !== 'none');
                downloadJSON(`${(project.acronym || project.name).replace(/[^\w-]+/g, '_')}-export-${new Date().toISOString().slice(0, 10)}.json`, data);
              } catch (err) {
                toast.error(err);
              } finally {
                setBusy(false);
              }
            }}
          >
            Export everything as JSON
          </Button>
          <p className="mt-1 text-xs text-secondary">A complete, machine-readable copy for archiving or moving to another system{finance !== 'none' ? ', including the budget' : ''}.</p>
        </div>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await saveProjectAsTemplate(project.id, project.workspace_id, tplName.trim(), tplCategory.trim() || 'Saved', project.description.slice(0, 300));
              toast.show('Saved as a template. It appears when creating a project.');
            } catch (err) {
              toast.error(err);
            }
          }}
        >
          <Field label="Save the structure as a template" htmlFor="tpl-name" className="min-w-60 flex-1" hint="Boards, lists, tasks (relative dates), work packages, milestones, risks, KPIs and cost categories. No people, comments or amounts.">
            <Input id="tpl-name" value={tplName} onChange={(e) => setTplName(e.target.value)} />
          </Field>
          <Field label="Category" htmlFor="tpl-cat">
            <Input id="tpl-cat" value={tplCategory} onChange={(e) => setTplCategory(e.target.value)} className="w-40" />
          </Field>
          <Button type="submit" disabled={!tplName.trim()}>
            Save template
          </Button>
        </form>
      </div>
    </Section>
  );
}

function Danger({ project }: { project: Project }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState(false);
  const [typed, setTyped] = useState('');
  return (
    <Section id="ps-danger" title="Archive or delete" defaultOpen={false}>
      <div className="flex flex-col gap-3 text-sm">
        <div className="flex flex-wrap items-center gap-3">
          {project.archived_at ? (
            <Button onClick={() => updateProject(project, { archived_at: null }).then(() => toast.show('Project restored')).catch(toast.error)}>Restore project</Button>
          ) : (
            <Button
              onClick={async () => {
                try {
                  const res = await updateProject(project, { archived_at: new Date().toISOString() });
                  toast.show('Project archived', { undo: () => updateProject(res, { archived_at: null }).then(() => undefined) });
                } catch (err) {
                  toast.error(err);
                }
              }}
            >
              Archive project
            </Button>
          )}
          <span className="text-secondary">Archived projects disappear from lists but keep all data and can be restored from Projects → Include archived.</span>
        </div>
        <div>
          <Button variant="danger" onClick={() => setConfirm(true)}>
            Delete project permanently…
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        danger
        title="Delete this project permanently?"
        confirmLabel="Delete"
        body={
          <div className="flex flex-col gap-2">
            <p>All boards, tasks, plans, budgets, KPIs, files records and history of this project are deleted. Consider exporting first.</p>
            <p>
              Type <b>{project.name}</b> to confirm.
            </p>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Project name" />
          </div>
        }
        onConfirm={async () => {
          if (typed !== project.name) return toast.error(new Error('The name does not match.'));
          try {
            const files = must(await sb().from('attachments').select('storage_path').eq('project_id', project.id).eq('kind', 'file')) as { storage_path: string }[];
            if (files.length) await sb().storage.from('attachments').remove(files.map((f) => f.storage_path));
            must(await sb().from('projects').delete().eq('id', project.id));
            navigate('/projects');
          } catch (err) {
            toast.error(err);
          }
        }}
      />
    </Section>
  );
}
