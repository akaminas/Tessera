import { useState } from 'react';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { Trash2 } from 'lucide-react';
import { useProjectCtx } from '@/features/project/context';
import { Button, Checkbox, Field, IconButton, Input, Select, ErrorNote, PageLoading } from '@/components/ui';
import { useToast } from '@/components/ui/Toast';
import { updateProject } from '@/data/core';
import { deleteCategory, saveCategory, useFinanceAudit, type FinanceData } from '@/data/finance';
import { defaultIndirectBase, isNumberLike, settingsFromFunding, toBig, type CategoryKind, type RoundingLevel, type RoundingMode } from '@/domain/finance';
import { keyAfterLast } from '@/domain/ordering';

const KINDS: { id: CategoryKind; label: string }[] = [
  { id: 'personnel', label: 'Personnel' },
  { id: 'subcontracting', label: 'Subcontracting' },
  { id: 'travel', label: 'Travel and subsistence' },
  { id: 'equipment', label: 'Equipment' },
  { id: 'other', label: 'Other goods, works and services' },
  { id: 'third_party', label: 'Financial support to third parties' },
  { id: 'internal', label: 'Internally invoiced goods and services' },
  { id: 'other_direct', label: 'Other direct costs' },
];

export function SettingsTab({ data }: { data: FinanceData }) {
  const ctx = useProjectCtx();
  const toast = useToast();
  const canEdit = ctx.finance === 'edit';
  const s = settingsFromFunding(ctx.project.funding);
  const [v, setV] = useState({
    indirect: s.indirectRate.times(100).toString(),
    funding: s.fundingRate.times(100).toString(),
    rounding: s.rounding,
    decimals: String(s.decimals),
    mode: s.mode,
    hours: String(s.hoursPerPm),
    currency: ctx.project.currency,
  });
  const errors: string[] = [];
  const pctOk = (x: string) => isNumberLike(x) && toBig(x).gte(0) && toBig(x).lte(100);
  if (!pctOk(v.indirect)) errors.push('Indirect rate must be between 0 and 100 %.');
  if (!pctOk(v.funding)) errors.push('Funding rate must be between 0 and 100 %.');
  if (!/^\d$/.test(v.decimals) || Number(v.decimals) > 4) errors.push('Decimals must be 0–4.');
  if (!isNumberLike(v.hours) || Number(v.hours) <= 0 || Number(v.hours) > 300) errors.push('Hours per person-month must be between 1 and 300.');
  if (!/^[A-Z]{3}$/.test(v.currency)) errors.push('Currency must be a three-letter ISO code such as EUR.');

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <section className="flex flex-col gap-3">
        <h3 className="text-sm">Calculation rules</h3>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Indirect-cost rate (%)" htmlFor="fs-i" hint="Applied to categories in the indirect base.">
            <Input id="fs-i" value={v.indirect} disabled={!canEdit} onChange={(e) => setV({ ...v, indirect: e.target.value })} inputMode="decimal" />
          </Field>
          <Field label="Funding rate (%)" htmlFor="fs-f" hint="Share of eligible costs requested.">
            <Input id="fs-f" value={v.funding} disabled={!canEdit} onChange={(e) => setV({ ...v, funding: e.target.value })} inputMode="decimal" />
          </Field>
          <Field label="Round indirect costs" htmlFor="fs-r">
            <Select id="fs-r" value={v.rounding} disabled={!canEdit} onChange={(e) => setV({ ...v, rounding: e.target.value as RoundingLevel })}>
              <option value="none">Do not round</option>
              <option value="line">On every line</option>
              <option value="category">Per partner and category</option>
              <option value="partner">Once per partner total</option>
            </Select>
          </Field>
          <Field label="Rounding method" htmlFor="fs-m">
            <Select id="fs-m" value={v.mode} disabled={!canEdit || v.rounding === 'none'} onChange={(e) => setV({ ...v, mode: e.target.value as RoundingMode })}>
              <option value="half_up">Half up (0.5 → 1)</option>
              <option value="half_even">Half even (banker’s)</option>
              <option value="up">Always up</option>
              <option value="down">Always down</option>
            </Select>
          </Field>
          <Field label="Decimals kept when rounding" htmlFor="fs-d">
            <Input id="fs-d" value={v.decimals} disabled={!canEdit || v.rounding === 'none'} onChange={(e) => setV({ ...v, decimals: e.target.value })} inputMode="numeric" />
          </Field>
          <Field label="Hours per person-month" htmlFor="fs-h" hint="Converts logged time into person-months.">
            <Input id="fs-h" value={v.hours} disabled={!canEdit} onChange={(e) => setV({ ...v, hours: e.target.value })} inputMode="decimal" />
          </Field>
          <Field label="Currency" htmlFor="fs-c">
            <Input id="fs-c" value={v.currency} disabled={!canEdit} onChange={(e) => setV({ ...v, currency: e.target.value.toUpperCase() })} maxLength={3} />
          </Field>
        </div>
        {errors.length > 0 && (
          <ul className="text-sm text-critical">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
        {canEdit && (
          <div>
            <Button
              variant="primary"
              disabled={errors.length > 0}
              onClick={() =>
                updateProject(ctx.project, {
                  currency: v.currency,
                  funding: {
                    ...ctx.project.funding,
                    indirect_rate: toBig(v.indirect).div(100).toString(),
                    funding_rate: toBig(v.funding).div(100).toString(),
                    rounding: v.rounding,
                    rounding_mode: v.mode,
                    rounding_decimals: Number(v.decimals),
                    hours_per_pm: Number(v.hours),
                  },
                })
                  .then(() => toast.show('Budget settings saved'))
                  .catch(toast.error)
              }
            >
              Save settings
            </Button>
          </div>
        )}
      </section>
      <CategoriesEditor data={data} canEdit={canEdit} />
    </div>
  );
}

function CategoriesEditor({ data, canEdit }: { data: FinanceData; canEdit: boolean }) {
  const ctx = useProjectCtx();
  const toast = useToast();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<CategoryKind>('other');
  const used = new Set([...data.lines.map((l) => l.category_id), ...data.expenditures.map((e) => e.category_id)]);
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm">Cost categories</h3>
      <p className="text-xs text-secondary">Categories ticked “indirect base” attract indirect costs. Subcontracting and financial support to third parties are usually excluded.</p>
      <ul className="flex flex-col divide-y divide-grid text-sm">
        {data.categories.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-2 py-1.5">
            <span className="min-w-0 flex-1">
              {c.code && <span className="text-secondary">{c.code} </span>}
              {c.name}
            </span>
            <Select
              value={c.kind}
              disabled={!canEdit}
              onChange={(e) => saveCategory({ id: c.id, project_id: c.project_id, kind: e.target.value }).catch(toast.error)}
              className="h-8 w-48"
              aria-label={`Kind of ${c.name}`}
            >
              {KINDS.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </Select>
            <Checkbox
              checked={c.indirect_base}
              disabled={!canEdit}
              onChange={(b) => saveCategory({ id: c.id, project_id: c.project_id, indirect_base: b }).catch(toast.error)}
              label="Indirect base"
            />
            {canEdit && (
              <IconButton
                label={used.has(c.id) ? `${c.name} is used by budget lines or expenditure` : `Delete ${c.name}`}
                disabled={used.has(c.id)}
                onClick={() => deleteCategory(c).catch(toast.error)}
              >
                <Trash2 className="size-3.5" />
              </IconButton>
            )}
          </li>
        ))}
        {data.categories.length === 0 && <li className="py-1.5 text-secondary">No categories yet.</li>}
      </ul>
      {canEdit && (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            saveCategory({ project_id: ctx.project.id, name: name.trim(), kind, indirect_base: defaultIndirectBase(kind), position: keyAfterLast(data.categories) })
              .then(() => setName(''))
              .catch(toast.error);
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New category" aria-label="Category name" className="h-8 flex-1" maxLength={200} />
          <Select value={kind} onChange={(e) => setKind(e.target.value as CategoryKind)} className="h-8 w-48" aria-label="Category kind">
            {KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </Select>
          <Button size="sm" type="submit" variant="primary" disabled={!name.trim()}>
            Add
          </Button>
        </form>
      )}
    </section>
  );
}

export function AuditTab() {
  const ctx = useProjectCtx();
  const [limit, setLimit] = useState(100);
  const q = useFinanceAudit(ctx.project.id, limit);
  if (q.isLoading) return <PageLoading />;
  if (q.error) return <ErrorNote error={q.error} retry={() => q.refetch()} />;
  const name = (id: string | null) => ctx.people.find((p) => p.user_id === id)?.display_name ?? (id ? 'Former member' : 'System');
  const LABEL: Record<string, string> = { budget_lines: 'budget line', expenditures: 'expenditure', partner_finance: 'partner rates', cost_categories: 'cost category' };
  const describe = (r: NonNullable<typeof q.data>[number]) => {
    const before = r.before ?? {};
    const after = r.after ?? {};
    const keys = ['amount', 'status', 'person_months', 'forecast_amount', 'pm_rate', 'funding_rate', 'indirect_rate', 'name', 'indirect_base', 'description'];
    if (r.op === 'update') {
      const changed = keys.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
      return changed.map((k) => `${k.replace('_', ' ')}: ${String(before[k] ?? '—')} → ${String(after[k] ?? '—')}`).join('; ');
    }
    const row = r.op === 'delete' ? before : after;
    return [row.description, row.name, row.amount != null ? `amount ${row.amount}` : null].filter(Boolean).join(' · ');
  };
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-secondary">Every change to budget lines, expenditure, categories and partner rates is recorded here. Only people with finance access can see it.</p>
      <ul className="flex flex-col divide-y divide-grid text-sm">
        {(q.data ?? []).map((r) => (
          <li key={r.id} className="py-1.5">
            <b>{name(r.actor_id)}</b> {r.op === 'insert' ? 'added' : r.op === 'update' ? 'changed' : 'deleted'} a {LABEL[r.table_name] ?? r.table_name}{' '}
            <span className="text-secondary">{formatDistanceToNow(parseISO(r.created_at), { addSuffix: true })}</span>
            <p className="text-xs text-secondary">{describe(r)}</p>
          </li>
        ))}
        {q.data?.length === 0 && <li className="py-1.5 text-secondary">No financial changes yet.</li>}
      </ul>
      {(q.data?.length ?? 0) >= limit && (
        <div>
          <Button size="sm" onClick={() => setLimit(limit + 200)}>
            Show more
          </Button>
        </div>
      )}
    </div>
  );
}
