import { sb } from '@/lib/supabase';
import { tracked } from './pending';
import { must } from './errors';
import { qk, queryClient } from './queryClient';
import { safeUpdate, tableBackend } from './safeUpdate';
import type { BoardData } from './core';
import type { Card, CardWithRelations, Label, LabelColor, List } from './types';
import { placeAt, keyAfterLast } from '@/domain/ordering';

const cardsBackend = tableBackend<Card>('cards');

function boardKey(projectId: string, boardId: string) {
  return qk.projectPart(projectId, 'board', boardId);
}

/** Apply a local transformation to a cached board, returning a rollback. */
function patchBoardCache(projectId: string, boardId: string, fn: (d: BoardData) => BoardData): () => void {
  const key = boardKey(projectId, boardId);
  const prev = queryClient.getQueryData<BoardData>(key);
  if (prev) queryClient.setQueryData<BoardData>(key, fn(prev));
  return () => {
    if (prev) queryClient.setQueryData(key, prev);
  };
}

let kickTimer: ReturnType<typeof setTimeout> | null = null;
/**
 * Ask the server to process queued automation events now, so rules react
 * within a second of a change (the per-minute scheduler is the safety net).
 * The automations themselves always run server-side.
 */
export function kickAutomations() {
  if (kickTimer) clearTimeout(kickTimer);
  kickTimer = setTimeout(() => {
    kickTimer = null;
    sb()
      .rpc('kick_automations')
      .then(({ data }) => {
        if (typeof data === 'number' && data > 0) {
          queryClient.invalidateQueries({ queryKey: ['p'] });
          queryClient.invalidateQueries({ queryKey: ['me'] });
        }
      });
  }, 400);
}

function refreshProject(projectId: string) {
  queryClient.invalidateQueries({ queryKey: qk.project(projectId) });
  queryClient.invalidateQueries({ queryKey: ['me', 'work'] });
  queryClient.invalidateQueries({ queryKey: ['global'] });
  kickAutomations();
}

/* ==================================================================== Cards */

async function createCardImpl(input: {
  project_id: string;
  board_id: string;
  list_id: string;
  title: string;
  position: string;
  parent_id?: string | null;
  due_date?: string | null;
  start_date?: string | null;
  description?: string;
  priority?: Card['priority'];
  assignees?: string[];
  label_ids?: string[];
  work_package_id?: string | null;
  status?: Card['status'];
}): Promise<Card> {
  const { assignees = [], label_ids = [], ...row } = input;
  const tempId = `temp-${Math.random().toString(36).slice(2)}`;
  const rollback = patchBoardCache(input.project_id, input.board_id, (d) => ({
    ...d,
    cards: [
      ...d.cards,
      {
        ...(row as unknown as Card),
        id: tempId,
        description: row.description ?? '',
        status: row.status ?? 'open',
        priority: row.priority ?? 'none',
        version: 0,
        card_assignees: assignees.map((user_id) => ({ user_id })),
        card_labels: label_ids.map((label_id) => ({ label_id })),
        comments: [{ count: 0 }],
        checklist_items: [],
        attachments: [{ count: 0 }],
      } as CardWithRelations,
    ],
  }));
  try {
    const card = must(await sb().from('cards').insert(row).select('*').single()) as Card;
    if (assignees.length)
      must(await sb().from('card_assignees').insert(assignees.map((user_id) => ({ card_id: card.id, user_id, project_id: card.project_id }))));
    if (label_ids.length)
      must(await sb().from('card_labels').insert(label_ids.map((label_id) => ({ card_id: card.id, label_id, project_id: card.project_id }))));
    refreshProject(input.project_id);
    return card;
  } catch (err) {
    rollback();
    throw err;
  }
}

/** Conflict-safe card update with optimistic cache patch. */
async function updateCardImpl(card: Card, patch: Partial<Card>): Promise<Card> {
  const rollback = patchBoardCache(card.project_id, card.board_id, (d) => ({
    ...d,
    cards: d.cards.map((c) => (c.id === card.id ? { ...c, ...patch } : c)),
  }));
  try {
    const res = await safeUpdate(cardsBackend, card, patch);
    queryClient.setQueryData(qk.projectPart(card.project_id, 'card', card.id), (old: Card | undefined) =>
      old ? { ...old, ...res } : old,
    );
    refreshProject(card.project_id);
    return res;
  } catch (err) {
    rollback();
    throw err;
  }
}

/** Move a card to `listId` at visual `index` (persisted with fractional keys). */
async function moveCardImpl(card: CardWithRelations, toListId: string, index: number, siblings: CardWithRelations[]) {
  const placement = placeAt(siblings, card.id, index);
  if (placement.rebalance) {
    // Rare: concurrent inserts produced equal keys. Renumber the list.
    for (const r of placement.rebalance) {
      if (r.id === card.id) continue;
      const sib = siblings.find((s) => s.id === r.id);
      if (sib) await safeUpdate(cardsBackend, sib, { position: r.position });
    }
  }
  return updateCard(card, { list_id: toListId, position: placement.key! });
}

export async function setCardsArchived(cards: Card[], archived: boolean) {
  const now = archived ? new Date().toISOString() : null;
  for (const c of cards) await safeUpdate(cardsBackend, c, { archived_at: now });
  if (cards[0]) refreshProject(cards[0].project_id);
}

export async function trashCard(card: Card, trashed: boolean) {
  await safeUpdate(cardsBackend, card, { deleted_at: trashed ? new Date().toISOString() : null });
  refreshProject(card.project_id);
}

export async function deleteCardPermanently(card: Card) {
  must(await sb().from('cards').delete().eq('id', card.id));
  refreshProject(card.project_id);
}

export async function copyCard(cardId: string, toListId: string, title: string, opts: { checklists: boolean; labels: boolean; members: boolean }) {
  const id = must(
    await sb().rpc('copy_card', {
      p_card: cardId,
      p_list: toListId,
      p_title: title,
      p_checklists: opts.checklists,
      p_labels: opts.labels,
      p_members: opts.members,
    }),
  ) as string;
  queryClient.invalidateQueries({ queryKey: ['p'] });
  return id;
}

export async function fetchCard(cardId: string): Promise<CardWithRelations | null> {
  const { data, error } = await sb()
    .from('cards')
    .select('*, card_assignees(user_id), card_labels(label_id), card_watchers(user_id)')
    .eq('id', cardId)
    .maybeSingle();
  if (error) throw error;
  return data as unknown as CardWithRelations | null;
}

export async function setAssignee(card: Card, userId: string, on: boolean) {
  const rollback = patchBoardCache(card.project_id, card.board_id, (d) => ({
    ...d,
    cards: d.cards.map((c) =>
      c.id === card.id
        ? {
            ...c,
            card_assignees: on
              ? [...c.card_assignees.filter((a) => a.user_id !== userId), { user_id: userId }]
              : c.card_assignees.filter((a) => a.user_id !== userId),
          }
        : c,
    ),
  }));
  try {
    if (on) {
      must(
        await sb()
          .from('card_assignees')
          .upsert({ card_id: card.id, user_id: userId, project_id: card.project_id }, { onConflict: 'card_id,user_id', ignoreDuplicates: true }),
      );
    } else {
      must(await sb().from('card_assignees').delete().eq('card_id', card.id).eq('user_id', userId));
    }
    refreshProject(card.project_id);
  } catch (err) {
    rollback();
    throw err;
  }
}

export async function setCardLabel(card: Card, labelId: string, on: boolean) {
  const rollback = patchBoardCache(card.project_id, card.board_id, (d) => ({
    ...d,
    cards: d.cards.map((c) =>
      c.id === card.id
        ? {
            ...c,
            card_labels: on
              ? [...c.card_labels.filter((l) => l.label_id !== labelId), { label_id: labelId }]
              : c.card_labels.filter((l) => l.label_id !== labelId),
          }
        : c,
    ),
  }));
  try {
    if (on)
      must(
        await sb()
          .from('card_labels')
          .upsert({ card_id: card.id, label_id: labelId, project_id: card.project_id }, { onConflict: 'card_id,label_id', ignoreDuplicates: true }),
      );
    else must(await sb().from('card_labels').delete().eq('card_id', card.id).eq('label_id', labelId));
    refreshProject(card.project_id);
  } catch (err) {
    rollback();
    throw err;
  }
}

export async function setWatching(card: Card, userId: string, on: boolean) {
  if (on)
    must(
      await sb()
        .from('card_watchers')
        .upsert({ card_id: card.id, user_id: userId, project_id: card.project_id }, { onConflict: 'card_id,user_id', ignoreDuplicates: true }),
    );
  else must(await sb().from('card_watchers').delete().eq('card_id', card.id).eq('user_id', userId));
  queryClient.invalidateQueries({ queryKey: qk.projectPart(card.project_id, 'card', card.id) });
}

/* ==================================================================== Lists */

export async function createList(projectId: string, boardId: string, name: string, lists: List[]) {
  const position = keyAfterLast(lists);
  must(await sb().from('lists').insert({ board_id: boardId, project_id: projectId, name, position }));
  refreshProject(projectId);
}

export async function updateList(list: List, patch: Partial<List>) {
  const rollback = patchBoardCache(list.project_id, list.board_id, (d) => ({
    ...d,
    lists: d.lists.map((l) => (l.id === list.id ? { ...l, ...patch } : l)),
  }));
  try {
    const res = await safeUpdate(tableBackend<List>('lists'), list, patch);
    refreshProject(list.project_id);
    return res;
  } catch (err) {
    rollback();
    throw err;
  }
}

export async function moveList(list: List, index: number, lists: List[]) {
  const placement = placeAt(lists, list.id, index);
  if (placement.rebalance) {
    for (const r of placement.rebalance) {
      const l = lists.find((x) => x.id === r.id);
      if (l && l.id !== list.id) await safeUpdate(tableBackend<List>('lists'), l, { position: r.position });
    }
  }
  return updateList(list, { position: placement.key! });
}

export async function moveListToBoard(list: List, targetBoardId: string) {
  must(await sb().rpc('move_list_to_board', { p_list: list.id, p_board: targetBoardId }));
  queryClient.invalidateQueries({ queryKey: ['p'] });
}

/* =================================================================== Labels */

export async function createLabel(projectId: string, boardId: string, name: string, color: LabelColor): Promise<Label> {
  const label = must(
    await sb().from('labels').insert({ board_id: boardId, project_id: projectId, name, color }).select('*').single(),
  ) as Label;
  refreshProject(projectId);
  return label;
}

export async function updateLabel(label: Label, patch: Partial<Label>) {
  must(await sb().from('labels').update(patch).eq('id', label.id));
  refreshProject(label.project_id);
}

export async function deleteLabel(label: Label) {
  must(await sb().from('labels').delete().eq('id', label.id));
  refreshProject(label.project_id);
}

/** Cards in a list ordered as displayed. */
export function cardsInList(cards: CardWithRelations[], listId: string): CardWithRelations[] {
  return cards
    .filter((c) => c.list_id === listId)
    .sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : a.id < b.id ? -1 : 1));
}

export const createCard = tracked(createCardImpl);

export const updateCard = tracked(updateCardImpl);

export const moveCard = tracked(moveCardImpl);
