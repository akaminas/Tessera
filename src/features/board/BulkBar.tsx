import { useState } from 'react';
import { Archive, CalendarDays, CheckCircle2, Tag as TagIcon, UserPlus, ArrowRight, X } from 'lucide-react';
import { Button, Input } from '@/components/ui';
import { MenuContent, MenuItem, MenuRoot, MenuTrigger } from '@/components/ui/Menu';
import { Popover } from '@/components/ui/Menu';
import { useToast } from '@/components/ui/Toast';
import { keysAfter } from '@/domain/ordering';
import { fetchCard, setAssignee, setCardLabel, setCardsArchived, updateCard } from '@/data/cards';
import type { CardStatus, CardWithRelations, Label, List, Person } from '@/data/types';
import { STATUS_LABEL, LABEL_NAME } from '@/components/ui';

/** Bulk actions for selected tasks. Every action is undoable where meaningful. */
export function BulkBar({
  cards,
  allCards,
  lists,
  labels,
  people,
  onDone,
}: {
  cards: CardWithRelations[];
  allCards: CardWithRelations[];
  lists: List[];
  labels: Label[];
  people: Person[];
  onDone: () => void;
}) {
  const toast = useToast();
  const [due, setDue] = useState('');
  const run = async (label: string, fn: (c: CardWithRelations) => Promise<unknown>) => {
    try {
      for (const c of cards) {
        const fresh = (await fetchCard(c.id)) ?? c;
        await fn(fresh);
      }
      toast.show(`${label}: ${cards.length} task${cards.length === 1 ? '' : 's'}`);
      onDone();
    } catch (err) {
      toast.error(err);
    }
  };
  return (
    <div className="no-print fixed bottom-4 left-1/2 z-30 flex max-w-[calc(100vw-24px)] -translate-x-1/2 flex-wrap items-center gap-1.5 rounded-[6px] border border-rule bg-surface px-3 py-2">
      <span className="mr-1 text-sm font-bold">{cards.length} selected</span>
      <MenuRoot>
        <MenuTrigger asChild>
          <Button size="sm" icon={<ArrowRight className="size-3.5" />}>
            Move
          </Button>
        </MenuTrigger>
        <MenuContent align="start">
          {lists.map((l) => (
            <MenuItem
              key={l.id}
              onSelect={() => {
                const ids = new Set(cards.map((c) => c.id));
                const keys = keysAfter(allCards.filter((x) => x.list_id === l.id && !ids.has(x.id)), cards.length);
                let i = 0;
                run(`Moved to ${l.name}`, (c) => updateCard(c, { list_id: l.id, position: keys[i++] }));
              }}
            >
              {l.name}
            </MenuItem>
          ))}
        </MenuContent>
      </MenuRoot>
      <MenuRoot>
        <MenuTrigger asChild>
          <Button size="sm" icon={<CheckCircle2 className="size-3.5" />}>
            Status
          </Button>
        </MenuTrigger>
        <MenuContent align="start">
          {(Object.keys(STATUS_LABEL) as CardStatus[]).map((s) => (
            <MenuItem key={s} onSelect={() => run(`Set ${STATUS_LABEL[s].toLowerCase()}`, (c) => updateCard(c, { status: s }))}>
              {STATUS_LABEL[s]}
            </MenuItem>
          ))}
        </MenuContent>
      </MenuRoot>
      <MenuRoot>
        <MenuTrigger asChild>
          <Button size="sm" icon={<UserPlus className="size-3.5" />}>
            Assign
          </Button>
        </MenuTrigger>
        <MenuContent align="start">
          {people.map((p) => (
            <MenuItem key={p.user_id} onSelect={() => run(`Assigned ${p.display_name}`, (c) => setAssignee(c, p.user_id, true))}>
              {p.display_name}
            </MenuItem>
          ))}
        </MenuContent>
      </MenuRoot>
      {labels.length > 0 && (
        <MenuRoot>
          <MenuTrigger asChild>
            <Button size="sm" icon={<TagIcon className="size-3.5" />}>
              Label
            </Button>
          </MenuTrigger>
          <MenuContent align="start">
            {labels.map((l) => (
              <MenuItem key={l.id} onSelect={() => run(`Labelled ${l.name}`, (c) => setCardLabel(c, l.id, true))}>
                {l.name || LABEL_NAME[l.color]}
              </MenuItem>
            ))}
          </MenuContent>
        </MenuRoot>
      )}
      <Popover
        trigger={
          <Button size="sm" icon={<CalendarDays className="size-3.5" />}>
            Due date
          </Button>
        }
      >
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(due ? 'Due date set' : 'Due date removed', (c) => updateCard(c, { due_date: due || null }));
          }}
        >
          <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date" />
          <Button size="sm" type="submit" variant="primary">
            {due ? 'Set due date' : 'Remove due dates'}
          </Button>
        </form>
      </Popover>
      <Button
        size="sm"
        icon={<Archive className="size-3.5" />}
        onClick={async () => {
          try {
            await setCardsArchived(cards, true);
            const ids = cards.map((c) => c.id);
            toast.show(`Archived ${cards.length} task${cards.length === 1 ? '' : 's'}`, {
              undo: async () => {
                const fresh = (await Promise.all(ids.map(fetchCard))).filter(Boolean) as CardWithRelations[];
                await setCardsArchived(fresh, false);
              },
            });
            onDone();
          } catch (err) {
            toast.error(err);
          }
        }}
      >
        Archive
      </Button>
      <Button size="sm" variant="ghost" icon={<X className="size-3.5" />} onClick={onDone}>
        Clear
      </Button>
    </div>
  );
}
