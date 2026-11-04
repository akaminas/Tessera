import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, CornerDownRight, ExternalLink, FileText, GitBranch, Link2, Paperclip, Plus, Trash2, Upload, Eye, EyeOff, Clock } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { generateKeyBetween } from 'fractional-indexing';
import { useAuth } from '@/auth/AuthProvider';
import {
  addCardLink,
  addChecklistItems,
  addDependency,
  addLinkAttachment,
  deleteChecklist,
  deleteChecklistItem,
  deleteTimeEntry,
  linkKind,
  logTime,
  openAttachment,
  promoteItemToCard,
  removeAttachment,
  removeCardLink,
  removeDependency,
  setFieldValue,
  updateChecklist,
  updateChecklistItem,
  uploadAttachment,
  useAttachments,
  useCardLinks,
  useCardTime,
  useCustomFields,
  useDependencies,
  useFieldValues,
  useSubtasks,
  type Checklist,
  type ChecklistItem,
} from '@/data/cardExtras';
import { createCard, updateCard } from '@/data/cards';
import { sb } from '@/lib/supabase';
import { must } from '@/data/errors';
import { qk } from '@/data/queryClient';
import type { Card, CardWithRelations, Person } from '@/data/types';
import { Avatar, Button, IconButton, Input, Select, StatusPill } from '@/components/ui';
import { Popover } from '@/components/ui/Menu';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';
import { keyAfterLast, keysAfter, sortByPosition } from '@/domain/ordering';
import type { ProjectCtx } from '@/features/project/context';
import { GitHubLinkStatus } from '@/features/automation/GitHubLinkStatus';

function SectionTitle({ icon, children, actions }: { icon: React.ReactNode; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-1.5 flex items-center gap-2">
      <span className="text-secondary">{icon}</span>
      <h3 className="flex-1 text-sm">{children}</h3>
      {actions}
    </div>
  );
}

/* =============================================================== Checklists */

export function ChecklistsSection({
  card,
  canEdit,
  people,
  data,
}: {
  card: Card;
  canEdit: boolean;
  people: Person[];
  data: { checklists: Checklist[]; items: ChecklistItem[] } | undefined;
}) {
  if (!data || data.checklists.length === 0) return null;
  return (
    <>
      {sortByPosition(data.checklists).map((cl) => (
        <ChecklistBlock key={cl.id} checklist={cl} items={data.items.filter((i) => i.checklist_id === cl.id)} card={card} canEdit={canEdit} people={people} />
      ))}
    </>
  );
}

function ChecklistBlock({ checklist, items, card, canEdit, people }: { checklist: Checklist; items: ChecklistItem[]; card: Card; canEdit: boolean; people: Person[] }) {
  const toast = useToast();
  const [title, setTitle] = useState(checklist.title);
  const done = items.filter((i) => i.done).length;
  const pct = items.length ? Math.round((done / items.length) * 100) : 0;
  const roots = sortByPosition(items.filter((i) => !i.parent_item_id));
  const childrenOf = (id: string) => sortByPosition(items.filter((i) => i.parent_item_id === id));

  return (
    <section aria-label={`Checklist ${checklist.title}`}>
      <div className="mb-1 flex items-center gap-2">
        <input
          value={title}
          disabled={!canEdit}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() && title !== checklist.title && updateChecklist(checklist, { title: title.trim() }).catch(toast.error)}
          className="min-w-0 flex-1 rounded-[3px] border border-transparent bg-transparent px-1 text-sm font-bold hover:border-grid focus:border-teal focus:outline-none"
          aria-label="Checklist title"
        />
        <span className="num text-xs text-secondary">
          {done}/{items.length}
        </span>
        <IconButton label={checklist.hide_done ? 'Show checked items' : 'Hide checked items'} onClick={() => updateChecklist(checklist, { hide_done: !checklist.hide_done }).catch(toast.error)}>
          {checklist.hide_done ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
        </IconButton>
        {canEdit && (
          <IconButton label="Delete checklist" onClick={() => deleteChecklist(checklist).catch(toast.error)}>
            <Trash2 className="size-4" />
          </IconButton>
        )}
      </div>
      <div className="mb-2 h-1 w-full rounded-full bg-grid" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Checklist progress">
        <div className={cn('h-1 rounded-full', pct === 100 ? 'bg-moss' : 'bg-teal')} style={{ width: `${pct}%` }} />
      </div>
      <ul className="flex flex-col">
        {roots.map((it) => (
          <ItemRow key={it.id} item={it} depth={0} childrenOf={childrenOf} checklist={checklist} card={card} canEdit={canEdit} people={people} />
        ))}
      </ul>
      {canEdit && <AddItems checklist={checklist} siblings={roots} parentId={null} />}
    </section>
  );
}

function ItemRow({
  item,
  depth,
  childrenOf,
  checklist,
  card,
  canEdit,
  people,
}: {
  item: ChecklistItem;
  depth: number;
  childrenOf: (id: string) => ChecklistItem[];
  checklist: Checklist;
  card: Card;
  canEdit: boolean;
  people: Person[];
}) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [addingSub, setAddingSub] = useState(false);
  const kids = childrenOf(item.id);
  const assignee = people.find((p) => p.user_id === item.assignee_id);
  if (checklist.hide_done && item.done) return null;
  return (
    <li>
      <div className="group flex items-start gap-2 rounded-[3px] py-0.5 pr-1 hover:bg-hover" style={{ paddingLeft: depth * 20 }}>
        <input
          type="checkbox"
          className="mt-1 size-4 shrink-0 accent-[var(--v-teal-deep)]"
          checked={item.done}
          disabled={!canEdit}
          onChange={(e) => updateChecklistItem(item, { done: e.target.checked }).catch(toast.error)}
          aria-label={`${item.done ? 'Uncheck' : 'Check'} ${item.title}`}
        />
        {editing ? (
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => {
              setEditing(false);
              if (title.trim() && title !== item.title) updateChecklistItem(item, { title: title.trim() }).catch(toast.error);
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') {
                setTitle(item.title);
                setEditing(false);
              }
            }}
            className="h-7 flex-1 rounded-[3px] border border-teal bg-surface px-1 text-sm focus:outline-none"
            aria-label="Item title"
          />
        ) : (
          <span
            className={cn('flex-1 text-sm', item.done && 'text-secondary line-through decoration-rule')}
            onClick={() => canEdit && setEditing(true)}
          >
            {item.title}
          </span>
        )}
        {item.due_date && <span className="num text-xs text-secondary">{format(parseISO(item.due_date), 'd MMM')}</span>}
        {assignee && <Avatar name={assignee.display_name} color={assignee.avatar_color} size={18} />}
        {canEdit && (
          <span className="invisible flex items-center gap-0.5 group-hover:visible group-focus-within:visible">
            <Popover
              trigger={
                <IconButton label="Assign or set a date for this item">
                  <Clock className="size-3.5" />
                </IconButton>
              }
            >
              <div className="flex flex-col gap-2">
                <label className="text-xs font-bold">
                  Assignee
                  <Select
                    value={item.assignee_id ?? ''}
                    onChange={(e) => updateChecklistItem(item, { assignee_id: e.target.value || null }).catch(toast.error)}
                    className="mt-0.5 h-8"
                  >
                    <option value="">Nobody</option>
                    {people.map((p) => (
                      <option key={p.user_id} value={p.user_id}>
                        {p.display_name}
                      </option>
                    ))}
                  </Select>
                </label>
                <label className="text-xs font-bold">
                  Due date
                  <Input
                    type="date"
                    value={item.due_date ?? ''}
                    onChange={(e) => updateChecklistItem(item, { due_date: e.target.value || null }).catch(toast.error)}
                    className="mt-0.5 h-8"
                  />
                </label>
              </div>
            </Popover>
            {depth < 3 && (
              <IconButton label="Add a sub-step" onClick={() => setAddingSub(true)}>
                <CornerDownRight className="size-3.5" />
              </IconButton>
            )}
            <IconButton
              label="Convert to a subtask"
              onClick={async () => {
                try {
                  const siblings = must(await sb().from('cards').select('id, position').eq('list_id', card.list_id)) as { id: string; position: string }[];
                  await promoteItemToCard(item, card, keyAfterLast(siblings));
                  toast.show('Converted into a subtask');
                } catch (err) {
                  toast.error(err);
                }
              }}
            >
              <ArrowUpRight className="size-3.5" />
            </IconButton>
            <IconButton label="Delete item" onClick={() => deleteChecklistItem(item).catch(toast.error)}>
              <Trash2 className="size-3.5" />
            </IconButton>
          </span>
        )}
      </div>
      {kids.length > 0 && (
        <ul>
          {kids.map((k) => (
            <ItemRow key={k.id} item={k} depth={depth + 1} childrenOf={childrenOf} checklist={checklist} card={card} canEdit={canEdit} people={people} />
          ))}
        </ul>
      )}
      {addingSub && (
        <div style={{ paddingLeft: (depth + 1) * 20 }}>
          <AddItems checklist={checklist} siblings={kids} parentId={item.id} autoOpen onClose={() => setAddingSub(false)} />
        </div>
      )}
    </li>
  );
}

function AddItems({
  checklist,
  siblings,
  parentId,
  autoOpen,
  onClose,
}: {
  checklist: Checklist;
  siblings: ChecklistItem[];
  parentId: string | null;
  autoOpen?: boolean;
  onClose?: () => void;
}) {
  const [open, setOpen] = useState(Boolean(autoOpen));
  const [text, setText] = useState('');
  const toast = useToast();
  if (!open)
    return (
      <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setOpen(true)} className="mt-1">
        Add an item
      </Button>
    );
  const submit = async () => {
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.replace(/^[-*•\d.)\s]+/, '').trim())
      .filter(Boolean);
    if (!lines.length) return;
    try {
      await addChecklistItems(checklist, lines, keysAfter(siblings, lines.length), parentId);
      setText('');
    } catch (err) {
      toast.error(err);
    }
  };
  return (
    <div className="mt-1 flex flex-col gap-1.5">
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        placeholder={parentId ? 'Sub-step. One per line.' : 'Add an item. Paste a list to add several.'}
        aria-label="New checklist item"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
          if (e.key === 'Escape') {
            setOpen(false);
            onClose?.();
          }
        }}
        className="w-full resize-none rounded-[4px] border border-teal bg-surface p-1.5 text-sm focus:outline-none"
      />
      <div className="flex gap-1.5">
        <Button size="sm" variant="primary" onClick={submit}>
          Add
        </Button>
        <Button size="sm" variant="ghost" onClick={() => (setOpen(false), onClose?.())}>
          Done
        </Button>
      </div>
    </div>
  );
}

/* ================================================================ Subtasks */

export function SubtasksSection({ card, canEdit, ctx }: { card: Card; canEdit: boolean; ctx: ProjectCtx }) {
  const subs = useSubtasks(card.project_id, card.id);
  const [title, setTitle] = useState('');
  const [adding, setAdding] = useState(false);
  const toast = useToast();
  const list = subs.data ?? [];
  if (!list.length && !canEdit) return null;
  const done = list.filter((s) => s.status === 'done').length;
  return (
    <section>
      <SectionTitle
        icon={<GitBranch className="size-4" />}
        actions={
          canEdit && !adding ? (
            <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setAdding(true)}>
              Break down
            </Button>
          ) : null
        }
      >
        Subtasks {list.length > 0 && <span className="num font-normal text-secondary">{done}/{list.length}</span>}
      </SectionTitle>
      {list.length === 0 && !adding && <p className="text-sm text-secondary">Split large work into smaller tasks that can be assigned and scheduled.</p>}
      <ul className="flex flex-col divide-y divide-grid">
        {list.map((s) => (
          <li key={s.id} className="flex items-center gap-2 py-1 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-[var(--v-teal-deep)]"
              checked={s.status === 'done'}
              disabled={!canEdit}
              aria-label={`Mark ${s.title} ${s.status === 'done' ? 'not done' : 'done'}`}
              onChange={async (e) => {
                try {
                  const full = must(await sb().from('cards').select('*').eq('id', s.id).single()) as Card;
                  await updateCard(full, { status: e.target.checked ? 'done' : 'open' });
                  subs.refetch();
                } catch (err) {
                  toast.error(err);
                }
              }}
            />
            <button className={cn('flex-1 truncate text-left hover:underline', s.status === 'done' && 'text-secondary line-through')} onClick={() => ctx.openCard(s.id)}>
              {s.title}
            </button>
            {s.due_date && <span className="num text-xs text-secondary">{format(parseISO(s.due_date), 'd MMM')}</span>}
          </li>
        ))}
      </ul>
      {adding && (
        <form
          className="mt-1 flex gap-1.5"
          onSubmit={async (e) => {
            e.preventDefault();
            const lines = title.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
            if (!lines.length) return;
            try {
              const siblings = must(await sb().from('cards').select('id, position').eq('list_id', card.list_id)) as { id: string; position: string }[];
              const keys = keysAfter(siblings, lines.length);
              for (let i = 0; i < lines.length; i++)
                await createCard({ project_id: card.project_id, board_id: card.board_id, list_id: card.list_id, parent_id: card.id, title: lines[i], position: keys[i] });
              setTitle('');
              subs.refetch();
            } catch (err) {
              toast.error(err);
            }
          }}
        >
          <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Subtask title" className="h-8" aria-label="Subtask title" onKeyDown={(e) => e.key === 'Escape' && setAdding(false)} />
          <Button size="sm" type="submit" variant="primary">
            Add
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
            Done
          </Button>
        </form>
      )}
    </section>
  );
}

/* ============================================================= Attachments */

export function AttachmentsSection({ card, canEdit }: { card: Card; canEdit: boolean }) {
  const q = useAttachments(card.project_id, { cardId: card.id });
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const toast = useToast();
  const items = q.data ?? [];
  if (!items.length && !canEdit) return null;
  return (
    <section
      onDragOver={(e) => canEdit && e.preventDefault()}
      onDrop={async (e) => {
        if (!canEdit) return;
        e.preventDefault();
        const files = [...e.dataTransfer.files];
        if (!files.length) return;
        setBusy(true);
        try {
          for (const f of files) await uploadAttachment(card.project_id, f, { cardId: card.id });
          toast.show(`${files.length} file${files.length > 1 ? 's' : ''} attached`);
        } catch (err) {
          toast.error(err);
        } finally {
          setBusy(false);
        }
      }}
    >
      <SectionTitle
        icon={<Paperclip className="size-4" />}
        actions={
          canEdit && (
            <span className="flex gap-1">
              <input
                ref={fileRef}
                type="file"
                multiple
                hidden
                onChange={async (e) => {
                  const files = [...(e.target.files ?? [])];
                  e.target.value = '';
                  if (!files.length) return;
                  setBusy(true);
                  try {
                    for (const f of files) await uploadAttachment(card.project_id, f, { cardId: card.id });
                  } catch (err) {
                    toast.error(err);
                  } finally {
                    setBusy(false);
                  }
                }}
              />
              <Button size="sm" variant="ghost" loading={busy} icon={<Upload className="size-3.5" />} onClick={() => fileRef.current?.click()}>
                Upload
              </Button>
              <Popover
                trigger={
                  <Button size="sm" variant="ghost" icon={<Link2 className="size-3.5" />}>
                    Link
                  </Button>
                }
              >
                <form
                  className="flex flex-col gap-2"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    try {
                      await addLinkAttachment(card.project_id, url.trim(), name.trim(), { cardId: card.id });
                      setUrl('');
                      setName('');
                    } catch (err) {
                      toast.error(err);
                    }
                  }}
                >
                  <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://drive.google.com/…" aria-label="Link address" className="h-8" />
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (optional)" aria-label="Link name" className="h-8" />
                  <Button size="sm" type="submit" variant="primary" disabled={!url.trim()}>
                    Attach link
                  </Button>
                </form>
              </Popover>
            </span>
          )
        }
      >
        Attachments
      </SectionTitle>
      {items.length === 0 ? (
        <p className="text-sm text-secondary">Drop files here, or attach a document link (Google Drive, SharePoint, GitHub…).</p>
      ) : (
        <ul className="flex flex-col divide-y divide-grid">
          {items.map((a) => (
            <li key={a.id} className="flex items-center gap-2 py-1.5 text-sm">
              {a.kind === 'file' ? <FileText className="size-4 text-secondary" aria-hidden /> : <ExternalLink className="size-4 text-secondary" aria-hidden />}
              <button className="min-w-0 flex-1 truncate text-left text-link hover:underline" onClick={() => openAttachment(a).catch(toast.error)}>
                {a.name}
              </button>
              <span className="text-xs text-secondary">
                {a.kind === 'link' ? linkKind(a.url!) ?? 'Link' : a.size_bytes != null ? formatBytes(a.size_bytes) : ''}
              </span>
              {a.kind === 'link' && <GitHubLinkStatus url={a.url!} />}
              {canEdit && (
                <IconButton label={`Remove ${a.name}`} onClick={() => removeAttachment(a).catch(toast.error)}>
                  <Trash2 className="size-3.5" />
                </IconButton>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/* ============================================================ Custom fields */

export function FieldsSection({ card, canEdit }: { card: Card; canEdit: boolean }) {
  const fields = useCustomFields(card.project_id, card.board_id);
  const values = useFieldValues(card.project_id, card.id);
  const toast = useToast();
  const map = useMemo(() => new Map((values.data ?? []).map((v) => [v.field_id, v.value])), [values.data]);
  if (!fields.data?.length) return null;
  return (
    <section>
      <h3 className="mb-1.5 text-sm">Fields</h3>
      <dl className="grid grid-cols-[minmax(100px,160px)_1fr] items-center gap-x-3 gap-y-1.5 text-sm">
        {fields.data.map((f) => {
          const v = map.get(f.id);
          const set = (val: unknown) => setFieldValue(card, f.id, val).then(() => values.refetch()).catch(toast.error);
          return (
            <div key={f.id} className="contents">
              <dt className="text-secondary">{f.name}</dt>
              <dd>
                {f.type === 'checkbox' ? (
                  <input type="checkbox" className="size-4 accent-[var(--v-teal-deep)]" checked={v === true} disabled={!canEdit} onChange={(e) => set(e.target.checked)} aria-label={f.name} />
                ) : f.type === 'select' ? (
                  <Select value={(v as string) ?? ''} disabled={!canEdit} onChange={(e) => set(e.target.value || null)} className="h-8" aria-label={f.name}>
                    <option value="">—</option>
                    {f.options.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <FieldInput
                    type={f.type}
                    value={v == null ? '' : String(v)}
                    disabled={!canEdit}
                    label={f.name}
                    onSave={(raw) => {
                      if (raw === '') return set(null);
                      if (f.type === 'number') {
                        const n = Number(raw.replace(',', '.'));
                        if (!Number.isFinite(n)) return toast.error(new Error(`${f.name} must be a number.`));
                        return set(n);
                      }
                      return set(raw);
                    }}
                  />
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

function FieldInput({ type, value, disabled, label, onSave }: { type: string; value: string; disabled: boolean; label: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  return (
    <Input
      type={type === 'date' ? 'date' : type === 'number' ? 'text' : type === 'url' ? 'url' : 'text'}
      inputMode={type === 'number' ? 'decimal' : undefined}
      value={v}
      disabled={disabled}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onSave(v.trim())}
      className="h-8"
      aria-label={label}
    />
  );
}

/* ====================================================== Dependencies & links */

export function RelationsSection({ card, canEdit, ctx }: { card: Card; canEdit: boolean; ctx: ProjectCtx }) {
  const deps = useDependencies(card.project_id);
  const links = useCardLinks(card.project_id, card.id);
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [rel, setRel] = useState<'blocked_by' | 'blocks' | 'relates' | 'duplicates'>('blocked_by');
  const candidates = useQuery({
    queryKey: qk.projectPart(card.project_id, 'card-search', search),
    enabled: search.trim().length >= 2,
    queryFn: async () =>
      must(
        await sb()
          .from('cards')
          .select('id, title')
          .eq('project_id', card.project_id)
          .neq('id', card.id)
          .is('deleted_at', null)
          .ilike('title', `%${search.trim().replace(/[%_]/g, '')}%`)
          .limit(8),
      ) as { id: string; title: string }[],
  });
  const titleQ = useQuery({
    queryKey: qk.projectPart(card.project_id, 'dep-titles', card.id, deps.data?.length),
    enabled: Boolean(deps.data),
    queryFn: async () => {
      const ids = [...new Set((deps.data ?? []).filter((d) => d.predecessor_id === card.id || d.successor_id === card.id).flatMap((d) => [d.predecessor_id, d.successor_id]))];
      if (!ids.length) return new Map<string, { title: string; status: Card['status'] }>();
      const rows = must(await sb().from('cards').select('id, title, status').in('id', ids)) as { id: string; title: string; status: Card['status'] }[];
      return new Map(rows.map((r) => [r.id, { title: r.title, status: r.status }]));
    },
  });
  const blockedBy = (deps.data ?? []).filter((d) => d.successor_id === card.id);
  const blocks = (deps.data ?? []).filter((d) => d.predecessor_id === card.id);
  const linkRows = links.data?.links ?? [];
  const total = blockedBy.length + blocks.length + linkRows.length;
  if (!total && !canEdit) return null;
  const titles = titleQ.data ?? new Map();
  const openBlockers = blockedBy.filter((d) => titles.get(d.predecessor_id)?.status !== 'done').length;

  return (
    <section>
      <SectionTitle icon={<Link2 className="size-4" />}>Dependencies and links</SectionTitle>
      {openBlockers > 0 && card.status !== 'done' && (
        <p className="mb-2 text-sm text-critical">
          Waiting on {openBlockers} unfinished task{openBlockers > 1 ? 's' : ''}.
        </p>
      )}
      <ul className="flex flex-col gap-1 text-sm">
        {blockedBy.map((d) => (
          <RelationRow key={d.id} verb="Blocked by" title={titles.get(d.predecessor_id)?.title} status={titles.get(d.predecessor_id)?.status} onOpen={() => ctx.openCard(d.predecessor_id)} onRemove={canEdit ? () => removeDependency(d).catch(toast.error) : undefined} />
        ))}
        {blocks.map((d) => (
          <RelationRow key={d.id} verb="Blocks" title={titles.get(d.successor_id)?.title} status={titles.get(d.successor_id)?.status} onOpen={() => ctx.openCard(d.successor_id)} onRemove={canEdit ? () => removeDependency(d).catch(toast.error) : undefined} />
        ))}
        {linkRows.map((l) => {
          const other = l.card_id === card.id ? l.linked_card_id : l.card_id;
          const c = links.data?.cards.find((x) => x.id === other);
          return (
            <RelationRow
              key={l.id}
              verb={l.relation === 'duplicates' ? 'Duplicates' : l.relation === 'follows_up' ? 'Follows up' : 'Related to'}
              title={c?.title ?? 'Task you cannot access'}
              status={c?.status as Card['status'] | undefined}
              onOpen={c ? () => ctx.openCard(c.id) : undefined}
              onRemove={canEdit ? () => removeCardLink(l).catch(toast.error) : undefined}
            />
          );
        })}
      </ul>
      {canEdit && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Select value={rel} onChange={(e) => setRel(e.target.value as typeof rel)} className="h-8 w-36" aria-label="Relation">
            <option value="blocked_by">Blocked by</option>
            <option value="blocks">Blocks</option>
            <option value="relates">Related to</option>
            <option value="duplicates">Duplicates</option>
          </Select>
          <div className="relative min-w-0 flex-1">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a task in this project" className="h-8" aria-label="Find task to link" />
            {(candidates.data?.length ?? 0) > 0 && search.trim().length >= 2 && (
              <ul className="absolute left-0 right-0 top-full z-20 mt-1 rounded-[4px] border border-rule bg-surface p-1 text-sm">
                {candidates.data!.map((c) => (
                  <li key={c.id}>
                    <button
                      className="w-full truncate rounded-[3px] px-2 py-1 text-left hover:bg-hover"
                      onClick={async () => {
                        try {
                          if (rel === 'blocked_by') await addDependency(card.project_id, c.id, card.id);
                          else if (rel === 'blocks') await addDependency(card.project_id, card.id, c.id);
                          else await addCardLink(card, c.id, rel);
                          setSearch('');
                        } catch (err) {
                          toast.error(err);
                        }
                      }}
                    >
                      {c.title}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function RelationRow({ verb, title, status, onOpen, onRemove }: { verb: string; title?: string; status?: Card['status']; onOpen?: () => void; onRemove?: () => void }) {
  return (
    <li className="flex items-center gap-2">
      <span className="w-24 shrink-0 text-xs text-secondary">{verb}</span>
      <button className="min-w-0 flex-1 truncate text-left hover:underline" onClick={onOpen} disabled={!onOpen}>
        {title ?? '…'}
      </button>
      {status && <StatusPill status={status} />}
      {onRemove && (
        <IconButton label="Remove relation" onClick={onRemove}>
          <Trash2 className="size-3.5" />
        </IconButton>
      )}
    </li>
  );
}

/* ==================================================================== Time */

export function TimeSection({ card, canEdit }: { card: Card; canEdit: boolean }) {
  const q = useCardTime(card.project_id, card.id);
  const { user } = useAuth();
  const toast = useToast();
  const [hours, setHours] = useState('');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const total = (q.data ?? []).reduce((s, e) => s + (e.minutes ?? 0), 0);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-bold text-secondary">Time logged</span>
      <span className="num">
        {(total / 60).toFixed(total % 60 ? 2 : 0)} h{card.estimate_minutes ? ` of ${(card.estimate_minutes / 60).toFixed(card.estimate_minutes % 60 ? 2 : 0)} h estimated` : ''}
      </span>
      {canEdit && (
        <Popover
          trigger={
            <Button size="sm" variant="ghost" className="justify-start" icon={<Clock className="size-3.5" />}>
              Log time
            </Button>
          }
        >
          <form
            className="flex flex-col gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await logTime(card.project_id, card.id, parseFloat(hours.replace(',', '.')) * 60, date);
                setHours('');
              } catch (err) {
                toast.error(err);
              }
            }}
          >
            <label className="text-xs font-bold">
              Hours
              <Input inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} className="mt-0.5 h-8" placeholder="1.5" />
            </label>
            <label className="text-xs font-bold">
              Date
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-0.5 h-8" />
            </label>
            <Button size="sm" type="submit" variant="primary" disabled={!hours}>
              Log
            </Button>
            {(q.data ?? []).length > 0 && (
              <ul className="max-h-32 overflow-y-auto border-t border-grid pt-1 text-xs">
                {q.data!.map((t) => (
                  <li key={t.id} className="flex items-center gap-2 py-0.5">
                    <span className="num flex-1">
                      {t.entry_date} · {((t.minutes ?? 0) / 60).toFixed(2)} h{t.ended_at === null && t.started_at ? ' (running)' : ''}
                    </span>
                    {t.user_id === user?.id && (
                      <button aria-label="Delete entry" className="text-muted hover:text-critical" onClick={() => deleteTimeEntry(card.project_id, t.id).catch(toast.error)}>
                        <Trash2 className="size-3" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </form>
        </Popover>
      )}
    </div>
  );
}

export function nextKey(after: string | null): string {
  return generateKeyBetween(after, null);
}

export type { CardWithRelations };
