import { describe, expect, it } from 'vitest';
import { keyAfterLast, keyBeforeFirst, keysAfter, placeAt, sortByPosition } from './ordering';

const items = [
  { id: 'a', position: 'a0' },
  { id: 'b', position: 'a1' },
  { id: 'c', position: 'a2' },
];

describe('ordering', () => {
  it('appends and prepends', () => {
    expect(keyAfterLast(items) > 'a2').toBe(true);
    expect(keyBeforeFirst(items) < 'a0').toBe(true);
    expect(keyAfterLast([])).toBe('a0');
  });

  it('places between neighbours', () => {
    const r = placeAt(items, 'x', 1);
    expect(r.rebalance).toBeUndefined();
    expect(r.key! > 'a0' && r.key! < 'a1').toBe(true);
  });

  it('moves an existing item without counting itself', () => {
    // move c to the top
    const r = placeAt(items, 'c', 0);
    expect(r.key! < 'a0').toBe(true);
    // move a to the end
    const r2 = placeAt(items, 'a', 5);
    expect(r2.key! > 'a2').toBe(true);
  });

  it('rebalances when neighbours share a key', () => {
    const dup = [
      { id: 'a', position: 'a0' },
      { id: 'b', position: 'a0' },
    ];
    const r = placeAt(dup, 'x', 1);
    expect(r.rebalance).toHaveLength(3);
    const sorted = sortByPosition(r.rebalance!);
    expect(sorted.map((i) => i.id)).toEqual(['a', 'x', 'b']);
    expect(new Set(r.rebalance!.map((i) => i.position)).size).toBe(3);
  });

  it('generates many ascending keys', () => {
    const keys = keysAfter(items, 5);
    expect(keys).toHaveLength(5);
    expect([...keys].sort()).toEqual(keys);
    expect(keys[0] > 'a2').toBe(true);
  });

  it('sorts by code unit like the database C collation', () => {
    const mixed = [
      { id: '1', position: 'a' },
      { id: '2', position: 'Z' },
      { id: '3', position: 'b' },
    ];
    expect(sortByPosition(mixed).map((i) => i.position)).toEqual(['Z', 'a', 'b']);
  });
});
