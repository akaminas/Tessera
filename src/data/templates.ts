import { useQuery } from '@tanstack/react-query';
import { sb } from '@/lib/supabase';
import { must } from './errors';
import { queryClient } from './queryClient';
import type { Blueprint } from '@/domain/templates';

export interface SavedTemplate {
  id: string;
  workspace_id: string;
  name: string;
  category: string;
  description: string;
  blueprint: Blueprint;
  created_by: string | null;
  created_at: string;
}

export function useWorkspaceTemplates(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ['ws', workspaceId ?? '', 'templates'],
    enabled: Boolean(workspaceId),
    queryFn: async () => must(await sb().from('project_templates').select('*').eq('workspace_id', workspaceId!).order('name')) as SavedTemplate[],
  });
}

/** Apply a blueprint to a (new) project, atomically on the server. */
export async function applyBlueprint(projectId: string, blueprint: Blueprint, startDate: string | null) {
  must(await sb().rpc('apply_blueprint', { p_project: projectId, p_blueprint: blueprint, p_start: startDate }));
  queryClient.invalidateQueries({ queryKey: ['p', projectId] });
}

/** Save an existing project as a reusable template for the workspace. */
export async function saveProjectAsTemplate(projectId: string, workspaceId: string, name: string, category: string, description: string) {
  const blueprint = must(await sb().rpc('project_to_blueprint', { p_project: projectId })) as Blueprint;
  must(await sb().from('project_templates').insert({ workspace_id: workspaceId, name, category, description, blueprint }));
  queryClient.invalidateQueries({ queryKey: ['ws', workspaceId, 'templates'] });
}

export async function deleteTemplate(t: SavedTemplate) {
  must(await sb().from('project_templates').delete().eq('id', t.id));
  queryClient.invalidateQueries({ queryKey: ['ws', t.workspace_id, 'templates'] });
}
