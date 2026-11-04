import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: true,
      retry: (count, err) => {
        const code = (err as { code?: string })?.code;
        if (code === '42501' || code === 'PGRST116') return false;
        return count < 2;
      },
    },
    mutations: { retry: 0 },
  },
});

/**
 * Query-key conventions
 *   ['p', projectId, ...]  — anything scoped to a project (invalidated by the change feed)
 *   ['ws', workspaceId, ...] — workspace-scoped
 *   ['me', ...]           — current-user data (profile, notifications, my work)
 *   ['global', ...]       — cross-project aggregates (calendar, search)
 */
export const qk = {
  me: ['me'] as const,
  profile: ['me', 'profile'] as const,
  workspaces: ['me', 'workspaces'] as const,
  invitations: ['me', 'invitations'] as const,
  workspace: (id: string) => ['ws', id] as const,
  wsPeople: (id: string) => ['ws', id, 'people'] as const,
  wsProjects: (id: string) => ['ws', id, 'projects'] as const,
  wsOrgs: (id: string) => ['ws', id, 'orgs'] as const,
  wsInvites: (id: string) => ['ws', id, 'invites'] as const,
  project: (id: string) => ['p', id] as const,
  projectPart: (id: string, part: string, ...rest: unknown[]) => ['p', id, part, ...rest] as const,
};
