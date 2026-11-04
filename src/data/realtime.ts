import { useEffect, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { sb } from '@/lib/supabase';
import { queryClient } from './queryClient';

export type SyncState = 'connecting' | 'live' | 'offline';

interface FeedRow {
  project_id: string;
  board_id: string | null;
  entity: string;
  entity_id: string | null;
  op: string;
  actor_id: string | null;
}

/**
 * One subscription for the whole session. The database writes a row to
 * `change_feed` for every change; Realtime delivers only the rows the user may
 * read (RLS). We coalesce bursts and invalidate the affected caches so every
 * open view — board, table, calendar, timeline — re-reads the same truth.
 */
export function startChangeFeed(userId: string, onState: (s: SyncState) => void): () => void {
  const pendingProjects = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    timer = null;
    for (const pid of pendingProjects) queryClient.invalidateQueries({ queryKey: ['p', pid] });
    pendingProjects.clear();
    queryClient.invalidateQueries({ queryKey: ['global'] });
    queryClient.invalidateQueries({ queryKey: ['me', 'work'] });
  };

  let channel: RealtimeChannel | null = sb()
    .channel(`feed:${userId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'change_feed' }, (payload) => {
      const row = payload.new as FeedRow;
      pendingProjects.add(row.project_id);
      if (row.entity === 'projects' || row.entity === 'project_members') {
        queryClient.invalidateQueries({ queryKey: ['ws'] });
      }
      if (!timer) timer = setTimeout(flush, 150);
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, () => {
      queryClient.invalidateQueries({ queryKey: ['me', 'notifications'] });
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') onState('live');
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') onState('offline');
    });

  onState('connecting');
  return () => {
    if (timer) clearTimeout(timer);
    if (channel) sb().removeChannel(channel);
    channel = null;
  };
}

/** Presence: who else is looking at the same board right now. */
export function useBoardPresence(boardId: string | undefined, me: { id: string; name: string } | null) {
  const [others, setOthers] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    if (!boardId || !me) return;
    const ch = sb().channel(`presence:board:${boardId}`, { config: { presence: { key: me.id } } });
    ch.on('presence', { event: 'sync' }, () => {
      const state = ch.presenceState<{ id: string; name: string }>();
      const people = Object.values(state)
        .map((entries) => entries[0])
        .filter((p) => p && p.id !== me.id);
      setOthers(people.map((p) => ({ id: p.id, name: p.name })));
    }).subscribe(async (status) => {
      if (status === 'SUBSCRIBED') await ch.track({ id: me.id, name: me.name });
    });
    return () => {
      sb().removeChannel(ch);
    };
  }, [boardId, me]);
  return others;
}
