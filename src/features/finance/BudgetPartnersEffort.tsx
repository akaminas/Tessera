import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import Big from 'big.js';
import { Trash2 } from 'lucide-react';
import { useProjectCtx } from '@/features/project/context';
import { Button, EmptyState, IconButton, Input, Select, PageLoading, ErrorNote } from '@/components/ui';
import { useToast } from '@/components/ui/Toast';
import {
  deleteAllocation,
  deleteEffortReport,
  saveAllocation,
  saveEffortReport,
  savePartnerFinance,
  useEffortData,
  type FinanceData,
  type Partner,
} from '@/data/finance';
import { computeEffort, isNumberLike, num, toBig } from '@/domain/finance';
import { useBudgetModel, useMoney } from './shared';

type Model = NonNullable<ReturnType<typeof useBudgetModel>>;

/* ================================================================ Partners */

export function PartnersTab({ data, model }: { data: FinanceData; model: Model }) {
  const ctx = useProjectCtx();
  const { money } = useMoney(ctx.project);
  const canEdit = ctx.finance === 'edit';
  if (!data.partners.length)
    return (
      <EmptyState
        title="No partners in this project"
        action={
          ctx.canManage ? (
            <Link className="text-sm text-link underline" to={`/p/${ctx.project.id}/settings`}>
              Add partner organisations in project settings
            </Link>
          ) : undefined
        }
      >
        Partners are the organisations sharing the budget. Importing a budget workbook also creates them.
      </EmptyState>
    );
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-secondary">
        Person-month rates convert effort into personnel cost. Leave the funding and indirect rates empty to use the project defaults (
        {model.settings.fundingRate.times(100).toString()} % funding, {model.settings.indirectRate.times(100).toString()} % indirect).{' '}
        {ctx.canManage && (
          <Link className="text-link underline" to={`/p/${ctx.project.id}/settings`}>
            Manage partners
          </Link>
        )}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-rule text-left">
              <th className="py-1.5 pr-3">Partner</th>
              <th className="py-1.5 pr-3">Role</th>
              <th className="py-1.5 pr-3">Person-month rate</th>
              <th className="py-1.5 pr-3">Funding rate</th>
              <th className="py-1.5 pr-3">Indirect rate</th>
              <th className="py-1.5 pr-3 text-right">Personnel budget</th>
              <th className="py-1.5 pr-3 text-right">PMs × rate</th>
              <th className="py-1.5 text-right">Difference</th>
            </tr>
          </thead>
          <tbody>
            {data.partners.map((p) => {
              const r = model.result.byPartner.find((x) => x.partnerId === p.id);
              const diff = r?.personnelFromRate ? r.personnelFromRate.minus(r.personnelBudget) : null;
              return (
                <tr key={p.id} className="border-b border-grid">
                  <td className="py-1.5 pr-3">
                    <b>{p.short_name || p.organizations?.short_name}</b> <span className="text-secondary">{p.organizations?.name}</span>
                    {p.organizations?.country && <span className="text-xs text-secondary"> · {p.organizations.country}</span>}
                  </td>
                  <td className="py-1.5 pr-3 capitalize">{p.role.replace('_', ' ')}</td>
                  <td className="py-1.5 pr-3">
                    <RateInput partner={p} field="pm_rate" value={model.partnerFinance.get(p.id)?.pm_rate} disabled={!canEdit} label={`Person-month rate for ${p.short_name}`} suffix={ctx.project.currency} />
                  </td>
                  <td className="py-1.5 pr-3">
                    <RateInput partner={p} field="funding_rate" value={model.partnerFinance.get(p.id)?.funding_rate} disabled={!canEdit} label="Funding rate" percent />
                  </td>
                  <td className="py-1.5 pr-3">
                    <RateInput partner={p} field="indirect_rate" value={model.partnerFinance.get(p.id)?.indirect_rate} disabled={!canEdit} label="Indirect rate" percent />
                  </td>
                  <td className="num py-1.5 pr-3 text-right">{r ? money(r.personnelBudget) : '—'}</td>
                  <td className="num py-1.5 pr-3 text-right">{r?.personnelFromRate ? money(r.personnelFromRate) : '—'}</td>
                  <td className={`num py-1.5 text-right ${diff && diff.abs().gt(0.01) ? 'text-critical' : ''}`}>{diff ? money(diff) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-secondary">Difference = budgeted person-months × rate − personnel budget. A non-zero value means rates and budgeted effort do not agree.</p>
    </div>
  );
}

function RateInput({
  partner,
  field,
  value,
  disabled,
  label,
  percent,
  suffix,
}: {
  partner: Partner;
  field: 'pm_rate' | 'funding_rate' | 'indirect_rate';
  value: string | number | null | undefined;
  disabled: boolean;
  label: string;
  percent?: boolean;
  suffix?: string;
}) {
  const toast = useToast();
  const initial = value == null || value === '' ? '' : percent ? toBig(value).times(100).toString() : toBig(value).toString();
  const [v, setV] = useState(initial);
  const save = () => {
    if (v === initial) return;
    if (v.trim() && (!isNumberLike(v) || toBig(v).lt(0) || (percent && toBig(v).gt(100)))) {
      toast.error(new Error(percent ? 'Enter a percentage between 0 and 100.' : 'Enter a non-negative number.'));
      setV(initial);
      return;
    }
    const stored = v.trim() ? (percent ? toBig(v).div(100).toString() : toBig(v).round(2).toString()) : null;
    savePartnerFinance(partner.project_id, partner.id, { [field]: stored }).catch((e) => {
      toast.error(e);
      setV(initial);
    });
  };
  return (
    <span className="inline-flex items-center gap-1">
      <Input value={v} onChange={(e) => setV(e.target.value)} onBlur={save} disabled={disabled} inputMode="decimal" aria-label={label} className="h-8 w-24" placeholder={percent ? 'default' : '—'} />
      <span className="text-xs text-secondary">{percent ? '%' : suffix}</span>
    </span>
  );
}

/* ================================================================= Effort */

export function EffortTab({ data, model }: { data: FinanceData; model: Model }) {
  const ctx = useProjectCtx();
  const { money } = useMoney(ctx.project);
  const effort = useEffortData(ctx.project.id);
  const toast = useToast();
  const canEdit = ctx.finance === 'edit';

  const orgToPartner = useMemo(() => new Map(data.partners.map((p) => [p.organization_id, p.id])), [data.partners]);
  const userToPartner = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of ctx.people) if (p.organization_id && orgToPartner.has(p.organization_id)) m.set(p.user_id, orgToPartner.get(p.organization_id)!);
    return m;
  }, [ctx.people, orgToPartner]);

  const matrix = useMemo(() => {
    if (!effort.data) return null;
    return computeEffort({
      lines: data.lines.map((l) => ({ partner_id: l.partner_id, work_package_id: l.work_package_id, person_months: l.person_months })),
      allocations: effort.data.allocations,
      reports: effort.data.reports,
      time: effort.data.time.map((t) => ({ partner_id: userToPartner.get(t.user_id) ?? null, work_package_id: t.cards?.work_package_id ?? null, minutes: t.minutes ?? 0 })),
      hoursPerPm: model.settings.hoursPerPm,
    });
  }, [effort.data, data.lines, userToPartner, model.settings.hoursPerPm]);

  if (effort.isLoading) return <PageLoading />;
  if (effort.error || !effort.data || !matrix) return <ErrorNote error={effort.error} retry={() => effort.refetch()} />;

  const partnerIds: (string | null)[] = [...data.partners.map((p) => p.id)];
  if ([...matrix.keys()].some((k) => k.startsWith('|'))) partnerIds.push(null);
  const wpIds: (string | null)[] = [...data.workPackages.map((w) => w.id)];
  if ([...matrix.keys()].some((k) => k.endsWith('|'))) wpIds.push(null);
  const cell = (p: string | null, w: string | null) => matrix.get(`${p ?? ''}|${w ?? ''}`);
  const sum = (cells: (ReturnType<typeof cell>)[], key: 'budgetPm' | 'actualPm' | 'allocatedPm') => cells.reduce((t, c) => t.plus(c?.[key] ?? 0), new Big(0));
  const unmappedMinutes = effort.data.time.filter((t) => !userToPartner.has(t.user_id)).reduce((s, t) => s + (t.minutes ?? 0), 0);

  return (
    <div className="flex flex-col gap-7">
      <section>
        <h3 className="mb-1 text-sm">Person-months by partner and work package</h3>
        <p className="mb-2 text-xs text-secondary">
          Each cell: actual ÷ budgeted person-months. Actual = reported effort + logged time ({model.settings.hoursPerPm} hours = 1 PM). Where no budget PMs exist, allocations are used.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-rule text-left">
                <th className="py-1.5 pr-3">Partner</th>
                {wpIds.map((w) => (
                  <th key={w ?? 'none'} className="py-1.5 pr-3 text-right">
                    {w ? model.wpById.get(w)?.code : 'No WP'}
                  </th>
                ))}
                <th className="py-1.5 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {partnerIds.map((p) => {
                const row = wpIds.map((w) => cell(p, w));
                const plan = sum(row, 'budgetPm');
                const act = sum(row, 'actualPm');
                return (
                  <tr key={p ?? 'none'} className="border-b border-grid">
                    <td className="py-1.5 pr-3">{model.partnerName(p)}</td>
                    {row.map((c, i) => (
                      <td key={i} className={`num py-1.5 pr-3 text-right ${c && c.budgetPm.gt(0) && c.actualPm.gt(c.budgetPm) ? 'text-critical' : ''}`}>
                        {c ? `${num(c.actualPm, 2)} / ${num(c.budgetPm.gt(0) ? c.budgetPm : c.allocatedPm, 2)}` : '—'}
                      </td>
                    ))}
                    <td className="num py-1.5 text-right font-bold">
                      {num(act, 2)} / {num(plan, 2)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {unmappedMinutes > 0 && (
          <p className="mt-2 text-xs text-secondary">
            {(unmappedMinutes / 60).toFixed(1)} logged hours belong to people not linked to a partner organisation and are counted under “Unassigned”. Link members to organisations in the
            workspace member list.
          </p>
        )}
      </section>

      <section>
        <h3 className="mb-1 text-sm">Personnel cost reconciliation</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-rule text-left">
                <th className="py-1.5 pr-3">Partner</th>
                <th className="py-1.5 pr-3 text-right">Budget PMs</th>
                <th className="py-1.5 pr-3 text-right">Actual PMs</th>
                <th className="py-1.5 pr-3 text-right">Rate</th>
                <th className="py-1.5 pr-3 text-right">Actual PMs × rate</th>
                <th className="py-1.5 text-right">Personnel spend recorded</th>
              </tr>
            </thead>
            <tbody>
              {data.partners.map((p) => {
                const cells = wpIds.map((w) => cell(p.id, w));
                const act = sum(cells, 'actualPm');
                const r = model.result.byPartner.find((x) => x.partnerId === p.id);
                const persCats = new Set(data.categories.filter((c) => c.kind === 'personnel').map((c) => c.id));
                const spent = data.expenditures.filter((e) => e.partner_id === p.id && e.status === 'actual' && persCats.has(e.category_id)).reduce((t, e) => t.plus(toBig(e.amount)), new Big(0));
                return (
                  <tr key={p.id} className="border-b border-grid">
                    <td className="py-1.5 pr-3">{model.partnerName(p.id)}</td>
                    <td className="num py-1.5 pr-3 text-right">{num(sum(cells, 'budgetPm'), 2)}</td>
                    <td className="num py-1.5 pr-3 text-right">{num(act, 2)}</td>
                    <td className="num py-1.5 pr-3 text-right">{r?.pmRate ? money(r.pmRate) : '—'}</td>
                    <td className="num py-1.5 pr-3 text-right">{r?.pmRate ? money(act.times(r.pmRate)) : '—'}</td>
                    <td className="num py-1.5 text-right">{money(spent)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm">Reported effort</h3>
          {canEdit && <ReportForm data={data} />}
          <ul className="mt-2 flex flex-col divide-y divide-grid text-sm">
            {effort.data.reports.map((r) => (
              <li key={r.id} className="flex items-center gap-2 py-1.5">
                <span className="num w-44 text-xs text-secondary">
                  {r.period_start} – {r.period_end}
                </span>
                <span className="flex-1">
                  {model.partnerName(r.partner_id)} · {r.work_package_id ? model.wpById.get(r.work_package_id)?.code : 'No WP'}
                  {r.user_id && <span className="text-secondary"> · {ctx.people.find((x) => x.user_id === r.user_id)?.display_name}</span>}
                  {r.note && <span className="text-secondary"> · {r.note}</span>}
                </span>
                <span className="num">{num(toBig(r.actual_pm), 2)} PM</span>
                {canEdit && (
                  <IconButton label="Delete report" onClick={() => deleteEffortReport(r).catch(toast.error)}>
                    <Trash2 className="size-3.5" />
                  </IconButton>
                )}
              </li>
            ))}
            {effort.data.reports.length === 0 && <li className="py-1.5 text-secondary">No effort reports yet.</li>}
          </ul>
        </div>
        <div>
          <h3 className="mb-2 text-sm">Staff allocations</h3>
          {canEdit && <AllocationForm data={data} />}
          <ul className="mt-2 flex flex-col divide-y divide-grid text-sm">
            {effort.data.allocations.map((a) => (
              <li key={a.id} className="flex items-center gap-2 py-1.5">
                <span className="flex-1">
                  {model.partnerName(a.partner_id)} · {a.work_package_id ? model.wpById.get(a.work_package_id)?.code : 'No WP'}
                  {a.user_id && <span> · {ctx.people.find((x) => x.user_id === a.user_id)?.display_name}</span>}
                  {a.role_title && <span className="text-secondary"> · {a.role_title}</span>}
                  {a.financial_year && <span className="text-secondary"> · {a.financial_year}</span>}
                </span>
                <span className="num">{num(toBig(a.planned_pm), 2)} PM</span>
                {canEdit && (
                  <IconButton label="Delete allocation" onClick={() => deleteAllocation(a).catch(toast.error)}>
                    <Trash2 className="size-3.5" />
                  </IconButton>
                )}
              </li>
            ))}
            {effort.data.allocations.length === 0 && <li className="py-1.5 text-secondary">No staff allocations yet.</li>}
          </ul>
        </div>
      </section>
    </div>
  );
}

function ReportForm({ data }: { data: FinanceData }) {
  const ctx = useProjectCtx();
  const toast = useToast();
  const [v, setV] = useState({ partner_id: data.partners[0]?.id ?? '', work_package_id: '', period: '', start: '', end: '', user_id: '', pm: '', note: '' });
  const period = data.periods.find((p) => p.id === v.period);
  const start = period?.start_date ?? v.start;
  const end = period?.end_date ?? v.end;
  const valid = isNumberLike(v.pm) && toBig(v.pm).gte(0) && start && end && end >= start;
  return (
    <form
      className="grid grid-cols-2 gap-2 rounded-[4px] border border-grid p-2 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        saveEffortReport({
          project_id: ctx.project.id,
          partner_id: v.partner_id || null,
          work_package_id: v.work_package_id || null,
          reporting_period_id: v.period || null,
          user_id: v.user_id || null,
          period_start: start,
          period_end: end,
          actual_pm: toBig(v.pm).round(4).toString(),
          note: v.note.trim(),
        })
          .then(() => setV({ ...v, pm: '', note: '' }))
          .catch(toast.error);
      }}
    >
      <Select value={v.partner_id} onChange={(e) => setV({ ...v, partner_id: e.target.value })} aria-label="Partner" className="h-8">
        <option value="">No partner</option>
        {data.partners.map((p) => (
          <option key={p.id} value={p.id}>
            {p.short_name || p.organizations?.name}
          </option>
        ))}
      </Select>
      <Select value={v.work_package_id} onChange={(e) => setV({ ...v, work_package_id: e.target.value })} aria-label="Work package" className="h-8">
        <option value="">No work package</option>
        {data.workPackages.map((w) => (
          <option key={w.id} value={w.id}>
            {w.code}
          </option>
        ))}
      </Select>
      <Select value={v.period} onChange={(e) => setV({ ...v, period: e.target.value })} aria-label="Reporting period" className="h-8">
        <option value="">Custom dates</option>
        {data.periods.map((p) => (
          <option key={p.id} value={p.id}>
            {p.code} {p.name}
          </option>
        ))}
      </Select>
      <Select value={v.user_id} onChange={(e) => setV({ ...v, user_id: e.target.value })} aria-label="Person" className="h-8">
        <option value="">Whole team</option>
        {ctx.people.map((p) => (
          <option key={p.user_id} value={p.user_id}>
            {p.display_name}
          </option>
        ))}
      </Select>
      {!v.period && (
        <>
          <Input type="date" value={v.start} onChange={(e) => setV({ ...v, start: e.target.value })} aria-label="From" className="h-8" />
          <Input type="date" value={v.end} onChange={(e) => setV({ ...v, end: e.target.value })} aria-label="To" className="h-8" />
        </>
      )}
      <Input value={v.pm} onChange={(e) => setV({ ...v, pm: e.target.value })} inputMode="decimal" placeholder="Person-months" aria-label="Person-months" className="h-8" />
      <Input value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} placeholder="Note" aria-label="Note" className="h-8" />
      <Button size="sm" type="submit" variant="primary" disabled={!valid} className="col-span-2">
        Add effort report
      </Button>
    </form>
  );
}

function AllocationForm({ data }: { data: FinanceData }) {
  const ctx = useProjectCtx();
  const toast = useToast();
  const [v, setV] = useState({ partner_id: data.partners[0]?.id ?? '', work_package_id: '', user_id: '', role: '', year: '', pm: '' });
  const valid = isNumberLike(v.pm) && toBig(v.pm).gte(0) && (!v.year || /^\d{4}$/.test(v.year));
  return (
    <form
      className="grid grid-cols-2 gap-2 rounded-[4px] border border-grid p-2 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        saveAllocation({
          project_id: ctx.project.id,
          partner_id: v.partner_id || null,
          work_package_id: v.work_package_id || null,
          user_id: v.user_id || null,
          role_title: v.role.trim(),
          financial_year: v.year ? Number(v.year) : null,
          planned_pm: toBig(v.pm).round(4).toString(),
        })
          .then(() => setV({ ...v, pm: '', role: '' }))
          .catch(toast.error);
      }}
    >
      <Select value={v.partner_id} onChange={(e) => setV({ ...v, partner_id: e.target.value })} aria-label="Partner" className="h-8">
        <option value="">No partner</option>
        {data.partners.map((p) => (
          <option key={p.id} value={p.id}>
            {p.short_name || p.organizations?.name}
          </option>
        ))}
      </Select>
      <Select value={v.work_package_id} onChange={(e) => setV({ ...v, work_package_id: e.target.value })} aria-label="Work package" className="h-8">
        <option value="">No work package</option>
        {data.workPackages.map((w) => (
          <option key={w.id} value={w.id}>
            {w.code}
          </option>
        ))}
      </Select>
      <Select value={v.user_id} onChange={(e) => setV({ ...v, user_id: e.target.value })} aria-label="Person" className="h-8">
        <option value="">Unnamed position</option>
        {ctx.people.map((p) => (
          <option key={p.user_id} value={p.user_id}>
            {p.display_name}
          </option>
        ))}
      </Select>
      <Input value={v.role} onChange={(e) => setV({ ...v, role: e.target.value })} placeholder="Role (e.g. researcher)" aria-label="Role" className="h-8" />
      <Input value={v.year} onChange={(e) => setV({ ...v, year: e.target.value })} placeholder="Year (optional)" aria-label="Year" inputMode="numeric" className="h-8" />
      <Input value={v.pm} onChange={(e) => setV({ ...v, pm: e.target.value })} placeholder="Planned PMs" aria-label="Planned person-months" inputMode="decimal" className="h-8" />
      <Button size="sm" type="submit" variant="primary" disabled={!valid} className="col-span-2">
        Add allocation
      </Button>
    </form>
  );
}

