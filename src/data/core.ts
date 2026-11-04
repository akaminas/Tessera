import { useMutation, useQuery } from '@tanstack/react-query';
import { sb } from '@/lib/supabase';
import { must } from './errors';
import { qk, queryClient } from './queryClient';
import { safeUpdate, tableBackend } from './safeUpdate';
import { kickAutomations } from './cards';
import type {
  ActivityEntry,
  Board,
  CardWithRelations,
  Comment,
  Invitation,
  Label,
  List,
  MyInvitation,
  Organization,
  Person,
  Project,
  ProjectRole,
  Workspace,
  WorkspaceRole,
} from './types';

/* =============================================================== Workspaces */

export interface MyWorkspace extends Workspace {
  my_role: WorkspaceRole;
}

export function useMyWorkspaces(userId: string | undefined) {
  return useQuery({
    queryKey: qk.workspaces,
    enabled: Boolean(userId),
    queryFn: async (): Promise<MyWorkspace[]> => {
      const rows = must(
        await sb().from('workspace_members').select('role, workspaces(*)').eq('user_id', userId!),
      ) as unknown as { role: WorkspaceRole; workspaces: Workspace }[];
      return rows
        .filter((r) => r.workspaces && !r.workspaces.archived_at)
        .map((r) => ({ ...r.workspaces, my_role: r.role }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  });
}

export async function createWorkspace(name: string, description = ''): Promise<string> {
  const id = must(await sb().rpc('create_workspace', { p_name: name, p_description: description })) as string;
  await queryClient.invalidateQueries({ queryKey: qk.workspaces });
  return id;
}

export async function updateWorkspace(ws: Workspace, patch: Partial<Workspace>) {
  const res = await safeUpdate(tableBackend<Workspace>('workspaces'), ws, patch);
  queryClient.invalidateQueries({ queryKey: qk.workspaces });
  return res;
}

export function useWorkspacePeople(workspaceId: string | undefined) {
  return useQuery({
    queryKey: qk.wsPeople(workspaceId ?? ''),
    enabled: Boolean(workspaceId),
    queryFn: async () => must(await sb().rpc('workspace_people', { p_workspace: workspaceId })) as Person[],
  });
}

export function useOrganizations(workspaceId: string | undefined) {
  return useQuery({
    queryKey: qk.wsOrgs(workspaceId ?? ''),
    enabled: Boolean(workspaceId),
    queryFn: async () =>
      must(await sb().from('organizations').select('*').eq('workspace_id', workspaceId!).order('name')) as Organization[],
  });
}

export async function saveOrganization(org: Partial<Organization> & { workspace_id: string }) {
  const { id, ...rest } = org;
  if (id) must(await sb().from('organizations').update(rest).eq('id', id));
  else must(await sb().from('organizations').insert(rest));
  queryClient.invalidateQueries({ queryKey: qk.wsOrgs(org.workspace_id) });
}

export async function deleteOrganization(org: Organization) {
  must(await sb().from('organizations').delete().eq('id', org.id));
  queryClient.invalidateQueries({ queryKey: qk.wsOrgs(org.workspace_id) });
}

export async function setWorkspaceMember(workspaceId: string, userId: string, patch: { role?: WorkspaceRole; organization_id?: string | null }) {
  must(await sb().from('workspace_members').update(patch).eq('workspace_id', workspaceId).eq('user_id', userId));
  queryClient.invalidateQueries({ queryKey: qk.wsPeople(workspaceId) });
}

export async function removeWorkspaceMember(workspaceId: string, userId: string) {
  must(await sb().from('workspace_members').delete().eq('workspace_id', workspaceId).eq('user_id', userId));
  queryClient.invalidateQueries({ queryKey: qk.wsPeople(workspaceId) });
  queryClient.invalidateQueries({ queryKey: qk.workspaces });
}

/* ============================================================== Invitations */

export function useWorkspaceInvitations(workspaceId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: qk.wsInvites(workspaceId ?? ''),
    enabled: Boolean(workspaceId) && enabled,
    queryFn: async () =>
      must(
        await sb()
          .from('invitations')
          .select('*')
          .eq('workspace_id', workspaceId!)
          .is('accepted_at', null)
          .is('revoked_at', null)
          .order('created_at', { ascending: false }),
      ) as Invitation[],
  });
}

export async function createInvitation(input: {
  workspace_id: string;
  email: string;
  role: 'admin' | 'member' | 'guest';
  project_id?: string | null;
  project_role?: ProjectRole | null;
  finance_access?: 'none' | 'view' | 'edit';
  message?: string;
}): Promise<Invitation> {
  const inv = must(await sb().from('invitations').insert(input).select('*').single()) as Invitation;
  queryClient.invalidateQueries({ queryKey: qk.wsInvites(input.workspace_id) });
  return inv;
}

export async function revokeInvitation(inv: Invitation) {
  must(await sb().from('invitations').update({ revoked_at: new Date().toISOString() }).eq('id', inv.id));
  queryClient.invalidateQueries({ queryKey: qk.wsInvites(inv.workspace_id) });
}

export function useMyInvitations(enabled: boolean) {
  return useQuery({
    queryKey: qk.invitations,
    enabled,
    queryFn: async () => must(await sb().rpc('my_invitations')) as MyInvitation[],
  });
}

export async function acceptInvitation(token: string): Promise<string> {
  const ws = must(await sb().rpc('accept_invitation', { p_token: token })) as string;
  await queryClient.invalidateQueries({ queryKey: ['me'] });
  return ws;
}

/* ================================================================= Projects */

export function useWorkspaceProjects(workspaceId: string | undefined, opts: { includeArchived?: boolean } = {}) {
  return useQuery({
    queryKey: [...qk.wsProjects(workspaceId ?? ''), opts.includeArchived ? 'all' : 'active'],
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      let q = sb().from('projects').select('*').eq('workspace_id', workspaceId!).is('deleted_at', null).eq('is_template', false);
      if (!opts.includeArchived) q = q.is('archived_at', null);
      return must(await q.order('name')) as Project[];
    },
  });
}

/** Every project the user can see, across workspaces (for switchers, My Work). */
export function useAllProjects(enabled = true) {
  return useQuery({
    queryKey: ['global', 'projects'],
    enabled,
    queryFn: async () =>
      must(
        await sb().from('projects').select('*').is('deleted_at', null).is('archived_at', null).eq('is_template', false).order('name'),
      ) as Project[],
  });
}

export function useProject(projectId: string | undefined) {
  return useQuery({
    queryKey: qk.projectPart(projectId ?? '', 'meta'),
    enabled: Boolean(projectId),
    queryFn: async () => must(await sb().from('projects').select('*').eq('id', projectId!).single()) as Project,
  });
}

export function useProjectRole(projectId: string | undefined) {
  return useQuery({
    queryKey: qk.projectPart(projectId ?? '', 'role'),
    enabled: Boolean(projectId),
    queryFn: async () => {
      const [role, finance] = await Promise.all([
        sb().rpc('project_role', { p_project: projectId }),
        sb().rpc('finance_access', { p_project: projectId }),
      ]);
      return {
        role: must(role) as ProjectRole | null,
        finance: (must(finance) as 'none' | 'view' | 'edit') ?? 'none',
      };
    },
  });
}

export function useProjectPeople(projectId: string | undefined) {
  return useQuery({
    queryKey: qk.projectPart(projectId ?? '', 'people'),
    enabled: Boolean(projectId),
    queryFn: async () => must(await sb().rpc('project_people', { p_project: projectId })) as Person[],
  });
}

export async function createProject(input: {
  workspace_id: string;
  name: string;
  description?: string;
  visibility?: 'workspace' | 'private';
  start_date?: string | null;
  end_date?: string | null;
  modules?: string[];
  acronym?: string;
}): Promise<string> {
  const id = must(
    await sb().rpc('create_project', {
      p_workspace: input.workspace_id,
      p_name: input.name,
      p_description: input.description ?? '',
      p_visibility: input.visibility ?? 'workspace',
      p_start: input.start_date || null,
      p_end: input.end_date || null,
      p_modules: input.modules ?? null,
      p_acronym: input.acronym ?? '',
    }),
  ) as string;
  queryClient.invalidateQueries({ queryKey: ['ws', input.workspace_id] });
  queryClient.invalidateQueries({ queryKey: ['global'] });
  return id;
}

export async function updateProject(project: Project, patch: Partial<Project>): Promise<Project> {
  const res = await safeUpdate(tableBackend<Project>('projects'), project, patch);
  queryClient.setQueryData(qk.projectPart(project.id, 'meta'), res);
  queryClient.invalidateQueries({ queryKey: ['ws', project.workspace_id] });
  queryClient.invalidateQueries({ queryKey: ['global'] });
  return res;
}

export async function setProjectMember(projectId: string, userId: string, patch: { role?: ProjectRole; finance_access?: string; organization_id?: string | null }) {
  const existing = must(
    await sb().from('project_members').select('user_id').eq('project_id', projectId).eq('user_id', userId).maybeSingle(),
  );
  if (existing) must(await sb().from('project_members').update(patch).eq('project_id', projectId).eq('user_id', userId));
  else must(await sb().from('project_members').insert({ project_id: projectId, user_id: userId, role: 'member', ...patch }));
  queryClient.invalidateQueries({ queryKey: qk.project(projectId) });
}

export async function removeProjectMember(projectId: string, userId: string) {
  must(await sb().from('project_members').delete().eq('project_id', projectId).eq('user_id', userId));
  queryClient.invalidateQueries({ queryKey: qk.project(projectId) });
}

/* =================================================================== Boards */

export function useBoards(projectId: string | undefined) {
  return useQuery({
    queryKey: qk.projectPart(projectId ?? '', 'boards'),
    enabled: Boolean(projectId),
    queryFn: async () =>
      must(
        await sb().from('boards').select('*').eq('project_id', projectId!).is('deleted_at', null).order('position'),
      ) as Board[],
  });
}

/** Trello's six starter labels: colour only, named later if useful. */
export const STARTER_LABEL_COLORS = ['moss', 'ochre', 'terracotta', 'red', 'mauve', 'indigo'] as const;

export async function createBoard(
  projectId: string,
  name: string,
  position: string,
  lists: string[] = ['To do', 'Doing', 'Done'],
  background?: string,
) {
  const board = must(
    await sb()
      .from('boards')
      .insert({ project_id: projectId, workspace_id: projectId, name, position, ...(background ? { background } : {}) })
      .select('*')
      .single(),
  ) as Board;
  must(await sb().from('labels').insert(STARTER_LABEL_COLORS.map((color) => ({ board_id: board.id, project_id: projectId, name: '', color }))));
  if (lists.length) {
    const { generateNKeysBetween } = await import('fractional-indexing');
    const keys = generateNKeysBetween(null, null, lists.length);
    must(
      await sb()
        .from('lists')
        .insert(lists.map((n, i) => ({ board_id: board.id, project_id: projectId, name: n, position: keys[i] }))),
    );
  }
  queryClient.invalidateQueries({ queryKey: qk.project(projectId) });
  return board;
}

export async function updateBoard(board: Board, patch: Partial<Board>) {
  const res = await safeUpdate(tableBackend<Board>('boards'), board, patch);
  queryClient.invalidateQueries({ queryKey: qk.project(board.project_id) });
  return res;
}

export async function duplicateBoard(boardId: string, name: string, includeCards: boolean): Promise<string> {
  const id = must(await sb().rpc('duplicate_board', { p_board: boardId, p_name: name, p_include_cards: includeCards })) as string;
  queryClient.invalidateQueries({ queryKey: ['p'] });
  return id;
}

export async function deleteBoardPermanently(board: Board) {
  must(await sb().from('boards').delete().eq('id', board.id));
  queryClient.invalidateQueries({ queryKey: qk.project(board.project_id) });
}

export interface BoardData {
  lists: List[];
  cards: CardWithRelations[];
  labels: Label[];
}

export const CARD_SELECT =
  '*, card_assignees(user_id), card_labels(label_id), comments(count), checklist_items(done), attachments(count)';

export function useBoardData(projectId: string | undefined, boardId: string | undefined) {
  return useQuery({
    queryKey: qk.projectPart(projectId ?? '', 'board', boardId),
    enabled: Boolean(projectId && boardId),
    queryFn: async (): Promise<BoardData> => {
      const [lists, cards, labels] = await Promise.all([
        sb().from('lists').select('*').eq('board_id', boardId!).is('archived_at', null).order('position'),
        sb()
          .from('cards')
          .select(CARD_SELECT)
          .eq('board_id', boardId!)
          .is('archived_at', null)
          .is('deleted_at', null)
          .eq('is_template', false)
          .is('comments.deleted_at', null)
          .order('position'),
        sb().from('labels').select('*').eq('board_id', boardId!).order('created_at'),
      ]);
      return {
        lists: must(lists) as List[],
        cards: must(cards) as unknown as CardWithRelations[],
        labels: must(labels) as Label[],
      };
    },
  });
}

/* ================================================================ Comments */

export function useComments(projectId: string, cardId: string | undefined) {
  return useQuery({
    queryKey: qk.projectPart(projectId, 'comments', cardId),
    enabled: Boolean(cardId),
    queryFn: async () =>
      must(
        await sb().from('comments').select('*').eq('card_id', cardId!).is('deleted_at', null).order('created_at'),
      ) as Comment[],
  });
}

export async function addComment(projectId: string, cardId: string, body: string, mentions: string[]) {
  must(await sb().from('comments').insert({ card_id: cardId, project_id: projectId, body, mentions }));
  queryClient.invalidateQueries({ queryKey: qk.projectPart(projectId, 'comments', cardId) });
  kickAutomations();
}

export async function editComment(c: Comment, body: string, mentions: string[]) {
  must(await sb().from('comments').update({ body, mentions }).eq('id', c.id));
  queryClient.invalidateQueries({ queryKey: qk.projectPart(c.project_id, 'comments', c.card_id) });
}

export async function deleteComment(c: Comment) {
  must(await sb().from('comments').update({ deleted_at: new Date().toISOString() }).eq('id', c.id));
  queryClient.invalidateQueries({ queryKey: qk.projectPart(c.project_id, 'comments', c.card_id) });
}

/* ================================================================ Activity */

export function useActivity(scope: { projectId?: string; cardId?: string; workspaceId?: string }, limit = 50) {
  return useQuery({
    queryKey: scope.projectId
      ? qk.projectPart(scope.projectId, 'activity', scope.cardId ?? 'all', limit)
      : ['ws', scope.workspaceId ?? '', 'activity', limit],
    enabled: Boolean(scope.projectId || scope.workspaceId),
    queryFn: async () => {
      let q = sb().from('activity_log').select('*').order('created_at', { ascending: false }).limit(limit);
      if (scope.cardId) q = q.eq('card_id', scope.cardId);
      else if (scope.projectId) q = q.eq('project_id', scope.projectId);
      else if (scope.workspaceId) q = q.eq('workspace_id', scope.workspaceId);
      return must(await q) as ActivityEntry[];
    },
  });
}

/* ================================================================== Helpers */

export function useInvalidateOnSuccess<T, V>(fn: (v: V) => Promise<T>, keys: unknown[][]) {
  return useMutation({
    mutationFn: fn,
    onSuccess: () => keys.forEach((k) => queryClient.invalidateQueries({ queryKey: k })),
  });
}
