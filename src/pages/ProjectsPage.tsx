import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { addMonths, format, parseISO, subDays } from 'date-fns';
import { Plus, Trash2 } from 'lucide-react';
import { createProject, useWorkspaceProjects, updateProject } from '@/data/core';
import { applyBlueprint, deleteTemplate, useWorkspaceTemplates } from '@/data/templates';
import { PROJECT_TEMPLATES, type Blueprint } from '@/domain/templates';
import { Button, Checkbox, EmptyState, Field, IconButton, Input, PageHeader, PageLoading, Select, Textarea, familyBar } from '@/components/ui';
import { Dialog } from '@/components/ui/Dialog';
import { useToast } from '@/components/ui/Toast';
import { useWorkspaceCtx } from '@/layout/WorkspaceContext';
import { cn } from '@/lib/cn';
import type { Project } from '@/data/types';

const STATUS_LABEL: Record<Project['status'], string> = { planning: 'Planning', active: 'Active', on_hold: 'On hold', completed: 'Completed', cancelled: 'Cancelled' };

export default function ProjectsPage() {
  const { current } = useWorkspaceCtx();
  const [params, setParams] = useSearchParams();
  const [showArchived, setShowArchived] = useState(false);
  const projects = useWorkspaceProjects(current?.id, { includeArchived: showArchived });
  const [text, setText] = useState('');
  const toast = useToast();
  const creating = params.get('new') === '1';
  const list = useMemo(
    () => (projects.data ?? []).filter((p) => !p.personal_owner && (!text.trim() || `${p.name} ${p.acronym}`.toLowerCase().includes(text.toLowerCase()))),
    [projects.data, text],
  );

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-6 sm:px-6">
      <PageHeader
        title="Projects"
        subtitle={current?.name}
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setParams({ new: '1' })} disabled={current?.my_role === 'guest'}>
            New project
          </Button>
        }
      />
      <div className="flex flex-wrap items-center gap-3">
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Find a project" aria-label="Find a project" className="h-8 w-60" />
        <Checkbox checked={showArchived} onChange={setShowArchived} label="Include archived" />
      </div>
      {projects.isLoading && <PageLoading />}
      {!projects.isLoading && list.length === 0 && (
        <EmptyState title="No projects here yet" action={<Button size="sm" variant="primary" onClick={() => setParams({ new: '1' })}>Create the first project</Button>}>
          Start from a template, or a blank project with a single board.
        </EmptyState>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-rule text-left">
              <th className="py-2 pr-3 font-bold">Project</th>
              <th className="py-2 pr-3 font-bold">Status</th>
              <th className="py-2 pr-3 font-bold">Dates</th>
              <th className="py-2 pr-3 font-bold">Visibility</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id} className="border-b border-grid hover:bg-hover">
                <td className="py-2 pr-3">
                  <Link to={`/p/${p.id}`} className="flex items-center gap-2 hover:underline">
                    <span className={cn('size-2.5 rounded-[2px]', familyBar[p.color])} aria-hidden />
                    <span className="font-bold">{p.name}</span>
                    {p.acronym && <span className="text-secondary">{p.acronym}</span>}
                  </Link>
                </td>
                <td className="py-2 pr-3">
                  {STATUS_LABEL[p.status]}
                  {p.archived_at && <span className="text-secondary"> · archived</span>}
                </td>
                <td className="num py-2 pr-3 text-secondary">
                  {p.start_date ? format(parseISO(p.start_date), 'MMM yyyy') : '—'} – {p.end_date ? format(parseISO(p.end_date), 'MMM yyyy') : '—'}
                </td>
                <td className="py-2 pr-3 text-secondary">{p.visibility === 'private' ? 'Members only' : 'Workspace'}</td>
                <td className="py-2 text-right">
                  {p.archived_at && (
                    <Button size="sm" onClick={() => updateProject(p, { archived_at: null }).catch(toast.error)}>
                      Restore
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {creating && current && <NewProjectDialog workspaceId={current.id} onClose={() => setParams({})} />}
    </div>
  );
}

export function NewProjectDialog({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const saved = useWorkspaceTemplates(workspaceId);
  const [templateId, setTemplateId] = useState('blank');
  const [name, setName] = useState('');
  const [acronym, setAcronym] = useState('');
  const [description, setDescription] = useState('');
  const [start, setStart] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [visibility, setVisibility] = useState<'workspace' | 'private'>('workspace');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const navigate = useNavigate();

  const all = [
    ...PROJECT_TEMPLATES.map((t) => ({ id: t.id, name: t.name, category: t.category, description: t.description, blueprint: t.blueprint, saved: null as null | string })),
    ...(saved.data ?? []).map((t) => ({ id: `saved:${t.id}`, name: t.name, category: t.category || 'Saved', description: t.description, blueprint: t.blueprint, saved: t.id })),
  ];
  const chosen = all.find((t) => t.id === templateId) ?? all[0];
  const duration = (chosen.blueprint as Blueprint).duration_months;
  const end = duration && start ? format(subDays(addMonths(parseISO(start), duration), 1), 'yyyy-MM-dd') : '';

  return (
    <Dialog
      open
      onOpenChange={onClose}
      title="New project"
      width={760}
      footer={
        <Button
          variant="primary"
          loading={busy}
          disabled={!name.trim()}
          onClick={async () => {
            setBusy(true);
            try {
              const id = await createProject({
                workspace_id: workspaceId,
                name: name.trim(),
                acronym: acronym.trim(),
                description,
                visibility,
                start_date: start || null,
                end_date: end || null,
                modules: chosen.blueprint.modules,
              });
              await applyBlueprint(id, chosen.blueprint, start || null);
              onClose();
              navigate(`/p/${id}`);
            } catch (err) {
              toast.error(err);
            } finally {
              setBusy(false);
            }
          }}
        >
          Create project
        </Button>
      }
    >
      <div className="grid gap-5 md:grid-cols-[1fr_1fr]">
        <fieldset>
          <legend className="mb-2 text-[13px] font-bold">Template</legend>
          <ul className="scroll-thin flex max-h-[52vh] flex-col gap-1 overflow-y-auto pr-1">
            {all.map((t) => (
              <li key={t.id}>
                <label className={cn('flex cursor-pointer gap-2 rounded-[4px] border p-2', templateId === t.id ? 'border-teal bg-accent-soft' : 'border-grid hover:bg-hover')}>
                  <input type="radio" name="tpl" className="mt-1 accent-[var(--v-teal-deep)]" checked={templateId === t.id} onChange={() => setTemplateId(t.id)} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold">{t.name}</span>
                    <span className="block text-xs text-secondary">{t.category} · {t.description}</span>
                  </span>
                  {t.saved && (
                    <IconButton
                      label={`Delete template ${t.name}`}
                      onClick={(e) => {
                        e.preventDefault();
                        const s = saved.data?.find((x) => x.id === t.saved);
                        if (s) deleteTemplate(s).catch(toast.error);
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </IconButton>
                  )}
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
        <div className="flex flex-col gap-3">
          <Field label="Project name" htmlFor="np-name">
            <Input id="np-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
          </Field>
          <Field label="Short name or acronym" htmlFor="np-acr" hint="Optional. Shown in the sidebar.">
            <Input id="np-acr" value={acronym} onChange={(e) => setAcronym(e.target.value)} maxLength={30} />
          </Field>
          <Field label="Start date" htmlFor="np-start" hint={end ? `Template length ${duration} months: ends ${format(parseISO(end), 'd MMM yyyy')}. Template dates are placed relative to this start.` : 'Template dates are placed relative to this start.'}>
            <Input id="np-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="Who can see it" htmlFor="np-vis">
            <Select id="np-vis" value={visibility} onChange={(e) => setVisibility(e.target.value as 'workspace' | 'private')}>
              <option value="workspace">Everyone in the workspace (guests excluded)</option>
              <option value="private">Only people added to the project</option>
            </Select>
          </Field>
          <Field label="Description" htmlFor="np-desc">
            <Textarea id="np-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </Field>
        </div>
      </div>
    </Dialog>
  );
}
