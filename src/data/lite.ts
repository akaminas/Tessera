import { useQuery } from '@tanstack/react-query';
import { sb } from '@/lib/supabase';
import { must } from './errors';
import { qk } from './queryClient';

/** Minimal work-package list for pickers and filters. */
export function useWorkPackagesLite(projectId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: qk.projectPart(projectId ?? '', 'wp-lite'),
    enabled: Boolean(projectId) && enabled,
    queryFn: async () =>
      must(await sb().from('work_packages').select('id, code, name').eq('project_id', projectId!).is('deleted_at', null).order('position')) as {
        id: string;
        code: string;
        name: string;
      }[],
  });
}

export function useMilestonesLite(projectId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: qk.projectPart(projectId ?? '', 'ms-lite'),
    enabled: Boolean(projectId) && enabled,
    queryFn: async () =>
      must(await sb().from('milestones').select('id, code, title, due_date, status').eq('project_id', projectId!).is('deleted_at', null).order('due_date')) as {
        id: string;
        code: string;
        title: string;
        due_date: string | null;
        status: string;
      }[],
  });
}
