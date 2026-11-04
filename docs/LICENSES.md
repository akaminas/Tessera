# Licences and third-party components

Tessera's own code is released under the MIT licence (see `LICENSE`). **No source code was copied from the reference projects.** They were studied for features and architecture only:

| Reference | Licence | Use in Tessera |
|---|---|---|
| mattermost-community/focalboard | AGPL-3.0 source; Apache-2.0 for config and admin tools; MIT for compiled builds | Ideas only (typed properties, per-board views, undo). **No code**, because AGPL is incompatible with distributing Tessera under MIT. |
| Leantime/leantime | AGPL-3.0 | Ideas only (milestones, timesheets, goals and risks alongside Kanban). **No code**, for the same reason. |

## Design assets

| Asset | Licence | Notes |
|---|---|---|
| Colour values (`src/styles/theme.css`) | GitHub Primer primitives, MIT | Neutral, accent and status values follow Primer's light and dark "Protanopia & Deuteranopia" themes. No Primer code is bundled. |
| Label and board pastels | Colour values only | Soft pastel values chosen for labels and board colours. Colours are not copyrightable, and no third-party assets, icons or text are used. |
| Inter (`@fontsource-variable/inter`) | SIL Open Font License 1.1 | Self-hosted, unmodified. |
| Board photos (`public/backgrounds/*.webp`) | [Unsplash License](https://unsplash.com/license) | Eight photos downloaded from Unsplash, resized to 1920×1080 and 320×180 WebP and self-hosted, so no third-party request is made. The licence allows free use without attribution; the picker credits Unsplash. Source photo IDs: 1501785888041-af3ef285b470, 1506905925346-21bda4d32df4, 1464822759023-fed622ff2c3b, 1507525428034-b723cf961d3e, 1441974231531-c6227db76b6e, 1418065460487-3e41a6c84dc5, 1519681393784-d120267933ba, 1500530855697-b586d89ba3ee. |
| Map tiles | © OpenStreetMap contributors (ODbL) | Loaded at runtime with on-map attribution, per the OSM tile usage policy. |

## Runtime dependencies (shipped in the browser bundle)

| Package | Version | Licence |
|---|---|---|
| react, react-dom | 19.3.1 | MIT |
| react-router | 8.5.1 | MIT |
| @tanstack/react-query | 5.105.3 | MIT |
| @supabase/supabase-js | 2.118.0 | MIT |
| @dnd-kit/core, sortable, utilities | 6.3.1 / 10.0.0 / 3.2.2 | MIT |
| @radix-ui/react-* (dialog, dropdown-menu, popover, tooltip, tabs, checkbox, select, switch) | 1.x–2.x | MIT |
| lucide-react | 1.68.0 | ISC |
| date-fns | 4.4.0 | MIT |
| big.js | 7.0.1 | MIT |
| fractional-indexing | 4.0.0 | CC0-1.0 |
| react-markdown, remark-gfm | 10.1.0 / 4.0.1 | MIT |
| exceljs | 4.4.0 | MIT |
| jspdf, jspdf-autotable | 4.2.1 / 5.0.9 | MIT |
| leaflet | 1.9.4 | BSD-2-Clause |
| @fontsource-variable/inter | 5.3.0 | OFL-1.1 |

### Transitive dependencies
A scan of `package-lock.json` (production tree, 400 packages) found the following licences:

| Licence | Packages |
|---|---|
| MIT | 364 |
| ISC | 15 |
| 0BSD | 6 |
| Apache-2.0 | 2 |
| BSD-2-Clause / BSD-3-Clause | 3 |
| CC0-1.0, Unlicense | 1 each |

These packages need individual notes:

| Package | Licence | Note |
|---|---|---|
| jszip (via exceljs) | dual MIT or GPL-3.0-or-later | Used under MIT. |
| dompurify (via jspdf) | dual MPL-2.0 or Apache-2.0 | Used under Apache-2.0. |
| pako | MIT and Zlib | Both permissive. |
| buffers, chainsaw (via exceljs) | MIT / MIT-X11 | `buffers` does not declare its licence in package metadata. Its repository states MIT/X11. |
| rgbcolor (via jspdf) | MIT, or the custom FEEL-FREE licence | Used under MIT. |

No copyleft licence applies to the shipped bundle.

## Development-only tools
TypeScript, Vite, Vitest, Playwright, ESLint, Tailwind CSS, the Supabase CLI, embedded-postgres and pg (all MIT, Apache-2.0 or PostgreSQL licence). None of them is shipped to users.
