import { ConflictError } from './errors';
import { sb } from '@/lib/supabase';

export interface VersionedRow {
  id: string;
  version: number;
}

export interface UpdateBackend<T extends VersionedRow> {
  /** Apply `patch` only if the row still has `version`; return the new row or null. */
  update(id: string, version: number, patch: Partial<T>): Promise<T | null>;
  /** Fetch the latest row (null if deleted / inaccessible). */
  fetch(id: string): Promise<T | null>;
}

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a == b;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Optimistic-concurrency update with field-level merging.
 *
 * 1. Try to write against the version the user edited (`base.version`).
 * 2. If someone else saved in between, fetch the latest row. If they changed
 *    none of the fields this patch touches (or changed them to the same value),
 *    re-apply the patch on top of their version — no data is lost.
 * 3. If the same field was changed differently by both, throw ConflictError
 *    carrying the latest row so the UI can let the user choose.
 */
export async function safeUpdate<T extends VersionedRow>(
  backend: UpdateBackend<T>,
  base: T,
  patch: Partial<T>,
  maxAttempts = 4,
): Promise<T> {
  let version = base.version;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const updated = await backend.update(base.id, version, patch);
    if (updated) return updated;
    const current = await backend.fetch(base.id);
    if (!current) throw new ConflictError('This item was deleted or you no longer have access to it.', null, []);
    const conflicting = Object.keys(patch).filter((key) => {
      const k = key as keyof T;
      const theirs = current[k];
      return !same(theirs, base[k]) && !same(theirs, patch[k]);
    });
    if (conflicting.length > 0) {
      throw new ConflictError(
        'Someone else changed this at the same time. Review their version before saving yours.',
        current,
        conflicting,
      );
    }
    version = current.version;
  }
  throw new ConflictError('This item is being edited heavily right now. Please try again.', null, []);
}

/** UpdateBackend backed by a Supabase table with a `version` column. */
export function tableBackend<T extends VersionedRow>(table: string, select = '*'): UpdateBackend<T> {
  return {
    async update(id, version, patch) {
      const { data, error } = await sb()
        .from(table)
        .update(patch as Record<string, unknown>)
        .eq('id', id)
        .eq('version', version)
        .select(select)
        .maybeSingle();
      if (error) throw error;
      return (data as T | null) ?? null;
    },
    async fetch(id) {
      const { data, error } = await sb().from(table).select(select).eq('id', id).maybeSingle();
      if (error) throw error;
      return (data as T | null) ?? null;
    },
  };
}
