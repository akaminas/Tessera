import { useEffect, useState } from 'react';
import { Navigate, useParams } from 'react-router';
import { fetchCard } from '@/data/cards';
import { PageLoading } from '@/components/ui';

/** Stable card links (/c/:id) resolve to the card on its board. */
export default function CardRedirect() {
  const { cardId } = useParams();
  const [target, setTarget] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    fetchCard(cardId!)
      .then((c) => (c ? setTarget(`/p/${c.project_id}/board/${c.board_id}?card=${c.id}`) : setMissing(true)))
      .catch(() => setMissing(true));
  }, [cardId]);
  if (missing)
    return (
      <div className="mx-auto max-w-lg px-4 py-12">
        <h1 className="text-2xl">Task not found</h1>
        <p className="mt-2 text-sm text-secondary">It may have been deleted, or you do not have access to its project.</p>
      </div>
    );
  if (target) return <Navigate to={target} replace />;
  return <PageLoading />;
}
