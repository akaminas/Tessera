# Tessera

**Collaborative project management for individuals, teams and multi-partner institutional projects.**

Tessera combines a simple board for everyday work with the planning, reporting and financial controls of funded, multi-partner projects. A simple project is just a board. As a project grows, you switch on work packages, milestones and deliverables, budgets, KPIs, risks, meetings and automations. Everything lives in one connected database, so a change in one view appears in every other view.

- **Live app:** <https://akaminas.github.io/Tessera/>
- **Look:** boards with photo and gradient backgrounds, pastel labels, the Inter typeface, and GitHub's red-green colour-blind palette in both light (default) and dark themes

## What it does

| Everyday work | Project controls | Finance and reporting |
|---|---|---|
| Workspaces, projects, boards, lists, cards with drag and drop | Work packages with leads, responsible people, dates, M1–Mn schedules, planned vs actual progress | Budgets by partner, work package, category, year and reporting period |
| Checklists with nested items, subtasks, dependencies, links | Milestones and deliverables with approval, evidence and history | Planned, committed, actual, forecast and remaining amounts, with decimal-safe calculations |
| Labels, priorities, statuses, dates, recurrence, custom fields | Risk register (probability × impact) and issue log | Configurable indirect costs, exclusions, funding rates and rounding |
| Comments with @mentions, watchers, notifications, activity history | Meetings: agendas, minutes, decisions, action items that become tasks | Person-months planned and actual, timesheets, personnel cost reconciliation |
| Table, calendar, timeline / Gantt, dashboard, map and My Work views | Reporting periods, workload across people and projects | KPI registry with targets, measurements, verification and evidence |
| Quick capture, personal inbox, focus mode, undo, keyboard shortcuts | Templates for nine kinds of project, plus your own | Excel import (plan and budget) with review and reconciliation; XLSX, CSV and PDF exports |
| Real-time collaboration with conflict-safe editing | Server-side automations: rules, schedules, due-date rules, buttons | Signed webhooks (generic, Slack, Teams), iCalendar feed, GitHub link status, Obsidian plugin |

## How it is built
- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS 4, React Router, TanStack Query, dnd-kit and Radix primitives, styled with theme tokens in `src/styles/theme.css`. Hosted on GitHub Pages.
- **Backend:** Supabase.
  - PostgreSQL with Row Level Security on every table.
  - Supabase Auth.
  - Realtime.
  - A private storage bucket.
  - pg_cron and pg_net for the automation scheduler and webhooks.
  - Edge Functions for the calendar feed and email digests.
- **Security:** the browser only ever holds the public key. Every permission, including the narrower access to financial data, is enforced inside the database.


## Licence
MIT. Third-party components keep their own licences; see [docs/LICENSES.md](docs/LICENSES.md).
