import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Dialog } from '@/components/ui/Dialog';
import { Button, Field, Input, Select } from '@/components/ui';
import { useToast } from '@/components/ui/Toast';
import { createBoard, duplicateBoard } from '@/data/core';
import { keyAfterLast } from '@/domain/ordering';
import { BOARD_TEMPLATES } from '@/domain/templates';
import type { Board } from '@/data/types';
import { DEFAULT_BACKGROUND, boardBackground } from '@/domain/backgrounds';
import { BackgroundPicker } from './BoardMenu';

export function NewBoardDialog({
  open,
  onOpenChange,
  projectId,
  boards,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  projectId: string;
  boards: Board[];
}) {
  const [name, setName] = useState('');
  const [source, setSource] = useState('kanban');
  const [background, setBackground] = useState(DEFAULT_BACKGROUND);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const navigate = useNavigate();
  const templateBoards = boards.filter((b) => b.is_template && !b.deleted_at);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Create board"
      width={480}
      footer={
        <Button
          variant="primary"
          loading={busy}
          disabled={!name.trim()}
          onClick={async () => {
            setBusy(true);
            try {
              let id: string;
              if (source.startsWith('board:')) {
                id = await duplicateBoard(source.slice(6), name.trim(), true);
              } else {
                const tpl = BOARD_TEMPLATES.find((t) => t.id === source) ?? BOARD_TEMPLATES[0];
                const b = await createBoard(projectId, name.trim(), keyAfterLast(boards), tpl.lists, background);
                id = b.id;
              }
              onOpenChange(false);
              setName('');
              navigate(`/p/${projectId}/board/${id}`);
            } catch (err) {
              toast.error(err);
            } finally {
              setBusy(false);
            }
          }}
        >
          Create board
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        {/* A small preview of the board, as in Trello's create dialog. */}
        <div className="mx-auto flex h-24 w-56 items-start justify-center gap-1.5 rounded-[6px] pt-3" style={boardBackground(background).style} aria-hidden>
          {[0, 1, 2].map((i) => (
            <span key={i} className="h-12 w-12 rounded-[4px] bg-white/80" style={{ height: 48 - i * 10 }} />
          ))}
        </div>
        {!source.startsWith('board:') && <BackgroundPicker value={background} onChange={setBackground} />}
        <Field label="Board title" htmlFor="nb-name">
          <Input id="nb-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
        </Field>
        <Field label="Start from" htmlFor="nb-src">
          <Select id="nb-src" value={source} onChange={(e) => setSource(e.target.value)}>
            <optgroup label="Layouts">
              {BOARD_TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}: {t.lists.join(' → ')}
                </option>
              ))}
            </optgroup>
            {templateBoards.length > 0 && (
              <optgroup label="Board templates in this project">
                {templateBoards.map((b) => (
                  <option key={b.id} value={`board:${b.id}`}>
                    {b.name}
                  </option>
                ))}
              </optgroup>
            )}
          </Select>
        </Field>
      </div>
    </Dialog>
  );
}
