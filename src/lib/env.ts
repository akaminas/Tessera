/** Public runtime configuration (safe to ship in the browser bundle). */
export const env = {
  supabaseUrl: (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() || '',
  supabaseAnonKey: (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() || '',
  basePath: import.meta.env.BASE_URL || '/',
};

export const isBackendConfigured = Boolean(env.supabaseUrl && env.supabaseAnonKey);

/** Absolute URL to a route inside the app (handles the GitHub Pages subpath). */
export function appUrl(path: string): string {
  const base = env.basePath.endsWith('/') ? env.basePath : env.basePath + '/';
  return window.location.origin + base + path.replace(/^\//, '');
}
