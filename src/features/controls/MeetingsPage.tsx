import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { format, parseISO } from 'date-fns';
import { CalendarClock, CheckCircle2, Circle, Download, ExternalLink, MapPin, Plus, Trash2, ListPlus } from 'lucide-react';
import {
  actionToCard,
  addAction,
  addDecision,
  deleteAction,
  deleteDecision,
  saveMeeting,
  updateAction,
  useMeetingDetail,
  useMeetings,
  type Meeting,
  type MeetingAction,
  type MeetingInput,
} from '@/data/controls';
import { useBoardData, useBoards } from '@/data/core';
import { useProjectCtx } from '@/features/project/context';
import { Avatar, Button, Checkbox, EmptyState, ErrorNote, Field, IconButton, Input, PageHeader, PageLoading, Select, Textarea } from '@/components/ui';
import { Dialog } from '@/components/ui/Dialog';
import { Markdown } from '@/components/ui/Markdown';
import { useToast } from '@/components/ui/Toast';
import { downloadPDF } from '@/lib/exporters';
import { keyAfterLast } from '@/domain/ordering';
import { cn } from '@/lib/cn';
import { fmtDate } from './helpers';

const STATUS_LABEL = { planned: 'Planned', held: 'Held', cancelled: 'Cancelled' } as const;

function toLocalInput(iso: string | null): string {
  return iso ? format(parseISO(iso), "yyyy-MM-dd'T'HH:mm") : '';
}
function fromLocalInput(v: string): string | null {
  return v ? new Date(v).toISOString() : null;
}

export default function MeetingsPage() {
  const { project, canEdit } = useProjectCtx();
  const meetings = useMeetings(project.id);
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const selectedId = params.get('meeting');
  const now = new Date().toISOString();
  const upcoming = useMemo(() => (meetings.data ?? []).filter((m) => m.starts_at >= now && m.status !== 'cancelled').sort((a, b) => a.starts_at.localeCompare(b.starts_at)), [meetings.data, now]);
  const past = useMemo(() => (meetings.data ?? []).filter((m) => m.starts_at < now || m.status === 'cancelled'), [meetings.data, now]);
  const selected = (meetings.data ?? []).find((m) => m.id === selectedId) ?? null;
  const select = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('meeting', id);
    else next.delete('meeting');
    setParams(next);
  };

  if (meetings.isLoading) return <PageLoading />;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 px-3 py-4 sm:px-5">
      <PageHeader
        title="Meetings"
        subtitle="Agendas, minutes, decisions and action items. Actions can become ordinary tasks."
        actions={
          canEdit && (
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              New meeting
            </Button>
          )
        }
      />
      {meetings.error && <ErrorNote error={meetings.error} retry={() => meetings.refetch()} />}
      {(meetings.data ?? []).length === 0 ? (
        <EmptyState title="No meetings yet" action={canEdit ? <Button size="sm" variant="primary" onClick={() => setCreating(true)}>Plan a meeting</Button> : undefined}>
          Record agendas and minutes, capture decisions, and turn action items into tasks.
        </EmptyState>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
          <nav aria-label="Meetings" className="flex flex-col gap-4">
            <MeetingList title="Upcoming" items={upcoming} selected={selectedId} onSelect={select} />
            <MeetingList title="Past" items={past} selected={selectedId} onSelect={select} />
          </nav>
          <div className="min-w-0">
            {selected ? <MeetingDetail key={selected.id} meeting={selected} onDeleted={() => select(null)} /> : <p className="text-sm text-secondary">Select a meeting to see its agenda, minutes and actions.</p>}
          </div>
        </div>
      )}
      {creating && (
        <MeetingEditor
          onClose={() => setCreating(false)}
          onSaved={(m) => {
            setCreating(false);
            select(m.id);
          }}
        />
      )}
    </div>
  );
}

function MeetingList({ title, items, selected, onSelect }: { title: string; items: Meeting[]; selected: string | null; onSelect: (id: string) => void }) {
  return (
    <section>
      <h2 className="mb-1 font-sans text-xs font-bold text-secondary">
        {title} <span className="num font-normal">{items.length}</span>
      </h2>
      {items.length === 0 ? (
        <p className="text-xs text-secondary">None.</p>
      ) : (
        <ul className="flex flex-col">
          {items.map((m) => (
            <li key={m.id}>
              <button
                onClick={() => onSelect(m.id)}
                aria-current={selected === m.id}
                className={cn('w-full rounded-[4px] px-2 py-1.5 text-left hover:bg-hover', selected === m.id && 'bg-selected')}
              >
                <span className={cn('block truncate text-sm', m.status === 'cancelled' && 'text-secondary line-through')}>{m.title}</span>
                <span className="num block text-xs text-secondary">
                  {format(parseISO(m.starts_at), 'EEE d MMM yyyy, HH:mm')}
                  {m.status !== 'planned' && ` · ${STATUS_LABEL[m.status]}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MeetingEditor({ meeting, onClose, onSaved }: { meeting?: Meeting; onClose: () => void; onSaved: (m: Meeting) => void }) {
  const { project, people } = useProjectCtx();
  const toast = useToast();
  const [form, setForm] = useState<MeetingInput>({
    title: meeting?.title ?? '',
    starts_at: meeting?.starts_at ?? new Date(Math.ceil(Date.now() / 3600000) * 3600000).toISOString(),
    ends_at: meeting?.ends_at ?? null,
    location: meeting?.location ?? '',
    online_url: meeting?.online_url ?? null,
    status: meeting?.status ?? 'planned',
    attendees: meeting?.attendees ?? [],
    external_attendees: meeting?.external_attendees ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof MeetingInput>(k: K, v: MeetingInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <Dialog
      open
      onOpenChange={onClose}
      title={meeting ? 'Edit meeting' : 'New meeting'}
      width={600}
      footer={
        <Button
          variant="primary"
          loading={busy}
          onClick={async () => {
            setError(null);
            if (!form.title?.trim()) return setError('A title is required.');
            if (!form.starts_at) return setError('Choose a start time.');
            if (form.ends_at && form.ends_at < form.starts_at) return setError('The end must be after the start.');
            if (form.online_url && !/^https?:\/\//i.test(form.online_url)) return setError('The online link must start with http:// or https://');
            setBusy(true);
            try {
              const m = await saveMeeting(project.id, { ...form, title: form.title!.trim(), online_url: form.online_url || null }, meeting);
              onSaved(m);
            } catch (err) {
              toast.error(err);
            } finally {
              setBusy(false);
            }
          }}
        >
          {meeting ? 'Save' : 'Create'}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Title" htmlFor="mt-title">
          <Input id="mt-title" value={form.title} onChange={(e) => set('title', e.target.value)} maxLength={300} placeholder="e.g. Monthly consortium meeting" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Starts" htmlFor="mt-start">
            <Input id="mt-start" type="datetime-local" value={toLocalInput(form.starts_at ?? null)} onChange={(e) => set('starts_at', fromLocalInput(e.target.value) ?? undefined)} />
          </Field>
          <Field label="Ends" htmlFor="mt-end">
            <Input id="mt-end" type="datetime-local" value={toLocalInput(form.ends_at ?? null)} onChange={(e) => set('ends_at', fromLocalInput(e.target.value))} />
          </Field>
          <Field label="Status" htmlFor="mt-status">
            <Select id="mt-status" value={form.status} onChange={(e) => set('status', e.target.value as Meeting['status'])}>
              <option value="planned">Planned</option>
              <option value="held">Held</option>
              <option value="cancelled">Cancelled</option>
            </Select>
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Location" htmlFor="mt-loc">
            <Input id="mt-loc" value={form.location} onChange={(e) => set('location', e.target.value)} />
          </Field>
          <Field label="Online meeting link" htmlFor="mt-url">
            <Input id="mt-url" value={form.online_url ?? ''} onChange={(e) => set('online_url', e.target.value)} placeholder="https://…" />
          </Field>
        </div>
        <fieldset>
          <legend className="mb-1 text-[13px] font-bold">Attendees</legend>
          <div className="grid max-h-40 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
            {people.map((p) => (
              <Checkbox
                key={p.user_id}
                checked={(form.attendees ?? []).includes(p.user_id)}
                onChange={(v) => set('attendees', v ? [...(form.attendees ?? []), p.user_id] : (form.attendees ?? []).filter((x) => x !== p.user_id))}
                label={p.display_name}
              />
            ))}
          </div>
        </fieldset>
        <Field label="Other attendees" htmlFor="mt-ext" hint="People without a Tessera account, one per line or comma separated.">
          <Textarea id="mt-ext" rows={2} value={form.external_attendees} onChange={(e) => set('external_attendees', e.target.value)} />
        </Field>
        {error && (
          <p role="alert" className="text-sm text-critical">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}

function MarkdownBlock({ label, value, canEdit, onSave, placeholder }: { label: string; value: string; canEdit: boolean; onSave: (v: string) => Promise<void>; placeholder: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);
  return (
    <section>
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-sm">{label}</h3>
        {canEdit && !editing && (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            Edit
          </Button>
        )}
      </div>
      {editing ? (
        <div className="flex flex-col gap-2">
          <Textarea autoFocus rows={10} value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={`${label} (Markdown)`} onKeyDown={(e) => e.stopPropagation()} />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="primary"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onSave(draft);
                  setEditing(false);
                } catch {
                  /* error already shown; the draft is kept */
                } finally {
                  setBusy(false);
                }
              }}
            >
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => (setDraft(value), setEditing(false))}>
              Cancel
            </Button>
          </div>
        </div>
      ) : value.trim() ? (
        <Markdown source={value} />
      ) : (
        <p className="text-sm text-secondary">{placeholder}</p>
      )}
    </section>
  );
}

function MeetingDetail({ meeting, onDeleted }: { meeting: Meeting; onDeleted: () => void }) {
  const { project, canEdit, people, openCard } = useProjectCtx();
  const detail = useMeetingDetail(project.id, meeting.id);
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [decision, setDecision] = useState('');
  const [action, setAction] = useState({ title: '', owner_id: '', due_date: '' });
  const [toCard, setToCard] = useState<MeetingAction | null>(null);
  const attendees = meeting.attendees.map((id) => people.find((p) => p.user_id === id)).filter(Boolean) as typeof people;
  const save = async (patch: MeetingInput) => {
    try {
      await saveMeeting(project.id, patch, meeting);
    } catch (err) {
      toast.error(err);
      throw err;
    }
  };
  const decisions = detail.data?.decisions ?? [];
  const actions = detail.data?.actions ?? [];

  const exportPdf = () =>
    downloadPDF(
      `${format(parseISO(meeting.starts_at), 'yyyy-MM-dd')}_${meeting.title.replace(/[^\w-]+/g, '_')}_minutes`,
      meeting.title,
      `${project.name} · ${format(parseISO(meeting.starts_at), 'EEEE d MMMM yyyy, HH:mm')}${meeting.location ? ` · ${meeting.location}` : ''}`,
      [
        { heading: 'Attendees', paragraphs: [[...attendees.map((a) => a.display_name), ...meeting.external_attendees.split(/[\n,]/).map((s) => s.trim()).filter(Boolean)].join(', ') || 'Not recorded'] },
        { heading: 'Agenda', paragraphs: [meeting.agenda.trim() || 'No agenda recorded.'] },
        { heading: 'Minutes', paragraphs: [meeting.minutes.trim() || 'No minutes recorded.'] },
        { heading: 'Decisions', table: { head: ['#', 'Decision'], body: decisions.map((d, i) => [i + 1, d.text]) } },
        {
          heading: 'Action items',
          table: {
            head: ['Action', 'Owner', 'Due', 'Status'],
            body: actions.map((a) => [a.title, people.find((p) => p.user_id === a.owner_id)?.display_name ?? '', a.due_date, a.status === 'done' ? 'Done' : 'Open']),
          },
        },
      ],
    ).catch(toast.error);

  return (
    <article className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start gap-3 border-b border-grid pb-3">
        <div className="min-w-0 flex-1">
          <h2 className={cn('text-xl', meeting.status === 'cancelled' && 'line-through')}>{meeting.title}</h2>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-secondary">
            <span className="inline-flex items-center gap-1">
              <CalendarClock className="size-4" aria-hidden />
              {format(parseISO(meeting.starts_at), 'EEE d MMM yyyy, HH:mm')}
              {meeting.ends_at && `–${format(parseISO(meeting.ends_at), 'HH:mm')}`}
            </span>
            {meeting.location && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-4" aria-hidden />
                {meeting.location}
              </span>
            )}
            {meeting.online_url && (
              <a className="inline-flex items-center gap-1 text-link hover:underline" href={meeting.online_url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="size-4" aria-hidden />
                Join online
              </a>
            )}
            <span>{STATUS_LABEL[meeting.status]}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" icon={<Download className="size-3.5" />} onClick={exportPdf}>
            Minutes PDF
          </Button>
          {canEdit && meeting.status === 'planned' && (
            <Button size="sm" onClick={() => save({ status: 'held' }).catch(() => {})}>
              Mark as held
            </Button>
          )}
          {canEdit && (
            <>
              <Button size="sm" onClick={() => setEditing(true)}>
                Edit details
              </Button>
              <IconButton
                label="Delete meeting"
                onClick={async () => {
                  try {
                    const row = await saveMeeting(project.id, { deleted_at: new Date().toISOString() }, meeting);
                    onDeleted();
                    toast.show(`Deleted “${meeting.title}”`, { undo: () => saveMeeting(project.id, { deleted_at: null }, row).then(() => undefined) });
                  } catch (err) {
                    toast.error(err);
                  }
                }}
              >
                <Trash2 className="size-4" />
              </IconButton>
            </>
          )}
        </div>
      </header>

      <section className="text-sm">
        <h3 className="mb-1 text-sm">Attendees</h3>
        <div className="flex flex-wrap gap-2">
          {attendees.map((p) => (
            <span key={p.user_id} className="inline-flex items-center gap-1.5 rounded-[3px] bg-card py-0.5 pl-0.5 pr-2">
              <Avatar name={p.display_name} color={p.avatar_color} size={20} />
              {p.display_name}
            </span>
          ))}
          {meeting.external_attendees.trim() && <span className="text-secondary">{meeting.external_attendees}</span>}
          {attendees.length === 0 && !meeting.external_attendees.trim() && <span className="text-secondary">Not recorded.</span>}
        </div>
      </section>

      <MarkdownBlock label="Agenda" value={meeting.agenda} canEdit={canEdit} onSave={(agenda) => save({ agenda })} placeholder="No agenda yet." />
      <MarkdownBlock label="Minutes" value={meeting.minutes} canEdit={canEdit} onSave={(minutes) => save({ minutes })} placeholder="No minutes yet." />

      <section>
        <h3 className="mb-1 text-sm">
          Decisions <span className="num font-normal text-secondary">{decisions.length}</span>
        </h3>
        <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm">
          {decisions.map((d) => (
            <li key={d.id} className="group">
              <span>{d.text}</span>
              {canEdit && (
                <button aria-label="Delete decision" className="invisible ml-2 align-middle text-muted hover:text-critical group-hover:visible focus:visible" onClick={() => deleteDecision(d).catch(toast.error)}>
                  <Trash2 className="inline size-3.5" />
                </button>
              )}
            </li>
          ))}
        </ol>
        {decisions.length === 0 && <p className="text-sm text-secondary">No decisions recorded.</p>}
        {canEdit && (
          <form
            className="mt-2 flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!decision.trim()) return;
              try {
                await addDecision(project.id, meeting.id, decision.trim(), keyAfterLast(decisions));
                setDecision('');
              } catch (err) {
                toast.error(err);
              }
            }}
          >
            <Input value={decision} onChange={(e) => setDecision(e.target.value)} placeholder="Record a decision" className="h-8" aria-label="New decision" />
            <Button size="sm" type="submit" disabled={!decision.trim()}>
              Add
            </Button>
          </form>
        )}
      </section>

      <section>
        <h3 className="mb-1 text-sm">
          Action items <span className="num font-normal text-secondary">{actions.filter((a) => a.status === 'open').length} open</span>
        </h3>
        {actions.length === 0 && <p className="text-sm text-secondary">No actions recorded.</p>}
        <ul className="flex flex-col divide-y divide-grid">
          {actions.map((a) => {
            const owner = people.find((p) => p.user_id === a.owner_id);
            return (
              <li key={a.id} className="flex flex-wrap items-center gap-2 py-1.5 text-sm">
                <button
                  aria-label={a.status === 'done' ? `Reopen ${a.title}` : `Mark ${a.title} done`}
                  disabled={!canEdit || Boolean(a.card_id)}
                  title={a.card_id ? 'Status follows the linked task' : undefined}
                  onClick={() => updateAction(a, { status: a.status === 'done' ? 'open' : 'done' }).catch(toast.error)}
                  className={a.status === 'done' ? 'text-good' : 'text-secondary'}
                >
                  {a.status === 'done' ? <CheckCircle2 className="size-4" /> : <Circle className="size-4" />}
                </button>
                <span className={cn('min-w-0 flex-1', a.status === 'done' && 'text-secondary line-through')}>{a.title}</span>
                {owner && (
                  <span className="inline-flex items-center gap-1 text-xs">
                    <Avatar name={owner.display_name} color={owner.avatar_color} size={18} />
                    {owner.display_name}
                  </span>
                )}
                {a.due_date && <span className="num text-xs text-secondary">{fmtDate(a.due_date, 'd MMM')}</span>}
                {a.card_id ? (
                  <Button size="sm" variant="ghost" onClick={() => openCard(a.card_id!)}>
                    Open task
                  </Button>
                ) : (
                  canEdit && (
                    <Button size="sm" variant="ghost" icon={<ListPlus className="size-3.5" />} onClick={() => setToCard(a)}>
                      Create task
                    </Button>
                  )
                )}
                {canEdit && (
                  <IconButton label={`Delete action ${a.title}`} onClick={() => deleteAction(a).catch(toast.error)}>
                    <Trash2 className="size-3.5" />
                  </IconButton>
                )}
              </li>
            );
          })}
        </ul>
        {canEdit && (
          <form
            className="mt-2 grid gap-2 sm:grid-cols-[1fr_160px_150px_auto]"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!action.title.trim()) return;
              try {
                await addAction(project.id, meeting.id, { title: action.title.trim(), owner_id: action.owner_id || null, due_date: action.due_date || null, position: keyAfterLast(actions) });
                setAction({ title: '', owner_id: '', due_date: '' });
              } catch (err) {
                toast.error(err);
              }
            }}
          >
            <Input value={action.title} onChange={(e) => setAction({ ...action, title: e.target.value })} placeholder="New action item" className="h-8" aria-label="Action title" />
            <Select value={action.owner_id} onChange={(e) => setAction({ ...action, owner_id: e.target.value })} className="h-8" aria-label="Owner">
              <option value="">No owner</option>
              {people.map((p) => (
                <option key={p.user_id} value={p.user_id}>
                  {p.display_name}
                </option>
              ))}
            </Select>
            <Input type="date" value={action.due_date} onChange={(e) => setAction({ ...action, due_date: e.target.value })} className="h-8" aria-label="Due date" />
            <Button size="sm" type="submit" disabled={!action.title.trim()}>
              Add
            </Button>
          </form>
        )}
      </section>

      {editing && <MeetingEditor meeting={meeting} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />}
      {toCard && <ActionToCardDialog action={toCard} onClose={() => setToCard(null)} onCreated={(id) => (setToCard(null), openCard(id))} />}
      {detail.error && <ErrorNote error={detail.error} retry={() => detail.refetch()} />}
    </article>
  );
}

function ActionToCardDialog({ action, onClose, onCreated }: { action: MeetingAction; onClose: () => void; onCreated: (cardId: string) => void }) {
  const { project } = useProjectCtx();
  const boards = useBoards(project.id);
  const live = (boards.data ?? []).filter((b) => !b.archived_at && !b.is_template);
  const [boardId, setBoardId] = useState('');
  const effectiveBoard = boardId || live[0]?.id || '';
  const data = useBoardData(project.id, effectiveBoard || undefined);
  const [listId, setListId] = useState('');
  const effectiveList = listId || data.data?.lists[0]?.id || '';
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <Dialog
      open
      onOpenChange={onClose}
      title="Create a task from this action"
      description={action.title}
      width={420}
      footer={
        <Button
          variant="primary"
          loading={busy}
          disabled={!effectiveList}
          onClick={async () => {
            setBusy(true);
            try {
              const id = await actionToCard(action, effectiveList);
              toast.show('Task created; its status now updates the action item');
              onCreated(id);
            } catch (err) {
              toast.error(err);
            } finally {
              setBusy(false);
            }
          }}
        >
          Create task
        </Button>
      }
    >
      {live.length === 0 ? (
        <p className="text-sm text-secondary">This project has no board yet. Create a board first.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <Field label="Board" htmlFor="atc-board">
            <Select id="atc-board" value={effectiveBoard} onChange={(e) => (setBoardId(e.target.value), setListId(''))}>
              {live.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="List" htmlFor="atc-list">
            <Select id="atc-list" value={effectiveList} onChange={(e) => setListId(e.target.value)}>
              {(data.data?.lists ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </Field>
          <p className="text-xs text-secondary">The owner is assigned and the due date copied. Completing the task completes the action.</p>
        </div>
      )}
    </Dialog>
  );
}
