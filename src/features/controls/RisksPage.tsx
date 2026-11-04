import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { AlertTriangle, ArrowDown, ArrowUp, Download, MoreHorizontal, Pencil, Plus, Trash2, X } from 'lucide-react';
import { RISK_STATUS_LABEL, saveRisk, useRisks, useWorkPackages, type Risk, type RiskInput, type RiskStatus } from '@/data/controls';
import { useProjectCtx } from '@/features/project/context';
import { Avatar, Button, Checkbox, EmptyState, ErrorNote, Field, IconButton, Input, PageHeader, PageLoading, Select, Textarea } from '@/components/ui';
import { Dialog } from '@/components/ui/Dialog';
import { MenuContent, MenuItem, MenuRoot, MenuTrigger } from '@/components/ui/Menu';
import { useToast } from '@/components/ui/Toast';
import { downloadCSV, downloadXLSX, type Cell } from '@/lib/exporters';
import { cn } from '@/lib/cn';
import { EMBER_DARK, EMBER_LIGHT, emberStep, emberText, fmtDate, riskLevel, riskMatrix } from './helpers';

const LEVEL_WORDS = ['Very low', 'Low', 'Medium', 'High', 'Very high'];
const LEVEL_LABEL = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' } as const;
type SortKey = 'score' | 'title' | 'status' | 'review' | 'owner';

export default function RisksPage() {
  const { project, canEdit, people } = useProjectCtx();
  const risks = useRisks(project.id);
  const wps = useWorkPackages(project.id);
  const toast = useToast();
  const [tab, setTab] = useState<'risk' | 'issue'>('risk');
  const [showClosed, setShowClosed] = useState(false);
  const [cell, setCell] = useState<{ p: number; i: number } | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'score', dir: -1 });
  const [editing, setEditing] = useState<Risk | 'new' | null>(null);
  const today = format(new Date(), 'yyyy-MM-dd');
  const dark = typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark';
  const ember = dark ? EMBER_DARK : EMBER_LIGHT;

  const ofKind = useMemo(() => (risks.data ?? []).filter((r) => r.kind === tab), [risks.data, tab]);
  const open = ofKind.filter((r) => r.status !== 'closed' && r.status !== 'mitigated');
  const matrix = riskMatrix(open);
  const person = (id: string | null) => people.find((p) => p.user_id === id);
  const wpCode = (id: string | null) => wps.data?.find((w) => w.id === id)?.code ?? '';

  const list = useMemo(() => {
    const base = ofKind.filter(
      (r) => (showClosed || (r.status !== 'closed' && r.status !== 'mitigated')) && (!cell || (r.probability === cell.p && r.impact === cell.i)),
    );
    const cmp = (a: Risk, b: Risk): number => {
      switch (sort.key) {
        case 'score':
          return a.score - b.score;
        case 'title':
          return a.title.localeCompare(b.title);
        case 'status':
          return a.status.localeCompare(b.status);
        case 'review':
          return (a.review_date ?? '9999').localeCompare(b.review_date ?? '9999');
        case 'owner':
          return (person(a.owner_id)?.display_name ?? '~').localeCompare(person(b.owner_id)?.display_name ?? '~');
      }
    };
    return [...base].sort((a, b) => cmp(a, b) * sort.dir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ofKind, showClosed, cell, sort, people]);

  const reviewOverdue = (r: Risk) => Boolean(r.review_date) && r.review_date! < today && r.status !== 'closed';

  const exportRows = (): { head: string[]; body: Cell[][] } => ({
    head: ['Type', 'Code', 'Title', 'Category', 'Work package', 'Probability', 'Impact', 'Score', 'Level', 'Status', 'Owner', 'Review date', 'Mitigation', 'Contingency', 'Raised', 'Resolved'],
    body: list.map((r) => [
      r.kind === 'risk' ? 'Risk' : 'Issue',
      r.code,
      r.title,
      r.category,
      wpCode(r.work_package_id),
      r.probability,
      r.impact,
      r.score,
      LEVEL_LABEL[riskLevel(r.score)],
      RISK_STATUS_LABEL[r.status],
      person(r.owner_id)?.display_name ?? '',
      r.review_date,
      r.mitigation,
      r.contingency,
      r.raised_on,
      r.resolved_on,
    ]),
  });
  const base = `${(project.acronym || project.name).replace(/[^\w-]+/g, '_')}_${tab === 'risk' ? 'risk_register' : 'issue_log'}_${today}`;

  const header = (key: SortKey, label: string, cls = '') => (
    <th className={cn('py-2 pr-3 font-bold', cls)} aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button className="inline-flex items-center gap-1 hover:underline" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === 'score' ? -1 : 1 }))}>
        {label}
        {sort.key === key && (sort.dir === 1 ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />)}
      </button>
    </th>
  );

  if (risks.isLoading) return <PageLoading />;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 px-3 py-4 sm:px-5">
      <PageHeader
        title="Risks and issues"
        subtitle="Score = probability × impact (1–25). Reviews past their date are flagged."
        actions={
          <>
            <MenuRoot>
              <MenuTrigger asChild>
                <Button icon={<Download className="size-4" />} disabled={!list.length}>
                  Export
                </Button>
              </MenuTrigger>
              <MenuContent>
                <MenuItem onSelect={() => downloadCSV(base, [exportRows().head, ...exportRows().body])}>CSV</MenuItem>
                <MenuItem onSelect={() => downloadXLSX(base, [{ name: tab === 'risk' ? 'Risk register' : 'Issue log', header: exportRows().head, rows: exportRows().body }]).catch(toast.error)}>
                  Excel workbook
                </MenuItem>
              </MenuContent>
            </MenuRoot>
            {canEdit && (
              <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
                {tab === 'risk' ? 'New risk' : 'New issue'}
              </Button>
            )}
          </>
        }
      />
      {risks.error && <ErrorNote error={risks.error} retry={() => risks.refetch()} />}
      <div role="tablist" className="flex gap-1 border-b border-grid">
        {(['risk', 'issue'] as const).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => (setTab(k), setCell(null))}
            className={cn('-mb-px border-b-2 px-3 py-2 text-sm', tab === k ? 'border-teal-deep font-bold' : 'border-transparent text-secondary hover:text-ink')}
          >
            {k === 'risk' ? 'Risk register' : 'Issue log'}{' '}
            <span className="num text-xs text-secondary">{(risks.data ?? []).filter((r) => r.kind === k && r.status !== 'closed' && r.status !== 'mitigated').length}</span>
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(280px,360px)_1fr]">
        <section aria-label="Probability and impact matrix">
          <p className="font-title text-[17px] leading-snug">
            {open.filter((r) => r.score >= 15).length > 0
              ? `${open.filter((r) => r.score >= 15).length} open ${tab === 'risk' ? 'risks' : 'issues'} score 15 or more`
              : `No open ${tab === 'risk' ? 'risk' : 'issue'} scores 15 or more`}
          </p>
          <p className="mb-2 text-xs text-muted">Count of open items by probability (across) and impact (up). Select a cell to filter.</p>
          <div className="flex gap-1">
            <div className="flex w-5 items-center justify-center">
              <span className="-rotate-90 whitespace-nowrap text-[11px] text-muted">Impact</span>
            </div>
            <div className="flex-1">
              <div className="grid grid-cols-5 gap-[2px]">
                {[5, 4, 3, 2, 1].map((i) =>
                  [1, 2, 3, 4, 5].map((p) => {
                    const n = matrix[i - 1][p - 1];
                    const step = emberStep(p * i);
                    const selected = cell?.p === p && cell?.i === i;
                    return (
                      <button
                        key={`${i}-${p}`}
                        onClick={() => setCell(selected ? null : { p, i })}
                        aria-pressed={selected}
                        aria-label={`Probability ${p}, impact ${i}: ${n} item${n === 1 ? '' : 's'}`}
                        className={cn('num flex aspect-square items-center justify-center text-sm', selected && 'outline outline-2 outline-offset-1 outline-teal')}
                        style={{ background: ember[step], color: emberText(step, dark) }}
                      >
                        {n || ''}
                      </button>
                    );
                  }),
                )}
              </div>
              <div className="mt-1 grid grid-cols-5 text-center text-[10px] text-muted">
                {[1, 2, 3, 4, 5].map((p) => (
                  <span key={p}>{p}</span>
                ))}
              </div>
              <p className="text-center text-[11px] text-muted">Probability</p>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-muted">
            Colour darkens with score (ochre → terracotta → mauve). Levels: low &lt; 8, medium 8–14, high 15–19, critical 20–25. 1 = {LEVEL_WORDS[0].toLowerCase()}, 5 = {LEVEL_WORDS[4].toLowerCase()}.
          </p>
          {cell && (
            <Button size="sm" variant="ghost" icon={<X className="size-3.5" />} onClick={() => setCell(null)} className="mt-1">
              Clear cell filter (P{cell.p} × I{cell.i})
            </Button>
          )}
        </section>

        <section className="min-w-0">
          <div className="mb-2 flex items-center gap-3">
            <Checkbox checked={showClosed} onChange={setShowClosed} label="Include closed and mitigated" />
          </div>
          {list.length === 0 ? (
            <EmptyState title={ofKind.length ? 'Nothing matches' : tab === 'risk' ? 'No risks recorded' : 'No issues recorded'}>
              {tab === 'risk' ? 'Record what could go wrong, how likely it is, and what you will do about it.' : 'Issues are problems that are already happening.'}
            </EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-rule text-left">
                    {header('score', 'Score')}
                    {header('title', 'Title')}
                    {header('owner', 'Owner')}
                    {header('status', 'Status')}
                    {header('review', 'Review')}
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {list.map((r) => {
                    const owner = person(r.owner_id);
                    const lvl = riskLevel(r.score);
                    return (
                      <tr key={r.id} className="border-b border-grid align-top hover:bg-hover">
                        <td className="num py-2 pr-3">
                          <span className="font-bold">{r.score}</span>
                          <span className="block text-xs text-secondary">
                            {LEVEL_LABEL[lvl]} · P{r.probability}×I{r.impact}
                          </span>
                        </td>
                        <td className="py-2 pr-3">
                          <button className="text-left hover:underline" onClick={() => canEdit && setEditing(r)} disabled={!canEdit}>
                            {r.code && <b>{r.code} </b>}
                            {r.title}
                          </button>
                          <span className="block text-xs text-secondary">
                            {[r.category, wpCode(r.work_package_id)].filter(Boolean).join(' · ')}
                          </span>
                          {r.mitigation && <span className="block max-w-xl text-xs text-secondary">Mitigation: {r.mitigation}</span>}
                        </td>
                        <td className="py-2 pr-3">
                          {owner ? (
                            <span className="inline-flex items-center gap-1.5">
                              <Avatar name={owner.display_name} color={owner.avatar_color} size={20} />
                              <span className="hidden lg:inline">{owner.display_name}</span>
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="py-2 pr-3">{RISK_STATUS_LABEL[r.status]}</td>
                        <td className="num py-2 pr-3">
                          {fmtDate(r.review_date)}
                          {reviewOverdue(r) && (
                            <span className="flex items-center gap-1 text-xs text-critical">
                              <AlertTriangle className="size-3.5" aria-hidden />
                              <span className="text-ink">Review overdue</span>
                            </span>
                          )}
                        </td>
                        <td className="py-2 text-right">
                          {canEdit && (
                            <MenuRoot>
                              <MenuTrigger asChild>
                                <IconButton label={`Actions for ${r.title}`}>
                                  <MoreHorizontal className="size-4" />
                                </IconButton>
                              </MenuTrigger>
                              <MenuContent>
                                <MenuItem icon={<Pencil className="size-4" />} onSelect={() => setEditing(r)}>
                                  Edit
                                </MenuItem>
                                {r.status !== 'closed' && (
                                  <MenuItem onSelect={() => saveRisk(project.id, { status: 'closed', resolved_on: today }, r).catch(toast.error)}>Close</MenuItem>
                                )}
                                <MenuItem
                                  icon={<Trash2 className="size-4" />}
                                  onSelect={async () => {
                                    try {
                                      const row = await saveRisk(project.id, { deleted_at: new Date().toISOString() }, r);
                                      toast.show(`Deleted “${r.title}”`, { undo: () => saveRisk(project.id, { deleted_at: null }, row).then(() => undefined) });
                                    } catch (err) {
                                      toast.error(err);
                                    }
                                  }}
                                >
                                  Delete
                                </MenuItem>
                              </MenuContent>
                            </MenuRoot>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
      {editing && <RiskEditor risk={editing === 'new' ? null : editing} kind={tab} onClose={() => setEditing(null)} />}
    </div>
  );
}

function RiskEditor({ risk, kind, onClose }: { risk: Risk | null; kind: 'risk' | 'issue'; onClose: () => void }) {
  const { project, people } = useProjectCtx();
  const wps = useWorkPackages(project.id);
  const toast = useToast();
  const [form, setForm] = useState<RiskInput>({
    kind: risk?.kind ?? kind,
    code: risk?.code ?? '',
    title: risk?.title ?? '',
    description: risk?.description ?? '',
    category: risk?.category ?? '',
    work_package_id: risk?.work_package_id ?? null,
    probability: risk?.probability ?? 3,
    impact: risk?.impact ?? 3,
    mitigation: risk?.mitigation ?? '',
    contingency: risk?.contingency ?? '',
    owner_id: risk?.owner_id ?? null,
    status: risk?.status ?? 'open',
    review_date: risk?.review_date ?? null,
    raised_on: risk?.raised_on ?? format(new Date(), 'yyyy-MM-dd'),
    resolved_on: risk?.resolved_on ?? null,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof RiskInput>(k: K, v: RiskInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const score = (form.probability ?? 1) * (form.impact ?? 1);

  return (
    <Dialog
      open
      onOpenChange={onClose}
      title={risk ? `Edit ${risk.kind}` : `New ${kind}`}
      width={640}
      footer={
        <Button
          variant="primary"
          loading={busy}
          onClick={async () => {
            setError(null);
            if (!form.title?.trim()) return setError('A title is required.');
            setBusy(true);
            try {
              await saveRisk(project.id, { ...form, title: form.title!.trim() }, risk ?? undefined);
              onClose();
            } catch (err) {
              toast.error(err);
            } finally {
              setBusy(false);
            }
          }}
        >
          {risk ? 'Save' : 'Create'}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-[100px_1fr_130px]">
          <Field label="Code" htmlFor="r-code">
            <Input id="r-code" value={form.code} onChange={(e) => set('code', e.target.value)} maxLength={20} />
          </Field>
          <Field label="Title" htmlFor="r-title">
            <Input id="r-title" value={form.title} onChange={(e) => set('title', e.target.value)} maxLength={300} />
          </Field>
          <Field label="Type" htmlFor="r-kind">
            <Select id="r-kind" value={form.kind} onChange={(e) => set('kind', e.target.value as 'risk' | 'issue')}>
              <option value="risk">Risk</option>
              <option value="issue">Issue</option>
            </Select>
          </Field>
        </div>
        <Field label="Description" htmlFor="r-desc">
          <Textarea id="r-desc" rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Probability" htmlFor="r-p">
            <Select id="r-p" value={form.probability} onChange={(e) => set('probability', Number(e.target.value))}>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n} · {LEVEL_WORDS[n - 1]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Impact" htmlFor="r-i">
            <Select id="r-i" value={form.impact} onChange={(e) => set('impact', Number(e.target.value))}>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n} · {LEVEL_WORDS[n - 1]}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex flex-col justify-end pb-1 text-sm">
            <span className="text-xs text-secondary">Score</span>
            <span className="num text-lg">
              {score} <span className="text-sm text-secondary">· {LEVEL_LABEL[riskLevel(score)]}</span>
            </span>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Category" htmlFor="r-cat">
            <Input id="r-cat" value={form.category} onChange={(e) => set('category', e.target.value)} placeholder="e.g. Financial" />
          </Field>
          <Field label="Work package" htmlFor="r-wp">
            <Select id="r-wp" value={form.work_package_id ?? ''} onChange={(e) => set('work_package_id', e.target.value || null)}>
              <option value="">None</option>
              {(wps.data ?? []).map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} {w.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Owner" htmlFor="r-owner">
            <Select id="r-owner" value={form.owner_id ?? ''} onChange={(e) => set('owner_id', e.target.value || null)}>
              <option value="">Nobody</option>
              {people.map((p) => (
                <option key={p.user_id} value={p.user_id}>
                  {p.display_name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Mitigation" htmlFor="r-mit" hint="What reduces the probability or impact.">
          <Textarea id="r-mit" rows={2} value={form.mitigation} onChange={(e) => set('mitigation', e.target.value)} />
        </Field>
        <Field label="Contingency" htmlFor="r-con" hint="What you will do if it happens.">
          <Textarea id="r-con" rows={2} value={form.contingency} onChange={(e) => set('contingency', e.target.value)} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Status" htmlFor="r-status">
            <Select id="r-status" value={form.status} onChange={(e) => set('status', e.target.value as RiskStatus)}>
              {(Object.keys(RISK_STATUS_LABEL) as RiskStatus[]).map((s) => (
                <option key={s} value={s}>
                  {RISK_STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Next review" htmlFor="r-rev">
            <Input id="r-rev" type="date" value={form.review_date ?? ''} onChange={(e) => set('review_date', e.target.value || null)} />
          </Field>
          <Field label="Raised on" htmlFor="r-raised">
            <Input id="r-raised" type="date" value={form.raised_on ?? ''} onChange={(e) => set('raised_on', e.target.value)} />
          </Field>
          <Field label="Resolved on" htmlFor="r-res">
            <Input id="r-res" type="date" value={form.resolved_on ?? ''} onChange={(e) => set('resolved_on', e.target.value || null)} />
          </Field>
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
