import { forwardRef, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as RD from '@radix-ui/react-dialog';
import {
  Archive,
  ArrowRight,
  CalendarDays,
  Copy,
  Eye,
  EyeOff,
  Link2,
  ListChecks,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Play,
  Repeat,
  Tags,
  Trash2,
  UserPlus,
  X,
  LayoutTemplate,
  MapPin,
  Paperclip,
  GitBranch,
  Flag,
  CircleDot,
  Clock,
  Plus,
  Layers,
  Milestone,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { useAuth } from '@/auth/AuthProvider';
import { sb } from '@/lib/supabase';
import { must } from '@/data/errors';
import { qk } from '@/data/queryClient';
import { ConflictError } from '@/data/errors';
import { fetchCard, setAssignee, setCardLabel, setCardsArchived, setWatching, trashCard, updateCard, deleteCardPermanently, copyCard } from '@/data/cards';
import { startTimer } from '@/data/personal';
import { addChecklist, useChecklists } from '@/data/cardExtras';
import { useMilestonesLite, useWorkPackagesLite } from '@/data/lite';
import type { Board, CardStatus, CardWithRelations, Label, List, Priority, Recurrence } from '@/data/types';
import { Avatar, Button, ErrorNote, IconButton, Input, Select, Spinner, Tag, Textarea, STATUS_LABEL, PRIORITY_LABEL, LABEL_NAME } from '@/components/ui';
import { MenuContent, MenuItem, MenuRoot, MenuSeparator, MenuTrigger, Popover } from '@/components/ui/Menu';
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog';
import { Markdown } from '@/components/ui/Markdown';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';
import type { ProjectCtx } from '@/features/project/context';
import { keyAfterLast } from '@/domain/ordering';
import { describeRecurrence } from '@/domain/recurrence';
import { appUrl } from '@/lib/env';
import { ChecklistsSection, SubtasksSection, AttachmentsSection, FieldsSection, RelationsSection, TimeSection } from './CardSections';
import { CommentsAndActivity } from './CardComments';
import { CardButtons } from '@/features/automation/CardButtons';

export function CardDialog({ cardId, ctx, onClose }: { cardId: string; ctx: ProjectCtx; onClose: () => void }) {
  const { project, canEdit, people } = ctx;
  const { user } = useAuth();
  const me = user!.id;
  const toast = useToast();
  const [wide, setWide] = useState(false);

  const cardQ = useQuery({
    queryKey: qk.projectPart(project.id, 'card', cardId),
    queryFn: () => fetchCard(cardId),
  });
  const card = cardQ.data as (CardWithRelations & { card_watchers?: { user_id: string }[] }) | null | undefined;

  const metaQ = useQuery({
    queryKey: qk.projectPart(project.id, 'card-meta', card?.board_id),
    enabled: Boolean(card?.board_id),
    queryFn: async () => {
      const [labels, lists, boards] = await Promise.all([
        sb().from('labels').select('*').eq('board_id', card!.board_id).order('created_at'),
        sb().from('lists').select('*').eq('project_id', project.id).is('archived_at', null).order('position'),
        sb().from('boards').select('*').eq('project_id', project.id).is('deleted_at', null).is('archived_at', null).order('position'),
      ]);
      return { labels: must(labels) as Label[], lists: must(lists) as List[], boards: must(boards) as Board[] };
    },
  });
  const checklists = useChecklists(project.id, cardId);
  const wps = useWorkPackagesLite(project.id, ctx.has('workpackages'));
  const milestones = useMilestonesLite(project.id, ctx.has('milestones'));
  const parentQ = useQuery({
    queryKey: qk.projectPart(project.id, 'card-title', card?.parent_id),
    enabled: Boolean(card?.parent_id),
    queryFn: async () => must(await sb().from('cards').select('id, title').eq('id', card!.parent_id!).maybeSingle()) as { id: string; title: string } | null,
  });

  const save = async (patch: Partial<CardWithRelations>) => {
    if (!card) return;
    try {
      await updateCard(card, patch);
      cardQ.refetch();
    } catch (err) {
      if (err instanceof ConflictError && err.current) {
        cardQ.refetch();
      }
      toast.error(err);
      throw err;
    }
  };

  const listName = metaQ.data?.lists.find((l) => l.id === card?.list_id)?.name;
  const boardName = metaQ.data?.boards.find((b) => b.id === card?.board_id)?.name;
  const watching = (card?.card_watchers ?? []).some((w) => w.user_id === me);
  const assigned = new Set((card?.card_assignees ?? []).map((a) => a.user_id));
  const cardLabels = new Set((card?.card_labels ?? []).map((l) => l.label_id));

  // Sections appear once they hold something, or when chosen from "Add to card".
  const [shown, setShown] = useState<Set<string>>(() => new Set());
  const reveal = (key: string) => setShown((s) => new Set(s).add(key));
  const [picker, setPicker] = useState<'members' | 'labels' | null>(null);

  return (
    <RD.Root open onOpenChange={(o) => !o && onClose()}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-40 bg-[rgba(42,40,37,0.35)]" />
        <RD.Content
          className={cn(
            'fixed z-50 flex flex-col border border-rule bg-surface',
            wide
              ? 'inset-0 sm:inset-4 sm:rounded-[6px]'
              : 'inset-x-0 bottom-0 top-0 sm:left-1/2 sm:top-[4vh] sm:bottom-auto sm:max-h-[92vh] sm:w-[min(920px,calc(100vw-32px))] sm:-translate-x-1/2 sm:rounded-[6px]',
          )}
          aria-describedby={undefined}
        >
          {cardQ.isLoading && (
            <div className="p-6">
              <RD.Title className="sr-only">Loading task</RD.Title>
              <Spinner />
            </div>
          )}
          {cardQ.error && (
            <div className="p-6">
              <RD.Title className="sr-only">Error</RD.Title>
              <ErrorNote error={cardQ.error} />
            </div>
          )}
          {cardQ.isFetched && !card && !cardQ.error && (
            <div className="flex items-center gap-3 p-6">
              <RD.Title className="flex-1 text-lg">This task no longer exists or you lost access to it.</RD.Title>
              <IconButton label="Close" onClick={onClose}>
                <X className="size-4" />
              </IconButton>
            </div>
          )}
          {card && (
            <>
              <header className="flex items-start gap-2 border-b border-grid px-4 py-3 sm:px-5">
                <input
                  type="checkbox"
                  className="mt-2 size-4 shrink-0 accent-[var(--v-teal-deep)]"
                  checked={card.status === 'done'}
                  disabled={!canEdit}
                  aria-label={card.status === 'done' ? 'Mark as not done' : 'Mark as done'}
                  onChange={(e) => save({ status: e.target.checked ? 'done' : 'open' }).catch(() => {})}
                />
                <div className="min-w-0 flex-1">
                  <TitleEditor title={card.title} canEdit={canEdit} onSave={(title) => save({ title })} />
                  <p className="mt-0.5 text-xs text-secondary">
                    {card.is_template && <b className="text-ink">Template · </b>}
                    in <b className="text-ink">{listName ?? '…'}</b> on {boardName ?? '…'}
                    {parentQ.data && (
                      <>
                        {' '}
                        · subtask of{' '}
                        <button className="text-link underline-offset-2 hover:underline" onClick={() => ctx.openCard(parentQ.data!.id)}>
                          {parentQ.data.title}
                        </button>
                      </>
                    )}
                    {card.archived_at && <b className="text-serious"> · Archived</b>}
                    {card.deleted_at && <b className="text-critical"> · In trash</b>}
                  </p>
                </div>
                <IconButton label={wide ? 'Smaller window' : 'Distraction-free view'} onClick={() => setWide((w) => !w)} className="hidden sm:inline-flex">
                  {wide ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
                </IconButton>
                <MoreMenu card={card} ctx={ctx} lists={metaQ.data?.lists ?? []} boards={metaQ.data?.boards ?? []} onClose={onClose} onChanged={() => cardQ.refetch()} />
                <RD.Close asChild>
                  <IconButton label="Close">
                    <X className="size-4" />
                  </IconButton>
                </RD.Close>
              </header>

              <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
                <div className={cn('grid gap-6 px-4 py-4 sm:px-5', !wide && 'md:grid-cols-[1fr_240px]')}>
                  <div className="flex min-w-0 flex-col gap-6">
                    {/* Summary row: only what this task actually has. */}
                    <div className="flex flex-wrap gap-x-6 gap-y-3 empty:hidden">
                      {(assigned.size > 0 || shown.has('members')) && (
                        <Prop label="Members">
                          <div className="flex flex-wrap items-center gap-1">
                            {[...assigned].map((id) => {
                              const p = people.find((x) => x.user_id === id);
                              return <Avatar key={id} name={p?.display_name ?? 'Former member'} color={p?.avatar_color ?? 'teal'} size={28} />;
                            })}
                            {canEdit && (
                              <Popover
                                open={picker === 'members'}
                                onOpenChange={(o) => setPicker(o ? 'members' : null)}
                                trigger={
                                  <button className="grid size-7 place-items-center rounded-full bg-card text-secondary hover:bg-hover hover:text-ink" aria-label="Change members">
                                    <Plus className="size-4" />
                                  </button>
                                }
                              >
                                <p className="mb-2 font-bold">Members</p>
                                <ul className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
                                  {people.map((p) => (
                                    <li key={p.user_id}>
                                      <label className="flex cursor-pointer items-center gap-2 rounded-[3px] px-1 py-1 hover:bg-hover">
                                        <input
                                          type="checkbox"
                                          className="accent-[var(--v-teal-deep)]"
                                          checked={assigned.has(p.user_id)}
                                          onChange={(e) =>
                                            setAssignee(card, p.user_id, e.target.checked)
                                              .then(() => cardQ.refetch())
                                              .catch(toast.error)
                                          }
                                        />
                                        <Avatar name={p.display_name} color={p.avatar_color} size={20} />
                                        <span className="truncate">{p.display_name}</span>
                                        {p.user_id === me && <span className="text-xs text-secondary">(you)</span>}
                                      </label>
                                    </li>
                                  ))}
                                </ul>
                              </Popover>
                            )}
                          </div>
                        </Prop>
                      )}
                      {(cardLabels.size > 0 || shown.has('labels')) && (
                        <Prop label="Labels">
                          <div className="flex flex-wrap items-center gap-1">
                            {(metaQ.data?.labels ?? [])
                              .filter((l) => cardLabels.has(l.id))
                              .map((l) => (
                                <Tag key={l.id} color={l.color} className="h-7 px-2.5 text-sm">
                                  {l.name || LABEL_NAME[l.color]}
                                </Tag>
                              ))}
                            {canEdit && (
                              <Popover
                                open={picker === 'labels'}
                                onOpenChange={(o) => setPicker(o ? 'labels' : null)}
                                trigger={
                                  <button className="grid size-7 place-items-center rounded-[4px] bg-card text-secondary hover:bg-hover hover:text-ink" aria-label="Change labels">
                                    <Plus className="size-4" />
                                  </button>
                                }
                              >
                                <p className="mb-2 font-bold">Labels</p>
                                {(metaQ.data?.labels ?? []).length === 0 && <p className="text-secondary">This board has no labels yet. Add them from the board menu.</p>}
                                <ul className="flex flex-col gap-1">
                                  {(metaQ.data?.labels ?? []).map((l) => (
                                    <li key={l.id}>
                                      <label className="flex cursor-pointer items-center gap-2">
                                        <input
                                          type="checkbox"
                                          className="accent-[var(--v-teal-deep)]"
                                          checked={cardLabels.has(l.id)}
                                          onChange={(e) =>
                                            setCardLabel(card, l.id, e.target.checked)
                                              .then(() => cardQ.refetch())
                                              .catch(toast.error)
                                          }
                                        />
                                        <Tag color={l.color}>{l.name || LABEL_NAME[l.color]}</Tag>
                                      </label>
                                    </li>
                                  ))}
                                </ul>
                              </Popover>
                            )}
                          </div>
                        </Prop>
                      )}
                      {(card.due_date || card.start_date || shown.has('dates')) && <DatesProp card={card} canEdit={canEdit} onSave={save} autoOpen={shown.has('dates')} />}
                      {(card.priority !== 'none' || shown.has('priority')) && (
                        <Prop label="Priority">
                          <Select value={card.priority} disabled={!canEdit} onChange={(e) => save({ priority: e.target.value as Priority }).catch(() => {})} className="h-8 w-32" aria-label="Priority">
                            {(['none', 'low', 'medium', 'high', 'urgent'] as Priority[]).map((p) => (
                              <option key={p} value={p}>
                                {PRIORITY_LABEL[p]}
                              </option>
                            ))}
                          </Select>
                        </Prop>
                      )}
                      {(card.status === 'in_progress' || card.status === 'blocked' || shown.has('status')) && (
                        <Prop label="Status">
                          <Select value={card.status} disabled={!canEdit} onChange={(e) => save({ status: e.target.value as CardStatus }).catch(() => {})} className="h-8 w-36" aria-label="Status">
                            {(Object.keys(STATUS_LABEL) as CardStatus[]).map((s) => (
                              <option key={s} value={s}>
                                {STATUS_LABEL[s]}
                              </option>
                            ))}
                          </Select>
                        </Prop>
                      )}
                      {(card.recurrence || shown.has('repeat')) && <RecurrenceProp card={card} canEdit={canEdit} onSave={save} autoOpen={shown.has('repeat')} />}
                      {(card.lat != null || shown.has('location')) && <LocationProp card={card} canEdit={canEdit} onSave={save} autoOpen={shown.has('location')} />}
                      {ctx.has('workpackages') && (card.work_package_id || shown.has('wp')) && (
                        <Prop label="Work package">
                          <Select value={card.work_package_id ?? ''} disabled={!canEdit} onChange={(e) => save({ work_package_id: e.target.value || null }).catch(() => {})} className="h-8 max-w-56" aria-label="Work package">
                            <option value="">None</option>
                            {(wps.data ?? []).map((w) => (
                              <option key={w.id} value={w.id}>
                                {w.code} {w.name}
                              </option>
                            ))}
                          </Select>
                        </Prop>
                      )}
                      {ctx.has('milestones') && (card.milestone_id || shown.has('milestone')) && (
                        <Prop label="Milestone">
                          <Select value={card.milestone_id ?? ''} disabled={!canEdit} onChange={(e) => save({ milestone_id: e.target.value || null }).catch(() => {})} className="h-8 max-w-56" aria-label="Milestone">
                            <option value="">None</option>
                            {(milestones.data ?? []).map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.code} {m.title}
                              </option>
                            ))}
                          </Select>
                        </Prop>
                      )}
                      {(card.estimate_minutes || shown.has('time')) && (
                        <Prop label="Estimate">
                          <EstimateInput value={card.estimate_minutes} disabled={!canEdit} autoFocus={shown.has('time') && !card.estimate_minutes} onSave={(estimate_minutes) => save({ estimate_minutes }).catch(() => {})} />
                        </Prop>
                      )}
                      {card.responsible_text && (
                        <Prop label="Responsible (imported)">
                          <span className="text-sm">{card.responsible_text}</span>
                        </Prop>
                      )}
                    </div>
                    <DescriptionEditor card={card} canEdit={canEdit} onSave={(description) => save({ description })} />
                    <FieldsSection card={card} canEdit={canEdit} />
                    <ChecklistsSection card={card} canEdit={canEdit} people={people} data={checklists.data} />
                    <SubtasksSection card={card} canEdit={canEdit} ctx={ctx} open={shown.has('subtasks')} />
                    <AttachmentsSection card={card} canEdit={canEdit} open={shown.has('attachments')} />
                    <RelationsSection card={card} canEdit={canEdit} ctx={ctx} open={shown.has('relations')} />
                    {!wide && <CommentsAndActivity card={card} ctx={ctx} />}
                  </div>

                  <aside className="flex flex-col gap-5 text-sm" aria-label="Task details">
                    {canEdit && (
                      <SideGroup title="Add to card">
                        <SideButton icon={<UserPlus className="size-4" />} onClick={() => (reveal('members'), setPicker('members'))}>
                          Members
                        </SideButton>
                        <SideButton icon={<Tags className="size-4" />} onClick={() => (reveal('labels'), setPicker('labels'))}>
                          Labels
                        </SideButton>
                        <SideButton
                          icon={<ListChecks className="size-4" />}
                          onClick={() =>
                            addChecklist(card, 'Checklist', keyAfterLast(checklists.data?.checklists ?? []))
                              .then(() => checklists.refetch())
                              .catch(toast.error)
                          }
                        >
                          Checklist
                        </SideButton>
                        <SideButton icon={<CalendarDays className="size-4" />} onClick={() => reveal('dates')}>
                          Dates
                        </SideButton>
                        <SideButton icon={<Paperclip className="size-4" />} onClick={() => reveal('attachments')}>
                          Attachment
                        </SideButton>
                        <MenuRoot>
                          <MenuTrigger asChild>
                            <SideButton icon={<MoreHorizontal className="size-4" />}>More</SideButton>
                          </MenuTrigger>
                          <MenuContent align="start">
                            <MenuItem icon={<GitBranch className="size-4" />} onSelect={() => reveal('subtasks')}>
                              Subtasks
                            </MenuItem>
                            <MenuItem icon={<Flag className="size-4" />} onSelect={() => reveal('priority')}>
                              Priority
                            </MenuItem>
                            <MenuItem icon={<CircleDot className="size-4" />} onSelect={() => reveal('status')}>
                              Status (in progress, blocked)
                            </MenuItem>
                            <MenuItem icon={<Repeat className="size-4" />} onSelect={() => reveal('repeat')}>
                              Repeat
                            </MenuItem>
                            <MenuItem icon={<Link2 className="size-4" />} onSelect={() => reveal('relations')}>
                              Dependencies and links
                            </MenuItem>
                            <MenuItem icon={<Clock className="size-4" />} onSelect={() => reveal('time')}>
                              Estimate and time
                            </MenuItem>
                            {ctx.has('map') && (
                              <MenuItem icon={<MapPin className="size-4" />} onSelect={() => reveal('location')}>
                                Location
                              </MenuItem>
                            )}
                            {ctx.has('workpackages') && (
                              <MenuItem icon={<Layers className="size-4" />} onSelect={() => reveal('wp')}>
                                Work package
                              </MenuItem>
                            )}
                            {ctx.has('milestones') && (
                              <MenuItem icon={<Milestone className="size-4" />} onSelect={() => reveal('milestone')}>
                                Milestone
                              </MenuItem>
                            )}
                          </MenuContent>
                        </MenuRoot>
                      </SideGroup>
                    )}
                    <SideGroup title="Actions">
                      <SideButton
                        icon={watching ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                        onClick={() => setWatching(card, me, !watching).then(() => cardQ.refetch()).catch(toast.error)}
                        aria-pressed={watching}
                      >
                        {watching ? 'Stop watching' : 'Watch'}
                      </SideButton>
                      {canEdit && (
                        <SideButton icon={<Play className="size-4" />} onClick={() => startTimer(card.project_id, card.id).then(() => (reveal('time'), toast.show('Timer started'))).catch(toast.error)}>
                          Start timer
                        </SideButton>
                      )}
                      {ctx.has('automations') && <CardButtons projectId={card.project_id} boardId={card.board_id} cardId={card.id} canEdit={canEdit} />}
                    </SideGroup>
                    <TimeSection card={card} canEdit={canEdit} open={shown.has('time')} />
                    <p className="text-xs text-secondary">
                      Created {format(parseISO(card.created_at), 'd MMM yyyy')}
                      {card.completed_at && <> · completed {format(parseISO(card.completed_at), 'd MMM yyyy')}</>}
                    </p>
                  </aside>
                </div>
                {wide && (
                  <div className="px-4 pb-6 sm:px-5">
                    <CommentsAndActivity card={card} ctx={ctx} />
                  </div>
                )}
              </div>
            </>
          )}
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}

function Prop({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-bold text-secondary">{label}</span>
      {children}
    </div>
  );
}

function SideGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="font-sans text-xs font-bold text-secondary">{title}</h3>
      {children}
    </section>
  );
}

/** A full-width, quiet button in the card sidebar. */
const SideButton = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { icon: React.ReactNode }>(function SideButton(
  { icon, children, className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      {...rest}
      className={cn('flex h-8 w-full items-center gap-2 rounded-[4px] bg-card px-2.5 text-left text-sm text-ink hover:bg-hover focus-visible:ring-2 focus-visible:ring-teal', className)}
    >
      <span className="text-secondary">{icon}</span>
      {children}
    </button>
  );
});

function TitleEditor({ title, canEdit, onSave }: { title: string; canEdit: boolean; onSave: (t: string) => Promise<void> }) {
  const [draft, setDraft] = useState(title);
  useEffect(() => setDraft(title), [title]);
  const commit = () => {
    const t = draft.trim();
    if (t && t !== title) onSave(t).catch(() => setDraft(title));
    else setDraft(title);
  };
  return (
    <RD.Title asChild>
      {canEdit ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value.replace(/\n/g, ''))}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              (e.target as HTMLTextAreaElement).blur();
            }
            if (e.key === 'Escape') {
              e.stopPropagation();
              setDraft(title);
            }
          }}
          rows={1}
          maxLength={500}
          aria-label="Task title"
          className="font-title field-sizing-content w-full resize-none rounded-[3px] border border-transparent bg-transparent px-1 py-0.5 text-xl leading-snug hover:border-grid focus:border-teal focus:outline-none"
        />
      ) : (
        <h2 className="text-xl leading-snug">{title}</h2>
      )}
    </RD.Title>
  );
}

function DescriptionEditor({ card, canEdit, onSave }: { card: CardWithRelations; canEdit: boolean; onSave: (d: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(card.description);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!editing) setDraft(card.description);
  }, [card.description, editing]);
  return (
    <section>
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-sm">Description</h3>
        {canEdit && !editing && (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            Edit
          </Button>
        )}
      </div>
      {editing ? (
        <div className="flex flex-col gap-2">
          <Textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={8}
            aria-label="Description (Markdown)"
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) document.getElementById('desc-save')?.click();
            }}
          />
          <p className="text-xs text-secondary">Markdown supported: **bold**, _italic_, lists, [links](https://…), tables. Ctrl+Enter saves.</p>
          <div className="flex gap-2">
            <Button
              id="desc-save"
              size="sm"
              variant="primary"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onSave(draft);
                  setEditing(false);
                } catch {
                  /* conflict or error already reported; keep the draft so nothing is lost */
                } finally {
                  setBusy(false);
                }
              }}
            >
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => (setDraft(card.description), setEditing(false))}>
              Cancel
            </Button>
          </div>
        </div>
      ) : card.description.trim() ? (
        <div className={cn('rounded-[4px]', canEdit && 'cursor-text hover:bg-hover')} onDoubleClick={() => canEdit && setEditing(true)}>
          <Markdown source={card.description} />
        </div>
      ) : (
        <p className="text-sm text-secondary">{canEdit ? 'Add more detail when it helps. Double-click or use Edit.' : 'No description.'}</p>
      )}
    </section>
  );
}

function DatesProp({ card, canEdit, onSave, autoOpen }: { card: CardWithRelations; canEdit: boolean; onSave: (p: Partial<CardWithRelations>) => Promise<void>; autoOpen?: boolean }) {
  const [open, setOpen] = useState(Boolean(autoOpen));
  const [start, setStart] = useState(card.start_date ?? '');
  const [due, setDue] = useState(card.due_date ?? '');
  const [time, setTime] = useState(card.due_time?.slice(0, 5) ?? '');
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setStart(card.start_date ?? '');
    setDue(card.due_date ?? '');
    setTime(card.due_time?.slice(0, 5) ?? '');
  }, [card.start_date, card.due_date, card.due_time]);
  const label = card.due_date
    ? `${card.start_date ? `${format(parseISO(card.start_date), 'd MMM')} – ` : ''}${format(parseISO(card.due_date), 'd MMM yyyy')}${card.due_time ? ` ${card.due_time.slice(0, 5)}` : ''}`
    : card.start_date
      ? `Starts ${format(parseISO(card.start_date), 'd MMM yyyy')}`
      : 'No dates';
  return (
    <Prop label="Dates">
      {canEdit ? (
        <Popover
          open={open}
          onOpenChange={setOpen}
          trigger={
            <Button size="sm" variant="ghost" className="justify-start" icon={<CalendarDays className="size-3.5" />}>
              {label}
            </Button>
          }
        >
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (start && due && due < start) return setErr('The due date must be on or after the start date.');
              setErr(null);
              onSave({ start_date: start || null, due_date: due || null, due_time: due && time ? time : null }).then(() => setOpen(false)).catch(() => {});
            }}
          >
            <label className="text-xs font-bold">
              Start
              <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="mt-0.5 h-8" />
            </label>
            <label className="text-xs font-bold">
              Due
              <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="mt-0.5 h-8" />
            </label>
            <label className="text-xs font-bold">
              Time (optional)
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="mt-0.5 h-8" disabled={!due} />
            </label>
            {err && <p className="text-xs text-critical">{err}</p>}
            <div className="flex gap-2">
              <Button size="sm" type="submit" variant="primary">
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onSave({ start_date: null, due_date: null, due_time: null }).catch(() => {})}>
                Clear
              </Button>
            </div>
          </form>
        </Popover>
      ) : (
        <span>{label}</span>
      )}
    </Prop>
  );
}

function RecurrenceProp({ card, canEdit, onSave, autoOpen }: { card: CardWithRelations; canEdit: boolean; onSave: (p: Partial<CardWithRelations>) => Promise<void>; autoOpen?: boolean }) {
  const [open, setOpen] = useState(Boolean(autoOpen));
  const r = card.recurrence;
  const [freq, setFreq] = useState<Recurrence['freq']>(r?.freq ?? 'weekly');
  const [interval, setInterval] = useState(String(r?.interval ?? 1));
  const [days, setDays] = useState<number[]>(r?.byweekday ?? []);
  const [until, setUntil] = useState(r?.until ?? '');
  const DAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return (
    <Prop label="Repeat">
      {canEdit ? (
        <Popover
          open={open}
          onOpenChange={setOpen}
          trigger={
            <Button size="sm" variant="ghost" className="justify-start" icon={<Repeat className="size-3.5" />}>
              {r ? describeRecurrence(r) : 'Does not repeat'}
            </Button>
          }
        >
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const n = Math.max(1, Math.min(365, parseInt(interval, 10) || 1));
              onSave({
                recurrence: { freq, interval: n, byweekday: freq === 'weekly' && days.length ? [...days].sort() : undefined, until: until || null, mode: 'on_complete' },
              }).catch(() => {});
            }}
          >
            <p className="text-xs text-secondary">When this task is completed, the next one is created with the same people, labels and a fresh checklist.</p>
            <div className="flex items-center gap-2">
              <span>Every</span>
              <Input type="number" min={1} max={365} value={interval} onChange={(e) => setInterval(e.target.value)} className="h-8 w-16" aria-label="Interval" />
              <Select value={freq} onChange={(e) => setFreq(e.target.value as Recurrence['freq'])} className="h-8" aria-label="Frequency">
                <option value="daily">day(s)</option>
                <option value="weekly">week(s)</option>
                <option value="monthly">month(s)</option>
                <option value="yearly">year(s)</option>
              </Select>
            </div>
            {freq === 'weekly' && (
              <div className="flex flex-wrap gap-1" role="group" aria-label="Weekdays">
                {DAY.map((d, i) => (
                  <button
                    type="button"
                    key={d}
                    aria-pressed={days.includes(i)}
                    onClick={() => setDays((x) => (x.includes(i) ? x.filter((y) => y !== i) : [...x, i]))}
                    className={cn('h-7 w-10 rounded-[3px] border text-xs', days.includes(i) ? 'border-teal bg-accent-soft' : 'border-grid')}
                  >
                    {d}
                  </button>
                ))}
              </div>
            )}
            <label className="text-xs font-bold">
              Until (optional)
              <Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className="mt-0.5 h-8" />
            </label>
            <div className="flex gap-2">
              <Button size="sm" type="submit" variant="primary">
                Save
              </Button>
              {r && (
                <Button size="sm" variant="ghost" onClick={() => onSave({ recurrence: null }).catch(() => {})}>
                  Stop repeating
                </Button>
              )}
            </div>
          </form>
        </Popover>
      ) : (
        <span>{r ? describeRecurrence(r) : 'Does not repeat'}</span>
      )}
    </Prop>
  );
}

function LocationProp({ card, canEdit, onSave, autoOpen }: { card: CardWithRelations; canEdit: boolean; onSave: (p: Partial<CardWithRelations>) => Promise<void>; autoOpen?: boolean }) {
  const [open, setOpen] = useState(Boolean(autoOpen));
  const [label, setLabel] = useState(card.location_label ?? '');
  const [coords, setCoords] = useState(card.lat != null ? `${card.lat}, ${card.lng}` : '');
  const [err, setErr] = useState<string | null>(null);
  if (!canEdit && card.lat == null) return null;
  return (
    <Prop label="Location">
      {canEdit ? (
        <Popover
          open={open}
          onOpenChange={setOpen}
          trigger={
            <Button size="sm" variant="ghost" className="justify-start" icon={<MapPin className="size-3.5" />}>
              {card.lat != null ? card.location_label || `${card.lat.toFixed(3)}, ${card.lng!.toFixed(3)}` : 'Add location'}
            </Button>
          }
        >
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!coords.trim()) {
                onSave({ lat: null, lng: null, location_label: null }).catch(() => {});
                return;
              }
              const m = coords.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/);
              const lat = m ? parseFloat(m[1]) : NaN;
              const lng = m ? parseFloat(m[2]) : NaN;
              if (!m || Math.abs(lat) > 90 || Math.abs(lng) > 180) return setErr('Enter latitude, longitude, e.g. 37.9838, 23.7275');
              setErr(null);
              onSave({ lat, lng, location_label: label.trim() || null }).then(() => setOpen(false)).catch(() => {});
            }}
          >
            <label className="text-xs font-bold">
              Place name
              <Input value={label} onChange={(e) => setLabel(e.target.value)} className="mt-0.5 h-8" placeholder="e.g. Field site 2" />
            </label>
            <label className="text-xs font-bold">
              Latitude, longitude
              <Input value={coords} onChange={(e) => setCoords(e.target.value)} className="mt-0.5 h-8" placeholder="37.9838, 23.7275" />
            </label>
            {err && <p className="text-xs text-critical">{err}</p>}
            <p className="text-xs text-secondary">Tip: you can also click a point on the project's Map view.</p>
            <Button size="sm" type="submit" variant="primary">
              Save location
            </Button>
          </form>
        </Popover>
      ) : (
        <span>{card.location_label || `${card.lat}, ${card.lng}`}</span>
      )}
    </Prop>
  );
}

function EstimateInput({ value, disabled, onSave, autoFocus }: { value: number | null; disabled: boolean; onSave: (v: number | null) => void; autoFocus?: boolean }) {
  const [v, setV] = useState(value != null ? String(+(value / 60).toFixed(2)) : '');
  useEffect(() => setV(value != null ? String(+(value / 60).toFixed(2)) : ''), [value]);
  return (
    <div className="flex items-center gap-1.5">
      <Input
        type="number"
        min={0}
        step={0.25}
        value={v}
        disabled={disabled}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => {
          const h = parseFloat(v);
          const minutes = Number.isFinite(h) && h > 0 ? Math.round(h * 60) : null;
          if (minutes !== value) onSave(minutes);
        }}
        autoFocus={autoFocus}
        className="h-8 w-20"
        aria-label="Estimate in hours"
      />
      <span className="text-secondary">hours</span>
    </div>
  );
}

function MoreMenu({
  card,
  ctx,
  lists,
  boards,
  onClose,
  onChanged,
}: {
  card: CardWithRelations;
  ctx: ProjectCtx;
  lists: List[];
  boards: Board[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [moveOpen, setMoveOpen] = useState<null | 'move' | 'copy'>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  if (!ctx.canEdit)
    return (
      <IconButton label="Copy link" onClick={() => navigator.clipboard.writeText(appUrl(`c/${card.id}`)).then(() => toast.show('Link copied'))}>
        <Link2 className="size-4" />
      </IconButton>
    );
  return (
    <>
      <MenuRoot>
        <MenuTrigger asChild>
          <IconButton label="Task actions">
            <MoreHorizontal className="size-4" />
          </IconButton>
        </MenuTrigger>
        <MenuContent>
          <MenuItem icon={<ArrowRight className="size-4" />} onSelect={() => setMoveOpen('move')}>
            Move…
          </MenuItem>
          <MenuItem icon={<Copy className="size-4" />} onSelect={() => setMoveOpen('copy')}>
            Copy…
          </MenuItem>
          <MenuItem icon={<Link2 className="size-4" />} onSelect={() => navigator.clipboard.writeText(appUrl(`c/${card.id}`)).then(() => toast.show('Link copied'))}>
            Copy link
          </MenuItem>
          <MenuItem
            icon={<LayoutTemplate className="size-4" />}
            onSelect={() => updateCard(card, { is_template: !card.is_template }).then(onChanged).catch(toast.error)}
          >
            {card.is_template ? 'Stop using as template' : 'Make into template'}
          </MenuItem>
          <MenuSeparator />
          {card.archived_at ? (
            <MenuItem icon={<Archive className="size-4" />} onSelect={() => setCardsArchived([card], false).then(onChanged).catch(toast.error)}>
              Restore from archive
            </MenuItem>
          ) : (
            <MenuItem
              icon={<Archive className="size-4" />}
              onSelect={async () => {
                try {
                  await setCardsArchived([card], true);
                  toast.show(`Archived “${card.title}”`, {
                    undo: async () => {
                      const fresh = await fetchCard(card.id);
                      if (fresh) await setCardsArchived([fresh], false);
                    },
                  });
                  onClose();
                } catch (err) {
                  toast.error(err);
                }
              }}
            >
              Archive
            </MenuItem>
          )}
          {card.deleted_at ? (
            <MenuItem icon={<Trash2 className="size-4" />} onSelect={() => trashCard(card, false).then(onChanged).catch(toast.error)}>
              Restore from trash
            </MenuItem>
          ) : (
            <MenuItem
              icon={<Trash2 className="size-4" />}
              onSelect={async () => {
                try {
                  await trashCard(card, true);
                  toast.show(`Moved “${card.title}” to trash`, {
                    undo: async () => {
                      const fresh = await fetchCard(card.id);
                      if (fresh) await trashCard(fresh, false);
                    },
                  });
                  onClose();
                } catch (err) {
                  toast.error(err);
                }
              }}
            >
              Move to trash
            </MenuItem>
          )}
          {ctx.canManage && (
            <MenuItem danger icon={<Trash2 className="size-4" />} onSelect={() => setConfirmDelete(true)}>
              Delete permanently…
            </MenuItem>
          )}
        </MenuContent>
      </MenuRoot>
      {moveOpen && (
        <MoveCopyDialog
          mode={moveOpen}
          card={card}
          lists={lists}
          boards={boards}
          onClose={() => setMoveOpen(null)}
          onDone={(newId) => {
            setMoveOpen(null);
            if (newId) ctx.openCard(newId);
            else onChanged();
          }}
        />
      )}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        danger
        title="Delete this task permanently?"
        confirmLabel="Delete"
        body="Comments, checklists, attachments and history for this task will be removed. This cannot be undone."
        onConfirm={() =>
          deleteCardPermanently(card)
            .then(() => {
              setConfirmDelete(false);
              onClose();
            })
            .catch(toast.error)
        }
      />
    </>
  );
}

function MoveCopyDialog({
  mode,
  card,
  lists,
  boards,
  onClose,
  onDone,
}: {
  mode: 'move' | 'copy';
  card: CardWithRelations;
  lists: List[];
  boards: Board[];
  onClose: () => void;
  onDone: (newId?: string) => void;
}) {
  const [boardId, setBoardId] = useState(card.board_id);
  const boardLists = lists.filter((l) => l.board_id === boardId);
  const [listId, setListId] = useState(card.list_id);
  const [title, setTitle] = useState(card.title);
  const [opts, setOpts] = useState({ checklists: true, labels: true, members: true });
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => {
    if (!boardLists.some((l) => l.id === listId)) setListId(boardLists[0]?.id ?? '');
  }, [boardId]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Dialog
      open
      onOpenChange={onClose}
      title={mode === 'move' ? 'Move task' : 'Copy task'}
      width={440}
      footer={
        <Button
          variant="primary"
          loading={busy}
          disabled={!listId}
          onClick={async () => {
            setBusy(true);
            try {
              if (mode === 'move') {
                const siblings = must(await sb().from('cards').select('id, position').eq('list_id', listId)) as { id: string; position: string }[];
                await updateCard(card, { list_id: listId, position: keyAfterLast(siblings.filter((s) => s.id !== card.id)) });
                if (boardId !== card.board_id) toast.show('Moved. Labels and custom fields from the previous board were removed.');
                onDone();
              } else {
                const id = await copyCard(card.id, listId, title, opts);
                onDone(id);
              }
            } catch (err) {
              toast.error(err);
            } finally {
              setBusy(false);
            }
          }}
        >
          {mode === 'move' ? 'Move' : 'Create copy'}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        {mode === 'copy' && (
          <label className="text-sm font-bold">
            Title
            <Input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1" />
          </label>
        )}
        <label className="text-sm font-bold">
          Board
          <Select value={boardId} onChange={(e) => setBoardId(e.target.value)} className="mt-1">
            {boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="text-sm font-bold">
          List
          <Select value={listId} onChange={(e) => setListId(e.target.value)} className="mt-1">
            {boardLists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </label>
        {mode === 'copy' && (
          <fieldset className="flex flex-col gap-1 text-sm">
            <legend className="mb-1 font-bold">Keep</legend>
            {(['checklists', 'labels', 'members'] as const).map((k) => (
              <label key={k} className="flex items-center gap-2">
                <input type="checkbox" className="accent-[var(--v-teal-deep)]" checked={opts[k]} onChange={(e) => setOpts({ ...opts, [k]: e.target.checked })} />
                {k === 'members' ? 'Assignees' : k[0].toUpperCase() + k.slice(1)}
              </label>
            ))}
          </fieldset>
        )}
      </div>
    </Dialog>
  );
}
