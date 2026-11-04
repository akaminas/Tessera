# Licences and third-party components

Tessera's own code is released under the MIT licence (see `LICENSE`). **No source code was copied from the reference projects.** They were studied for features and architecture only:

| Reference | Licence | Use in Tessera |
|---|---|---|
| knowankit/trello-clone | MIT | Ideas only (optimistic drag and drop). |
| trevorlasn/simple-trello | MIT | Ideas only (minimal board UX baseline). |
| mattermost-community/focalboard | AGPL-3.0 source; Apache-2.0 for config and admin tools; MIT for compiled builds | Ideas only (typed properties, per-board views, undo). **No code**, because AGPL is incompatible with distributing Tessera under MIT. |
| Leantime/leantime | AGPL-3.0 | Ideas only (milestones, timesheets, goals and risks alongside Kanban). **No code**, for the same reason. |
| Trello (Atlassian) | Proprietary | Functional reference. No assets, names, artwork or text reused. |

## Design assets

| Asset | Licence | Notes |
|---|---|---|
| Vellum tokens (`src/styles/vellum.css`) | MIT, © 2026 Alexandros Kaminas | Values copied from `style/vellum.json`; attribution kept in the file header. |
| TeX Gyre Pagella (`public/fonts/texgyrepagella-regular.woff2`) | GUST Font License (LPPL 1.3c) | Redistributed unmodified; licence text shipped in `public/fonts/GUST-FONT-LICENSE.txt`. |
| Lato (`@fontsource/lato`) | SIL Open Font License 1.1 | Self-hosted, unmodified. |
| Corbel, Palatino Linotype | Microsoft system fonts | Referenced by name only; never bundled. |
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
| @fontsource/lato | 5.3.0 | OFL-1.1 |

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
