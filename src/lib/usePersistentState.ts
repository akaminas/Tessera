import { useCallback, useEffect, useState } from 'react';

/** useState persisted in local or session storage (per viewer convenience only). */
export function usePersistentState<T>(key: string, initial: T, storage: 'local' | 'session' = 'local'): [T, (v: T | ((p: T) => T)) => void] {
  const fullKey = `tessera.${key}`;
  const read = useCallback((): T => {
    try {
      const raw = (storage === 'local' ? localStorage : sessionStorage).getItem(fullKey);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullKey, storage]);
  const [value, setValue] = useState<T>(read);
  useEffect(() => setValue(read()), [read]);
  const set = useCallback(
    (v: T | ((p: T) => T)) => {
      setValue((prev) => {
        const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v;
        try {
          (storage === 'local' ? localStorage : sessionStorage).setItem(fullKey, JSON.stringify(next));
        } catch {
          /* storage unavailable */
        }
        return next;
      });
    },
    [fullKey, storage],
  );
  return [value, set];
}
