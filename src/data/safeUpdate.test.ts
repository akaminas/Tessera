import { describe, expect, it } from 'vitest';
import { safeUpdate, type UpdateBackend } from './safeUpdate';
import { ConflictError } from './errors';

interface Row {
  id: string;
  version: number;
  title: string;
  list_id: string;
  labels?: string[];
}

function memoryBackend(initial: Row): UpdateBackend<Row> & { row: Row } {
  const store = { row: { ...initial } };
  return {
    get row() {
      return store.row;
    },
    async update(id, version, patch) {
      if (id !== store.row.id || version !== store.row.version) return null;
      store.row = { ...store.row, ...patch, version: store.row.version + 1 };
      return store.row;
    },
    async fetch() {
      return store.row;
    },
  };
}

describe('safeUpdate', () => {
  const base: Row = { id: '1', version: 1, title: 'Draft', list_id: 'todo' };

  it('writes when nobody else changed the row', async () => {
    const be = memoryBackend(base);
    const res = await safeUpdate(be, base, { title: 'Final' });
    expect(res).toMatchObject({ title: 'Final', version: 2 });
  });

  it('merges a concurrent change to a different field', async () => {
    const be = memoryBackend(base);
    // another user renames the card
    await be.update('1', 1, { title: 'Renamed by Bob' });
    // this user moves it, based on the stale version
    const res = await safeUpdate(be, base, { list_id: 'doing' });
    expect(res).toMatchObject({ title: 'Renamed by Bob', list_id: 'doing', version: 3 });
  });

  it('raises a conflict when both changed the same field differently', async () => {
    const be = memoryBackend(base);
    await be.update('1', 1, { title: 'Bob title' });
    const err = await safeUpdate(be, base, { title: 'Alice title' }).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect(err.fields).toEqual(['title']);
    expect(err.current.title).toBe('Bob title');
    expect(be.row.title).toBe('Bob title');
  });

  it('accepts an identical concurrent change', async () => {
    const be = memoryBackend(base);
    await be.update('1', 1, { title: 'Same' });
    const res = await safeUpdate(be, base, { title: 'Same' });
    expect(res.version).toBe(3);
  });

  it('compares structured values', async () => {
    const be = memoryBackend({ ...base, labels: ['a'] });
    await be.update('1', 1, { labels: ['a', 'b'] });
    const err = await safeUpdate(be, { ...base, labels: ['a'] }, { labels: ['c'] }).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
  });

  it('reports deletion', async () => {
    const be: UpdateBackend<Row> = { update: async () => null, fetch: async () => null };
    await expect(safeUpdate(be, base, { title: 'x' })).rejects.toThrow(/deleted/);
  });
});
