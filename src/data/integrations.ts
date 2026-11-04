import { useQuery } from '@tanstack/react-query';
import { sb } from '@/lib/supabase';
import { must } from './errors';
import { queryClient } from './queryClient';
import { appUrl, env } from '@/lib/env';
import { encodeConnection } from '../../integrations/obsidian/src/connection';

export interface IntegrationKey {
  id: string;
  name: string;
  hint: string;
  created_at: string;
  last_used_at: string | null;
}

const KEY = ['me', 'integration-keys'];

export function useIntegrationKeys() {
  return useQuery({
    queryKey: KEY,
    queryFn: async () =>
      must(await sb().from('integration_tokens').select('id,name,hint,created_at,last_used_at').order('created_at', { ascending: false })) as IntegrationKey[],
  });
}

/**
 * Create an access key. Returns the connection code for the Obsidian plugin;
 * it contains the key, which Tessera never shows again.
 */
export async function createIntegrationKey(name: string): Promise<string> {
  const token = must(await sb().rpc('create_integration_token', { p_name: name })) as string;
  queryClient.invalidateQueries({ queryKey: KEY });
  return encodeConnection({
    url: env.supabaseUrl,
    anonKey: env.supabaseAnonKey,
    token,
    site: appUrl('').replace(/\/+$/, ''),
  });
}

export async function deleteIntegrationKey(id: string) {
  must(await sb().from('integration_tokens').delete().eq('id', id));
  queryClient.invalidateQueries({ queryKey: KEY });
}
