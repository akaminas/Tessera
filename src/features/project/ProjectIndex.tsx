import { Navigate } from 'react-router';
import { useBoards } from '@/data/core';
import { PageLoading } from '@/components/ui';
import { useProjectCtx } from './context';
import ProjectOverview from './ProjectOverview';

/**
 * Opening a project shows its board, as opening a board does in Trello.
 * Projects without a board (or with the board switched off) show the overview.
 */
export default function ProjectIndex() {
  const { project } = useProjectCtx();
  const boards = useBoards(project.id);
  if (boards.isLoading) return <PageLoading />;
  const first = project.modules.includes('board') ? (boards.data ?? []).find((b) => !b.archived_at && !b.is_template) : undefined;
  if (first) return <Navigate to={`board/${first.id}`} replace />;
  return <ProjectOverview />;
}
