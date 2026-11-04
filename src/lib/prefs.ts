/** Appearance preferences: applied instantly, cached locally, synced to the profile. */
export interface UiPrefs {
  theme?: 'light' | 'dark' | 'system';
  density?: 'comfortable' | 'compact';
  motion?: 'full' | 'reduced';
}

const KEY = 'tessera.ui';

export function readUiPrefs(): UiPrefs {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}') as UiPrefs;
  } catch {
    return {};
  }
}

export function resolvedTheme(theme: UiPrefs['theme']): 'light' | 'dark' {
  if (theme === 'light' || theme === 'dark') return theme;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyUiPrefs(prefs: UiPrefs) {
  const merged = { ...readUiPrefs(), ...Object.fromEntries(Object.entries(prefs).filter(([, v]) => v !== undefined)) };
  const root = document.documentElement;
  root.dataset.theme = resolvedTheme(merged.theme);
  if (merged.density === 'compact') root.dataset.density = 'compact';
  else delete root.dataset.density;
  if (merged.motion === 'reduced') root.dataset.motion = 'reduced';
  else delete root.dataset.motion;
  try {
    localStorage.setItem(KEY, JSON.stringify(merged));
  } catch {
    /* storage unavailable: appearance still applies for this session */
  }
}

/** Follow OS theme changes when the user chose "system". */
export function watchSystemTheme() {
  const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
  if (!mq) return () => {};
  const handler = () => {
    if ((readUiPrefs().theme ?? 'system') === 'system') applyUiPrefs({});
  };
  mq.addEventListener('change', handler);
  return () => mq.removeEventListener('change', handler);
}
