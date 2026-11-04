import { useQuery } from '@tanstack/react-query';
import { sb } from '@/lib/supabase';
import { must } from './errors';
import { queryClient } from './queryClient';
import type { CardStatus, Family, Priority } from './types';

/* ============================================================ Notifications */

export interface Notification {
  id: string;
  user_id: string;
  project_id: string | null;
  card_id: string | null;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  actor_id: string | null;
  created_at: string;
  read_at: string | null;
}

export function useNotifications(enabled = true) {
  return useQuery({
    queryKey: ['me', 'notifications'],
    enabled,
    refetchInterval: 120_000,
    queryFn: async () =>
      must(await sb().from('notifications').select('*').order('created_at', { ascending: false }).limit(200)) as Notification[],
  });
}

export async function markNotificationsRead(ids: string[] | 'all') {
  let q = sb().from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null);
  if (ids !== 'all') q = q.in('id', ids);
  must(await q);
  queryClient.invalidateQueries({ queryKey: ['me', 'notifications'] });
}

export async function markNotificationUnread(id: string) {
  must(await sb().from('notifications').update({ read_at: null }).eq('id', id));
  queryClient.invalidateQueries({ queryKey: ['me', 'notifications'] });
}

export async function deleteNotification(id: string) {
  must(await sb().from('notifications').delete().eq('id', id));
  queryClient.invalidateQueries({ queryKey: ['me', 'notifications'] });
}

/* ================================================================ My work */

export interface WorkItem {
  card_id: string;
  title: string;
  status: CardStatus;
  priority: Priority;
  start_date: string | null;
  due_date: string | null;
  due_time: string | null;
  completed_at: string | null;
  project_id: string;
  project_name: string;
  project_color: Family;
  board_id: string;
  board_name: string;
  list_name: string;
  parent_id: string | null;
  estimate_minutes: number | null;
  version: number;
  source: 'card' | 'checklist_item';
  checklist_item_id: string | null;
}

export function useMyWork(includeDone = false) {
  return useQuery({
    queryKey: ['me', 'work', includeDone],
    queryFn: async () => must(await sb().rpc('my_work', { p_include_done: includeDone })) as WorkItem[],
  });
}

/* ============================================================ Personal inbox */

export async function ensurePersonalInbox(workspaceId: string): Promise<{ project_id: string; board_id: string; list_id: string }> {
  const rows = must(await sb().rpc('ensure_personal_inbox', { p_workspace: workspaceId })) as {
    project_id: string;
    board_id: string;
    list_id: string;
  }[];
  return rows[0];
}

export function usePersonalInbox(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ['me', 'inbox-board', workspaceId],
    enabled: Boolean(workspaceId),
    staleTime: Infinity,
    queryFn: () => ensurePersonalInbox(workspaceId!),
  });
}

/* =============================================================== Bookmarks */

export interface Bookmark {
  id: string;
  kind: 'board' | 'project' | 'card' | 'view' | 'url';
  target_id: string | null;
  project_id: string | null;
  url: string | null;
  label: string;
  position: string;
}

export function useBookmarks() {
  return useQuery({
    queryKey: ['me', 'bookmarks'],
    queryFn: async () => must(await sb().from('bookmarks').select('*').order('position').order('created_at')) as Bookmark[],
  });
}

export async function toggleBookmark(input: { kind: Bookmark['kind']; target_id: string; project_id?: string | null; label: string }, on: boolean) {
  if (on) {
    must(
      await sb()
        .from('bookmarks')
        .upsert({ ...input, project_id: input.project_id ?? null }, { onConflict: 'user_id,kind,target_id', ignoreDuplicates: true }),
    );
  } else {
    must(await sb().from('bookmarks').delete().eq('kind', input.kind).eq('target_id', input.target_id));
  }
  queryClient.invalidateQueries({ queryKey: ['me', 'bookmarks'] });
}

export async function addUrlBookmark(url: string, label: string) {
  must(await sb().from('bookmarks').insert({ kind: 'url', url, label, target_id: crypto.randomUUID() }));
  queryClient.invalidateQueries({ queryKey: ['me', 'bookmarks'] });
}

export async function removeBookmark(id: string) {
  must(await sb().from('bookmarks').delete().eq('id', id));
  queryClient.invalidateQueries({ queryKey: ['me', 'bookmarks'] });
}

/* ================================================================== Search */

export interface SearchHit {
  kind: 'card' | 'project' | 'board' | 'comment';
  id: string;
  title: string;
  snippet: string | null;
  project_id: string;
  board_id: string | null;
  card_id: string | null;
  rank: number;
}

export function useSearch(query: string) {
  const q = query.trim();
  return useQuery({
    queryKey: ['global', 'search', q],
    enabled: q.length >= 2,
    staleTime: 10_000,
    queryFn: async () => must(await sb().rpc('search_all', { p_query: q, p_limit: 40 })) as SearchHit[],
  });
}

/* ============================================================= Saved views */

export interface SavedView {
  id: string;
  user_id: string;
  workspace_id: string | null;
  project_id: string | null;
  board_id: string | null;
  name: string;
  view: string;
  config: Record<string, unknown>;
  shared: boolean;
}

export function useSavedViews(scope: { projectId?: string; view: string }) {
  return useQuery({
    queryKey: scope.projectId ? ['p', scope.projectId, 'views', scope.view] : ['me', 'views', scope.view],
    queryFn: async () => {
      let q = sb().from('saved_views').select('*').eq('view', scope.view).order('name');
      q = scope.projectId ? q.eq('project_id', scope.projectId) : q.is('project_id', null);
      return must(await q) as SavedView[];
    },
  });
}

export async function saveView(v: Partial<SavedView> & { name: string; view: string; config: Record<string, unknown> }) {
  if (v.id) must(await sb().from('saved_views').update({ name: v.name, config: v.config, shared: v.shared ?? false }).eq('id', v.id));
  else must(await sb().from('saved_views').insert(v));
  queryClient.invalidateQueries({ queryKey: v.project_id ? ['p', v.project_id, 'views'] : ['me', 'views'] });
}

export async function deleteView(v: SavedView) {
  must(await sb().from('saved_views').delete().eq('id', v.id));
  queryClient.invalidateQueries({ queryKey: v.project_id ? ['p', v.project_id, 'views'] : ['me', 'views'] });
}

/* ================================================================== Timer */

export interface TimeEntry {
  id: string;
  project_id: string;
  card_id: string | null;
  user_id: string;
  entry_date: string;
  started_at: string | null;
  ended_at: string | null;
  minutes: number | null;
  note: string;
}

export function useRunningTimer(userId: string | undefined) {
  return useQuery({
    queryKey: ['me', 'timer'],
    enabled: Boolean(userId),
    queryFn: async () =>
      (must(
        await sb()
          .from('time_entries')
          .select('*, cards(title)')
          .eq('user_id', userId!)
          .not('started_at', 'is', null)
          .is('ended_at', null)
          .maybeSingle(),
      ) as (TimeEntry & { cards: { title: string } | null }) | null) ?? null,
  });
}

export async function startTimer(projectId: string, cardId: string | null) {
  // stop any running timer first (only one at a time)
  must(await sb().from('time_entries').update({ ended_at: new Date().toISOString() }).is('ended_at', null).not('started_at', 'is', null));
  must(await sb().from('time_entries').insert({ project_id: projectId, card_id: cardId, started_at: new Date().toISOString() }));
  queryClient.invalidateQueries({ queryKey: ['me', 'timer'] });
  queryClient.invalidateQueries({ queryKey: ['p', projectId] });
}

export async function stopTimer(entry: TimeEntry) {
  must(await sb().from('time_entries').update({ ended_at: new Date().toISOString() }).eq('id', entry.id));
  queryClient.invalidateQueries({ queryKey: ['me', 'timer'] });
  queryClient.invalidateQueries({ queryKey: ['p', entry.project_id] });
}

/* ================================================================ Profile */

export async function updateProfile(userId: string, patch: { display_name?: string; timezone?: string; preferences?: Record<string, unknown>; avatar_color?: string }) {
  must(await sb().from('profiles').update(patch).eq('id', userId));
  queryClient.invalidateQueries({ queryKey: ['me', 'profile'] });
}
