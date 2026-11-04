import { useQuery } from '@tanstack/react-query';
import { sb } from '@/lib/supabase';
import { must } from './errors';
import { queryClient } from './queryClient';
import { cleanDraft, type Action, type Condition, type RuleDraft, type RuleKind, type Schedule, type Trigger } from '@/domain/automation';

export interface RuleRow {
  id: string;
  project_id: string;
  board_id: string | null;
  name: string;
  kind: RuleKind;
  enabled: boolean;
  trigger: Trigger;
  conditions: Condition[];
  actions: Action[];
  schedule: Schedule | null;
  next_run_at: string | null;
  last_run_at: string | null;
  run_count: number;
  failure_count: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface RunRow {
  id: number;
  rule_id: string | null;
  project_id: string;
  event_id: number | null;
  card_id: string | null;
  status: 'success' | 'failed' | 'skipped';
  message: string;
  actions_done: number;
  attempt: number;
  depth: number;
  started_at: string;
  finished_at: string | null;
  automation_rules: { name: string } | null;
}

export interface IntegrationRow {
  id: string;
  project_id: string;
  kind: 'webhook' | 'slack' | 'teams';
  name: string;
  url: string;
  secret: string;
  events: string[];
  enabled: boolean;
  created_at: string;
}

export interface DeliveryRow {
  id: number;
  integration_id: string;
  event: string;
  status: 'pending' | 'sent' | 'delivered' | 'failed';
  attempts: number;
  response_status: number | null;
  error: string | null;
  created_at: string;
  delivered_at: string | null;
  integrations: { name: string } | null;
}

export const WEBHOOK_EVENTS: { id: string; label: string }[] = [
  { id: 'task.created', label: 'Task created' },
  { id: 'task.completed', label: 'Task completed' },
  { id: 'task.moved', label: 'Task moved' },
  { id: 'comment.added', label: 'Comment added' },
  { id: 'milestone.updated', label: 'Milestone status changed' },
];

const key = (projectId: string, ...rest: unknown[]) => ['p', projectId, 'automation', ...rest];
const invalidate = (projectId: string) => queryClient.invalidateQueries({ queryKey: key(projectId) });

/* ------------------------------------------------------------------ Rules */

export function useRules(projectId: string) {
  return useQuery({
    queryKey: key(projectId, 'rules'),
    queryFn: async () => must(await sb().from('automation_rules').select('*').eq('project_id', projectId).order('created_at')) as RuleRow[],
  });
}

export async function saveRule(projectId: string, draft: RuleDraft): Promise<RuleRow> {
  const d = cleanDraft(draft);
  const row = {
    name: d.name,
    kind: d.kind,
    board_id: d.board_id,
    enabled: d.enabled,
    trigger: d.trigger,
    conditions: d.conditions,
    actions: d.actions,
    schedule: d.schedule,
  };
  const res = d.id
    ? await sb().from('automation_rules').update(row).eq('id', d.id).select('*').single()
    : await sb().from('automation_rules').insert({ ...row, project_id: projectId }).select('*').single();
  const saved = must(res) as RuleRow;
  invalidate(projectId);
  return saved;
}

export async function setRuleEnabled(rule: RuleRow, enabled: boolean) {
  must(await sb().from('automation_rules').update({ enabled }).eq('id', rule.id));
  invalidate(rule.project_id);
}

export async function deleteRule(rule: RuleRow) {
  must(await sb().from('automation_rules').delete().eq('id', rule.id));
  invalidate(rule.project_id);
}

/** Run a scheduled or due-date rule immediately (server-side). */
export async function runRuleNow(rule: RuleRow): Promise<number> {
  const n = must(await sb().rpc('run_rule_now', { p_rule: rule.id })) as number;
  invalidate(rule.project_id);
  queryClient.invalidateQueries({ queryKey: ['p', rule.project_id] });
  queryClient.invalidateQueries({ queryKey: ['me'] });
  return n;
}

/** Press a task or board button. */
export async function runButton(rule: { id: string; project_id: string }, cardId: string | null): Promise<number> {
  const res = must(await sb().rpc('run_button', { p_rule: rule.id, p_card: cardId })) as { actions: number };
  queryClient.invalidateQueries({ queryKey: ['p', rule.project_id] });
  queryClient.invalidateQueries({ queryKey: ['me'] });
  return res?.actions ?? 0;
}

/** Buttons available on a board (project-wide buttons included). */
export function useButtons(projectId: string, boardId: string | null | undefined, kind: 'card_button' | 'board_button') {
  return useQuery({
    queryKey: key(projectId, 'buttons', kind, boardId ?? 'all'),
    queryFn: async () => {
      let q = sb().from('automation_rules').select('*').eq('project_id', projectId).eq('kind', kind).eq('enabled', true).order('name');
      q = boardId ? q.or(`board_id.is.null,board_id.eq.${boardId}`) : q.is('board_id', null);
      return must(await q) as RuleRow[];
    },
  });
}

/* --------------------------------------------------------------- Run log */

export function useRuns(projectId: string, ruleId?: string, limit = 100) {
  return useQuery({
    queryKey: key(projectId, 'runs', ruleId ?? 'all', limit),
    refetchInterval: 30_000,
    queryFn: async () => {
      let q = sb().from('automation_runs').select('*, automation_rules(name)').eq('project_id', projectId).order('started_at', { ascending: false }).limit(limit);
      if (ruleId) q = q.eq('rule_id', ruleId);
      const runs = must(await q) as unknown as RunRow[];
      const ids = [...new Set(runs.map((r) => r.card_id).filter(Boolean))] as string[];
      const titles = new Map<string, string>();
      if (ids.length) {
        const cards = must(await sb().from('cards').select('id, title').in('id', ids)) as { id: string; title: string }[];
        for (const c of cards) titles.set(c.id, c.title);
      }
      return { runs, titles };
    },
  });
}

/* ---------------------------------------------------------- Integrations */

export function useIntegrations(projectId: string, enabled: boolean) {
  return useQuery({
    queryKey: key(projectId, 'integrations'),
    enabled,
    queryFn: async () => must(await sb().from('integrations').select('*').eq('project_id', projectId).order('created_at')) as IntegrationRow[],
  });
}

export function useDeliveries(projectId: string, enabled: boolean) {
  return useQuery({
    queryKey: key(projectId, 'deliveries'),
    enabled,
    refetchInterval: enabled ? 30_000 : false,
    queryFn: async () =>
      must(
        await sb()
          .from('webhook_deliveries')
          .select('id, integration_id, event, status, attempts, response_status, error, created_at, delivered_at, integrations(name)')
          .eq('project_id', projectId)
          .order('id', { ascending: false })
          .limit(100),
      ) as unknown as DeliveryRow[],
  });
}

export function validateIntegration(input: { name: string; url: string; events: string[] }): string[] {
  const errs: string[] = [];
  if (!input.name.trim()) errs.push('Give the integration a name.');
  let ok: boolean;
  try {
    const u = new URL(input.url.trim());
    ok = u.protocol === 'https:' && Boolean(u.hostname);
  } catch {
    ok = false;
  }
  if (!ok) errs.push('Enter an https:// address.');
  if (!input.events.length) errs.push('Choose at least one event.');
  return errs;
}

export async function createIntegration(projectId: string, input: { kind: IntegrationRow['kind']; name: string; url: string; events: string[] }) {
  const row = must(
    await sb()
      .from('integrations')
      .insert({ project_id: projectId, kind: input.kind, name: input.name.trim(), url: input.url.trim(), events: input.events })
      .select('*')
      .single(),
  ) as IntegrationRow;
  invalidate(projectId);
  return row;
}

export async function updateIntegration(i: IntegrationRow, patch: Partial<Pick<IntegrationRow, 'name' | 'url' | 'events' | 'enabled'>>) {
  must(await sb().from('integrations').update(patch).eq('id', i.id));
  invalidate(i.project_id);
}

export async function deleteIntegration(i: IntegrationRow) {
  must(await sb().from('integrations').delete().eq('id', i.id));
  invalidate(i.project_id);
}

/* -------------------------------------------------- Prompt processing */

let kickTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Ask the server to process queued automation events now, so rules feel
 * immediate after a user action. Debounced; failures are ignored because the
 * scheduler processes the queue every minute anyway.
 */
export function kickAutomations(projectId?: string) {
  if (kickTimer) clearTimeout(kickTimer);
  kickTimer = setTimeout(async () => {
    kickTimer = null;
    try {
      const { data } = await sb().rpc('kick_automations');
      if (typeof data === 'number' && data > 0) {
        if (projectId) queryClient.invalidateQueries({ queryKey: ['p', projectId] });
        else queryClient.invalidateQueries({ queryKey: ['p'] });
        queryClient.invalidateQueries({ queryKey: ['me'] });
      }
    } catch {
      /* the scheduler will pick the events up */
    }
  }, 600);
}

/* -------------------------------------------- Lists and labels in a project */

export function useProjectStructure(projectId: string) {
  return useQuery({
    queryKey: ['p', projectId, 'automation', 'structure'],
    queryFn: async () => {
      const [boards, lists, labels, wps] = await Promise.all([
        sb().from('boards').select('id, name').eq('project_id', projectId).is('deleted_at', null).is('archived_at', null).order('position'),
        sb().from('lists').select('id, name, board_id, position').eq('project_id', projectId).is('archived_at', null).order('position'),
        sb().from('labels').select('id, name, color, board_id').eq('project_id', projectId).order('created_at'),
        sb().from('work_packages').select('id, code, name').eq('project_id', projectId).is('deleted_at', null).order('position'),
      ]);
      const b = must(boards) as { id: string; name: string }[];
      const boardName = new Map(b.map((x) => [x.id, x.name]));
      const multi = b.length > 1;
      const ls = (must(lists) as { id: string; name: string; board_id: string }[])
        .filter((l) => boardName.has(l.board_id))
        .map((l) => ({ ...l, label: multi ? `${boardName.get(l.board_id)} › ${l.name}` : l.name }));
      const lbs = (must(labels) as { id: string; name: string; color: string; board_id: string }[])
        .filter((l) => boardName.has(l.board_id))
        .map((l) => ({ ...l, name: l.name || l.color, label: multi ? `${boardName.get(l.board_id)} › ${l.name || l.color}` : l.name || l.color }));
      return { boards: b, lists: ls, labels: lbs, workPackages: wps.error ? [] : ((wps.data ?? []) as { id: string; code: string; name: string }[]) };
    },
  });
}
