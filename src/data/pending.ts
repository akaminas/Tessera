/**
 * Saves still on their way to the server. While any are in flight, leaving
 * or reloading the page asks for confirmation, so a change made a moment
 * before closing the tab is not lost.
 */
let pending = 0;

function onBeforeUnload(e: BeforeUnloadEvent) {
  if (pending > 0) {
    e.preventDefault();
    e.returnValue = ''; // older browsers need this to show the prompt
  }
}

if (typeof window !== 'undefined') window.addEventListener('beforeunload', onBeforeUnload);

export function pendingWrites(): number {
  return pending;
}

/** Wrap a save so it counts as in flight until it settles. */
export function tracked<A extends unknown[], R>(fn: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  return async (...args: A) => {
    pending++;
    mark();
    try {
      return await fn(...args);
    } finally {
      pending--;
      mark();
    }
  };
}

/** `<html data-saving>` while saves are in flight (used by tests and available to styles). */
function mark() {
  if (typeof document === 'undefined') return;
  if (pending > 0) document.documentElement.dataset.saving = 'true';
  else delete document.documentElement.dataset.saving;
}
