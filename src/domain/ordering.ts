import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';

/**
 * Fractional ordering keys. Items sort by `position` using plain code-unit
 * comparison, matching the database's "C" collation.
 */
export interface Positioned {
  id: string;
  position: string;
}

export function comparePositioned(a: Positioned, b: Positioned): number {
  if (a.position < b.position) return -1;
  if (a.position > b.position) return 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function sortByPosition<T extends Positioned>(items: T[]): T[] {
  return [...items].sort(comparePositioned);
}

/** Key after the last item (append). */
export function keyAfterLast(items: Positioned[]): string {
  const sorted = sortByPosition(items);
  const last = sorted[sorted.length - 1];
  return generateKeyBetween(last ? last.position : null, null);
}

/** Key before the first item (prepend). */
export function keyBeforeFirst(items: Positioned[]): string {
  const sorted = sortByPosition(items);
  return generateKeyBetween(null, sorted[0] ? sorted[0].position : null);
}

export interface PlacementResult {
  /** New key for the moved item, or null when the neighbours need rebalancing. */
  key: string | null;
  /** Fresh keys for every item (in order) when rebalancing is needed. */
  rebalance?: { id: string; position: string }[];
}

/**
 * Compute the key for `movingId` placed at `index` among `items` (which may or
 * may not already contain the moving item). Falls back to rebalancing when two
 * neighbours share a key (possible after concurrent inserts).
 */
export function placeAt(items: Positioned[], movingId: string, index: number): PlacementResult {
  const others = sortByPosition(items.filter((i) => i.id !== movingId));
  const clamped = Math.max(0, Math.min(index, others.length));
  const before = others[clamped - 1] ?? null;
  const after = others[clamped] ?? null;
  if (before && after && before.position >= after.position) {
    const ordered = [...others.slice(0, clamped), { id: movingId, position: '' }, ...others.slice(clamped)];
    const keys = generateNKeysBetween(null, null, ordered.length);
    const rebalance = ordered.map((item, i) => ({ id: item.id, position: keys[i] }));
    return { key: rebalance[clamped].position, rebalance };
  }
  return { key: generateKeyBetween(before?.position ?? null, after?.position ?? null) };
}

/** Generate `n` sequential keys after the given items (bulk append). */
export function keysAfter(items: Positioned[], n: number): string[] {
  const sorted = sortByPosition(items);
  const last = sorted[sorted.length - 1];
  return generateNKeysBetween(last ? last.position : null, null, n);
}
