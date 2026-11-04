import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import {
  PERIOD_STATUS_LABEL,
  deleteReportingPeriod,
  generateReportingPeriods,
  saveReportingPeriod,
  useReportingPeriods,
  type ReportingPeriod,
} from '@/data/controls';
import { Button, EmptyState, Field, IconButton, Input, Select } from '@/components/ui';
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog';
import { useToast } from '@/components/ui/Toast';
import { fmtDate, monthRangeLabel } from './helpers';

/** Reporting periods of a project: list, edit, generate every N months. */
export function ReportingPeriodsManager({ projectId, canManage, start, end }: { projectId: string; canManage: boolean; start: string | null; end: string | null }) {
  const periods = useReportingPeriods(projectId);
  const toast = useToast();
  const [editing, setEditing] = useState<ReportingPeriod | 'new' | null>(null);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [months, setMonths] = useState('6');
  const [dueAfter, setDueAfter] = useState('60');
  const [confirm, setConfirm] = useState<ReportingPeriod | null>(null);
  const list = periods.data ?? [];

  return (
    <div className="flex flex-col gap-3">
      {list.length === 0 ? (
        <EmptyState title="No reporting periods">
          Reporting periods group progress, effort, costs and KPI measurements for periodic reports.
          {!start || !end ? ' Set the project start and end dates to generate them automatically.' : ''}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-rule text-left">
                <th className="py-2 pr-3 font-bold">Period</th>
                <th className="py-2 pr-3 font-bold">Dates</th>
                <th className="py-2 pr-3 font-bold">Report due</th>
                <th className="py-2 pr-3 font-bold">Status</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id} className="border-b border-grid">
                  <td className="py-2 pr-3">
                    <b>{p.code}</b> {p.name}
                    {start && <span className="block text-xs text-secondary">{monthRangeLabel(start, p.start_date, p.end_date)}</span>}
                  </td>
                  <td className="num py-2 pr-3">
                    {fmtDate(p.start_date)} – {fmtDate(p.end_date)}
                  </td>
                  <td className="num py-2 pr-3">{fmtDate(p.due_date)}</td>
                  <td className="py-2 pr-3">
                    {canManage ? (
                      <Select
                        value={p.status}
                        onChange={(e) => saveReportingPeriod(projectId, { ...strip(p), status: e.target.value as ReportingPeriod['status'] }, p.id).catch(toast.error)}
                        className="h-8 w-40"
                        aria-label={`Status of ${p.code}`}
                      >
                        {(Object.keys(PERIOD_STATUS_LABEL) as ReportingPeriod['status'][]).map((s) => (
                          <option key={s} value={s}>
                            {PERIOD_STATUS_LABEL[s]}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      PERIOD_STATUS_LABEL[p.status]
                    )}
                  </td>
                  <td className="py-2 text-right">
                    {canManage && (
                      <span className="inline-flex gap-0.5">
                        <IconButton label={`Edit ${p.code}`} onClick={() => setEditing(p)}>
                          <Pencil className="size-4" />
                        </IconButton>
                        <IconButton label={`Delete ${p.code}`} onClick={() => setConfirm(p)}>
                          <Trash2 className="size-4" />
                        </IconButton>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canManage && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setEditing('new')}>
            Add period
          </Button>
          <Button size="sm" onClick={() => setGenerateOpen(true)} disabled={!start || !end} title={!start || !end ? 'Set project start and end dates first' : undefined}>
            Generate periods
          </Button>
        </div>
      )}
      {editing && <PeriodEditor projectId={projectId} period={editing === 'new' ? null : editing} count={list.length} onClose={() => setEditing(null)} />}
      <Dialog
        open={generateOpen}
        onOpenChange={setGenerateOpen}
        title="Generate reporting periods"
        width={420}
        footer={
          <Button
            variant="primary"
            onClick={async () => {
              const m = parseInt(months, 10);
              const d = parseInt(dueAfter, 10);
              if (!(m >= 1 && m <= 60)) return toast.error(new Error('Choose between 1 and 60 months.'));
              try {
                const n = await generateReportingPeriods(projectId, m, Number.isFinite(d) ? d : 60);
                toast.show(`${n} period${n === 1 ? '' : 's'} cover the project; existing codes were kept`);
                setGenerateOpen(false);
              } catch (err) {
                toast.error(err);
              }
            }}
          >
            Generate
          </Button>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-secondary">
            Periods are created from {fmtDate(start)} to {fmtDate(end)}. Periods whose code (RP1, RP2…) already exists are left unchanged.
          </p>
          <Field label="Length (months)" htmlFor="gen-m">
            <Input id="gen-m" type="number" min={1} max={60} value={months} onChange={(e) => setMonths(e.target.value)} />
          </Field>
          <Field label="Report due (days after period end)" htmlFor="gen-d">
            <Input id="gen-d" type="number" min={0} max={365} value={dueAfter} onChange={(e) => setDueAfter(e.target.value)} />
          </Field>
        </div>
      </Dialog>
      <ConfirmDialog
        open={Boolean(confirm)}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Delete ${confirm?.code}?`}
        danger
        confirmLabel="Delete"
        body="Budget lines, expenditures and KPI measurements that refer to this period keep their data but lose the period link."
        onConfirm={async () => {
          if (!confirm) return;
          try {
            await deleteReportingPeriod(confirm);
            setConfirm(null);
          } catch (err) {
            toast.error(err);
          }
        }}
      />
    </div>
  );
}

function strip(p: ReportingPeriod): Omit<ReportingPeriod, 'id' | 'project_id'> {
  return { code: p.code, name: p.name, start_date: p.start_date, end_date: p.end_date, due_date: p.due_date, status: p.status, notes: p.notes };
}

function PeriodEditor({ projectId, period, count, onClose }: { projectId: string; period: ReportingPeriod | null; count: number; onClose: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState<Omit<ReportingPeriod, 'id' | 'project_id'>>(
    period ? strip(period) : { code: `RP${count + 1}`, name: '', start_date: '', end_date: '', due_date: null, status: 'open', notes: '' },
  );
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog
      open
      onOpenChange={onClose}
      title={period ? `Edit ${period.code}` : 'New reporting period'}
      width={480}
      footer={
        <Button
          variant="primary"
          onClick={async () => {
            setError(null);
            if (!form.code.trim() || !form.start_date || !form.end_date) return setError('Code, start and end are required.');
            if (form.end_date < form.start_date) return setError('The end must be on or after the start.');
            try {
              await saveReportingPeriod(projectId, { ...form, code: form.code.trim() }, period?.id);
              onClose();
            } catch (err) {
              toast.error(err);
            }
          }}
        >
          Save
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-[100px_1fr] gap-3">
          <Field label="Code" htmlFor="rp-code">
            <Input id="rp-code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          </Field>
          <Field label="Name" htmlFor="rp-name">
            <Input id="rp-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. M1–M6" />
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Start" htmlFor="rp-start">
            <Input id="rp-start" type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
          </Field>
          <Field label="End" htmlFor="rp-end">
            <Input id="rp-end" type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
          </Field>
          <Field label="Report due" htmlFor="rp-due">
            <Input id="rp-due" type="date" value={form.due_date ?? ''} onChange={(e) => setForm({ ...form, due_date: e.target.value || null })} />
          </Field>
        </div>
        <Field label="Notes" htmlFor="rp-notes">
          <Input id="rp-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Field>
        {error && (
          <p role="alert" className="text-sm text-critical">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
