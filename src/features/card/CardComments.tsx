import { useState } from 'react';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { History, MessageSquare } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { addComment, deleteComment, editComment, useActivity, useComments } from '@/data/core';
import type { Card, Comment } from '@/data/types';
import { Avatar, Button } from '@/components/ui';
import { Markdown } from '@/components/ui/Markdown';
import { useToast } from '@/components/ui/Toast';
import { MentionInput, extractMentions } from '@/components/MentionInput';
import type { ProjectCtx } from '@/features/project/context';

export function CommentsAndActivity({ card, ctx }: { card: Card; ctx: ProjectCtx }) {
  const [showActivity, setShowActivity] = useState(false);
  const comments = useComments(card.project_id, card.id);
  const activity = useActivity({ projectId: card.project_id, cardId: card.id }, 100);
  const { user } = useAuth();
  const toast = useToast();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const person = (id: string | null) => ctx.people.find((p) => p.user_id === id);

  const submit = async () => {
    if (!draft.trim()) return;
    setBusy(true);
    try {
      await addComment(card.project_id, card.id, draft.trim(), extractMentions(draft));
      setDraft('');
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  type Entry = { kind: 'comment'; at: string; c: Comment } | { kind: 'activity'; at: string; summary: string; actor: string | null; id: number };
  const entries: Entry[] = [
    ...(comments.data ?? []).map((c) => ({ kind: 'comment' as const, at: c.created_at, c })),
    ...(showActivity
      ? (activity.data ?? []).filter((a) => a.entity_type !== 'comment').map((a) => ({ kind: 'activity' as const, at: a.created_at, summary: a.summary, actor: a.actor_id, id: a.id }))
      : []),
  ].sort((a, b) => (a.at < b.at ? 1 : -1));

  return (
    <section aria-label="Comments and activity">
      <div className="mb-2 flex items-center gap-2">
        <MessageSquare className="size-4 text-secondary" aria-hidden />
        <h3 className="flex-1 text-sm">Comments</h3>
        <Button size="sm" variant="ghost" icon={<History className="size-3.5" />} onClick={() => setShowActivity((v) => !v)} aria-pressed={showActivity}>
          {showActivity ? 'Hide history' : 'Show history'}
        </Button>
      </div>
      {ctx.canEdit && (
        <div className="mb-3 flex flex-col gap-1.5">
          <MentionInput value={draft} onChange={setDraft} people={ctx.people} placeholder="Write a comment. Type @ to mention someone." onSubmit={submit} rows={2} />
          {draft.trim() && (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="primary" loading={busy} onClick={submit}>
                Comment
              </Button>
              <span className="text-xs text-secondary">Ctrl+Enter to send. Mentioned people are notified.</span>
            </div>
          )}
        </div>
      )}
      <ol className="flex flex-col gap-3">
        {entries.map((e) =>
          e.kind === 'comment' ? (
            <CommentItem key={e.c.id} comment={e.c} author={person(e.c.author_id)} mine={e.c.author_id === user?.id} canModerate={ctx.canManage} ctx={ctx} />
          ) : (
            <li key={`a${e.id}`} className="flex gap-2 text-xs text-secondary">
              <span className="w-6 shrink-0" />
              <span>
                <b className="text-ink">{person(e.actor)?.display_name ?? 'Someone'}</b> {e.summary} ·{' '}
                <time dateTime={e.at}>{formatDistanceToNow(parseISO(e.at), { addSuffix: true })}</time>
              </span>
            </li>
          ),
        )}
        {entries.length === 0 && <li className="text-sm text-secondary">No comments yet.</li>}
      </ol>
    </section>
  );
}

function CommentItem({
  comment,
  author,
  mine,
  canModerate,
  ctx,
}: {
  comment: Comment;
  author?: { display_name: string; avatar_color: import('@/data/types').Family };
  mine: boolean;
  canModerate: boolean;
  ctx: ProjectCtx;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const toast = useToast();
  return (
    <li className="flex gap-2">
      <Avatar name={author?.display_name ?? 'Former member'} color={author?.avatar_color ?? 'teal'} size={24} />
      <div className="min-w-0 flex-1">
        <p className="text-xs">
          <b>{author?.display_name ?? 'Former member'}</b>{' '}
          <time className="text-secondary" dateTime={comment.created_at} title={new Date(comment.created_at).toLocaleString()}>
            {formatDistanceToNow(parseISO(comment.created_at), { addSuffix: true })}
          </time>
          {comment.edited_at && <span className="text-secondary"> · edited</span>}
        </p>
        {editing ? (
          <div className="mt-1 flex flex-col gap-1.5">
            <MentionInput value={draft} onChange={setDraft} people={ctx.people} rows={3} ariaLabel="Edit comment" />
            <div className="flex gap-1.5">
              <Button
                size="sm"
                variant="primary"
                onClick={() =>
                  editComment(comment, draft.trim(), extractMentions(draft))
                    .then(() => setEditing(false))
                    .catch(toast.error)
                }
              >
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-0.5 rounded-[4px] border border-grid bg-card px-2.5 py-1.5">
            <Markdown source={comment.body} />
          </div>
        )}
        {(mine || canModerate) && !editing && (
          <div className="mt-0.5 flex gap-2 text-xs">
            {mine && (
              <button className="text-secondary hover:text-ink hover:underline" onClick={() => setEditing(true)}>
                Edit
              </button>
            )}
            <button
              className="text-secondary hover:text-critical hover:underline"
              onClick={async () => {
                try {
                  await deleteComment(comment);
                  toast.show('Comment deleted');
                } catch (err) {
                  toast.error(err);
                }
              }}
            >
              Delete
            </button>
          </div>
        )}
      </div>
    </li>
  );
}
