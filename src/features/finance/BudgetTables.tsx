import { useMemo, useState } from 'react';
import Big from 'big.js';
import { Download, Pencil, Plus, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { useProjectCtx } from '@/features/project/context';
import { Button, Field, IconButton, Input, Select, Textarea, EmptyState } from '@/components/ui';
import { Dialog, ConfirmDialog } from '@/components/ui/Dialog';
import { MenuContent, MenuItem, MenuRoot, MenuTrigger } from '@/components/ui/Menu';
import { useToast } from '@/components/ui/Toast';
import { createExpenditure, createLine, deleteLine, trashExpenditure, updateExpenditure, updateLine, type BudgetLine, type Expenditure, type FinanceData } from '@/data/finance';
import { isNumberLike, num, toBig } from '@/domain/finance';
import { downloadCSV, downloadXLSX } from '@/lib/exporters';
import { EvidencePanel, useBudgetModel, useMoney } from './shared';

type Model = NonNullable<ReturnType<typeof useBudgetModel>>;

const decimalOk = (v: string, allowEmpty = true) => (allowEmpty && v.trim() === '') || (isNumberLike(v) && !toBig(v).lt(0));

/* ================================================================== Lines */

export function LinesTab({ data, model }: { data: FinanceData; model: Model }) {
  const ctx = useProjectCtx();
  const { money } = useMoney(ctx.project);
  const canEdit = ctx.finance === 'edit';
  const toast = useToast();
  const [f, setF] = useState({ partner: '', wp: '', category: '', year: '', text: '' });
  const [editing, setEditing] = useState<BudgetLine | 'new' | null>(null);
  const [confirm, setConfirm] = useState<BudgetLine | null>(null);

  const rows = useMemo(
    () =>
      data.lines.filter(
        (l) =>
          (!f.partner || (l.partner_id ?? 'none') === f.partner) &&
          (!f.wp || (l.work_package_id ?? 'none') === f.wp) &&
          (!f.category || l.category_id === f.category) &&
          (!f.year || String(l.financial_year ?? 'none') === f.year) &&
          (!f.text.trim() || l.description.toLowerCase().includes(f.text.trim().toLowerCase())),
      ),
    [data.lines, f],
  );
  const totals = rows.reduce(
    (t, l) => {
      const lr = model.result.lines.get(l.id);
      return {
        direct: t.direct.plus(toBig(l.amount)),
        indirect: t.indirect.plus(lr?.indirect ?? 0),
        pm: t.pm.plus(toBig(l.person_months)),
        forecast: t.forecast.plus(l.forecast_amount != null ? toBig(l.forecast_amount) : toBig(l.amount)),
      };
    },
    { direct: new Big(0), indirect: new Big(0), pm: new Big(0), forecast: new Big(0) },
  );
  const years = [...new Set(data.lines.map((l) => String(l.financial_year ?? 'none')))].sort();

  const exportRows = () => [
    ['Partner', 'Work package', 'Category', 'Year', 'Period', 'Description', 'Direct', 'Indirect (line level)', 'Total', 'Person-months', 'Forecast', 'Source'],
    ...rows.map((l) => {
      const lr = model.result.lines.get(l.id)!;
      return [
        model.partnerName(l.partner_id),
        l.work_package_id ? model.wpById.get(l.work_package_id)?.code ?? '' : '',
        model.catById.get(l.category_id)?.name ?? '',
        l.financial_year ?? '',
        l.reporting_period_id ? model.periodById.get(l.reporting_period_id)?.code ?? '' : '',
        l.description,
        Number(toBig(l.amount).toFixed(2)),
        Number(lr.indirect.toFixed(2)),
        Number(lr.total.toFixed(2)),
        l.person_months != null ? Number(toBig(l.person_months).toFixed(4)) : null,
        l.forecast_amount != null ? Number(toBig(l.forecast_amount).toFixed(2)) : null,
        l.source_ref || l.source,
      ];
    }),
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={f.partner} onChange={(e) => setF({ ...f, partner: e.target.value })} className="h-8 w-40" aria-label="Partner">
          <option value="">All partners</option>
          {data.partners.map((p) => (
            <option key={p.id} value={p.id}>
              {model.partnerName(p.id)}
            </option>
          ))}
          <option value="none">Unassigned</option>
        </Select>
        <Select value={f.wp} onChange={(e) => setF({ ...f, wp: e.target.value })} className="h-8 w-36" aria-label="Work package">
          <option value="">All work packages</option>
          {data.workPackages.map((w) => (
            <option key={w.id} value={w.id}>
              {w.code}
            </option>
          ))}
          <option value="none">No work package</option>
        </Select>
        <Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} className="h-8 w-44" aria-label="Category">
          <option value="">All categories</option>
          {data.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select value={f.year} onChange={(e) => setF({ ...f, year: e.target.value })} className="h-8 w-28" aria-label="Year">
          <option value="">All years</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y === 'none' ? 'No year' : y}
            </option>
          ))}
        </Select>
        <Input value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} placeholder="Search descriptions" aria-label="Search descriptions" className="h-8 w-48" />
        <div className="ml-auto flex gap-2">
          <MenuRoot>
            <MenuTrigger asChild>
              <Button size="sm" icon={<Download className="size-3.5" />}>
                Export
              </Button>
            </MenuTrigger>
            <MenuContent>
              <MenuItem onSelect={() => downloadCSV(`${ctx.project.acronym || 'budget'}-lines`, exportRows())}>CSV</MenuItem>
              <MenuItem
                onSelect={() => {
                  const [header, ...body] = exportRows();
                  downloadXLSX(`${ctx.project.acronym || 'budget'}-lines`, [
                    { name: 'Budget lines', header: header as string[], rows: body, totals: true, formats: [undefined, undefined, undefined, '0', undefined, undefined, '#,##0.00', '#,##0.00', '#,##0.00', '0.0000', '#,##0.00'] },
                  ]).catch(toast.error);
                }}
              >
                Excel (XLSX)
              </MenuItem>
            </MenuContent>
          </MenuRoot>
          {canEdit && (
            <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEditing('new')} disabled={!data.categories.length}>
              Add line
            </Button>
          )}
        </div>
      </div>
      {!data.categories.length && <p className="text-sm text-secondary">Add cost categories in Settings before adding budget lines.</p>}
      {rows.length === 0 ? (
        <EmptyState title="No budget lines match" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-rule text-left">
                <th className="py-1.5 pr-3">Partner</th>
                <th className="py-1.5 pr-3">WP</th>
                <th className="py-1.5 pr-3">Category</th>
                <th className="py-1.5 pr-3">Year</th>
                <th className="py-1.5 pr-3">Description</th>
                <th className="py-1.5 pr-3 text-right">Direct</th>
                <th className="py-1.5 pr-3 text-right">Indirect</th>
                <th className="py-1.5 pr-3 text-right">PMs</th>
                <th className="py-1.5 pr-3 text-right">Forecast</th>
                <th className="py-1.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id} className="border-b border-grid hover:bg-hover">
                  <td className="py-1.5 pr-3">{model.partnerName(l.partner_id)}</td>
                  <td className="py-1.5 pr-3">{l.work_package_id ? model.wpById.get(l.work_package_id)?.code : '—'}</td>
                  <td className="py-1.5 pr-3">{model.catById.get(l.category_id)?.name}</td>
                  <td className="num py-1.5 pr-3">{l.financial_year ?? '—'}</td>
                  <td className="max-w-[280px] truncate py-1.5 pr-3" title={l.description}>
                    {l.description || <span className="text-secondary">—</span>}
                  </td>
                  <td className="num py-1.5 pr-3 text-right">{money(toBig(l.amount))}</td>
                  <td className="num py-1.5 pr-3 text-right text-secondary">{money(model.result.lines.get(l.id)?.indirect ?? new Big(0))}</td>
                  <td className="num py-1.5 pr-3 text-right">{l.person_months != null ? num(toBig(l.person_months), 2) : '—'}</td>
                  <td className="num py-1.5 pr-3 text-right">{l.forecast_amount != null ? money(toBig(l.forecast_amount)) : <span className="text-secondary">as planned</span>}</td>
                  <td className="py-1.5 text-right">
                    {canEdit && (
                      <span className="inline-flex">
                        <IconButton label="Edit line" onClick={() => setEditing(l)}>
                          <Pencil className="size-3.5" />
                        </IconButton>
                        <IconButton label="Delete line" onClick={() => setConfirm(l)}>
                          <Trash2 className="size-3.5" />
                        </IconButton>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              <tr className="font-bold">
                <td className="py-1.5 pr-3" colSpan={5}>
                  Total of {rows.length} line{rows.length === 1 ? '' : 's'}
                </td>
                <td className="num py-1.5 pr-3 text-right">{money(totals.direct)}</td>
                <td className="num py-1.5 pr-3 text-right">{money(totals.indirect)}</td>
                <td className="num py-1.5 pr-3 text-right">{num(totals.pm, 2)}</td>
                <td className="num py-1.5 pr-3 text-right">{money(totals.forecast)}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {editing && <LineDialog data={data} line={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={Boolean(confirm)}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Delete this budget line?"
        danger
        confirmLabel="Delete"
        body="The change is recorded in the finance audit trail."
        onConfirm={() =>
          deleteLine(confirm!)
            .then(() => setConfirm(null))
            .catch(toast.error)
        }
      />
    </div>
  );
}

function LineDialog({ data, line, onClose }: { data: FinanceData; line: BudgetLine | null; onClose: () => void }) {
  const ctx = useProjectCtx();
  const toast = useToast();
  const [v, setV] = useState({
    partner_id: line?.partner_id ?? data.partners[0]?.id ?? '',
    work_package_id: line?.work_package_id ?? '',
    category_id: line?.category_id ?? data.categories[0]?.id ?? '',
    financial_year: line?.financial_year != null ? String(line.financial_year) : '',
    reporting_period_id: line?.reporting_period_id ?? '',
    description: line?.description ?? '',
    amount: line ? toBig(line.amount).toString() : '',
    person_months: line?.person_months != null ? toBig(line.person_months).toString() : '',
    forecast_amount: line?.forecast_amount != null ? toBig(line.forecast_amount).toString() : '',
  });
  const [busy, setBusy] = useState(false);
  const errors: string[] = [];
  if (!decimalOk(v.amount, false)) errors.push('Enter a non-negative amount.');
  if (!decimalOk(v.person_months)) errors.push('Person-months must be a non-negative number.');
  if (!decimalOk(v.forecast_amount)) errors.push('Forecast must be a non-negative number.');
  if (v.financial_year && !/^\d{4}$/.test(v.financial_year)) errors.push('Year must have four digits.');
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });
  const isPersonnel = data.categories.find((c) => c.id === v.category_id)?.kind === 'personnel';

  return (
    <Dialog
      open
      onOpenChange={onClose}
      title={line ? 'Edit budget line' : 'Add budget line'}
      width={560}
      footer={
        <Button
          variant="primary"
          loading={busy}
          disabled={errors.length > 0}
          onClick={async () => {
            setBusy(true);
            const patch = {
              partner_id: v.partner_id || null,
              work_package_id: v.work_package_id || null,
              category_id: v.category_id,
              financial_year: v.financial_year ? Number(v.financial_year) : null,
              reporting_period_id: v.reporting_period_id || null,
              description: v.description.trim(),
              amount: toBig(v.amount).round(2).toString(),
              person_months: v.person_months.trim() ? toBig(v.person_months).round(4).toString() : null,
              forecast_amount: v.forecast_amount.trim() ? toBig(v.forecast_amount).round(2).toString() : null,
            };
            try {
              if (line) await updateLine(line, patch);
              else await createLine({ project_id: ctx.project.id, ...patch });
              onClose();
            } catch (err) {
              toast.error(err);
            } finally {
              setBusy(false);
            }
          }}
        >
          Save
        </Button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Partner" htmlFor="bl-p">
          <Select id="bl-p" value={v.partner_id} onChange={set('partner_id')}>
            <option value="">Unassigned</option>
            {data.partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.short_name || p.organizations?.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Cost category" htmlFor="bl-c">
          <Select id="bl-c" value={v.category_id} onChange={set('category_id')}>
            {data.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Work package" htmlFor="bl-w">
          <Select id="bl-w" value={v.work_package_id} onChange={set('work_package_id')}>
            <option value="">None</option>
            {data.workPackages.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} {w.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Financial year" htmlFor="bl-y">
          <Input id="bl-y" inputMode="numeric" value={v.financial_year} onChange={set('financial_year')} placeholder="2027" />
        </Field>
        <Field label="Reporting period" htmlFor="bl-rp">
          <Select id="bl-rp" value={v.reporting_period_id} onChange={set('reporting_period_id')}>
            <option value="">None</option>
            {data.periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={`Amount, direct (${ctx.project.currency})`} htmlFor="bl-a">
          <Input id="bl-a" inputMode="decimal" value={v.amount} onChange={set('amount')} />
        </Field>
        <Field label="Person-months" htmlFor="bl-pm" hint={isPersonnel ? 'For personnel lines.' : 'Usually only for personnel.'}>
          <Input id="bl-pm" inputMode="decimal" value={v.person_months} onChange={set('person_months')} />
        </Field>
        <Field label="Forecast (optional)" htmlFor="bl-f" hint="Expected final cost if different from plan.">
          <Input id="bl-f" inputMode="decimal" value={v.forecast_amount} onChange={set('forecast_amount')} />
        </Field>
        <Field label="Justification" htmlFor="bl-d" className="sm:col-span-2">
          <Textarea id="bl-d" value={v.description} onChange={set('description')} rows={3} />
        </Field>
      </div>
      {errors.length > 0 && (
        <ul className="mt-3 text-sm text-critical">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

/* ============================================================ Expenditure */

export function ExpendituresTab({ data, model }: { data: FinanceData; model: Model }) {
  const ctx = useProjectCtx();
  const { money } = useMoney(ctx.project);
  const canEdit = ctx.finance === 'edit';
  const toast = useToast();
  const [status, setStatus] = useState<'' | 'actual' | 'committed'>('');
  const [partner, setPartner] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<Expenditure | 'new' | null>(null);
  const rows = data.expenditures.filter((e) => (!status || e.status === status) && (!partner || (e.partner_id ?? 'none') === partner));
  const total = rows.reduce((t, e) => t.plus(toBig(e.amount)), new Big(0));

  const exportRows = () => [
    ['Date', 'Status', 'Partner', 'Work package', 'Category', 'Description', 'Supplier', 'Invoice', 'Amount', 'Person-months'],
    ...rows.map((e) => [
      e.spent_on,
      e.status,
      model.partnerName(e.partner_id),
      e.work_package_id ? model.wpById.get(e.work_package_id)?.code ?? '' : '',
      model.catById.get(e.category_id)?.name ?? '',
      e.description,
      e.supplier,
      e.invoice_ref,
      Number(toBig(e.amount).toFixed(2)),
      e.person_months != null ? Number(toBig(e.person_months).toFixed(4)) : null,
    ]),
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="h-8 w-40" aria-label="Status">
          <option value="">Committed and actual</option>
          <option value="actual">Actual only</option>
          <option value="committed">Committed only</option>
        </Select>
        <Select value={partner} onChange={(e) => setPartner(e.target.value)} className="h-8 w-40" aria-label="Partner">
          <option value="">All partners</option>
          {data.partners.map((p) => (
            <option key={p.id} value={p.id}>
              {model.partnerName(p.id)}
            </option>
          ))}
          <option value="none">Unassigned</option>
        </Select>
        <div className="ml-auto flex gap-2">
          <MenuRoot>
            <MenuTrigger asChild>
              <Button size="sm" icon={<Download className="size-3.5" />}>
                Export
              </Button>
            </MenuTrigger>
            <MenuContent>
              <MenuItem onSelect={() => downloadCSV(`${ctx.project.acronym || 'project'}-expenditure`, exportRows())}>CSV</MenuItem>
              <MenuItem
                onSelect={() => {
                  const [header, ...body] = exportRows();
                  downloadXLSX(`${ctx.project.acronym || 'project'}-expenditure`, [
                    { name: 'Expenditure', header: header as string[], rows: body, totals: true, formats: [undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, '#,##0.00', '0.0000'] },
                  ]).catch(toast.error);
                }}
              >
                Excel (XLSX)
              </MenuItem>
            </MenuContent>
          </MenuRoot>
          {canEdit && (
            <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEditing('new')} disabled={!data.categories.length}>
              Record expenditure
            </Button>
          )}
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No expenditure recorded">Record committed and actual costs here; attach invoices as evidence.</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-rule text-left">
                <th className="w-6" />
                <th className="py-1.5 pr-3">Date</th>
                <th className="py-1.5 pr-3">Status</th>
                <th className="py-1.5 pr-3">Partner</th>
                <th className="py-1.5 pr-3">Category</th>
                <th className="py-1.5 pr-3">Description</th>
                <th className="py-1.5 pr-3 text-right">Amount</th>
                <th className="py-1.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <ExpRow
                  key={e.id}
                  e={e}
                  model={model}
                  money={money}
                  canEdit={canEdit}
                  open={open === e.id}
                  onToggle={() => setOpen(open === e.id ? null : e.id)}
                  onEdit={() => setEditing(e)}
                  onTrash={async () => {
                    try {
                      const res = await trashExpenditure(e, true);
                      toast.show('Expenditure deleted', { undo: () => trashExpenditure(res, false).then(() => undefined) });
                    } catch (err) {
                      toast.error(err);
                    }
                  }}
                />
              ))}
              <tr className="font-bold">
                <td />
                <td className="py-1.5 pr-3" colSpan={5}>
                  Total
                </td>
                <td className="num py-1.5 pr-3 text-right">{money(total)}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {editing && <ExpDialog data={data} exp={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ExpRow({
  e,
  model,
  money,
  canEdit,
  open,
  onToggle,
  onEdit,
  onTrash,
}: {
  e: Expenditure;
  model: Model;
  money: (v: Big) => string;
  canEdit: boolean;
  open: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onTrash: () => void;
}) {
  const ctx = useProjectCtx();
  const toast = useToast();
  return (
    <>
      <tr className="border-b border-grid hover:bg-hover">
        <td>
          <IconButton label={open ? 'Hide evidence' : 'Show evidence'} onClick={onToggle}>
            {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </IconButton>
        </td>
        <td className="num py-1.5 pr-3">{e.spent_on}</td>
        <td className="py-1.5 pr-3">
          {e.status === 'committed' ? 'Committed' : 'Actual'}
          {canEdit && e.status === 'committed' && (
            <button className="ml-2 text-xs text-link hover:underline" onClick={() => updateExpenditure(e, { status: 'actual' }).catch(toast.error)}>
              mark paid
            </button>
          )}
        </td>
        <td className="py-1.5 pr-3">{model.partnerName(e.partner_id)}</td>
        <td className="py-1.5 pr-3">{model.catById.get(e.category_id)?.name}</td>
        <td className="max-w-[260px] truncate py-1.5 pr-3" title={e.description}>
          {e.description}
          {e.supplier && <span className="text-secondary"> · {e.supplier}</span>}
        </td>
        <td className="num py-1.5 pr-3 text-right">{money(toBig(e.amount))}</td>
        <td className="py-1.5 text-right">
          {canEdit && (
            <span className="inline-flex">
              <IconButton label="Edit expenditure" onClick={onEdit}>
                <Pencil className="size-3.5" />
              </IconButton>
              <IconButton label="Delete expenditure" onClick={onTrash}>
                <Trash2 className="size-3.5" />
              </IconButton>
            </span>
          )}
        </td>
      </tr>
      {open && (
        <tr className="border-b border-grid bg-card">
          <td />
          <td colSpan={7} className="py-2 pr-3">
            <EvidencePanel projectId={ctx.project.id} entityType="expense" entityId={e.id} canEdit={canEdit} canVerify={canEdit} finance defaultTitle="Invoice or receipt" />
          </td>
        </tr>
      )}
    </>
  );
}

function ExpDialog({ data, exp, onClose }: { data: FinanceData; exp: Expenditure | null; onClose: () => void }) {
  const ctx = useProjectCtx();
  const toast = useToast();
  const [v, setV] = useState({
    status: exp?.status ?? 'actual',
    spent_on: exp?.spent_on ?? new Date().toISOString().slice(0, 10),
    partner_id: exp?.partner_id ?? data.partners[0]?.id ?? '',
    work_package_id: exp?.work_package_id ?? '',
    category_id: exp?.category_id ?? data.categories[0]?.id ?? '',
    budget_line_id: exp?.budget_line_id ?? '',
    reporting_period_id: exp?.reporting_period_id ?? '',
    description: exp?.description ?? '',
    supplier: exp?.supplier ?? '',
    invoice_ref: exp?.invoice_ref ?? '',
    amount: exp ? toBig(exp.amount).toString() : '',
    person_months: exp?.person_months != null ? toBig(exp.person_months).toString() : '',
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });
  // pick a reporting period automatically from the date
  const autoPeriod = data.periods.find((p) => p.start_date <= v.spent_on && p.end_date >= v.spent_on);
  const errors: string[] = [];
  if (!decimalOk(v.amount, false)) errors.push('Enter a non-negative amount.');
  if (!v.description.trim()) errors.push('Describe the expenditure.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.spent_on)) errors.push('Enter a date.');
  if (!decimalOk(v.person_months)) errors.push('Person-months must be a non-negative number.');
  const lineOptions = data.lines.filter((l) => (!v.partner_id || l.partner_id === v.partner_id) && l.category_id === v.category_id);

  return (
    <Dialog
      open
      onOpenChange={onClose}
      title={exp ? 'Edit expenditure' : 'Record expenditure'}
      width={580}
      footer={
        <Button
          variant="primary"
          loading={busy}
          disabled={errors.length > 0}
          onClick={async () => {
            setBusy(true);
            const row = {
              status: v.status as Expenditure['status'],
              spent_on: v.spent_on,
              partner_id: v.partner_id || null,
              work_package_id: v.work_package_id || null,
              category_id: v.category_id,
              budget_line_id: v.budget_line_id || null,
              reporting_period_id: v.reporting_period_id || autoPeriod?.id || null,
              description: v.description.trim(),
              supplier: v.supplier.trim(),
              invoice_ref: v.invoice_ref.trim(),
              amount: toBig(v.amount).round(2).toString(),
              person_months: v.person_months.trim() ? toBig(v.person_months).round(4).toString() : null,
            };
            try {
              if (exp) await updateExpenditure(exp, row);
              else await createExpenditure({ project_id: ctx.project.id, ...row });
              onClose();
            } catch (err) {
              toast.error(err);
            } finally {
              setBusy(false);
            }
          }}
        >
          Save
        </Button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Status" htmlFor="ex-s">
          <Select id="ex-s" value={v.status} onChange={set('status')}>
            <option value="actual">Actual (paid or invoiced)</option>
            <option value="committed">Committed (ordered, not yet paid)</option>
          </Select>
        </Field>
        <Field label="Date" htmlFor="ex-d">
          <Input id="ex-d" type="date" value={v.spent_on} onChange={set('spent_on')} />
        </Field>
        <Field label="Partner" htmlFor="ex-p">
          <Select id="ex-p" value={v.partner_id} onChange={set('partner_id')}>
            <option value="">Unassigned</option>
            {data.partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.short_name || p.organizations?.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Cost category" htmlFor="ex-c">
          <Select id="ex-c" value={v.category_id} onChange={set('category_id')}>
            {data.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Work package" htmlFor="ex-w">
          <Select id="ex-w" value={v.work_package_id} onChange={set('work_package_id')}>
            <option value="">None</option>
            {data.workPackages.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} {w.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Budget line (optional)" htmlFor="ex-l">
          <Select id="ex-l" value={v.budget_line_id} onChange={set('budget_line_id')}>
            <option value="">None</option>
            {lineOptions.map((l) => (
              <option key={l.id} value={l.id}>
                {(l.description || 'Line').slice(0, 60)} · {toBig(l.amount).toFixed(2)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Reporting period" htmlFor="ex-rp" hint={!v.reporting_period_id && autoPeriod ? `Will use ${autoPeriod.code} from the date.` : undefined}>
          <Select id="ex-rp" value={v.reporting_period_id} onChange={set('reporting_period_id')}>
            <option value="">From the date</option>
            {data.periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={`Amount (${ctx.project.currency})`} htmlFor="ex-a">
          <Input id="ex-a" inputMode="decimal" value={v.amount} onChange={set('amount')} />
        </Field>
        <Field label="Description" htmlFor="ex-desc" className="sm:col-span-2">
          <Input id="ex-desc" value={v.description} onChange={set('description')} maxLength={500} />
        </Field>
        <Field label="Supplier" htmlFor="ex-sup">
          <Input id="ex-sup" value={v.supplier} onChange={set('supplier')} />
        </Field>
        <Field label="Invoice reference" htmlFor="ex-inv">
          <Input id="ex-inv" value={v.invoice_ref} onChange={set('invoice_ref')} />
        </Field>
        <Field label="Person-months (personnel costs)" htmlFor="ex-pm">
          <Input id="ex-pm" inputMode="decimal" value={v.person_months} onChange={set('person_months')} />
        </Field>
      </div>
      {errors.length > 0 && (
        <ul className="mt-3 text-sm text-critical">
          {errors.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
