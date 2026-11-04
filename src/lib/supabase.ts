import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env, isBackendConfigured } from './env';

let client: SupabaseClient | null = null;

/** The shared Supabase client. Throws if the backend is not configured. */
export function sb(): SupabaseClient {
  if (!client) {
    if (!isBackendConfigured) throw new Error('Backend is not configured');
    client = createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      realtime: { params: { eventsPerSecond: 20 } },
    });
  }
  return client;
}
