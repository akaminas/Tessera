import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Dialog } from '@/components/ui/Dialog';
import { Button, Field, Input, Select, PriorityMark } from '@/components/ui';
import { useToast } from '@/components/ui/Toast';
import { useWorkspaceCtx } from './WorkspaceContext';
import { ensurePersonalInbox } from '@/data/personal';
import { useAllProjects, useBoards, useBoardData } from '@/data/core';
import { createCard } from '@/data/cards';
import { keyAfterLast } from '@/domain/ordering';
import { parseQuickAdd } from '@/domain/quickParse';
import { sb } from '@/lib/supabase';
import { must } from '@/data/errors';
import { format, parseISO } from 'date-fns';

/**
 * Quick capture. Only a title is required; by default the task lands in the
 * user's private Inbox for later triage.
 */
export function QuickAddDialog({
  open,
  onOpenChange,
  defaultProjectId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  defaultProjectId?: string;
}) {
  const { current } = useWorkspaceCtx();
  const [title, setTitle] = useState('');
  const [dest, setDest] = useState<string>('inbox');
  const [boardId, setBoardId] = useState<string>('');
  const [listId, setListId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const navigate = useNavigate();
  const projects = useAllProjects(open);
  const boards = useBoards(dest !== 'inbox' ? dest : undefined);
  const boardData = useBoardData(dest !== 'inbox' ? dest : undefined, boardId || undefined);
  const parsed = useMemo(() => parseQuickAdd(title), [title]);

  useEffect(() => {
    if (open) {
      setTitle('');
      setDest(defaultProjectId ?? 'inbox');
    }
  }, [open, defaultProjectId]);
  useEffect(() => {
    const b = boards.data?.find((x) => !x.archived_at);
    setBoardId(b?.id ?? '');
  }, [boards.data]);
  useEffect(() => {
    setListId(boardData.data?.lists[0]?.id ?? '');
  }, [boardData.data]);

  const submit = async (openAfter: boolean) => {
    if (!parsed.title.trim() || !current) return;
    setBusy(true);
    try {
      let target: { project_id: string; board_id: string; list_id: string };
      if (dest === 'inbox') target = await ensurePersonalInbox(current.id);
      else target = { project_id: dest, board_id: boardId, list_id: listId };
      if (!target.list_id) throw new Error('Choose a list for the task.');
      const siblings = must(await sb().from('cards').select('id, position').eq('list_id', target.list_id)) as { id: string; position: string }[];
      const card = await createCard({
        ...target,
        title: parsed.title.trim(),
        position: keyAfterLast(siblings),
        due_date: parsed.due_date,
        priority: parsed.priority,
      });
      toast.show(dest === 'inbox' ? 'Added to your Inbox' : 'Task added');
      setTitle('');
      if (openAfter) {
        onOpenChange(false);
        navigate(`/p/${target.project_id}/board/${target.board_id}?card=${card.id}`);
      }
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const ownProjects = (projects.data ?? []).filter((p) => p.workspace_id === current?.id && !p.personal_owner);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add a task"
      description="Only a title is needed. Try “Send report fri !high”."
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={() => submit(true)} disabled={!parsed.title.trim()} loading={busy}>
            Add and open
          </Button>
          <Button variant="primary" onClick={() => submit(false)} disabled={!parsed.title.trim()} loading={busy}>
            Add task
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit(false);
        }}
      >
        <Input autoFocus aria-label="Task title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs doing?" maxLength={500} />
        {(parsed.due_date || parsed.priority !== 'none') && (
          <p className="flex items-center gap-3 text-xs text-secondary">
            {parsed.due_date && <span>Due {format(parseISO(parsed.due_date), 'EEE d MMM yyyy')}</span>}
            <PriorityMark priority={parsed.priority} withLabel />
          </p>
        )}
        <Field label="Where" htmlFor="qa-dest">
          <Select id="qa-dest" value={dest} onChange={(e) => setDest(e.target.value)}>
            <option value="inbox">My Inbox (private)</option>
            {ownProjects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        {dest !== 'inbox' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Board" htmlFor="qa-board">
              <Select id="qa-board" value={boardId} onChange={(e) => setBoardId(e.target.value)}>
                {(boards.data ?? []).filter((b) => !b.archived_at).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="List" htmlFor="qa-list">
              <Select id="qa-list" value={listId} onChange={(e) => setListId(e.target.value)}>
                {(boardData.data?.lists ?? []).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
