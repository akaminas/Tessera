/**
 * Board backgrounds, in the spirit of Trello: photos (from Unsplash, under the
 * Unsplash License, self-hosted in public/backgrounds), gradients and a
 * pattern. `onImage` boards get light text on a translucent header bar.
 */
import type { CSSProperties } from 'react';

export interface BoardBackground {
  id: string;
  label: string;
  kind: 'photo' | 'gradient' | 'plain';
  /** CSS for the board area. */
  style: CSSProperties;
  /** CSS for the small picker swatch. */
  swatch: CSSProperties;
  /** True when lists sit on a picture or a strong colour (light text on top). */
  onImage: boolean;
}

const base = (import.meta.env.BASE_URL ?? '/').replace(/\/?$/, '/');

function photo(id: string, label: string): BoardBackground {
  const url = `${base}backgrounds/${id}.webp`;
  const thumb = `${base}backgrounds/${id}-thumb.webp`;
  return {
    id: `photo-${id}`,
    label,
    kind: 'photo',
    // Thumbnail first as an instant placeholder under the full photo.
    style: { backgroundImage: `url(${url}), url(${thumb})`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundColor: '#1d2125' },
    swatch: { backgroundImage: `url(${thumb})`, backgroundSize: 'cover', backgroundPosition: 'center' },
    onImage: true,
  };
}

function gradient(id: string, label: string, css: string, onImage = true): BoardBackground {
  return { id, label, kind: 'gradient', style: { background: css }, swatch: { background: css }, onImage };
}

export const BOARD_BACKGROUNDS: BoardBackground[] = [
  photo('lake', 'Lake'),
  photo('alpine', 'Alpine dusk'),
  photo('valley', 'Valley'),
  photo('beach', 'Beach'),
  photo('forest', 'Forest'),
  photo('mist', 'Misty pines'),
  photo('night', 'Night sky'),
  photo('canyon', 'Canyon'),
  gradient('grad-ocean', 'Ocean', 'linear-gradient(135deg, #0c66e4 0%, #37b4c3 100%)'),
  gradient('grad-crystal', 'Crystal', 'linear-gradient(135deg, #09326c 0%, #c97cf4 100%)'),
  gradient('grad-peach', 'Peach', 'linear-gradient(135deg, #f88d01 0%, #e774bb 100%)'),
  gradient('grad-meadow', 'Meadow', 'linear-gradient(135deg, #1f845a 0%, #94c748 100%)'),
  gradient('grad-lavender', 'Lavender', 'linear-gradient(135deg, #6e5dc6 0%, #e774bb 100%)'),
  gradient('grad-sky', 'Sky', 'linear-gradient(135deg, #579dff 0%, #6cc3e0 100%)'),
  gradient(
    'pattern-dots',
    'Dots',
    'radial-gradient(rgba(255,255,255,0.22) 1.5px, transparent 1.6px) 0 0 / 18px 18px, linear-gradient(135deg, #0055cc 0%, #1d7afc 100%)',
  ),
  gradient(
    'pattern-grid',
    'Grid',
    'linear-gradient(rgba(255,255,255,0.09) 1px, transparent 1px) 0 0 / 24px 24px, linear-gradient(90deg, rgba(255,255,255,0.09) 1px, transparent 1px) 0 0 / 24px 24px, linear-gradient(135deg, #352c63 0%, #5e4db2 100%)',
  ),
  gradient('grad-snow', 'Snow', 'linear-gradient(135deg, #dcdfe4 0%, #f7f8f9 100%)', false),
  { id: 'plain', label: 'Plain', kind: 'plain', style: { background: 'var(--v-surface)' }, swatch: { background: 'var(--v-surface)' }, onImage: false },
];

/** The background new boards start with (also the database default). */
export const DEFAULT_BACKGROUND = 'photo-lake';

/** Earlier, colour-wash backgrounds map onto the nearest new option. */
const LEGACY: Record<string, string> = {
  cream: 'grad-snow',
  teal: 'grad-sky',
  indigo: 'grad-ocean',
  moss: 'grad-meadow',
  ochre: 'grad-peach',
  terracotta: 'grad-peach',
  mauve: 'grad-lavender',
};

export function boardBackground(id: string | null | undefined): BoardBackground {
  const key = id ? (LEGACY[id] ?? id) : DEFAULT_BACKGROUND;
  return BOARD_BACKGROUNDS.find((b) => b.id === key) ?? BOARD_BACKGROUNDS.find((b) => b.id === 'plain')!;
}
