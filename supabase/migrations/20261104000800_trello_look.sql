-- =============================================================================
-- Tessera: Trello-style boards
--   * Labels gain Trello's red, pink and lime alongside the existing colours
--     (shown as Trello's green, yellow, orange, purple, blue, sky and grey).
--   * New boards start on a photo background, as Trello boards do.
-- =============================================================================

alter table public.labels drop constraint if exists labels_color_check;
alter table public.labels add constraint labels_color_check
  check (color in ('teal','terracotta','indigo','ochre','mauve','moss','grey','red','pink','lime'));

alter table public.boards alter column background set default 'photo-lake';
