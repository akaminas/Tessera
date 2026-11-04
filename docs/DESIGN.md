# Design: Vellum adapted to an interactive product

Source of truth: [Vellum](https://akaminas.github.io/vellum/) tokens (`style/vellum.json`, MIT), copied verbatim into `src/styles/vellum.css` with the dark twin under `[data-theme="dark"]`.

## Colour
- **Page and cards:** white surface (warm charcoal in dark mode); cream (`--v-card`) for cards, panels, stat tiles and table headers. Cream is never the page background.
- **Lines and text:** hairline borders use `grid`; stronger separators use `rule`. Body text is `ink` or `secondary`, never `muted` (which fails body-text contrast); `muted` is only for small metadata.
- **Interaction accent:** teal. Primary buttons use teal *deep* in light mode (≥ 7:1 with white text) and teal *tone* in dark mode. Focus rings use teal tone.
- **Highlight:** terracotta marks the single highlighted item, such as the unread badge or the highlighted bar.
- **Labels:** each label is a family tint with deep text (≥ 4.5:1). Six families plus grey; the word carries the meaning.
- **Status colours** (good, warning, serious, critical) appear only on small marks, and always with an icon *and* a word ("Overdue", "Blocked", "Done"). They are never used as series colours.
- **Board backgrounds** are 20–22 % washes of a family tint over the surface: calm and optional.

## Typography
- Palatino (TeX Gyre Pagella web font, GUST licence) for page titles, section headings, dialog titles and chart claims.
- Corbel or Lato (OFL, self-hosted) for everything else.
- One weight per face, with bold reserved for labels and emphasis. Sentence case throughout, no letter-spacing tricks.
- Tabular lining numerals in tables and numbers.

## Charts (`src/components/charts.tsx`)
- Each chart's title states its claim in a sentence, computed from the data.
- Muted unit line; horizontal hairline grid only; bottom axis only.
- Direct end labels instead of legends for four series or fewer.
- Tones in slot order: teal, terracotta, indigo, ochre, mauve, moss.
- Reference lines are dotted ochre with a label.
- No shadows, gradients, 3D or frames.

## Interaction
- **Density:** comfortable by default; compact on request.
- **Motion:** only short colour and transform transitions. Removed entirely when the user or OS asks.
- **Progressive disclosure:** a task needs only a title; advanced fields sit in the card sidebar and in modules a project can switch off.
- **Accessibility:**
  - Radix primitives.
  - A skip link and labelled regions.
  - Keyboard alternatives for dragging (dnd-kit keyboard sensor, the Move dialog, and `,` / `.` shortcuts).
  - Visible focus.
  - 4.5:1 text contrast.
