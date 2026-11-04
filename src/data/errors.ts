/** Raised when an optimistic-concurrency update collides with another user's edit. */
export class ConflictError<T = Record<string, unknown>> extends Error {
  readonly current: T | null;
  readonly fields: string[];
  constructor(message: string, current: T | null, fields: string[]) {
    super(message);
    this.name = 'ConflictError';
    this.current = current;
    this.fields = fields;
  }
}

export class NotAllowedError extends Error {
  constructor(message = 'You do not have permission to do that.') {
    super(message);
    this.name = 'NotAllowedError';
  }
}

interface PgLikeError {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
}

/** Turn backend errors into short, human sentences. */
export function humanError(err: unknown): string {
  if (!err) return 'Something went wrong.';
  if (err instanceof ConflictError) return err.message;
  const e = err as PgLikeError;
  const msg = e.message || String(err);
  if (e.code === '42501' || /row-level security/i.test(msg)) return 'You do not have permission to do that.';
  if (e.code === '23505') return 'That already exists.';
  if (e.code === '23503') return 'A linked item no longer exists. Refresh and try again.';
  if (e.code === '23514') return 'Some values are not valid. Check the fields and try again.';
  if (e.code === 'PGRST116') return 'Not found, or you no longer have access.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return 'Network unavailable. Your change was not saved.';
  if (/JWT expired/i.test(msg)) return 'Your session expired. Please sign in again.';
  return msg.replace(/^ERROR:\s*/, '');
}

/** Unwrap a Supabase response, throwing its error. */
export function must<T>(res: { data: T | null; error: unknown }): T {
  if (res.error) throw res.error;
  return res.data as T;
}
