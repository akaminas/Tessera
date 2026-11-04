import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Archive, CheckSquare, Copy, LayoutTemplate, MoreHorizontal, Pencil, RotateCcw, Tags, Trash2, SlidersHorizontal } from 'lucide-react';
import { Button, Field, IconButton, Input, Select, Tag, Textarea, LABEL_COLORS, LABEL_NAME } from '@/components/ui';
import { BOARD_BACKGROUNDS, boardBackground } from '@/domain/backgrounds';
import { Dialog, ConfirmDialog } from '@/components/ui/Dialog';
import { MenuContent, MenuItem, MenuRoot, MenuSeparator, MenuTrigger } from '@/components/ui/Menu';
import { useToast } from '@/components/ui/Toast';
import { deleteBoardPermanently, duplicateBoard, updateBoard } from '@/data/core';
import { createLabel, deleteLabel, fetchCard, setCardsArchived, updateLabel, updateList, trashCard } from '@/data/cards';
import { sb } from '@/lib/supabase';
import { must } from '@/data/errors';
import { useProjectCtx } from '@/features/project/context';
import type { Board, Card, Label, LabelColor, List } from '@/data/types';
import { cn } from '@/lib/cn';
import { CustomFieldsManager } from './CustomFieldsManager';


type Panel = null | 'edit' | 'labels' | 'fields' | 'archived' | 'duplicate' | 'delete';

export function BoardMenu({ board, labels, lists, onSelectTasks }: { board: Board; labels: Label[]; lists: List[]; onSelectTasks?: () => void }) {
  const { canEdit, canManage, project } = useProjectCtx();
  const [panel, setPanel] = useState<Panel>(null);
  const toast = useToast();
  const navigate = useNavigate();
  if (!canEdit) return null;
  const close = () => setPanel(null);

  return (
    <>
      <MenuRoot>
        <MenuTrigger asChild>
          <IconButton label="Board menu">
            <MoreHorizontal className="size-4" />
          </IconButton>
        </MenuTrigger>
        <MenuContent>
          {onSelectTasks && (
            <>
              <MenuItem icon={<CheckSquare className="size-4" />} onSelect={onSelectTasks}>
                Select several tasks
              </MenuItem>
              <MenuSeparator />
            </>
          )}
          <MenuItem icon={<Pencil className="size-4" />} onSelect={() => setPanel('edit')}>
            Name, description and background
          </MenuItem>
          <MenuItem icon={<Tags className="size-4" />} onSelect={() => setPanel('labels')}>
            Labels
          </MenuItem>
          <MenuItem icon={<SlidersHorizontal className="size-4" />} onSelect={() => setPanel('fields')}>
            Custom fields
          </MenuItem>
          <MenuItem icon={<RotateCcw className="size-4" />} onSelect={() => setPanel('archived')}>
            Archived and deleted items
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon={<Copy className="size-4" />} onSelect={() => setPanel('duplicate')}>
            Duplicate board
          </MenuItem>
          <MenuItem
            icon={<LayoutTemplate className="size-4" />}
            onSelect={() =>
              updateBoard(board, { is_template: !board.is_template })
                .then(() => toast.show(board.is_template ? 'No longer a template' : 'Saved as a board template for this project'))
                .catch(toast.error)
            }
          >
            {board.is_template ? 'Stop using as template' : 'Use as board template'}
          </MenuItem>
          <MenuItem
            icon={<Archive className="size-4" />}
            onSelect={async () => {
              try {
                const res = await updateBoard(board, { archived_at: new Date().toISOString() });
                toast.show(`Archived board “${board.name}”`, { undo: () => updateBoard(res, { archived_at: null }).then(() => undefined) });
                navigate(`/p/${project.id}`);
              } catch (err) {
                toast.error(err);
              }
            }}
          >
            Archive board
          </MenuItem>
          {canManage && (
            <MenuItem danger icon={<Trash2 className="size-4" />} onSelect={() => setPanel('delete')}>
              Delete board permanently
            </MenuItem>
          )}
        </MenuContent>
      </MenuRoot>

      {panel === 'edit' && <EditBoard board={board} onClose={close} />}
      {panel === 'labels' && <LabelsManager board={board} labels={labels} onClose={close} />}
      {panel === 'fields' && (
        <Dialog open onOpenChange={close} title="Custom fields" width={560}>
          <CustomFieldsManager board={board} />
        </Dialog>
      )}
      {panel === 'archived' && <ArchivedItems board={board} onClose={close} />}
      {panel === 'duplicate' && <DuplicateBoard board={board} onClose={close} />}
      <ConfirmDialog
        open={panel === 'delete'}
        onOpenChange={(o) => !o && close()}
        title="Delete this board?"
        danger
        confirmLabel="Delete permanently"
        body={
          <>
            <p>
              “{board.name}” and its {lists.length} lists, tasks, comments and checklists will be permanently deleted. This cannot be
              undone.
            </p>
            <p className="mt-2 text-secondary">Archiving keeps everything recoverable instead.</p>
          </>
        }
        onConfirm={async () => {
          try {
            await deleteBoardPermanently(board);
            navigate(`/p/${project.id}`);
          } catch (err) {
            toast.error(err);
          }
        }}
      />
    </>
  );
}

function EditBoard({ board, onClose }: { board: Board; onClose: () => void }) {
  const [name, setName] = useState(board.name);
  const [description, setDescription] = useState(board.description);
  const [background, setBackground] = useState(board.background);
  const toast = useToast();
  return (
    <Dialog
      open
      onOpenChange={onClose}
      title="Board settings"
      footer={
        <Button
          variant="primary"
          disabled={!name.trim()}
          onClick={() =>
            updateBoard(board, { name: name.trim(), description, background })
              .then(onClose)
              .catch(toast.error)
          }
        >
          Save
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Name" htmlFor="b-name">
          <Input id="b-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
        </Field>
        <Field label="Description" htmlFor="b-desc">
          <Textarea id="b-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
        </Field>
        <BackgroundPicker value={background} onChange={setBackground} />
        <p className="text-xs text-secondary">
          Photos from{' '}
          <a className="text-link underline" href="https://unsplash.com" target="_blank" rel="noreferrer">
            Unsplash
          </a>
          .
        </p>
      </div>
    </Dialog>
  );
}

/** Background grid: photos first, then gradients and patterns. */
export function BackgroundPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const current = boardBackground(value).id;
  const groups: { title: string; items: typeof BOARD_BACKGROUNDS }[] = [
    { title: 'Photos', items: BOARD_BACKGROUNDS.filter((b) => b.kind === 'photo') },
    { title: 'Colours and patterns', items: BOARD_BACKGROUNDS.filter((b) => b.kind !== 'photo') },
  ];
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-[13px] font-bold">Background</legend>
      {groups.map((g) => (
        <div key={g.title}>
          <p className="mb-1.5 text-xs text-secondary">{g.title}</p>
          <div className="grid grid-cols-4 gap-2">
            {g.items.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => onChange(o.id)}
                aria-pressed={current === o.id}
                aria-label={o.label}
                title={o.label}
                className={cn(
                  'h-12 rounded-[6px] border bg-clip-padding outline-none focus-visible:ring-2 focus-visible:ring-teal',
                  current === o.id ? 'border-transparent ring-2 ring-teal ring-offset-2 ring-offset-[var(--v-surface)]' : 'border-grid hover:opacity-90',
                )}
                style={o.swatch}
              />
            ))}
          </div>
        </div>
      ))}
    </fieldset>
  );
}

function LabelsManager({ board, labels, onClose }: { board: Board; labels: Label[]; onClose: () => void }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState<LabelColor>('moss');
  const toast = useToast();
  return (
    <Dialog open onOpenChange={onClose} title="Labels" width={480}>
      <ul className="mb-4 flex flex-col gap-2">
        {labels.map((l) => (
          <LabelRow key={l.id} label={l} />
        ))}
        {labels.length === 0 && <li className="text-sm text-secondary">No labels yet.</li>}
      </ul>
      <form
        className="flex flex-wrap items-end gap-2 border-t border-grid pt-3"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await createLabel(board.project_id, board.id, name.trim(), color);
            setName('');
          } catch (err) {
            toast.error(err);
          }
        }}
      >
        <Field label="New label" htmlFor="lbl-name" className="flex-1">
          <Input id="lbl-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        </Field>
        <Select value={color} onChange={(e) => setColor(e.target.value as LabelColor)} aria-label="Colour" className="w-32">
          {LABEL_COLORS.map((c) => (
            <option key={c} value={c}>
              {LABEL_NAME[c]}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="primary">
          Add
        </Button>
      </form>
      <p className="mt-3 text-xs text-secondary">A label can be just a colour. Naming it helps people who cannot tell the colours apart.</p>
    </Dialog>
  );
}

function LabelRow({ label }: { label: Label }) {
  const [name, setName] = useState(label.name);
  const toast = useToast();
  return (
    <li className="flex items-center gap-2">
      <Tag color={label.color} className="w-20 justify-center">
        {label.name || LABEL_NAME[label.color]}
      </Tag>
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name !== label.name && updateLabel(label, { name }).catch(toast.error)}
        className="h-8 flex-1"
        aria-label="Label name"
        maxLength={60}
      />
      <Select value={label.color} onChange={(e) => updateLabel(label, { color: e.target.value as LabelColor }).catch(toast.error)} className="h-8 w-28" aria-label="Label colour">
        {LABEL_COLORS.map((c) => (
          <option key={c} value={c}>
            {LABEL_NAME[c]}
          </option>
        ))}
      </Select>
      <IconButton label={`Delete label ${label.name}`} onClick={() => deleteLabel(label).catch(toast.error)}>
        <Trash2 className="size-4" />
      </IconButton>
    </li>
  );
}

function ArchivedItems({ board, onClose }: { board: Board; onClose: () => void }) {
  const toast = useToast();
  const q = useQuery({
    queryKey: ['p', board.project_id, 'archived', board.id],
    queryFn: async () => {
      const [cards, lists] = await Promise.all([
        sb().from('cards').select('*').eq('board_id', board.id).or('archived_at.not.is.null,deleted_at.not.is.null').order('updated_at', { ascending: false }),
        sb().from('lists').select('*').eq('board_id', board.id).not('archived_at', 'is', null),
      ]);
      return { cards: must(cards) as Card[], lists: must(lists) as List[] };
    },
  });
  return (
    <Dialog open onOpenChange={onClose} title="Archived and deleted items" width={600}>
      {q.isLoading && <p className="text-sm text-secondary">Loading…</p>}
      {q.data && q.data.lists.length + q.data.cards.length === 0 && <p className="text-sm text-secondary">Nothing archived on this board.</p>}
      {q.data && q.data.lists.length > 0 && (
        <>
          <h3 className="mb-1 text-sm">Lists</h3>
          <ul className="mb-4 flex flex-col divide-y divide-grid">
            {q.data.lists.map((l) => (
              <li key={l.id} className="flex items-center gap-2 py-1.5 text-sm">
                <span className="flex-1">{l.name}</span>
                <Button size="sm" onClick={() => updateList(l, { archived_at: null }).then(() => q.refetch()).catch(toast.error)}>
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
      {q.data && q.data.cards.length > 0 && (
        <>
          <h3 className="mb-1 text-sm">Tasks</h3>
          <ul className="flex flex-col divide-y divide-grid">
            {q.data.cards.map((c) => (
              <li key={c.id} className="flex items-center gap-2 py-1.5 text-sm">
                <span className="flex-1">
                  {c.title}
                  <span className="text-xs text-secondary"> · {c.deleted_at ? 'in trash' : 'archived'}</span>
                </span>
                <Button
                  size="sm"
                  onClick={async () => {
                    try {
                      const fresh = (await fetchCard(c.id))!;
                      if (fresh.deleted_at) await trashCard(fresh, false);
                      else await setCardsArchived([fresh], false);
                      q.refetch();
                    } catch (err) {
                      toast.error(err);
                    }
                  }}
                >
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Dialog>
  );
}

function DuplicateBoard({ board, onClose }: { board: Board; onClose: () => void }) {
  const [name, setName] = useState(`${board.name} (copy)`);
  const [withCards, setWithCards] = useState(true);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const navigate = useNavigate();
  return (
    <Dialog
      open
      onOpenChange={onClose}
      title="Duplicate board"
      width={420}
      footer={
        <Button
          variant="primary"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const id = await duplicateBoard(board.id, name, withCards);
              onClose();
              navigate(`/p/${board.project_id}/board/${id}`);
            } catch (err) {
              toast.error(err);
            } finally {
              setBusy(false);
            }
          }}
        >
          Duplicate
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Name" htmlFor="dup-name">
          <Input id="dup-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={withCards} onChange={(e) => setWithCards(e.target.checked)} className="accent-[var(--v-teal-deep)]" />
          Copy tasks, checklists and labels too
        </label>
      </div>
    </Dialog>
  );
}
