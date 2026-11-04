import { useQuery } from '@tanstack/react-query';
import { sb } from '@/lib/supabase';
import { must } from './errors';
import { qk, queryClient } from './queryClient';
import { CARD_SELECT } from './core';
import { updateCard } from './cards';
import type { Board, Card, CardWithRelations, Family, Label, List } from './types';

/* =========================================================== Project data */

/** Every live task in a project, across all boards, with relations. */
export function useProjectCards(projectId: string | undefined) {
  return useQuery({
    queryKey: qk.projectPart(projectId ?? '', 'all-cards'),
    enabled: Boolean(projectId),
    queryFn: async () =>
      must(
        await sb()
          .from('cards')
          .select(CARD_SELECT)
          .eq('project_id', projectId!)
          .is('archived_at', null)
          .is('deleted_at', null)
          .eq('is_template', false)
          .is('comments.deleted_at', null)
          .order('position')
          .limit(5000),
      ) as unknown as CardWithRelations[],
  });
}

export interface ProjectStructure {
  boards: Board[];
  lists: List[];
  labels: Label[];
}

/** Boards, lists and labels of a project (active boards and lists only). */
export function useProjectStructure(projectId: string | undefined) {
  return useQuery({
    queryKey: qk.projectPart(projectId ?? '', 'structure'),
    enabled: Boolean(projectId),
    queryFn: async (): Promise<ProjectStructure> => {
      const [boards, lists, labels] = await Promise.all([
        sb().from('boards').select('*').eq('project_id', projectId!).is('deleted_at', null).is('archived_at', null).order('position'),
        sb().from('lists').select('*').eq('project_id', projectId!).is('archived_at', null).order('position'),
        sb().from('labels').select('*').eq('project_id', projectId!).order('created_at'),
      ]);
      const b = must(boards) as Board[];
      const boardIds = new Set(b.map((x) => x.id));
      return {
        boards: b,
        lists: (must(lists) as List[]).filter((l) => boardIds.has(l.board_id)),
        labels: must(labels) as Label[],
      };
    },
  });
}

export interface MilestoneRow {
  id: string;
  project_id: string;
  work_package_id: string | null;
  code: string;
  title: string;
  kind: string;
  due_date: string | null;
  actual_date: string | null;
  status: string;
}

export function useProjectMilestones(projectId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: qk.projectPart(projectId ?? '', 'view-milestones'),
    enabled: Boolean(projectId) && enabled,
    queryFn: async () =>
      must(
        await sb()
          .from('milestones')
          .select('id, project_id, work_package_id, code, title, kind, due_date, actual_date, status')
          .eq('project_id', projectId!)
          .is('deleted_at', null)
          .order('due_date'),
      ) as MilestoneRow[],
  });
}

export interface PeriodRow {
  id: string;
  code: string;
  name: string;
  start_date: string;
  end_date: string;
  due_date: string | null;
}

export function useReportingPeriods(projectId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: qk.projectPart(projectId ?? '', 'view-periods'),
    enabled: Boolean(projectId) && enabled,
    queryFn: async () =>
      must(
        await sb().from('reporting_periods').select('id, code, name, start_date, end_date, due_date').eq('project_id', projectId!).order('start_date'),
      ) as PeriodRow[],
  });
}

export interface WpProgress {
  work_package_id: string;
  tasks_total: number;
  tasks_done: number;
  tasks_overdue: number;
  actual_progress: number | string;
  planned_progress: number | string | null;
}

export function useWpProgress(projectId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: qk.projectPart(projectId ?? '', 'view-wp-progress'),
    enabled: Boolean(projectId) && enabled,
    queryFn: async () => must(await sb().rpc('work_package_progress', { p_project: projectId })) as WpProgress[],
  });
}

export interface ProjectSummary {
  tasks_total: number;
  tasks_done: number;
  tasks_overdue: number;
  tasks_blocked: number;
  tasks_unassigned: number;
  milestones_total: number;
  milestones_done: number;
  milestones_overdue: number;
  milestones_at_risk: number;
  evidence_missing: number;
  risks_open: number;
  risks_high: number;
  issues_open: number;
}

export function useProjectSummary(projectId: string | undefined) {
  return useQuery({
    queryKey: qk.projectPart(projectId ?? '', 'view-summary'),
    enabled: Boolean(projectId),
    queryFn: async () => ((must(await sb().rpc('project_summary', { p_project: projectId })) as ProjectSummary[])[0] ?? null) as ProjectSummary | null,
  });
}

/* ============================================================= Mutations */

/**
 * Conflict-safe task update that also patches the project-wide card cache,
 * so table, calendar and timeline respond immediately.
 */
export async function updateCardEverywhere(card: Card, patch: Partial<Card>): Promise<Card> {
  const key = qk.projectPart(card.project_id, 'all-cards');
  const prev = queryClient.getQueryData<CardWithRelations[]>(key);
  if (prev) queryClient.setQueryData<CardWithRelations[]>(key, prev.map((c) => (c.id === card.id ? { ...c, ...patch } : c)));
  try {
    return await updateCard(card, patch);
  } catch (err) {
    if (prev) queryClient.setQueryData(key, prev);
    throw err;
  }
}

/* ========================================================= Global calendar */

export interface GlobalCalItem {
  kind: 'card' | 'milestone';
  id: string;
  title: string;
  start: string;
  end: string;
  status: string;
  project_id: string;
  project_name: string;
  project_color: Family;
  board_id: string | null;
}

interface ProjEmbed {
  name: string;
  color: Family;
  workspace_id: string;
}

/**
 * Dated tasks and milestones overlapping [from, to]. `mine` restricts tasks to
 * those assigned to the current user (milestones of their projects are kept).
 */
export function useGlobalCalendar(workspaceId: string | undefined, from: string, to: string, mine: boolean, userId: string) {
  return useQuery({
    queryKey: ['global', 'calendar', workspaceId, from, to, mine],
    enabled: Boolean(workspaceId),
    queryFn: async (): Promise<GlobalCalItem[]> => {
      const overlap = `and(due_date.gte.${from},due_date.lte.${to}),and(start_date.gte.${from},start_date.lte.${to}),and(start_date.lte.${from},due_date.gte.${to})`;
      let cq = sb()
        .from('cards')
        .select(
          `id, title, status, start_date, due_date, project_id, board_id, projects!inner(name, color, workspace_id, deleted_at, archived_at)${mine ? ', card_assignees!inner(user_id)' : ''}`,
        )
        .eq('projects.workspace_id', workspaceId!)
        .is('projects.deleted_at', null)
        .is('projects.archived_at', null)
        .is('archived_at', null)
        .is('deleted_at', null)
        .eq('is_template', false)
        .or(overlap)
        .limit(2000);
      if (mine) cq = cq.eq('card_assignees.user_id', userId);
      const [cards, ms] = await Promise.all([
        cq,
        sb()
          .from('milestones')
          .select('id, code, title, status, due_date, project_id, projects!inner(name, color, workspace_id, deleted_at)')
          .eq('projects.workspace_id', workspaceId!)
          .is('projects.deleted_at', null)
          .is('deleted_at', null)
          .gte('due_date', from)
          .lte('due_date', to)
          .limit(1000),
      ]);
      const cardRows = must(cards) as unknown as {
        id: string;
        title: string;
        status: string;
        start_date: string | null;
        due_date: string | null;
        project_id: string;
        board_id: string;
        projects: ProjEmbed;
      }[];
      const msRows = must(ms) as unknown as {
        id: string;
        code: string;
        title: string;
        status: string;
        due_date: string;
        project_id: string;
        projects: ProjEmbed;
      }[];
      return [
        ...cardRows.map((c) => ({
          kind: 'card' as const,
          id: c.id,
          title: c.title,
          start: c.start_date ?? c.due_date!,
          end: c.due_date ?? c.start_date!,
          status: c.status,
          project_id: c.project_id,
          project_name: c.projects.name,
          project_color: c.projects.color,
          board_id: c.board_id,
        })),
        ...msRows.map((m) => ({
          kind: 'milestone' as const,
          id: m.id,
          title: `${m.code ? m.code + ' ' : ''}${m.title}`,
          start: m.due_date,
          end: m.due_date,
          status: m.status,
          project_id: m.project_id,
          project_name: m.projects.name,
          project_color: m.projects.color,
          board_id: null,
        })),
      ];
    },
  });
}
