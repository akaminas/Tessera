import { useQuery } from '@tanstack/react-query';
import { sb } from '@/lib/supabase';
import { must } from './errors';
import { qk, queryClient } from './queryClient';
import type { Card } from './types';
import { kickAutomations } from './cards';

const inval = (projectId: string) => {
  queryClient.invalidateQueries({ queryKey: qk.project(projectId) });
  queryClient.invalidateQueries({ queryKey: ['me', 'work'] });
  kickAutomations();
};

/* ================================================================ Checklists */

export interface Checklist {
  id: string;
  card_id: string;
  project_id: string;
  title: string;
  position: string;
  hide_done: boolean;
}
export interface ChecklistItem {
  id: string;
  checklist_id: string;
  card_id: string;
  project_id: string;
  parent_item_id: string | null;
  title: string;
  done: boolean;
  done_at: string | null;
  assignee_id: string | null;
  due_date: string | null;
  position: string;
}

export function useChecklists(projectId: string, cardId: string) {
  return useQuery({
    queryKey: qk.projectPart(projectId, 'checklists', cardId),
    queryFn: async () => {
      const [cls, items] = await Promise.all([
        sb().from('checklists').select('*').eq('card_id', cardId).order('position'),
        sb().from('checklist_items').select('*').eq('card_id', cardId).order('position'),
      ]);
      return { checklists: must(cls) as Checklist[], items: must(items) as ChecklistItem[] };
    },
  });
}

export async function addChecklist(card: Card, title: string, position: string) {
  must(await sb().from('checklists').insert({ card_id: card.id, project_id: card.project_id, title, position }));
  inval(card.project_id);
}
export async function updateChecklist(cl: Checklist, patch: Partial<Checklist>) {
  must(await sb().from('checklists').update(patch).eq('id', cl.id));
  inval(cl.project_id);
}
export async function deleteChecklist(cl: Checklist) {
  must(await sb().from('checklists').delete().eq('id', cl.id));
  inval(cl.project_id);
}
export async function addChecklistItems(cl: Checklist, titles: string[], positions: string[], parentId: string | null = null) {
  must(
    await sb()
      .from('checklist_items')
      .insert(
        titles.map((title, i) => ({
          checklist_id: cl.id,
          card_id: cl.card_id,
          project_id: cl.project_id,
          title,
          position: positions[i],
          parent_item_id: parentId,
        })),
      ),
  );
  inval(cl.project_id);
}
export async function updateChecklistItem(item: ChecklistItem, patch: Partial<ChecklistItem>) {
  must(await sb().from('checklist_items').update(patch).eq('id', item.id));
  inval(item.project_id);
}
export async function deleteChecklistItem(item: ChecklistItem) {
  must(await sb().from('checklist_items').delete().eq('id', item.id));
  inval(item.project_id);
}

/** Turn a checklist item into its own task (subtask card under this card). */
export async function promoteItemToCard(item: ChecklistItem, card: Card, position: string) {
  const created = must(
    await sb()
      .from('cards')
      .insert({
        board_id: card.board_id,
        list_id: card.list_id,
        project_id: card.project_id,
        parent_id: card.id,
        title: item.title,
        position,
        due_date: item.due_date,
      })
      .select('id')
      .single(),
  ) as { id: string };
  if (item.assignee_id) {
    must(await sb().from('card_assignees').insert({ card_id: created.id, user_id: item.assignee_id, project_id: card.project_id }));
  }
  must(await sb().from('checklist_items').delete().eq('id', item.id));
  inval(card.project_id);
  return created.id;
}

/* ============================================================ Custom fields */

export interface CustomField {
  id: string;
  board_id: string;
  project_id: string;
  name: string;
  type: 'text' | 'number' | 'date' | 'select' | 'checkbox' | 'url';
  options: string[];
  position: string;
  show_on_card: boolean;
}

export function useCustomFields(projectId: string, boardId: string | undefined) {
  return useQuery({
    queryKey: qk.projectPart(projectId, 'fields', boardId),
    enabled: Boolean(boardId),
    queryFn: async () => must(await sb().from('custom_fields').select('*').eq('board_id', boardId!).order('position')) as CustomField[],
  });
}

export function useFieldValues(projectId: string, cardId: string) {
  return useQuery({
    queryKey: qk.projectPart(projectId, 'field-values', cardId),
    queryFn: async () =>
      must(await sb().from('card_field_values').select('*').eq('card_id', cardId)) as { field_id: string; value: unknown }[],
  });
}

export async function saveCustomField(f: Partial<CustomField> & { board_id: string; project_id: string }) {
  const { id, ...rest } = f;
  if (id) must(await sb().from('custom_fields').update(rest).eq('id', id));
  else must(await sb().from('custom_fields').insert(rest));
  inval(f.project_id);
}
export async function deleteCustomField(f: CustomField) {
  must(await sb().from('custom_fields').delete().eq('id', f.id));
  inval(f.project_id);
}
export async function setFieldValue(card: Card, fieldId: string, value: unknown) {
  if (value === null || value === undefined || value === '') {
    must(await sb().from('card_field_values').delete().eq('card_id', card.id).eq('field_id', fieldId));
  } else {
    must(
      await sb()
        .from('card_field_values')
        .upsert({ card_id: card.id, field_id: fieldId, project_id: card.project_id, value }, { onConflict: 'card_id,field_id' }),
    );
  }
  inval(card.project_id);
}

/* ============================================================== Attachments */

export interface Attachment {
  id: string;
  project_id: string;
  card_id: string | null;
  entity_type: string;
  entity_id: string | null;
  kind: 'file' | 'link';
  name: string;
  url: string | null;
  storage_path: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  is_finance: boolean;
  uploaded_by: string | null;
  created_at: string;
  deleted_at: string | null;
}

export function useAttachments(projectId: string, scope: { cardId?: string; entityType?: string; entityId?: string; all?: boolean }) {
  return useQuery({
    queryKey: qk.projectPart(projectId, 'attachments', scope.cardId ?? scope.entityId ?? (scope.all ? 'all' : 'project')),
    queryFn: async () => {
      let q = sb().from('attachments').select('*').eq('project_id', projectId).is('deleted_at', null).order('created_at', { ascending: false });
      if (scope.cardId) q = q.eq('card_id', scope.cardId);
      else if (scope.entityId) q = q.eq('entity_id', scope.entityId);
      else if (!scope.all) q = q.eq('entity_type', scope.entityType ?? 'project');
      return must(await q) as Attachment[];
    },
  });
}

const MAX_BYTES = 50 * 1024 * 1024;

export async function uploadAttachment(
  projectId: string,
  file: File,
  target: { cardId?: string; entityType?: string; entityId?: string; finance?: boolean },
) {
  if (file.size > MAX_BYTES) throw new Error('Files are limited to 50 MB.');
  const safeName = file.name.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'file';
  const folder = target.finance ? 'finance' : target.cardId ? 'cards' : 'files';
  const path = `${projectId}/${folder}/${crypto.randomUUID()}-${safeName}`;
  const up = await sb().storage.from('attachments').upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
  if (up.error) throw up.error;
  const row = {
    project_id: projectId,
    card_id: target.cardId ?? null,
    entity_type: target.cardId ? 'card' : target.entityType ?? 'project',
    entity_id: target.cardId ?? target.entityId ?? null,
    kind: 'file',
    name: file.name.slice(0, 300),
    storage_path: path,
    mime_type: file.type || null,
    size_bytes: file.size,
    is_finance: Boolean(target.finance),
  };
  const ins = await sb().from('attachments').insert(row).select('id').single();
  if (ins.error) {
    await sb().storage.from('attachments').remove([path]);
    throw ins.error;
  }
  inval(projectId);
  return (ins.data as { id: string }).id;
}

export async function addLinkAttachment(
  projectId: string,
  url: string,
  name: string,
  target: { cardId?: string; entityType?: string; entityId?: string; finance?: boolean },
) {
  if (!/^https?:\/\//i.test(url)) throw new Error('Links must start with http:// or https://');
  must(
    await sb()
      .from('attachments')
      .insert({
        project_id: projectId,
        card_id: target.cardId ?? null,
        entity_type: target.cardId ? 'card' : target.entityType ?? 'project',
        entity_id: target.cardId ?? target.entityId ?? null,
        kind: 'link',
        url,
        name: (name || url).slice(0, 300),
        is_finance: Boolean(target.finance),
      }),
  );
  inval(projectId);
}

export async function removeAttachment(a: Attachment) {
  if (a.kind === 'file' && a.storage_path) {
    const res = await sb().storage.from('attachments').remove([a.storage_path]);
    if (res.error) throw res.error;
  }
  must(await sb().from('attachments').delete().eq('id', a.id));
  inval(a.project_id);
}

export async function openAttachment(a: Attachment) {
  if (a.kind === 'link') {
    window.open(a.url!, '_blank', 'noopener,noreferrer');
    return;
  }
  const { data, error } = await sb().storage.from('attachments').createSignedUrl(a.storage_path!, 300, { download: a.name });
  if (error) throw error;
  window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
}

/** Recognise well-known document links for nicer display. */
export function linkKind(url: string): string | null {
  if (/docs\.google\.com\/document/.test(url)) return 'Google Doc';
  if (/docs\.google\.com\/spreadsheets/.test(url)) return 'Google Sheet';
  if (/docs\.google\.com\/presentation/.test(url)) return 'Google Slides';
  if (/drive\.google\.com/.test(url)) return 'Google Drive';
  if (/github\.com\/[^/]+\/[^/]+\/(issues|pull)\/\d+/.test(url)) return 'GitHub';
  if (/sharepoint\.com|onedrive\.live\.com/.test(url)) return 'Microsoft 365';
  return null;
}

/* ===================================================== Dependencies & links */

export interface Dependency {
  id: string;
  project_id: string;
  predecessor_id: string;
  successor_id: string;
  kind: 'finish_to_start' | 'start_to_start' | 'finish_to_finish';
  lag_days: number;
}

export function useDependencies(projectId: string) {
  return useQuery({
    queryKey: qk.projectPart(projectId, 'dependencies'),
    queryFn: async () => must(await sb().from('card_dependencies').select('*').eq('project_id', projectId)) as Dependency[],
  });
}

export async function addDependency(projectId: string, predecessor: string, successor: string, kind: Dependency['kind'] = 'finish_to_start', lag = 0) {
  must(await sb().from('card_dependencies').insert({ project_id: projectId, predecessor_id: predecessor, successor_id: successor, kind, lag_days: lag }));
  inval(projectId);
}
export async function removeDependency(d: Dependency) {
  must(await sb().from('card_dependencies').delete().eq('id', d.id));
  inval(d.project_id);
}

export interface CardLink {
  id: string;
  project_id: string;
  card_id: string;
  linked_card_id: string;
  relation: 'relates' | 'duplicates' | 'follows_up';
}
export function useCardLinks(projectId: string, cardId: string) {
  return useQuery({
    queryKey: qk.projectPart(projectId, 'links', cardId),
    queryFn: async () => {
      const links = must(
        await sb().from('card_links').select('*').or(`card_id.eq.${cardId},linked_card_id.eq.${cardId}`),
      ) as CardLink[];
      const ids = links.map((l) => (l.card_id === cardId ? l.linked_card_id : l.card_id));
      const cards = ids.length
        ? (must(await sb().from('cards').select('id, title, status, project_id, board_id').in('id', ids)) as {
            id: string;
            title: string;
            status: string;
            project_id: string;
            board_id: string;
          }[])
        : [];
      return { links, cards };
    },
  });
}
export async function addCardLink(card: Card, linkedId: string, relation: CardLink['relation']) {
  must(await sb().from('card_links').insert({ project_id: card.project_id, card_id: card.id, linked_card_id: linkedId, relation }));
  inval(card.project_id);
}
export async function removeCardLink(l: CardLink) {
  must(await sb().from('card_links').delete().eq('id', l.id));
  inval(l.project_id);
}

/* ============================================================ Time entries */

export function useCardTime(projectId: string, cardId: string) {
  return useQuery({
    queryKey: qk.projectPart(projectId, 'time', cardId),
    queryFn: async () =>
      must(await sb().from('time_entries').select('*').eq('card_id', cardId).order('entry_date', { ascending: false })) as {
        id: string;
        user_id: string;
        minutes: number | null;
        entry_date: string;
        note: string;
        started_at: string | null;
        ended_at: string | null;
      }[],
  });
}

export async function logTime(projectId: string, cardId: string | null, minutes: number, entryDate: string, note = '') {
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 1440) throw new Error('Enter between 1 minute and 24 hours.');
  must(await sb().from('time_entries').insert({ project_id: projectId, card_id: cardId, minutes: Math.round(minutes), entry_date: entryDate, note }));
  inval(projectId);
}

export async function deleteTimeEntry(projectId: string, id: string) {
  must(await sb().from('time_entries').delete().eq('id', id));
  inval(projectId);
}

/** Child cards (subtasks) of a card. */
export function useSubtasks(projectId: string, cardId: string) {
  return useQuery({
    queryKey: qk.projectPart(projectId, 'subtasks', cardId),
    queryFn: async () =>
      must(
        await sb()
          .from('cards')
          .select('id, title, status, due_date, position, list_id, board_id, version, card_assignees(user_id)')
          .eq('parent_id', cardId)
          .is('deleted_at', null)
          .is('archived_at', null)
          .order('position'),
      ) as unknown as { id: string; title: string; status: Card['status']; due_date: string | null; position: string; list_id: string; board_id: string; version: number; card_assignees: { user_id: string }[] }[],
  });
}

/** Card templates on a board. */
export function useCardTemplates(projectId: string, boardId: string | undefined) {
  return useQuery({
    queryKey: qk.projectPart(projectId, 'card-templates', boardId),
    enabled: Boolean(boardId),
    queryFn: async () =>
      must(
        await sb().from('cards').select('id, title, list_id').eq('board_id', boardId!).eq('is_template', true).is('deleted_at', null).order('title'),
      ) as { id: string; title: string; list_id: string }[],
  });
}
