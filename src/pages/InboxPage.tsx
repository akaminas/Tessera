import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { Bell, CheckCheck, Inbox as InboxIcon, Mail, Trash2 } from 'lucide-react';
import { acceptInvitation, useAllProjects, useBoardData, useBoards, useMyInvitations } from '@/data/core';
import { deleteNotification, markNotificationUnread, markNotificationsRead, useNotifications, usePersonalInbox } from '@/data/personal';
import { keyAfterLast } from '@/domain/ordering';
import { sb } from '@/lib/supabase';
import { must } from '@/data/errors';
import { Button, Checkbox, EmptyState, IconButton, PageHeader, PageLoading, Select } from '@/components/ui';
import { Dialog } from '@/components/ui/Dialog';
import { useToast } from '@/components/ui/Toast';
import { useWorkspaceCtx } from '@/layout/WorkspaceContext';
import { cn } from '@/lib/cn';
import type { CardWithRelations } from '@/data/types';

type Tab = 'notifications' | 'captured' | 'invitations';

export default function InboxPage() {
  const [tab, setTab] = useState<Tab>('notifications');
  const notifications = useNotifications();
  const invitations = useMyInvitations(true);
  const { current, setCurrent } = useWorkspaceCtx();
  const inbox = usePersonalInbox(current?.id);
  const board = useBoardData(inbox.data?.project_id, inbox.data?.board_id);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const toast = useToast();
  const navigate = useNavigate();
  const [triage, setTriage] = useState<CardWithRelations | null>(null);

  const list = useMemo(() => (notifications.data ?? []).filter((n) => !unreadOnly || !n.read_at), [notifications.data, unreadOnly]);
  const unread = (notifications.data ?? []).filter((n) => !n.read_at).length;
  const captured = (board.data?.cards ?? []).filter((c) => c.list_id === inbox.data?.list_id && c.status !== 'done');

  const tabs: { id: Tab; label: string; count: number; icon: React.ReactNode }[] = [
    { id: 'notifications', label: 'Notifications', count: unread, icon: <Bell className="size-4" /> },
    { id: 'captured', label: 'Captured tasks', count: captured.length, icon: <InboxIcon className="size-4" /> },
    { id: 'invitations', label: 'Invitations', count: invitations.data?.length ?? 0, icon: <Mail className="size-4" /> },
  ];

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6 sm:px-6">
      <PageHeader title="Inbox" subtitle="Notifications, quick captures waiting to be sorted, and invitations." />
      <div role="tablist" className="flex gap-1 border-b border-grid">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn('-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm', tab === t.id ? 'border-teal-deep font-bold' : 'border-transparent text-secondary hover:text-ink')}
          >
            {t.icon}
            {t.label}
            {t.count > 0 && <span className="num text-xs text-secondary">{t.count}</span>}
          </button>
        ))}
      </div>

      {tab === 'notifications' && (
        <section role="tabpanel" className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <Checkbox checked={unreadOnly} onChange={setUnreadOnly} label="Unread only" />
            {unread > 0 && (
              <Button size="sm" variant="ghost" icon={<CheckCheck className="size-4" />} onClick={() => markNotificationsRead('all').catch(toast.error)} className="ml-auto">
                Mark all as read
              </Button>
            )}
          </div>
          {notifications.isLoading && <PageLoading />}
          {!notifications.isLoading && list.length === 0 && <EmptyState title="You are all caught up">New assignments, mentions and reminders appear here.</EmptyState>}
          <ul className="flex flex-col divide-y divide-grid">
            {list.map((n) => (
              <li key={n.id} className={cn('flex items-start gap-3 py-2.5', !n.read_at && 'font-bold')}>
                <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', n.read_at ? 'bg-transparent' : 'bg-teal')} aria-label={n.read_at ? undefined : 'Unread'} />
                <div className="min-w-0 flex-1">
                  <button
                    className="text-left text-sm hover:underline"
                    onClick={async () => {
                      if (!n.read_at) await markNotificationsRead([n.id]).catch(() => {});
                      if (n.card_id) navigate(`/c/${n.card_id}`);
                      else if (n.project_id) navigate(`/p/${n.project_id}`);
                    }}
                  >
                    {n.title}
                  </button>
                  {n.body && <p className="line-clamp-2 text-xs font-normal text-secondary">{n.body.replace(/@\[([^\]]+)\]\(user:[^)]+\)/g, '@$1')}</p>}
                  <p className="text-xs font-normal text-muted">{formatDistanceToNow(parseISO(n.created_at), { addSuffix: true })}</p>
                </div>
                <div className="flex shrink-0 gap-0.5 font-normal">
                  {n.read_at ? (
                    <Button size="sm" variant="ghost" onClick={() => markNotificationUnread(n.id).catch(toast.error)}>
                      Mark unread
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => markNotificationsRead([n.id]).catch(toast.error)}>
                      Mark read
                    </Button>
                  )}
                  <IconButton label="Delete notification" onClick={() => deleteNotification(n.id).catch(toast.error)}>
                    <Trash2 className="size-4" />
                  </IconButton>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === 'captured' && (
        <section role="tabpanel" className="flex flex-col gap-3">
          <p className="text-sm text-secondary">Tasks added with quick capture land here. Move each one to a project, schedule it, or open it.</p>
          {captured.length === 0 && <EmptyState title="Nothing to sort">Press q anywhere to capture a task.</EmptyState>}
          <ul className="flex flex-col divide-y divide-grid">
            {captured.map((c) => (
              <li key={c.id} className="flex items-center gap-3 py-2">
                <Link className="min-w-0 flex-1 truncate text-sm hover:underline" to={`/p/${c.project_id}/board/${c.board_id}?card=${c.id}`}>
                  {c.title}
                </Link>
                <Button size="sm" onClick={() => setTriage(c)}>
                  Move to project
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === 'invitations' && (
        <section role="tabpanel" className="flex flex-col gap-3">
          {(invitations.data ?? []).length === 0 && <EmptyState title="No pending invitations" />}
          <ul className="flex flex-col divide-y divide-grid">
            {(invitations.data ?? []).map((i) => (
              <li key={i.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="flex-1">
                  <b>{i.workspace_name}</b>
                  {i.project_name && <> · {i.project_name}</>}
                  <span className="text-secondary"> · {i.invited_by_name ?? 'someone'} invited you as {i.project_role ?? i.role}</span>
                </span>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={async () => {
                    try {
                      const ws = await acceptInvitation(i.token);
                      setCurrent(ws);
                      navigate(i.project_id ? `/p/${i.project_id}` : '/');
                    } catch (err) {
                      toast.error(err);
                    }
                  }}
                >
                  Accept
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {triage && <TriageDialog card={triage} onClose={() => setTriage(null)} />}
    </div>
  );
}

function TriageDialog({ card, onClose }: { card: CardWithRelations; onClose: () => void }) {
  const projects = useAllProjects();
  const { current } = useWorkspaceCtx();
  const [projectId, setProjectId] = useState('');
  const boards = useBoards(projectId || undefined);
  const [boardId, setBoardId] = useState('');
  const data = useBoardData(projectId || undefined, boardId || undefined);
  const [listId, setListId] = useState('');
  const toast = useToast();
  const options = (projects.data ?? []).filter((p) => p.workspace_id === current?.id && !p.personal_owner);
  return (
    <Dialog
      open
      onOpenChange={onClose}
      title={`Move “${card.title}”`}
      width={440}
      footer={
        <Button
          variant="primary"
          disabled={!listId}
          onClick={async () => {
            try {
              const siblings = must(await sb().from('cards').select('id, position').eq('list_id', listId)) as { id: string; position: string }[];
              // Moving between projects: create in target and archive the capture (keeps history in the personal project).
              const { createCard, setCardsArchived } = await import('@/data/cards');
              await createCard({
                project_id: projectId,
                board_id: boardId,
                list_id: listId,
                title: card.title,
                description: card.description,
                due_date: card.due_date,
                start_date: card.start_date,
                priority: card.priority,
                position: keyAfterLast(siblings),
              });
              await setCardsArchived([card], true);
              toast.show('Moved to project');
              onClose();
            } catch (err) {
              toast.error(err);
            }
          }}
        >
          Move
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <Select value={projectId} onChange={(e) => (setProjectId(e.target.value), setBoardId(''), setListId(''))} aria-label="Project">
          <option value="">Choose a project</option>
          {options.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        {projectId && (
          <Select value={boardId} onChange={(e) => (setBoardId(e.target.value), setListId(''))} aria-label="Board">
            <option value="">Choose a board</option>
            {(boards.data ?? []).filter((b) => !b.archived_at).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        )}
        {boardId && (
          <Select value={listId} onChange={(e) => setListId(e.target.value)} aria-label="List">
            <option value="">Choose a list</option>
            {(data.data?.lists ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        )}
        <p className="text-xs text-secondary">The task is copied into the project and the private capture is archived. Assignees are not copied because the personal project is private.</p>
      </div>
    </Dialog>
  );
}

