import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Crosshair, MapPin, Plus, X } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { useProjectCtx } from '@/features/project/context';
import { useProjectCards, useProjectStructure, updateCardEverywhere } from '@/data/views';
import { createCard } from '@/data/cards';
import { matchesFilter, type CardFilter } from '@/domain/cardFilter';
import { keyAfterLast } from '@/domain/ordering';
import { usePersistentState } from '@/lib/usePersistentState';
import { Button, ErrorNote, Field, IconButton, Input, PageLoading, Select } from '@/components/ui';
import { Dialog } from '@/components/ui/Dialog';
import { useToast } from '@/components/ui/Toast';
import { FilterBar } from './FilterBar';
import { cn } from '@/lib/cn';
import type { CardWithRelations } from '@/data/types';

type Mode = { kind: 'idle' } | { kind: 'place'; cardId: string } | { kind: 'create' };

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export default function MapView() {
  const ctx = useProjectCtx();
  const { project, people, canEdit, openCard } = ctx;
  const { user } = useAuth();
  const toast = useToast();
  const cardsQ = useProjectCards(project.id);
  const structQ = useProjectStructure(project.id);
  const [filter, setFilter] = usePersistentState<CardFilter>(`map-filter:${project.id}`, {}, 'session');
  const [mode, setMode] = useState<Mode>({ kind: 'idle' });
  const [createAt, setCreateAt] = useState<{ lat: number; lng: number } | null>(null);
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const fitted = useRef(false);
  const clickRef = useRef<(ll: L.LatLng) => void>(() => {});
  const openRef = useRef(openCard);
  openRef.current = openCard;

  const cards = useMemo(() => (cardsQ.data ?? []).filter((c) => matchesFilter(c, filter, user!.id)), [cardsQ.data, filter, user]);
  const located = useMemo(() => cards.filter((c) => c.lat != null && c.lng != null), [cards]);
  const unlocated = useMemo(() => cards.filter((c) => (c.lat == null || c.lng == null) && c.status !== 'done'), [cards]);
  const placing = mode.kind === 'place' ? (cardsQ.data ?? []).find((c) => c.id === mode.cardId) : undefined;

  // map click behaviour depends on the current mode
  clickRef.current = (ll) => {
    if (mode.kind === 'place' && placing) {
      const lat = +ll.lat.toFixed(6);
      const lng = +ll.lng.toFixed(6);
      const before = { lat: placing.lat, lng: placing.lng };
      updateCardEverywhere(placing, { lat, lng })
        .then((res) => toast.show(`Placed “${placing.title}”`, { undo: () => updateCardEverywhere(res, before).then(() => undefined) }))
        .catch(toast.error);
      setMode({ kind: 'idle' });
    } else if (mode.kind === 'create') {
      setCreateAt({ lat: +ll.lat.toFixed(6), lng: +ll.lng.toFixed(6) });
      setMode({ kind: 'idle' });
    }
  };

  useEffect(() => {
    if (!mapEl.current || mapRef.current) return;
    const map = L.map(mapEl.current, { zoomControl: true, worldCopyJump: true }).setView([40, 10], 3);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    map.on('click', (e: L.LeafletMouseEvent) => clickRef.current(e.latlng));
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, [cardsQ.isLoading]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const teal = cssVar('--v-teal-deep', '#004c50');
    const moss = cssVar('--v-moss', '#567e4d');
    const terracotta = cssVar('--v-terracotta', '#a1644f');
    const surface = cssVar('--v-surface', '#ffffff');
    const today = new Date().toISOString().slice(0, 10);
    for (const c of located) {
      const overdue = Boolean(c.due_date && c.due_date < today && c.status !== 'done');
      const marker = L.circleMarker([c.lat!, c.lng!], {
        radius: 8,
        color: surface,
        weight: 2,
        fillColor: c.status === 'done' ? moss : overdue ? terracotta : teal,
        fillOpacity: 1,
      });
      const box = document.createElement('div');
      box.style.minWidth = '160px';
      const title = document.createElement('p');
      title.textContent = c.title;
      title.style.fontWeight = '700';
      title.style.margin = '0 0 2px';
      box.appendChild(title);
      const meta = document.createElement('p');
      meta.textContent = [c.location_label, c.status === 'done' ? 'Done' : overdue ? 'Overdue' : c.due_date ? `Due ${c.due_date}` : ''].filter(Boolean).join(' · ');
      meta.style.margin = '0 0 6px';
      meta.style.fontSize = '12px';
      box.appendChild(meta);
      const btn = document.createElement('button');
      btn.textContent = 'Open task';
      btn.style.textDecoration = 'underline';
      btn.onclick = () => openRef.current(c.id);
      box.appendChild(btn);
      marker.bindPopup(box);
      marker.bindTooltip(c.title);
      marker.addTo(layer);
    }
    if (!fitted.current && located.length) {
      fitted.current = true;
      map.fitBounds(L.latLngBounds(located.map((c) => [c.lat!, c.lng!] as [number, number])), { padding: [40, 40], maxZoom: 13 });
    }
  }, [located]);

  useEffect(() => {
    const el = mapEl.current;
    if (el) el.style.cursor = mode.kind === 'idle' ? '' : 'crosshair';
  }, [mode]);

  if (cardsQ.isLoading || structQ.isLoading) return <PageLoading />;
  if (cardsQ.error) return <div className="p-6"><ErrorNote error={cardsQ.error} retry={() => cardsQ.refetch()} /></div>;

  const fitAll = () => {
    if (mapRef.current && located.length) mapRef.current.fitBounds(L.latLngBounds(located.map((c) => [c.lat!, c.lng!] as [number, number])), { padding: [40, 40], maxZoom: 13 });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="no-print flex flex-wrap items-center gap-2 border-b border-grid px-3 py-2 sm:px-5">
        <FilterBar filter={filter} onChange={setFilter} people={people} labels={structQ.data?.labels} view="map" projectId={project.id} />
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" icon={<Crosshair className="size-3.5" />} onClick={fitAll} disabled={!located.length}>
            Show all
          </Button>
          {canEdit && (
            <Button size="sm" variant={mode.kind === 'create' ? 'primary' : 'secondary'} icon={<Plus className="size-3.5" />} onClick={() => setMode(mode.kind === 'create' ? { kind: 'idle' } : { kind: 'create' })} aria-pressed={mode.kind === 'create'}>
              New task here
            </Button>
          )}
        </div>
      </div>
      {mode.kind !== 'idle' && (
        <div role="status" className="flex items-center gap-2 border-b border-grid bg-card px-3 py-1.5 text-sm sm:px-5">
          <MapPin className="size-4 text-teal-deep" aria-hidden />
          <span className="flex-1">{mode.kind === 'place' ? `Click the map to place “${placing?.title ?? ''}”.` : 'Click the map where the new task belongs.'}</span>
          <Button size="sm" variant="ghost" icon={<X className="size-3.5" />} onClick={() => setMode({ kind: 'idle' })}>
            Cancel
          </Button>
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div ref={mapEl} className="z-0 min-h-[360px] flex-1" role="application" aria-label="Map of tasks with a location" />
        <aside className="scroll-thin max-h-[40vh] w-full shrink-0 overflow-y-auto border-t border-grid p-3 md:max-h-none md:w-72 md:border-l md:border-t-0" aria-label="Tasks and locations">
          <h3 className="mb-1 text-sm">
            On the map <span className="num font-normal text-secondary">{located.length}</span>
          </h3>
          {located.length === 0 && <p className="mb-3 text-sm text-secondary">No task has a location yet.</p>}
          <ul className="mb-4 flex flex-col">
            {located.map((c) => (
              <li key={c.id} className="flex items-center gap-1">
                <button
                  className="min-w-0 flex-1 truncate rounded-[3px] px-1 py-1 text-left text-[13px] hover:bg-hover"
                  onClick={() => mapRef.current?.setView([c.lat!, c.lng!], Math.max(mapRef.current.getZoom(), 12))}
                  title="Zoom to this task"
                >
                  {c.title}
                  {c.location_label && <span className="text-xs text-secondary"> · {c.location_label}</span>}
                </button>
                <IconButton label={`Open ${c.title}`} onClick={() => openCard(c.id)}>
                  <MapPin className="size-3.5" />
                </IconButton>
                {canEdit && (
                  <IconButton
                    label={`Remove location of ${c.title}`}
                    onClick={() => {
                      const before = { lat: c.lat, lng: c.lng, location_label: c.location_label };
                      updateCardEverywhere(c, { lat: null, lng: null, location_label: null })
                        .then((res) => toast.show('Location removed', { undo: () => updateCardEverywhere(res, before).then(() => undefined) }))
                        .catch(toast.error);
                    }}
                  >
                    <X className="size-3.5" />
                  </IconButton>
                )}
              </li>
            ))}
          </ul>
          <h3 className="mb-1 text-sm">
            Without a location <span className="num font-normal text-secondary">{unlocated.length}</span>
          </h3>
          <ul className="flex flex-col">
            {unlocated.map((c) => (
              <li key={c.id} className="flex items-center gap-1">
                <button className="min-w-0 flex-1 truncate rounded-[3px] px-1 py-1 text-left text-[13px] hover:bg-hover" onClick={() => openCard(c.id)}>
                  {c.title}
                </button>
                {canEdit && (
                  <Button
                    size="sm"
                    variant={mode.kind === 'place' && mode.cardId === c.id ? 'primary' : 'ghost'}
                    className={cn('shrink-0')}
                    onClick={() => setMode({ kind: 'place', cardId: c.id })}
                  >
                    Place
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </aside>
      </div>
      {createAt && <CreateAtPoint at={createAt} onClose={() => setCreateAt(null)} cards={cardsQ.data ?? []} />}
    </div>
  );
}

function CreateAtPoint({ at, onClose, cards }: { at: { lat: number; lng: number }; onClose: () => void; cards: CardWithRelations[] }) {
  const { project } = useProjectCtx();
  const structQ = useProjectStructure(project.id);
  const boards = structQ.data?.boards ?? [];
  const lists = structQ.data?.lists ?? [];
  const first = boards.length ? lists.find((l) => l.board_id === boards[0].id) : undefined;
  const [title, setTitle] = useState('');
  const [place, setPlace] = useState('');
  const [listId, setListId] = useState(first?.id ?? '');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const submit = async () => {
    const list = lists.find((l) => l.id === (listId || first?.id));
    if (!title.trim() || !list) return;
    setBusy(true);
    try {
      const card = await createCard({
        project_id: project.id,
        board_id: list.board_id,
        list_id: list.id,
        title: title.trim(),
        position: keyAfterLast(cards.filter((c) => c.list_id === list.id)),
      });
      await updateCardEverywhere(card, { lat: at.lat, lng: at.lng, location_label: place.trim() || null });
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={onClose}
      title="New task at this location"
      description={`${at.lat.toFixed(4)}, ${at.lng.toFixed(4)}`}
      width={440}
      footer={
        <Button variant="primary" loading={busy} disabled={!title.trim() || !lists.length} onClick={submit}>
          Add task
        </Button>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="Title" htmlFor="map-title">
          <Input id="map-title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={500} />
        </Field>
        <Field label="Place name (optional)" htmlFor="map-place">
          <Input id="map-place" value={place} onChange={(e) => setPlace(e.target.value)} maxLength={200} />
        </Field>
        <Field label="List" htmlFor="map-list">
          <Select id="map-list" value={listId || first?.id} onChange={(e) => setListId(e.target.value)}>
            {boards.map((b) => (
              <optgroup key={b.id} label={b.name}>
                {lists
                  .filter((l) => l.board_id === b.id)
                  .map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </Select>
        </Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
