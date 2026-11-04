# Phase 0: audit and architecture

This document records what was examined before implementation, the requirements derived from it, licence decisions, and the resulting architecture. It contains no source-workbook data; workbook findings are described structurally and in aggregate.

## 1. References examined

### Trello (primary functional reference)
Official guide and support pages, plus the end-user course video "Trello Full Course Tutorial" (Learn Skills Daily, 2025). The course runs in three parts:
- **Beginner:** boards, lists, cards, moving cards, attachments, members, due dates, labels, checklists.
- **Intermediate:** copying cards, subscribing, archiving, backgrounds, filtering, comments, visibility, starring, linking cards, calendar sync.
- **Advanced:** email-in, links, keyboard shortcuts, Power-Ups, Markdown.

Capabilities carried into Tessera:

| Area | Trello behaviour | Tessera |
|---|---|---|
| Structure | Workspace → board → list → card | Workspace → **project** → board → list → card → checklist / subtask |
| Card back | Description, labels, dates, checklist, members, attachments, custom fields, activity, actions (copy, move, archive) | Same, plus status, priority, recurrence, dependencies, links, time, work package, milestone, location |
| Views | Board, table, calendar, timeline, dashboard, map; workspace views | All, synchronised through one data model and a realtime change feed |
| Automation | Rules, scheduled, due-date, card buttons, board buttons | Same five kinds, server-side, with logs, retries and loop protection |
| Roles | Workspace admin, member, guest; board visibility private / workspace | Owner, admin, member, guest; project manager, member, collaborator, read-only; separate budget permission |
| Shortcuts | `?`, `b`, `f`, `x`, `t`, `j`/`k`, `n`, `c`, `z`, `e`, `space`, `d`, `,` / `.`, `g i` / `g p` | Equivalent set; all can be turned off |

### Open-source projects (architectural references only; no code reused)

| Project | Licence | Stack | Takeaways | Decision |
|---|---|---|---|---|
| knowankit/trello-clone | MIT | Next.js, Chakra, Redux, react-beautiful-dnd, MongoDB | Optimistic UI makes dragging feel instant. Integer sequence ordering costs O(n) writes per move. | Use fractional keys instead (one write per move). |
| trevorlasn/simple-trello | MIT | React 16, Redux, react-dnd, client-only | A minimal baseline only. | No reuse. |
| mattermost-community/focalboard | Mixed: AGPL-3.0 source; Apache-2.0 for config / admin tools; MIT for compiled builds | Go, React, block model, WebSocket sync, undo manager, typed properties | Typed custom properties, per-board views, a central mutation layer with undo. | Ideas only, **no code** (AGPL). |
| Leantime/leantime | AGPL-3.0 | PHP / Laravel, HTMX | Milestones, timesheets, goals, risk canvases and retrospectives next to Kanban. | Ideas only, **no code** (AGPL). |

All Tessera code is original. See [LICENSES.md](LICENSES.md) for the third-party components that are used.

### Vellum design system
Source of truth: `style/vellum.json` (MIT). See [DESIGN.md](DESIGN.md) for how the tokens and rules were adapted to an interactive product.

## 2. Workbook analysis (structure only)

### Project management plan workbook
- **Overview sheet:**
  - Project metadata: acronym, 24-month duration, coordinator, partner list.
  - Usage instructions.
  - A colour legend with four colours: planned/ongoing (teal), milestone/deliverable/report due (amber), completed (green), task header row (light blue).
- **Milestones sheet:**
  - 15 control points, each with number, title, work package, due date, means of verification, status and notes.
  - Status is a dropdown with four values: *Planned, On track, At risk, Done*.
  - `COUNTIF` formulas count *Done* and *At risk*.
- **Six work-package sheets:**
  - A title row reads "WPn – name | Lead: organisation".
  - Columns M1…M24 are mapped to calendar months.
  - Rows are task headers ("TASK n.x …") followed by activities, each with a free-text responsible party.
  - Month cells are coloured, not filled with values. Schedules are often non-contiguous: monthly meetings, quarterly checks, report-due months.
- **Problems it solves:**
  - Planning on project-relative months.
  - Showing what is due when.
  - Recording completion.
  - Monthly milestone status reviews.
- **Limitations:**
  - Colours carry the meaning but cannot be queried.
  - Nothing links to people, evidence or the budget.
  - Manual status updates.
  - No history.
  - No permissions.
  - Copying sheets for new projects.

### Consortium budget workbook
- **Sheets:**
  - A general-information sheet with cost-eligibility rules and instructions.
  - Hidden lookup sheets for categories and years.
  - A consortium summary sheet.
  - One sheet per partner (nine).
- **Partner sheets:** one row per budget line, with category, cost, indirect cost, total, year, work package, person-months and justification. A "Person months per WP" block follows the lines.
- **Summary sheet:**
  - Per-partner columns: personnel (A), subcontracting (B), travel (C1), equipment (C2), other goods and services (C3), other categories (D), indirect (E), total eligible, funding rate, maximum and requested contribution.
  - A partner × WP person-month matrix.
  - The list of work packages.
- **The workbook has no formulas;** every value is static. Findings:
  - **Indirect rate:** 25 % of personnel + travel + equipment + other goods + internally invoiced services. Subcontracting and financial support to third parties are excluded.
  - **Person-month rates:** each partner has an implied monthly personnel rate (personnel cost ÷ PMs). It is constant within a partner and differs across partners.
  - **Reconciliation:**
    - Partner lines reconcile exactly with the summary for direct costs per category and for person-months per WP.
    - Summary indirect costs differ from 25 % of the base by €0 to €1.5 per partner, and no single rounding rule reproduces all nine values.
    - Tessera therefore makes rounding explicit and configurable, and the importer **reports** such differences instead of hiding them.
  - **Funding:** the funding-rate column is blank and the requested contribution equals total eligible cost (100 %).
- **Problems it solves:**
  - Partner allocations.
  - Category totals.
  - Indirect calculation.
  - Person-month planning by WP.
  - Applicant guidance.
- **Limitations:**
  - No actuals, commitments or forecasts.
  - No link to the work plan or evidence.
  - Error-prone manual totals.
  - No access control: everyone with the file sees every partner's figures.

## 3. Requirements matrix

The detailed status of each requirement is maintained in [FEATURES.md](FEATURES.md). It maps every item of the brief (sections 4–17) to the implementation and its tests.

## 4. Architecture decisions

| Decision | Choice | Reason |
|---|---|---|
| Hosting | GitHub Pages (static) and Supabase | Required by the brief. Pages cannot run a server, so authentication, data, files and jobs live in Supabase. |
| Security boundary | PostgreSQL Row Level Security on every table | The browser holds only the public key. Every read and write is checked in the database, per user. |
| Business rules | In the database (triggers and functions) for integrity and permissions; in TypeScript for presentation and decimal-safe finance views | Rules cannot be bypassed by calling the API directly. |
| Ordering | Fractional index keys (text, "C" collation) | One write per move; concurrent inserts are handled by a rebalance fallback. |
| Concurrency | `version` column and field-level merge (`safeUpdate`) | No silent overwrites. A real conflict is surfaced to the user. |
| Realtime | One `change_feed` table published to Supabase Realtime, filtered by RLS | Works for deletes and join tables, and every view refreshes from the same source of truth. |
| Automation | Event queue, plus a worker in PL/pgSQL, triggered by pg_cron every minute and immediately after user actions | Server-side, transactional, testable on plain PostgreSQL, with logging, retries and loop protection. |
| Finance permissions | Separate `finance_access` (none / view / edit). Money lives only in finance-RLS tables, with a separate audit table. | Financial data is narrower than task data, as the brief requires. |
| Templates | One JSON "blueprint" format, applied atomically by `apply_blueprint` | Built-in and user templates share one code path. Dates are relative. |
| Imports | Parsed in the browser (ExcelJS), shown for review and correction, then written atomically by `import_plan` / `import_budget` | The user sees the mapping and the issues first, and partial imports cannot happen. |
| Self-hosting | Standard PostgreSQL, Supabase-compatible auth and storage schema, migrations in plain SQL, and a client data layer behind small modules | Can run on self-hosted Supabase without changes. |
