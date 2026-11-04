import { useMemo, useState } from 'react';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { AlertTriangle, CheckCircle2, MinusCircle, MoreHorizontal, Pencil, Play, Plus, Sparkles, Trash2, Zap } from 'lucide-react';
import { useProjectCtx } from '@/features/project/context';
import { Button, EmptyState, ErrorNote, IconButton, PageLoading } from '@/components/ui';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { MenuContent, MenuItem, MenuRoot, MenuSeparator, MenuTrigger } from '@/components/ui/Menu';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';
import {
  deleteRule,
  runRuleNow,
  setRuleEnabled,
  useIntegrations,
  useProjectStructure,
  useRules,
  useRuns,
  type RuleRow,
} from '@/data/automation';
import { KIND_LABEL, PRESETS, describeRule, describeSchedule, emptyDraft, rowToDraft, type RuleContext, type RuleDraft, type RuleKind } from '@/domain/automation';
import { RuleBuilder, browserTimeZone, type Structure } from './RuleBuilder';
import { IntegrationsTab } from './IntegrationsTab';

type Tab = 'rules' | 'buttons' | 'log' | 'integrations';

export default function AutomationsPage() {
  const ctx = useProjectCtx();
  const { project, canEdit, canManage, people } = ctx;
  const [tab, setTab] = useState<Tab>('rules');
  const rules = useRules(project.id);
  const structure = useProjectStructure(project.id);
  const integrations = useIntegrations(project.id, canManage);
  const [editing, setEditing] = useState<RuleDraft | null>(null);

  const ruleCtx: RuleContext = useMemo(
    () => ({
      lists: (structure.data?.lists ?? []).map((l) => ({ id: l.id, name: l.name })),
      labels: (structure.data?.labels ?? []).map((l) => ({ id: l.id, name: l.name })),
      people: people.map((p) => ({ user_id: p.user_id, display_name: p.display_name })),
      integrations: (integrations.data ?? []).map((i) => ({ id: i.id, name: i.name })),
      workPackages: structure.data?.workPackages ?? [],
    }),
    [structure.data, people, integrations.data],
  );
  const integrationOptions = useMemo(() => (integrations.data ?? []).filter((i) => i.enabled).map((i) => ({ id: i.id, name: i.name })), [integrations.data]);

  const all = rules.data ?? [];
  const automations = all.filter((r) => r.kind === 'rule' || r.kind === 'scheduled' || r.kind === 'due_date');
  const buttons = all.filter((r) => r.kind === 'card_button' || r.kind === 'board_button');
  const tz = browserTimeZone();

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'rules', label: 'Rules', count: automations.length },
    { id: 'buttons', label: 'Buttons', count: buttons.length },
    { id: 'log', label: 'Run log' },
    { id: 'integrations', label: 'Integrations', count: integrations.data?.length },
  ];

  if (rules.isLoading || structure.isLoading) return <PageLoading />;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-5 sm:px-6">
      <header className="flex flex-wrap items-end gap-3">
        <div className="flex-1">
          <h2 className="text-2xl">Automations</h2>
          <p className="text-sm text-secondary">Rules run on the server, even when nobody has the project open. Every run is logged.</p>
        </div>
        {canEdit && tab !== 'integrations' && (
          <Button
            variant="primary"
            icon={<Plus className="size-4" />}
            onClick={() => setEditing({ ...emptyDraft(tab === 'buttons' ? 'card_button' : 'rule', tz) })}
          >
            {tab === 'buttons' ? 'New button' : 'New rule'}
          </Button>
        )}
      </header>

      <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-grid">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn('-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm', tab === t.id ? 'border-teal-deep font-bold' : 'border-transparent text-secondary hover:text-ink')}
          >
            {t.label}
            {t.count ? <span className="num ml-1 text-xs text-secondary">{t.count}</span> : null}
          </button>
        ))}
      </div>

      {rules.error && <ErrorNote error={rules.error} retry={() => rules.refetch()} />}

      {tab === 'rules' && (
        <section role="tabpanel" className="flex flex-col gap-6">
          {automations.length === 0 ? (
            <EmptyState title="No rules yet">Start from one of the examples below, or create your own rule.</EmptyState>
          ) : (
            <RuleTable rules={automations} ruleCtx={ruleCtx} canEdit={canEdit} onEdit={(r) => setEditing(rowToDraft(r))} />
          )}
          {canEdit && (
            <section className="flex flex-col gap-2">
              <h3 className="flex items-center gap-1.5 text-sm">
                <Sparkles className="size-4 text-secondary" aria-hidden /> Examples
              </h3>
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {PRESETS.map((p) => (
                  <li key={p.id}>
                    <button
                      className="flex h-full w-full flex-col items-start gap-1 rounded-[4px] border border-grid bg-card p-3 text-left hover:border-rule"
                      onClick={() => setEditing(p.build({ ...ruleCtx, tz }))}
                    >
                      <span className="text-sm font-bold">{p.title}</span>
                      <span className="text-xs text-secondary">{p.description}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </section>
      )}

      {tab === 'buttons' && (
        <section role="tabpanel" className="flex flex-col gap-3">
          <p className="text-sm text-secondary">
            Task buttons appear in the side panel of a task; board buttons appear in the board header. Pressing one runs its actions on the server.
          </p>
          {buttons.length === 0 ? (
            <EmptyState title="No buttons yet">For example, a “Start review” task button that moves the task, assigns you and adds a review checklist.</EmptyState>
          ) : (
            <RuleTable rules={buttons} ruleCtx={ruleCtx} canEdit={canEdit} onEdit={(r) => setEditing(rowToDraft(r))} />
          )}
        </section>
      )}

      {tab === 'log' && <RunLog projectId={project.id} rules={all} />}

      {tab === 'integrations' && <IntegrationsTab projectId={project.id} canManage={canManage} />}

      {editing && structure.data && (
        <RuleBuilder
          projectId={project.id}
          initial={editing}
          structure={structure.data as Structure}
          people={people}
          integrations={integrationOptions}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function RuleTable({ rules, ruleCtx, canEdit, onEdit }: { rules: RuleRow[]; ruleCtx: RuleContext; canEdit: boolean; onEdit: (r: RuleRow) => void }) {
  const toast = useToast();
  const [confirm, setConfirm] = useState<RuleRow | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  return (
    <>
      <ul className="flex flex-col divide-y divide-grid border-y border-grid">
        {rules.map((r) => (
          <li key={r.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start">
            <label className="flex shrink-0 items-center gap-2 pt-0.5" title={r.enabled ? 'Turn off' : 'Turn on'}>
              <input
                type="checkbox"
                role="switch"
                className="size-4 accent-[var(--v-teal-deep)]"
                checked={r.enabled}
                disabled={!canEdit}
                aria-label={`${r.enabled ? 'Disable' : 'Enable'} ${r.name}`}
                onChange={(e) => setRuleEnabled(r, e.target.checked).catch(toast.error)}
              />
            </label>
            <div className="min-w-0 flex-1">
              <p className={cn('font-bold', !r.enabled && 'text-secondary')}>
                {r.name}
                <span className="ml-2 text-xs font-normal text-secondary">{KIND_LABEL[r.kind as RuleKind]}</span>
                {!r.enabled && <span className="ml-2 text-xs font-normal text-secondary">· off</span>}
              </p>
              <p className="text-sm text-ink">{describeRule(rowToDraft(r), ruleCtx)}</p>
              <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-secondary">
                <span className="num">
                  {r.run_count} run{r.run_count === 1 ? '' : 's'}
                </span>
                {r.failure_count > 0 && (
                  <span className="inline-flex items-center gap-1 text-critical">
                    <AlertTriangle className="size-3" aria-hidden />
                    <span className="num text-ink">{r.failure_count} failed</span>
                  </span>
                )}
                {r.last_run_at && <span>last {formatDistanceToNow(parseISO(r.last_run_at), { addSuffix: true })}</span>}
                {r.enabled && r.next_run_at && (r.kind === 'scheduled' || r.kind === 'due_date') && (
                  <span>
                    next {new Date(r.next_run_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                    {r.kind === 'scheduled' && r.schedule ? ` (${describeSchedule(r.schedule)})` : ''}
                  </span>
                )}
              </p>
            </div>
            {canEdit && (
              <div className="flex shrink-0 items-center gap-1">
                {(r.kind === 'scheduled' || r.kind === 'due_date') && (
                  <Button
                    size="sm"
                    icon={<Play className="size-3.5" />}
                    loading={running === r.id}
                    disabled={!r.enabled}
                    title={r.enabled ? 'Run this rule now' : 'Turn the rule on first'}
                    onClick={async () => {
                      setRunning(r.id);
                      try {
                        const n = await runRuleNow(r);
                        toast.show(n ? `Ran: ${n} action set${n === 1 ? '' : 's'} applied` : 'Ran: nothing matched today');
                      } catch (err) {
                        toast.error(err);
                      } finally {
                        setRunning(null);
                      }
                    }}
                  >
                    Run now
                  </Button>
                )}
                <MenuRoot>
                  <MenuTrigger asChild>
                    <IconButton label={`Actions for ${r.name}`}>
                      <MoreHorizontal className="size-4" />
                    </IconButton>
                  </MenuTrigger>
                  <MenuContent>
                    <MenuItem icon={<Pencil className="size-4" />} onSelect={() => onEdit(r)}>
                      Edit
                    </MenuItem>
                    <MenuSeparator />
                    <MenuItem danger icon={<Trash2 className="size-4" />} onSelect={() => setConfirm(r)}>
                      Delete
                    </MenuItem>
                  </MenuContent>
                </MenuRoot>
              </div>
            )}
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={Boolean(confirm)}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Delete this automation?"
        danger
        confirmLabel="Delete"
        body={<>“{confirm?.name}” and its run history will be removed. Turning it off instead keeps the history.</>}
        onConfirm={async () => {
          if (!confirm) return;
          try {
            await deleteRule(confirm);
            setConfirm(null);
            toast.show('Automation deleted');
          } catch (err) {
            toast.error(err);
          }
        }}
      />
    </>
  );
}

const RUN_STATUS = {
  success: { icon: <CheckCircle2 className="size-3.5 text-good" aria-hidden />, word: 'Succeeded' },
  failed: { icon: <AlertTriangle className="size-3.5 text-critical" aria-hidden />, word: 'Failed' },
  skipped: { icon: <MinusCircle className="size-3.5 text-serious" aria-hidden />, word: 'Skipped' },
};

function RunLog({ projectId, rules }: { projectId: string; rules: RuleRow[] }) {
  const [ruleId, setRuleId] = useState('');
  const runs = useRuns(projectId, ruleId || undefined, 200);
  const { openCard } = useProjectCtx();
  return (
    <section role="tabpanel" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor="log-rule" className="text-secondary">
          Show
        </label>
        <select
          id="log-rule"
          value={ruleId}
          onChange={(e) => setRuleId(e.target.value)}
          className="h-8 rounded-[4px] border border-rule bg-surface px-2"
        >
          <option value="">All automations</option>
          {rules.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <span className="text-xs text-secondary">Refreshes every 30 seconds.</span>
      </div>
      {runs.isLoading && <PageLoading />}
      {runs.error && <ErrorNote error={runs.error} retry={() => runs.refetch()} />}
      {runs.data && runs.data.runs.length === 0 && (
        <EmptyState title="Nothing has run yet">
          <span className="inline-flex items-center gap-1">
            <Zap className="size-3.5" aria-hidden /> Runs appear here as soon as an automation acts.
          </span>
        </EmptyState>
      )}
      {runs.data && runs.data.runs.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-rule text-left">
                <th className="py-1.5 pr-3 font-bold">When</th>
                <th className="py-1.5 pr-3 font-bold">Automation</th>
                <th className="py-1.5 pr-3 font-bold">Task</th>
                <th className="py-1.5 pr-3 font-bold">Result</th>
                <th className="py-1.5 pr-3 font-bold">Details</th>
                <th className="py-1.5 text-right font-bold">Attempt</th>
              </tr>
            </thead>
            <tbody>
              {runs.data.runs.map((r) => {
                const s = RUN_STATUS[r.status];
                const title = r.card_id ? runs.data!.titles.get(r.card_id) : undefined;
                return (
                  <tr key={r.id} className="border-b border-grid align-top">
                    <td className="num whitespace-nowrap py-1.5 pr-3 text-secondary" title={new Date(r.started_at).toLocaleString()}>
                      {formatDistanceToNow(parseISO(r.started_at), { addSuffix: true })}
                    </td>
                    <td className="py-1.5 pr-3">{r.automation_rules?.name ?? 'Deleted automation'}</td>
                    <td className="max-w-[200px] py-1.5 pr-3">
                      {r.card_id ? (
                        title ? (
                          <button className="truncate text-left text-link hover:underline" onClick={() => openCard(r.card_id!)}>
                            {title}
                          </button>
                        ) : (
                          <span className="text-secondary">Deleted task</span>
                        )
                      ) : (
                        <span className="text-secondary">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap py-1.5 pr-3">
                      <span className="inline-flex items-center gap-1">
                        {s.icon}
                        {s.word}
                      </span>
                    </td>
                    <td className="py-1.5 pr-3 text-secondary">
                      {r.message || (r.status === 'success' ? `${r.actions_done} action${r.actions_done === 1 ? '' : 's'}` : '')}
                    </td>
                    <td className="num py-1.5 text-right">{r.attempt}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
