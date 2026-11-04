import { useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import Big from 'big.js';
import { FileSpreadsheet } from 'lucide-react';
import { useProjectCtx } from '@/features/project/context';
import { useFinanceData } from '@/data/finance';
import { Button, EmptyState, ErrorNote, PageLoading } from '@/components/ui';
import { ChartFrame, ColumnChart, HBarChart, StatTile } from '@/components/charts';
import { pct, type Totals } from '@/domain/finance';
import { FinanceRestricted, SubTabs, useBudgetModel, useMoney } from './shared';
import { LinesTab, ExpendituresTab } from './BudgetTables';
import { PartnersTab, EffortTab } from './BudgetPartnersEffort';
import { SettingsTab, AuditTab } from './BudgetSettings';

type Tab = 'overview' | 'lines' | 'expenditures' | 'partners' | 'effort' | 'settings' | 'audit';
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'lines', label: 'Budget lines' },
  { id: 'expenditures', label: 'Expenditure' },
  { id: 'partners', label: 'Partners & rates' },
  { id: 'effort', label: 'Person-months' },
  { id: 'settings', label: 'Settings' },
  { id: 'audit', label: 'Audit trail' },
];

export default function BudgetPage() {
  const ctx = useProjectCtx();
  const { sub } = useParams();
  const navigate = useNavigate();
  const tab = (TABS.some((t) => t.id === sub) ? sub : 'overview') as Tab;
  const allowed = ctx.finance !== 'none';
  const data = useFinanceData(ctx.project.id, allowed);
  const model = useBudgetModel(ctx.project, data.data);

  if (!allowed) return <FinanceRestricted />;
  if (data.isLoading) return <PageLoading />;
  if (data.error || !data.data || !model) return <div className="p-6"><ErrorNote error={data.error} retry={() => data.refetch()} /></div>;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 px-3 py-4 sm:px-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex-1 text-xl">Budget</h2>
        {ctx.finance === 'view' && <span className="text-xs text-secondary">Read-only finance access</span>}
        {ctx.finance === 'edit' && (
          <Button size="sm" variant="ghost" icon={<FileSpreadsheet className="size-4" />} onClick={() => navigate(`/p/${ctx.project.id}/import`)}>
            Import or export workbook
          </Button>
        )}
      </div>
      <SubTabs tabs={TABS} value={tab} onChange={(t) => navigate(`/p/${ctx.project.id}/budget${t === 'overview' ? '' : `/${t}`}`)} />
      {tab === 'overview' && <Overview data={data.data} model={model} />}
      {tab === 'lines' && <LinesTab data={data.data} model={model} />}
      {tab === 'expenditures' && <ExpendituresTab data={data.data} model={model} />}
      {tab === 'partners' && <PartnersTab data={data.data} model={model} />}
      {tab === 'effort' && <EffortTab data={data.data} model={model} />}
      {tab === 'settings' && <SettingsTab data={data.data} />}
      {tab === 'audit' && <AuditTab />}
    </div>
  );
}

type Model = NonNullable<ReturnType<typeof useBudgetModel>>;

function Overview({ data, model }: { data: import('@/data/finance').FinanceData; model: Model }) {
  const ctx = useProjectCtx();
  const { money, short } = useMoney(ctx.project);
  const t = model.result.total;
  const n = (b: Big) => Number(b.toFixed(2));

  const byPartner = useMemo(
    () =>
      model.result.byPartner
        .map((p) => ({ label: model.partnerName(p.partnerId), value: n(p.eligible), secondary: undefined as number | undefined }))
        .sort((a, b) => b.value - a.value),
    [model],
  );
  const byCategory = useMemo(
    () => [...model.result.byCategory.entries()].map(([id, v]) => ({ label: model.catById.get(id)?.name ?? 'Unknown', value: n(v.planned) })).sort((a, b) => b.value - a.value),
    [model],
  );
  const byWp = useMemo(
    () =>
      [...model.result.byWorkPackage.entries()]
        .map(([id, v]) => ({ label: id === 'none' ? 'No work package' : `${model.wpById.get(id)?.code ?? '?'} ${model.wpById.get(id)?.name ?? ''}`.trim(), value: n(v.actual), secondary: n(v.planned) }))
        .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })),
    [model],
  );
  const years = [...model.result.byYear.keys()].filter((k) => k !== 'none').sort();

  if (!data.lines.length && !data.expenditures.length)
    return (
      <EmptyState
        title="No budget yet"
        action={
          ctx.finance === 'edit' ? (
            <div className="flex gap-2">
              <Link className="text-sm text-link underline" to={`/p/${ctx.project.id}/budget/lines`}>
                Add budget lines
              </Link>
              <Link className="text-sm text-link underline" to={`/p/${ctx.project.id}/import`}>
                Import a budget workbook
              </Link>
            </div>
          ) : undefined
        }
      >
        Budget lines, expenditure and person-months appear here once they are recorded.
      </EmptyState>
    );

  const top = byPartner[0];
  const util = t.utilisation;
  const overspend = model.result.byPartner.filter((p) => p.variance.gt(0));

  return (
    <div className="flex flex-col gap-7">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatTile label="Total eligible budget" value={short(n(t.eligible))} note={`${money(t.planned, 0)} direct + ${money(t.indirect, 0)} indirect`} />
        <StatTile label="Requested funding" value={short(n(t.requested))} />
        <StatTile label="Actual spend (direct)" value={short(n(t.actual))} note={`Utilisation ${pct(util, 1)}`} />
        <StatTile label="Committed" value={short(n(t.committed))} />
        <StatTile label="Remaining (direct)" value={short(n(t.remaining))} tone={t.remaining.lt(0) ? 'critical' : undefined} note={t.remaining.lt(0) ? 'Overspent' : undefined} />
      </div>
      {!model.result.roundingAdjustment.eq(0) && (
        <p className="text-xs text-secondary">
          Indirect costs are rounded {model.settings.rounding === 'partner' ? 'per partner' : model.settings.rounding === 'category' ? 'per partner and category' : 'per line'}; breakdowns by
          category, work package and year use unrounded line values, which differ from the official total by {money(model.result.roundingAdjustment)}.
        </p>
      )}
      <div className="grid gap-8 lg:grid-cols-2">
        <ChartFrame
          title={top ? `${top.label} holds the largest share of the eligible budget` : 'Eligible budget by partner'}
          subtitle="Total eligible costs (direct + indirect) per partner"
          unit={ctx.project.currency}
        >
          <HBarChart data={byPartner} highlight={top?.label} format={short} />
        </ChartFrame>
        <ChartFrame title={byCategory[0] ? `${byCategory[0].label} is the largest cost category` : 'Direct costs by category'} subtitle="Planned direct costs" unit={ctx.project.currency}>
          <HBarChart data={byCategory} format={short} />
        </ChartFrame>
        {byWp.length > 0 && (
          <ChartFrame title="Spending against plan by work package" subtitle="Bars: actual direct spend; band: planned direct budget" unit={ctx.project.currency}>
            <HBarChart data={byWp} format={short} />
          </ChartFrame>
        )}
        {years.length > 0 && (
          <ChartFrame title="Planned and actual direct costs per year" subtitle="Planned from budget lines; actual from recorded expenditure" unit={ctx.project.currency}>
            <ColumnChart
              categories={years}
              stacked={false}
              format={short}
              series={[
                { name: 'Planned', values: years.map((y) => n(model.result.byYear.get(y)!.planned)), color: 'teal' },
                { name: 'Actual', values: years.map((y) => n(model.result.byYear.get(y)!.actual)), color: 'terracotta' },
              ]}
            />
          </ChartFrame>
        )}
      </div>
      <section>
        <h3 className="mb-2 text-sm">Partners: plan, spend and variance</h3>
        {overspend.length > 0 && <p className="mb-2 text-sm text-critical">{overspend.length} partner{overspend.length > 1 ? 's are' : ' is'} forecast above plan.</p>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-rule text-left">
                {['Partner', 'Direct', 'Indirect', 'Eligible', 'Share', 'Requested', 'Committed', 'Actual', 'Remaining', 'Forecast', 'Variance', 'Use'].map((h, i) => (
                  <th key={h} className={`py-1.5 pr-3 font-bold ${i ? 'text-right' : ''}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {model.result.byPartner.map((p) => (
                <TotalsRow key={p.partnerId ?? 'none'} label={model.partnerName(p.partnerId)} t={p} share={p.share} money={money} />
              ))}
              <TotalsRow label="Total" t={t} share={t.eligible.gt(0) ? 1 : null} money={money} bold />
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export function TotalsRow({ label, t, share, money, bold }: { label: string; t: Totals; share: number | null; money: (v: Big, d?: number) => string; bold?: boolean }) {
  return (
    <tr className={`border-b border-grid ${bold ? 'font-bold' : ''}`}>
      <td className="py-1.5 pr-3">{label}</td>
      <td className="num py-1.5 pr-3 text-right">{money(t.planned)}</td>
      <td className="num py-1.5 pr-3 text-right">{money(t.indirect)}</td>
      <td className="num py-1.5 pr-3 text-right">{money(t.eligible)}</td>
      <td className="num py-1.5 pr-3 text-right">{pct(share, 1)}</td>
      <td className="num py-1.5 pr-3 text-right">{money(t.requested)}</td>
      <td className="num py-1.5 pr-3 text-right">{money(t.committed)}</td>
      <td className="num py-1.5 pr-3 text-right">{money(t.actual)}</td>
      <td className={`num py-1.5 pr-3 text-right ${t.remaining.lt(0) ? 'text-critical' : ''}`}>{money(t.remaining)}</td>
      <td className="num py-1.5 pr-3 text-right">{money(t.forecast)}</td>
      <td className={`num py-1.5 pr-3 text-right ${t.variance.gt(0) ? 'text-critical' : ''}`}>{money(t.variance)}</td>
      <td className="num py-1.5 text-right">{pct(t.utilisation, 0)}</td>
    </tr>
  );
}
