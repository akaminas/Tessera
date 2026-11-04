import { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Download, Pencil, Plus, Trash2 } from 'lucide-react';
import { useProjectCtx } from '@/features/project/context';
import { useOrganizations } from '@/data/core';
import {
  addMeasurement,
  createKpi,
  currentPeriod,
  deleteMeasurement,
  setMeasurementStatus,
  updateKpi,
  useKpis,
  usePartners,
  useReportingPeriods,
  useWorkPackagesBasic,
  type Kpi,
  type KpiMeasurement,
  type KpiStatus,
} from '@/data/finance';
import { Button, Checkbox, EmptyState, ErrorNote, Field, IconButton, Input, PageLoading, Select, Textarea } from '@/components/ui';
import { Dialog, ConfirmDialog } from '@/components/ui/Dialog';
import { MenuContent, MenuItem, MenuRoot, MenuTrigger } from '@/components/ui/Menu';
import { useToast } from '@/components/ui/Toast';
import { ChartFrame, LineChart, Meter } from '@/components/charts';
import { isNumberLike, num, toBig } from '@/domain/finance';
import { downloadCSV, downloadXLSX } from '@/lib/exporters';
import { keyAfterLast } from '@/domain/ordering';
import { cn } from '@/lib/cn';
import { EvidencePanel } from './shared';

/** Progress from baseline toward target (0–100), respecting the KPI's direction. */
export function kpiProgress(k: Pick<Kpi, 'baseline' | 'target' | 'direction'>, current: number | null): number | null {
  if (current == null || k.target == null) return null;
  const target = Number(k.target);
  const base = k.baseline != null ? Number(k.baseline) : 0;
  if (k.direction === 'maintain') return current >= target ? 100 : Math.max(0, (current / (target || 1)) * 100);
  const span = target - base;
  if (span === 0) return current === target ? 100 : 0;
  const p = ((current - base) / span) * 100;
  return Math.max(0, Math.min(100, p));
}

export default function KpisPage() {
  const ctx = useProjectCtx();
  const q = useKpis(ctx.project.id);
  const periods = useReportingPeriods(ctx.project.id);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<Kpi | 'new' | null>(null);
  const toast = useToast();

  const statusById = useMemo(() => new Map((q.data?.status ?? []).map((s) => [s.kpi_id, s])), [q.data?.status]);
  const period = currentPeriod(periods.data ?? []);
  const missingThisPeriod = useMemo(() => {
    if (!period || !q.data) return new Set<string>();
    const measured = new Set(q.data.measurements.filter((m) => m.reporting_period_id === period.id || (m.measured_on >= period.start_date && m.measured_on <= period.end_date)).map((m) => m.kpi_id));
    return new Set(q.data.kpis.filter((k) => k.frequency !== 'once' && !measured.has(k.id)).map((k) => k.id));
  }, [period, q.data]);

  if (q.isLoading) return <PageLoading />;
  if (q.error || !q.data) return <div className="p-6"><ErrorNote error={q.error} retry={() => q.refetch()} /></div>;
  const kpis = q.data.kpis;
  const sel = kpis.find((k) => k.id === selected) ?? null;

  const exportRows = () => [
    ['Code', 'KPI', 'Unit', 'Direction', 'Baseline', 'Target', 'Target date', 'Current value', 'Last measured', 'Measurements', 'Verified', 'Evidence missing', 'Progress %'],
    ...kpis.map((k) => {
      const s = statusById.get(k.id);
      const cur = s?.current_value != null ? Number(s.current_value) : null;
      const prog = kpiProgress(k, cur);
      return [k.code, k.name, k.unit, k.direction, k.baseline != null ? Number(k.baseline) : null, k.target != null ? Number(k.target) : null, k.target_date, cur, s?.last_measured ?? null, s?.measurements ?? 0, s?.verified ?? 0, s?.evidence_missing ?? 0, prog != null ? Math.round(prog) : null];
    }),
  ];
  const measurementRows = () => [
    ['KPI', 'Date', 'Value', 'Reporting period', 'Verification', 'Note'],
    ...q.data!.measurements.map((m) => [
      kpis.find((k) => k.id === m.kpi_id)?.code || kpis.find((k) => k.id === m.kpi_id)?.name || '',
      m.measured_on,
      Number(m.value),
      (periods.data ?? []).find((p) => p.id === m.reporting_period_id)?.code ?? '',
      m.verification_status,
      m.note,
    ]),
  ];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 px-3 py-4 sm:px-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex-1 text-xl">KPIs</h2>
        {period && (
          <span className="text-xs text-secondary">
            Current period {period.code} ({period.name}){missingThisPeriod.size > 0 && <b className="text-serious"> · {missingThisPeriod.size} without a measurement</b>}
          </span>
        )}
        <MenuRoot>
          <MenuTrigger asChild>
            <Button size="sm" icon={<Download className="size-3.5" />} disabled={!kpis.length}>
              Export
            </Button>
          </MenuTrigger>
          <MenuContent>
            <MenuItem onSelect={() => downloadCSV(`${ctx.project.acronym || 'project'}-kpis`, exportRows())}>KPIs (CSV)</MenuItem>
            <MenuItem onSelect={() => downloadCSV(`${ctx.project.acronym || 'project'}-kpi-measurements`, measurementRows())}>Measurements (CSV)</MenuItem>
            <MenuItem
              onSelect={() => {
                const [h1, ...b1] = exportRows();
                const [h2, ...b2] = measurementRows();
                downloadXLSX(`${ctx.project.acronym || 'project'}-kpis`, [
                  { name: 'KPIs', header: h1 as string[], rows: b1 },
                  { name: 'Measurements', header: h2 as string[], rows: b2 },
                ]).catch(toast.error);
              }}
            >
              KPIs and measurements (XLSX)
            </MenuItem>
          </MenuContent>
        </MenuRoot>
        {ctx.canEdit && (
          <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEditing('new')}>
            New KPI
          </Button>
        )}
      </div>
      {kpis.length === 0 ? (
        <EmptyState title="No KPIs defined">Define indicators with a unit, baseline and target, then record measurements and evidence each reporting period.</EmptyState>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <ul className="flex flex-col divide-y divide-grid">
            {kpis.map((k) => {
              const s = statusById.get(k.id);
              const cur = s?.current_value != null ? Number(s.current_value) : null;
              const prog = kpiProgress(k, cur);
              return (
                <li key={k.id}>
                  <button
                    onClick={() => setSelected(k.id)}
                    className={cn('flex w-full flex-col gap-1 px-2 py-2 text-left hover:bg-hover', selected === k.id && 'bg-selected')}
                    aria-pressed={selected === k.id}
                  >
                    <span className="flex items-baseline gap-2">
                      {k.code && <span className="text-xs text-secondary">{k.code}</span>}
                      <span className="flex-1 font-bold">{k.name}</span>
                      <span className="num text-sm">
                        {cur != null ? num(cur, 2) : '—'}
                        {k.target != null && <span className="text-secondary"> / {num(Number(k.target), 2)}</span>} <span className="text-xs text-secondary">{k.unit}</span>
                      </span>
                    </span>
                    {prog != null && <Meter value={prog} label={`${k.name} progress toward target`} />}
                    <span className="flex flex-wrap gap-x-3 text-xs text-secondary">
                      <span>{s?.last_measured ? `Last measured ${format(parseISO(s.last_measured), 'd MMM yyyy')}` : 'Not measured yet'}</span>
                      {missingThisPeriod.has(k.id) && <span className="text-serious">No measurement this period</span>}
                      {(s?.evidence_missing ?? 0) > 0 && <span className="text-serious">{s!.evidence_missing} evidence item(s) missing</span>}
                      {s && s.measurements > 0 && <span>{s.verified}/{s.measurements} verified</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div>
            {sel ? (
              <KpiDetail kpi={sel} status={statusById.get(sel.id)} measurements={q.data.measurements.filter((m) => m.kpi_id === sel.id)} onEdit={() => setEditing(sel)} />
            ) : (
              <p className="text-sm text-secondary">Select a KPI to see its history, record measurements and manage evidence.</p>
            )}
          </div>
        </div>
      )}
      {editing && <KpiDialog kpi={editing === 'new' ? null : editing} position={keyAfterLast(kpis)} onClose={() => setEditing(null)} onCreated={setSelected} />}
    </div>
  );
}

function KpiDetail({ kpi, status, measurements, onEdit }: { kpi: Kpi; status?: KpiStatus; measurements: KpiMeasurement[]; onEdit: () => void }) {
  const ctx = useProjectCtx();
  const periods = useReportingPeriods(ctx.project.id);
  const partners = usePartners(ctx.project.id);
  const toast = useToast();
  const [v, setV] = useState({ date: new Date().toISOString().slice(0, 10), value: '', period: '', partner: '', note: '' });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const sorted = [...measurements].sort((a, b) => a.measured_on.localeCompare(b.measured_on));
  const valid = sorted.filter((m) => m.verification_status !== 'rejected');
  // cumulative series for "sum" KPIs, raw values otherwise
  let acc = 0;
  const series = valid.map((m) => (kpi.aggregation === 'sum' ? (acc += Number(m.value)) : Number(m.value)));
  const autoPeriod = (periods.data ?? []).find((p) => p.start_date <= v.date && p.end_date >= v.date);
  const cur = status?.current_value != null ? Number(status.current_value) : null;
  const meets = cur != null && kpi.target != null && (kpi.direction === 'decrease' ? cur <= Number(kpi.target) : cur >= Number(kpi.target));

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <h3 className="font-title text-lg">
            {kpi.code && <span className="text-secondary">{kpi.code} </span>}
            {kpi.name}
          </h3>
          {kpi.description && <p className="text-sm text-secondary">{kpi.description}</p>}
          <p className="text-xs text-secondary">
            {kpi.direction === 'decrease' ? 'Lower is better' : kpi.direction === 'maintain' ? 'Maintain at or above target' : 'Higher is better'} · baseline{' '}
            {kpi.baseline != null ? num(Number(kpi.baseline), 2) : '—'} · target {kpi.target != null ? num(Number(kpi.target), 2) : '—'} {kpi.unit}
            {kpi.target_date && ` by ${format(parseISO(kpi.target_date), 'd MMM yyyy')}`} · {kpi.aggregation === 'sum' ? 'measurements are added up' : kpi.aggregation === 'max' ? 'highest value counts' : 'latest value counts'}
          </p>
          {kpi.verification && <p className="mt-1 text-xs">Means of verification: {kpi.verification}</p>}
        </div>
        {ctx.canEdit && (
          <>
            <IconButton label="Edit KPI" onClick={onEdit}>
              <Pencil className="size-4" />
            </IconButton>
            <IconButton label="Delete KPI" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="size-4" />
            </IconButton>
          </>
        )}
      </div>

      {valid.length > 0 ? (
        <ChartFrame
          title={cur == null ? `${kpi.name} has no valid measurement yet` : meets ? `${kpi.name} has reached its target` : `${kpi.name} is ${num(cur, 2)} ${kpi.unit} against a target of ${kpi.target != null ? num(Number(kpi.target), 2) : '—'}`}
          subtitle={`${valid.length} measurement${valid.length === 1 ? '' : 's'}${kpi.aggregation === 'sum' ? ', cumulative' : ''}; rejected measurements excluded`}
          unit={kpi.unit}
        >
          <LineChart
            labels={valid.map((m) => format(parseISO(m.measured_on), 'MMM yy'))}
            series={[{ name: kpi.code || 'Value', values: series, color: 'teal' }]}
            reference={kpi.target != null ? { value: Number(kpi.target), label: 'Target' } : undefined}
          />
        </ChartFrame>
      ) : (
        <p className="text-sm text-secondary">No measurements yet.</p>
      )}

      <div>
        <h4 className="mb-1 text-sm">Measurements</h4>
        <ul className="flex flex-col divide-y divide-grid text-sm">
          {[...sorted].reverse().map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-2 py-1.5">
              <span className="num w-24 text-secondary">{m.measured_on}</span>
              <span className="num w-24 font-bold">{num(Number(m.value), 4)}</span>
              <span className="text-xs text-secondary">{(periods.data ?? []).find((p) => p.id === m.reporting_period_id)?.code}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-secondary">{m.note}</span>
              <span className={cn('text-xs', m.verification_status === 'verified' ? 'text-good' : m.verification_status === 'rejected' ? 'text-critical' : 'text-secondary')}>
                {m.verification_status === 'verified' ? '✓ Verified' : m.verification_status === 'rejected' ? '✕ Rejected' : 'Unverified'}
              </span>
              {ctx.canManage && m.verification_status !== 'verified' && (
                <Button size="sm" variant="ghost" onClick={() => setMeasurementStatus(m, 'verified').catch(toast.error)}>
                  Verify
                </Button>
              )}
              {ctx.canManage && m.verification_status !== 'rejected' && (
                <Button size="sm" variant="ghost" onClick={() => setMeasurementStatus(m, 'rejected').catch(toast.error)}>
                  Reject
                </Button>
              )}
              {ctx.canEdit && (
                <IconButton label="Delete measurement" onClick={() => deleteMeasurement(m).catch(toast.error)}>
                  <Trash2 className="size-3.5" />
                </IconButton>
              )}
            </li>
          ))}
        </ul>
        {ctx.canEdit && (
          <form
            className="mt-2 grid grid-cols-2 gap-2 rounded-[4px] border border-grid p-2 sm:grid-cols-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!isNumberLike(v.value)) return toast.error(new Error('Enter a numeric value.'));
              addMeasurement({
                kpi_id: kpi.id,
                project_id: kpi.project_id,
                measured_on: v.date,
                value: toBig(v.value).toString(),
                note: v.note.trim(),
                reporting_period_id: v.period || autoPeriod?.id || null,
                partner_id: v.partner || null,
              })
                .then(() => setV({ ...v, value: '', note: '' }))
                .catch(toast.error);
            }}
          >
            <Input type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} aria-label="Measured on" className="h-8" />
            <Input value={v.value} onChange={(e) => setV({ ...v, value: e.target.value })} inputMode="decimal" placeholder={`Value (${kpi.unit || 'number'})`} aria-label="Value" className="h-8" />
            <Select value={v.period} onChange={(e) => setV({ ...v, period: e.target.value })} aria-label="Reporting period" className="h-8">
              <option value="">{autoPeriod ? `Period from date (${autoPeriod.code})` : 'No reporting period'}</option>
              {(periods.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} {p.name}
                </option>
              ))}
            </Select>
            <Select value={v.partner} onChange={(e) => setV({ ...v, partner: e.target.value })} aria-label="Partner" className="h-8">
              <option value="">Whole project</option>
              {(partners.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.short_name || p.organizations?.name}
                </option>
              ))}
            </Select>
            <Input value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} placeholder="Note or source" aria-label="Note" className="h-8" />
            <Button size="sm" type="submit" variant="primary" disabled={!v.value}>
              Record measurement
            </Button>
          </form>
        )}
      </div>

      <div>
        <h4 className="mb-1 text-sm">Evidence</h4>
        <EvidencePanel projectId={kpi.project_id} entityType="kpi" entityId={kpi.id} canEdit={ctx.canEdit} canVerify={ctx.canManage} defaultTitle={kpi.verification || 'Supporting document'} />
      </div>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        danger
        title="Delete this KPI?"
        confirmLabel="Delete"
        body="The KPI is hidden from lists and reports. Its measurements stay in the database for the audit trail."
        onConfirm={() =>
          updateKpi(kpi, { deleted_at: new Date().toISOString() })
            .then(() => setConfirmDelete(false))
            .catch(toast.error)
        }
      />
    </section>
  );
}

function KpiDialog({ kpi, position, onClose, onCreated }: { kpi: Kpi | null; position: string; onClose: () => void; onCreated: (id: string) => void }) {
  const ctx = useProjectCtx();
  const toast = useToast();
  const wps = useWorkPackagesBasic(ctx.project.id);
  const orgs = useOrganizations(ctx.project.workspace_id);
  const [v, setV] = useState({
    code: kpi?.code ?? '',
    name: kpi?.name ?? '',
    description: kpi?.description ?? '',
    unit: kpi?.unit ?? '',
    direction: kpi?.direction ?? 'increase',
    baseline: kpi?.baseline != null ? String(kpi.baseline) : '',
    target: kpi?.target != null ? String(kpi.target) : '',
    target_date: kpi?.target_date ?? '',
    aggregation: kpi?.aggregation ?? 'latest',
    frequency: kpi?.frequency ?? 'period',
    verification: kpi?.verification ?? '',
    evidence_required: kpi?.evidence_required ?? true,
    work_package_id: kpi?.work_package_id ?? '',
    responsible_org_id: kpi?.responsible_org_id ?? '',
    owner_id: kpi?.owner_id ?? '',
  });
  const [busy, setBusy] = useState(false);
  const errors: string[] = [];
  if (!v.name.trim()) errors.push('Name the KPI.');
  if (v.baseline && !isNumberLike(v.baseline)) errors.push('Baseline must be a number.');
  if (v.target && !isNumberLike(v.target)) errors.push('Target must be a number.');
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });

  return (
    <Dialog
      open
      onOpenChange={onClose}
      title={kpi ? 'Edit KPI' : 'New KPI'}
      width={640}
      footer={
        <Button
          variant="primary"
          loading={busy}
          disabled={errors.length > 0}
          onClick={async () => {
            setBusy(true);
            const row = {
              code: v.code.trim(),
              name: v.name.trim(),
              description: v.description,
              unit: v.unit.trim(),
              direction: v.direction as Kpi['direction'],
              baseline: v.baseline ? toBig(v.baseline).toString() : null,
              target: v.target ? toBig(v.target).toString() : null,
              target_date: v.target_date || null,
              aggregation: v.aggregation as Kpi['aggregation'],
              frequency: v.frequency as Kpi['frequency'],
              verification: v.verification,
              evidence_required: v.evidence_required,
              work_package_id: v.work_package_id || null,
              responsible_org_id: v.responsible_org_id || null,
              owner_id: v.owner_id || null,
            };
            try {
              if (kpi) await updateKpi(kpi, row);
              else onCreated(await createKpi({ project_id: ctx.project.id, position, ...row }));
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
        <Field label="Code" htmlFor="k-code">
          <Input id="k-code" value={v.code} onChange={set('code')} maxLength={30} />
        </Field>
        <Field label="Name" htmlFor="k-name">
          <Input id="k-name" value={v.name} onChange={set('name')} maxLength={300} />
        </Field>
        <Field label="Description" htmlFor="k-desc" className="sm:col-span-2">
          <Textarea id="k-desc" value={v.description} onChange={set('description')} rows={2} />
        </Field>
        <Field label="Unit" htmlFor="k-unit">
          <Input id="k-unit" value={v.unit} onChange={set('unit')} placeholder="e.g. participants, %, t CO₂e" />
        </Field>
        <Field label="Direction" htmlFor="k-dir">
          <Select id="k-dir" value={v.direction} onChange={set('direction')}>
            <option value="increase">Higher is better</option>
            <option value="decrease">Lower is better</option>
            <option value="maintain">Maintain at or above</option>
          </Select>
        </Field>
        <Field label="Baseline" htmlFor="k-base">
          <Input id="k-base" value={v.baseline} onChange={set('baseline')} inputMode="decimal" />
        </Field>
        <Field label="Target" htmlFor="k-target">
          <Input id="k-target" value={v.target} onChange={set('target')} inputMode="decimal" />
        </Field>
        <Field label="Target date" htmlFor="k-td">
          <Input id="k-td" type="date" value={v.target_date} onChange={set('target_date')} />
        </Field>
        <Field label="How measurements combine" htmlFor="k-agg">
          <Select id="k-agg" value={v.aggregation} onChange={set('aggregation')}>
            <option value="latest">Latest value</option>
            <option value="sum">Add them up (counts)</option>
            <option value="max">Highest value</option>
          </Select>
        </Field>
        <Field label="Measured" htmlFor="k-freq">
          <Select id="k-freq" value={v.frequency} onChange={set('frequency')}>
            <option value="period">Every reporting period</option>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="annual">Annually</option>
            <option value="once">Once</option>
          </Select>
        </Field>
        <Field label="Work package" htmlFor="k-wp">
          <Select id="k-wp" value={v.work_package_id} onChange={set('work_package_id')}>
            <option value="">None</option>
            {(wps.data ?? []).map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} {w.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Responsible organisation" htmlFor="k-org">
          <Select id="k-org" value={v.responsible_org_id} onChange={set('responsible_org_id')}>
            <option value="">None</option>
            {(orgs.data ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {o.short_name || o.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Owner" htmlFor="k-owner">
          <Select id="k-owner" value={v.owner_id} onChange={set('owner_id')}>
            <option value="">Nobody</option>
            {ctx.people.map((p) => (
              <option key={p.user_id} value={p.user_id}>
                {p.display_name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Means of verification" htmlFor="k-ver" className="sm:col-span-2">
          <Input id="k-ver" value={v.verification} onChange={set('verification')} placeholder="e.g. attendance lists, signed agreements" />
        </Field>
        <Checkbox checked={v.evidence_required} onChange={(b) => setV({ ...v, evidence_required: b })} label="Evidence required" />
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
