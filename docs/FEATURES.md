# Feature checklist

## Status legend
- **Complete:** UI, persistence, permissions, validation and error handling are implemented, and the server-side behaviour is covered by automated tests.
- **Partial:** works with the stated limitation.
- **Not implemented:** absent; the reason is given.

## How features were verified
- **Database behaviour:** permissions, triggers, functions and automation are tested on real PostgreSQL in `tests/db` (73 tests). They run in CI on every push.
- **Domain logic:** unit-tested in `src/**/*.test.ts` (98 tests).
- **Browser flows:** covered by `tests/e2e`, which needs a live Supabase backend (see [DEPLOYMENT.md](DEPLOYMENT.md)).
- **Live backend (4 November 2026):** all 7 migrations were applied to the hosted Supabase project. All 56 tables have RLS. pg_cron runs the scheduler every minute without errors; pg_net is installed; Realtime publishes the change feed and notifications; the attachments bucket is private. The 6 end-to-end tests pass in Chromium against it, covering sign-in, workspace and project creation, invitations, two people editing live, @mentions with notifications, outsider isolation, the card back and board filter, deep links, dark theme and the phone layout. The calendar subscription feed (Edge Function `ical`) was checked against it as well. Test accounts are deleted afterwards through the Auth admin API.

## Core structure and Trello functionality

| Feature | Status | Notes |
|---|---|---|
| Accounts: sign-up, sign-in, magic link, password reset | Complete | Supabase Auth with PKCE; callbacks work under the GitHub Pages subpath. |
| Workspaces (multiple), projects, boards, lists, cards | Complete | Fractional ordering; integrity triggers; RLS-tested. |
| Board create / duplicate / archive / restore / delete | Complete | Duplicate copies lists, labels, custom fields and (optionally) cards. |
| Drag-and-drop lists and cards | Complete | dnd-kit with a keyboard sensor; also Move dialog and `,` / `.` shortcuts. |
| Board templates | Complete | Any board can be flagged as a template; also preset layouts. |
| Sharing, invitations, visibility | Complete | Invitation links tied to an email; workspace or private projects; guests. |
| Board favourites, bookmarks | Complete | Bookmarks for boards, projects, cards and URLs in the sidebar. |
| Board filtering, saved filters / views | Complete | Shared filter engine across views; saved views can be shared with the project. |
| Backgrounds and appearance | Complete | Eight Unsplash photos, Trello-style gradients and patterns; boards start on a photo. Light (default) and dark themes on GitHub's colour-blind palette; density; motion. |
| In-app guide | Complete | "How to use Tessera" in the account menu: 14 step-by-step sections and a shortcut table. |
| Workspace-wide full-text search | Complete | Tasks, descriptions, projects, boards, comments; RLS-limited. |
| Activity history: board, project, workspace, card | Complete | Trigger-written audit trail. |
| Card create / edit / copy / move / archive / restore / trash / delete | Complete | Undo for archive, trash and move; permanent delete for managers only. |
| Markdown descriptions | Complete | Safe rendering, with no raw HTML. |
| Multiple assignees, labels, priorities, statuses | Complete | |
| Start dates, deadlines with optional time | Complete | |
| Recurring tasks | Complete | Next occurrence is created server-side on completion; scheduled creation via automations. |
| Checklists with nested items and completion tracking | Complete | Item assignee and due date; promote item to subtask. |
| Subtasks (child cards) | Complete | |
| Dependencies (cycle-checked), card links | Complete | |
| Attachments (private storage) and document links | Complete | Signed URLs; Google Drive, SharePoint and GitHub links recognised. |
| Comments, @mentions, watchers, notifications | Complete | Mentions notify only people with access. |
| Custom fields (text, number, date, dropdown, checkbox, URL) | Complete | Server-validated values. |
| Task templates | Complete | Any card can be a template; copy into any list. |
| Bulk actions | Complete | Move, status, assign, label, due date, archive. |
| Quick edit, keyboard shortcuts | Complete | `?` lists all shortcuts; they can be turned off. |
| Concurrent-edit safety | Complete | Version check plus field-level merge; real conflicts reported, never overwritten. |
| Real-time updates and presence | Complete | Change feed via Realtime (RLS-filtered); "also viewing" avatars on boards. |

## Views

| Feature | Status | Notes |
|---|---|---|
| Kanban | Complete | |
| Table | Complete | Inline editing, sort, grouping, column choice, CSV / XLSX export. |
| Calendar (project and global) | Complete | Drag to reschedule (project calendar); `.ics` download; private subscription feed. |
| Timeline / Gantt | Complete | Calendar and project-month (M1–Mn) modes; drag and resize; dependency arrows; reporting-period bands; Excel-style month cells. |
| Dashboard | Complete | Charts computed from live records. |
| My Work, Home, Inbox | Complete | |
| Workspace overview | Complete | Cross-project health table; workload. |
| Map | Partial | OpenStreetMap tiles; locations entered by coordinates or by clicking the map. No address geocoding (would need a geocoding service). |

## Usability

| Feature | Status |
|---|---|
| Quick add with natural shorthand ("fri !high"), personal inbox, triage | Complete |
| Today's priorities, upcoming, overdue | Complete |
| Focus mode, distraction-free task view, "next step" shown on tasks | Complete |
| Task timers and timesheets | Complete |
| Bookmarks, saved layouts (collapsible sections, saved views) | Complete |
| Configurable reminders and notification preferences | Complete |
| Reusable routines (recurring tasks with checklists, templates) | Complete |
| Compact density, reduced motion, undo | Complete |

## Project controls

| Feature | Status | Notes |
|---|---|---|
| Project definition: objectives, outcomes, dates, funding, status, partners | Complete | |
| Work packages: leads, people, dates, months, dependencies, progress, effort, budget | Complete | Budget shown only with finance access. |
| Milestones and deliverables: approval, evidence, verification, dependencies, history | Complete | |
| Reporting periods (generated or manual) | Complete | |
| Risks and issues: 5×5 matrix | Complete | |
| Meetings: agendas, minutes, decisions, action items that become tasks | Complete | Action items and their tasks stay in sync. |
| Workload across people and projects | Complete | |

## Finance and KPIs

| Feature | Status | Notes |
|---|---|---|
| Budgets by partner / WP / year / period / category / line | Complete | |
| Planned, committed, actual, forecast, remaining | Complete | |
| Configurable indirect rate, exclusions, funding rate, rounding rules | Complete | Decimal-safe (big.js and NUMERIC). |
| Person-months: planned, actual, by WP and partner; personnel cost reconciliation | Complete | |
| Financial reports and exports | Complete | PDF, XLSX, CSV. |
| Narrower finance permissions and finance audit | Complete | RLS-tested. |
| KPI registry: targets, baselines, measurements, verification, evidence, history | Complete | |
| Missing evidence and updates checklist | Complete | Reports page. |

## Import and export

| Feature | Status | Notes |
|---|---|---|
| Planning workbook import (M1–Mn grid, WPs, milestones) | Complete | Preview, correction and issues before an atomic import. Verified locally against the real workbook: 6 WPs, 70 rows, 15 milestones. |
| Budget workbook import (partners, rates, categories, lines, PMs) | Complete | Reconciliation report. Direct costs and PMs reconcile exactly; source indirect totals differ by up to €1 from a consistent rounding rule, and this is reported. |
| Plan and budget XLSX exports in the familiar layout | Complete | |
| Full project JSON export; personal data export | Complete | |

## Automation and integrations

| Feature | Status | Notes |
|---|---|---|
| Event rules, scheduled rules, due-date rules, card buttons, board buttons | Complete | Server-side, with logs, retries and loop protection. |
| The six example automations from the brief | Complete | One-click presets. |
| Outgoing webhooks (generic, Slack, Teams) with HMAC signatures | Complete | Delivery uses pg_net on hosted Supabase. Locally the queueing and signatures are tested, and the "no pg_net" path fails clearly. |
| iCalendar subscription feed (works with Google Calendar "From URL") | Complete | Edge Function `ical`. |
| GitHub issue / PR links with live status | Partial | Public repositories only (unauthenticated GitHub API, 60 requests per hour). |
| Google Drive document links | Complete | Recognised and shown as Drive documents. No Drive API browsing. |
| Email notifications (digest) | Partial | Edge Function implemented; needs an email provider key (Resend) and a scheduled call to be configured. |
| Two-way Google Calendar sync | Not implemented | Would need Google OAuth app verification. One-way subscription is available. |
| Inbound integrations (GitHub webhooks into tasks, Slack commands) | Not implemented | Outside the agreed scope; outgoing webhooks and links are provided. |

## Platform

| Feature | Status |
|---|---|
| GitHub Pages hosting with subpath routing | Complete |
| Migrations, CI (lint, typecheck, unit, database, build), deploy workflow | Complete |
| Security: RLS on every table, private storage, input validation, finance isolation | Complete |
| Backup and restore guidance; recoverable deletion | Complete |
| Deleting a person (Supabase dashboard or Auth admin API): ownership passes on, others' work is kept | Complete |
| Templates: 9 built-in project templates plus user templates | Complete |
