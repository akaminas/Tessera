import { useMemo, useRef, useState } from 'react';
import { CheckCircle2, CircleAlert, ExternalLink, FileText, Link2, Trash2, Upload, XCircle } from 'lucide-react';
import { Button, IconButton, Input } from '@/components/ui';
import { Popover } from '@/components/ui/Menu';
import { useToast } from '@/components/ui/Toast';
import { computeBudget, money as fmtMoney, settingsFromFunding, type FinanceSettings } from '@/domain/finance';
import { openAttachment, uploadAttachment, useAttachments } from '@/data/cardExtras';
import { addEvidence, deleteEvidence, linkLatestAttachment, updateEvidence, useEvidence, partnerLabel, type FinanceData, type EvidenceItem } from '@/data/finance';
import type { Project } from '@/data/types';
import { cn } from '@/lib/cn';

export function useBudgetModel(project: Project, data: FinanceData | undefined) {
  return useMemo(() => {
    const settings: FinanceSettings = settingsFromFunding(project.funding);
    if (!data) return null;
    const pf = new Map(data.partnerFinance.map((p) => [p.partner_id, p]));
    const partners = data.partners.map((p) => ({
      id: p.id,
      name: partnerLabel(p),
      pm_rate: pf.get(p.id)?.pm_rate ?? null,
      funding_rate: pf.get(p.id)?.funding_rate ?? null,
      indirect_rate: pf.get(p.id)?.indirect_rate ?? null,
    }));
    const result = computeBudget({
      categories: data.categories,
      partners,
      lines: data.lines,
      expenditures: data.expenditures.map((e) => ({ ...e, status: e.status })),
      settings,
    });
    return {
      settings,
      result,
      partnerById: new Map(data.partners.map((p) => [p.id, p])),
      partnerName: (id: string | null) => (id ? partnerLabel(data.partners.find((p) => p.id === id)) : 'Unassigned'),
      catById: new Map(data.categories.map((c) => [c.id, c])),
      wpById: new Map(data.workPackages.map((w) => [w.id, w])),
      periodById: new Map(data.periods.map((p) => [p.id, p])),
      partnerFinance: pf,
    };
  }, [project.funding, data]);
}

export function useMoney(project: Project) {
  const currency = project.currency || 'EUR';
  return {
    currency,
    money: (v: Parameters<typeof fmtMoney>[0], d = 2) => fmtMoney(v, currency, d),
    short: (n: number) => fmtMoney(n, currency, 0),
  };
}

export function SubTabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="tablist" className="scroll-thin flex gap-1 overflow-x-auto border-b border-grid">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cn('-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm', value === t.id ? 'border-teal-deep font-bold' : 'border-transparent text-secondary hover:text-ink')}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

const STATUS_META: Record<EvidenceItem['status'], { label: string; icon: React.ReactNode; cls: string }> = {
  missing: { label: 'Missing', icon: <CircleAlert className="size-3.5" aria-hidden />, cls: 'text-serious' },
  submitted: { label: 'Submitted', icon: <FileText className="size-3.5" aria-hidden />, cls: 'text-indigo' },
  verified: { label: 'Verified', icon: <CheckCircle2 className="size-3.5" aria-hidden />, cls: 'text-good' },
  rejected: { label: 'Rejected', icon: <XCircle className="size-3.5" aria-hidden />, cls: 'text-critical' },
};

export function EvidenceStatus({ status }: { status: EvidenceItem['status'] }) {
  const m = STATUS_META[status];
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs', m.cls)}>
      {m.icon}
      <span className="text-ink">{m.label}</span>
    </span>
  );
}

/**
 * Evidence list for any entity (expense, KPI, …): required items, upload or
 * link proof, managers verify or reject.
 */
export function EvidencePanel({
  projectId,
  entityType,
  entityId,
  canEdit,
  canVerify,
  finance,
  defaultTitle,
}: {
  projectId: string;
  entityType: 'expense' | 'kpi' | 'milestone';
  entityId: string;
  canEdit: boolean;
  canVerify: boolean;
  finance?: boolean;
  defaultTitle: string;
}) {
  const ev = useEvidence(projectId, entityType, entityId);
  const atts = useAttachments(projectId, { entityId });
  const toast = useToast();
  const [title, setTitle] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState<EvidenceItem | null>(null);
  const [url, setUrl] = useState('');
  const items = ev.data ?? [];
  const attById = new Map((atts.data ?? []).map((a) => [a.id, a]));

  return (
    <div className="flex flex-col gap-2">
      {items.length === 0 && <p className="text-sm text-secondary">No evidence requested yet.</p>}
      <ul className="flex flex-col divide-y divide-grid">
        {items.map((e) => {
          const a = e.attachment_id ? attById.get(e.attachment_id) : undefined;
          return (
            <li key={e.id} className="flex flex-wrap items-center gap-2 py-1.5 text-sm">
              <span className="min-w-0 flex-1">
                {e.title}
                {e.required && <span className="text-xs text-secondary"> · required</span>}
              </span>
              <EvidenceStatus status={e.status} />
              {a && (
                <button className="inline-flex items-center gap-1 text-xs text-link hover:underline" onClick={() => openAttachment(a).catch(toast.error)}>
                  <FileText className="size-3.5" aria-hidden />
                  {a.name}
                </button>
              )}
              {e.url && (
                <a className="inline-flex items-center gap-1 text-xs text-link hover:underline" href={e.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="size-3.5" aria-hidden />
                  link
                </a>
              )}
              {canEdit && (
                <>
                  <IconButton
                    label="Upload proof"
                    onClick={() => {
                      setTarget(e);
                      fileRef.current?.click();
                    }}
                  >
                    <Upload className="size-3.5" />
                  </IconButton>
                  <Popover
                    trigger={
                      <IconButton label="Link proof">
                        <Link2 className="size-3.5" />
                      </IconButton>
                    }
                  >
                    <form
                      className="flex flex-col gap-2"
                      onSubmit={(ev2) => {
                        ev2.preventDefault();
                        if (!/^https?:\/\//i.test(url)) return toast.error(new Error('Links must start with http:// or https://'));
                        updateEvidence(e, { url })
                          .then(() => setUrl(''))
                          .catch(toast.error);
                      }}
                    >
                      <Input value={url} onChange={(x) => setUrl(x.target.value)} placeholder="https://…" aria-label="Evidence link" className="h-8" />
                      <Button size="sm" type="submit" variant="primary">
                        Save link
                      </Button>
                    </form>
                  </Popover>
                </>
              )}
              {canVerify && e.status === 'submitted' && (
                <>
                  <Button size="sm" variant="ghost" onClick={() => updateEvidence(e, { status: 'verified' }).catch(toast.error)}>
                    Verify
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => updateEvidence(e, { status: 'rejected' }).catch(toast.error)}>
                    Reject
                  </Button>
                </>
              )}
              {canVerify && (
                <IconButton label={`Delete evidence ${e.title}`} onClick={() => deleteEvidence(e).catch(toast.error)}>
                  <Trash2 className="size-3.5" />
                </IconButton>
              )}
            </li>
          );
        })}
      </ul>
      <input
        ref={fileRef}
        type="file"
        hidden
        onChange={async (x) => {
          const f = x.target.files?.[0];
          x.target.value = '';
          if (!f || !target) return;
          try {
            await uploadAttachment(projectId, f, { entityType, entityId, finance });
            await linkLatestAttachment(target);
            toast.show('Proof uploaded');
          } catch (err) {
            toast.error(err);
          }
        }}
      />
      {canEdit && (
        <form
          className="flex gap-2"
          onSubmit={(x) => {
            x.preventDefault();
            addEvidence({ project_id: projectId, entity_type: entityType, entity_id: entityId, title: title.trim() || defaultTitle })
              .then(() => setTitle(''))
              .catch(toast.error);
          }}
        >
          <Input value={title} onChange={(x) => setTitle(x.target.value)} placeholder={defaultTitle} aria-label="Evidence to request" className="h-8" />
          <Button size="sm" type="submit">
            Request evidence
          </Button>
        </form>
      )}
    </div>
  );
}

/** Restricted notice shown to people without finance access. */
export function FinanceRestricted() {
  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <h2 className="text-2xl">Financial information is restricted</h2>
      <p className="mt-2 text-sm text-secondary">
        Budgets, rates and expenditure are visible only to project managers, workspace administrators and members given finance access. Ask a project manager to grant you
        “view” or “edit” finance access in the project’s member settings.
      </p>
    </div>
  );
}
