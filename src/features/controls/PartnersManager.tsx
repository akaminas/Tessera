import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useOrganizations, useProjectPeople } from '@/data/core';
import { PARTNER_ROLE_LABEL, addPartner, createOrganization, removePartner, updatePartner, usePartners, type ProjectPartner } from '@/data/controls';
import { Button, EmptyState, Field, IconButton, Input, Select } from '@/components/ui';
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog';
import { useToast } from '@/components/ui/Toast';
import { keyAfterLast } from '@/domain/ordering';
import type { Organization } from '@/data/types';

const ORG_KINDS: { value: Organization['kind']; label: string }[] = [
  { value: 'university', label: 'University' },
  { value: 'research', label: 'Research organisation' },
  { value: 'company', label: 'Company' },
  { value: 'public', label: 'Public body' },
  { value: 'ngo', label: 'Non-profit' },
  { value: 'other', label: 'Other' },
];

/** Organisations taking part in a project (no financial attributes here). */
export function PartnersManager({ projectId, workspaceId, canManage }: { projectId: string; workspaceId: string; canManage: boolean }) {
  const partners = usePartners(projectId);
  const orgs = useOrganizations(workspaceId);
  const people = useProjectPeople(projectId);
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [confirm, setConfirm] = useState<ProjectPartner | null>(null);
  const org = (id: string) => orgs.data?.find((o) => o.id === id);
  const list = partners.data ?? [];

  return (
    <div className="flex flex-col gap-3">
      {list.length === 0 ? (
        <EmptyState title="No partners yet">Add the organisations taking part. Budgets, effort and milestones can then be attributed to them.</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-rule text-left">
                <th className="py-2 pr-3 font-bold">Organisation</th>
                <th className="py-2 pr-3 font-bold">Short name</th>
                <th className="py-2 pr-3 font-bold">Role</th>
                <th className="py-2 pr-3 font-bold">Contact</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {list.map((p) => {
                const o = org(p.organization_id);
                return (
                  <tr key={p.id} className="border-b border-grid">
                    <td className="py-2 pr-3">
                      {o?.name ?? '…'}
                      {o?.country && <span className="block text-xs text-secondary">{o.country}</span>}
                    </td>
                    <td className="py-2 pr-3">
                      {canManage ? (
                        <ShortNameInput partner={p} onSave={(v) => updatePartner(p, { short_name: v }).catch(toast.error)} />
                      ) : (
                        p.short_name
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      {canManage ? (
                        <Select value={p.role} onChange={(e) => updatePartner(p, { role: e.target.value as ProjectPartner['role'] }).catch(toast.error)} className="h-8 w-44" aria-label={`Role of ${p.short_name}`}>
                          {(Object.keys(PARTNER_ROLE_LABEL) as ProjectPartner['role'][]).map((r) => (
                            <option key={r} value={r}>
                              {PARTNER_ROLE_LABEL[r]}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        PARTNER_ROLE_LABEL[p.role]
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      {canManage ? (
                        <Select
                          value={p.contact_user_id ?? ''}
                          onChange={(e) => updatePartner(p, { contact_user_id: e.target.value || null }).catch(toast.error)}
                          className="h-8 w-44"
                          aria-label={`Contact for ${p.short_name}`}
                        >
                          <option value="">None</option>
                          {(people.data ?? []).map((u) => (
                            <option key={u.user_id} value={u.user_id}>
                              {u.display_name}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        (people.data ?? []).find((u) => u.user_id === p.contact_user_id)?.display_name ?? '—'
                      )}
                    </td>
                    <td className="py-2 text-right">
                      {canManage && (
                        <IconButton label={`Remove ${p.short_name}`} onClick={() => setConfirm(p)}>
                          <Trash2 className="size-4" />
                        </IconButton>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {canManage && (
        <div>
          <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setAdding(true)}>
            Add partner
          </Button>
        </div>
      )}
      {adding && (
        <AddPartnerDialog
          projectId={projectId}
          workspaceId={workspaceId}
          available={(orgs.data ?? []).filter((o) => !list.some((p) => p.organization_id === o.id))}
          position={keyAfterLast(list)}
          hasCoordinator={list.some((p) => p.role === 'coordinator')}
          onClose={() => setAdding(false)}
        />
      )}
      <ConfirmDialog
        open={Boolean(confirm)}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Remove ${confirm?.short_name} from the project?`}
        danger
        confirmLabel="Remove"
        body="The organisation stays in the workspace. Partners with budget lines or expenditures cannot be removed until those are reassigned."
        onConfirm={async () => {
          if (!confirm) return;
          try {
            await removePartner(confirm);
            setConfirm(null);
          } catch (err) {
            toast.error(err);
          }
        }}
      />
    </div>
  );
}

function ShortNameInput({ partner, onSave }: { partner: ProjectPartner; onSave: (v: string) => void }) {
  const [v, setV] = useState(partner.short_name);
  return (
    <Input
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v.trim() !== partner.short_name && onSave(v.trim())}
      className="h-8 w-32"
      maxLength={30}
      aria-label="Short name"
    />
  );
}

function AddPartnerDialog({
  projectId,
  workspaceId,
  available,
  position,
  hasCoordinator,
  onClose,
}: {
  projectId: string;
  workspaceId: string;
  available: Organization[];
  position: string;
  hasCoordinator: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const [mode, setMode] = useState<'existing' | 'new'>(available.length ? 'existing' : 'new');
  const [orgId, setOrgId] = useState(available[0]?.id ?? '');
  const [role, setRole] = useState<ProjectPartner['role']>(hasCoordinator ? 'partner' : 'coordinator');
  const [shortName, setShortName] = useState('');
  const [neo, setNeo] = useState({ name: '', short_name: '', country: '', kind: 'university' as Organization['kind'] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog
      open
      onOpenChange={onClose}
      title="Add a partner"
      width={480}
      footer={
        <Button
          variant="primary"
          loading={busy}
          onClick={async () => {
            setError(null);
            setBusy(true);
            try {
              let id = orgId;
              let sn = shortName.trim();
              if (mode === 'new') {
                if (!neo.name.trim()) {
                  setError('Enter the organisation name.');
                  return;
                }
                id = await createOrganization(workspaceId, { ...neo, name: neo.name.trim(), short_name: neo.short_name.trim() });
                sn = sn || neo.short_name.trim();
              } else if (!id) {
                setError('Choose an organisation.');
                return;
              }
              await addPartner(projectId, { organization_id: id, role, short_name: sn, position });
              onClose();
            } catch (err) {
              toast.error(err);
            } finally {
              setBusy(false);
            }
          }}
        >
          Add partner
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex gap-4 text-sm" role="radiogroup" aria-label="Organisation source">
          <label className="flex items-center gap-1.5">
            <input type="radio" className="accent-[var(--v-teal-deep)]" checked={mode === 'existing'} disabled={!available.length} onChange={() => setMode('existing')} />
            Existing organisation
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" className="accent-[var(--v-teal-deep)]" checked={mode === 'new'} onChange={() => setMode('new')} />
            New organisation
          </label>
        </div>
        {mode === 'existing' ? (
          <Field label="Organisation" htmlFor="pt-org">
            <Select id="pt-org" value={orgId} onChange={(e) => setOrgId(e.target.value)}>
              {available.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.short_name ? `${o.short_name} · ${o.name}` : o.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <>
            <Field label="Organisation name" htmlFor="pt-name">
              <Input id="pt-name" value={neo.name} onChange={(e) => setNeo({ ...neo, name: e.target.value })} maxLength={200} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Short name" htmlFor="pt-sn">
                <Input id="pt-sn" value={neo.short_name} onChange={(e) => setNeo({ ...neo, short_name: e.target.value })} maxLength={30} />
              </Field>
              <Field label="Country" htmlFor="pt-country">
                <Input id="pt-country" value={neo.country} onChange={(e) => setNeo({ ...neo, country: e.target.value })} />
              </Field>
            </div>
            <Field label="Type" htmlFor="pt-kind">
              <Select id="pt-kind" value={neo.kind} onChange={(e) => setNeo({ ...neo, kind: e.target.value as Organization['kind'] })}>
                {ORG_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Role in the project" htmlFor="pt-role">
            <Select id="pt-role" value={role} onChange={(e) => setRole(e.target.value as ProjectPartner['role'])}>
              {(Object.keys(PARTNER_ROLE_LABEL) as ProjectPartner['role'][]).map((r) => (
                <option key={r} value={r}>
                  {PARTNER_ROLE_LABEL[r]}
                </option>
              ))}
            </Select>
          </Field>
          {mode === 'existing' && (
            <Field label="Short name in this project" htmlFor="pt-short" hint="Defaults to the organisation's short name.">
              <Input id="pt-short" value={shortName} onChange={(e) => setShortName(e.target.value)} maxLength={30} />
            </Field>
          )}
        </div>
        {error && (
          <p role="alert" className="text-sm text-critical">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
