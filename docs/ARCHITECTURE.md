# Architecture

```
Browser (GitHub Pages, static)                Supabase (managed or self-hosted)
┌───────────────────────────────┐             ┌──────────────────────────────────────────┐
│ React 19 + TypeScript + Vite  │  HTTPS      │ Auth (email + password, magic link)      │
│ React Router (subpath-aware)  │────────────▶│ PostgREST  ── RLS on every table ──┐     │
│ TanStack Query caches         │             │ PostgreSQL: tables, triggers, RPCs  │     │
│ dnd-kit, Radix primitives     │◀────────────│ Realtime: change_feed + notifications│    │
│ Theme tokens (Tailwind 4)     │  websocket  │ Storage: private "attachments" bucket│    │
└───────────────────────────────┘             │ pg_cron → run_scheduler() every min  │    │
                                              │ pg_net  → signed outgoing webhooks   │    │
                                              │ Edge Functions: ical, email-digest   │    │
                                              └──────────────────────────────────────────┘
```

## Layers

| Layer | Location | Responsibility |
|---|---|---|
| UI | `src/pages`, `src/features/*`, `src/components`, `src/layout` | Presentation, interaction, accessibility. |
| Domain (pure TypeScript) | `src/domain` | Ordering keys, filters, recurrence, quick-add parsing, timeline maths, finance engine (big.js), workbook parsing, automation descriptions. Unit-tested without a backend. |
| Data access | `src/data` | Supabase queries and mutations, optimistic cache updates, conflict-safe updates (`safeUpdate`), realtime subscription. Query-key conventions drive invalidation. |
| Persistence and rules | `supabase/migrations` | Schema, integrity triggers, permission helpers, RLS policies, RPCs, automation engine. Tested against real PostgreSQL (`tests/db`). |
| Integrations | `supabase/functions`, `src/lib/github.ts`, `src/lib/ical.ts`, `src/lib/exporters.ts` | iCalendar feed and export, email digest, GitHub link status, XLSX/CSV/PDF export. |

## Data flow for a change
1. The user drags a card. The cache updates immediately (optimistic).
2. `updateCard` sends `UPDATE … WHERE id = ? AND version = ?`.
   - If another person saved in between, `safeUpdate` fetches the latest row.
   - If they changed *different* fields, the change is re-applied on top of theirs.
   - If they changed the *same* field differently, the user gets a conflict message and nothing is overwritten.
3. Database triggers:
   - keep denormalised ids consistent;
   - write the activity log;
   - append a row to `change_feed`;
   - enqueue automation events when a rule or webhook could react.
4. Realtime delivers the `change_feed` row to every subscriber allowed to read that project (RLS). Their caches for `['p', projectId]` refresh, so the board, table, calendar, timeline and dashboard all show the same truth.
5. The automation worker (pg_cron each minute, or right after the action via `kick_automations`) executes matching rules as the server.

## Routing on GitHub Pages
The app is served from `/Tessera/`.
- `vite.config.ts` sets `base`, and the router uses the same basename.
- `public/404.html` encodes unknown paths into the query string, and `index.html` restores them before the app starts. Deep links such as `/Tessera/p/<id>/board/<id>` and the auth callbacks (`/Tessera/auth/callback?code=…`) therefore work after a refresh.

## Self-hosting
- The schema uses only PostgreSQL features plus Supabase's `auth.uid()`, the `storage` schema, Realtime publication, and optionally `pg_cron` and `pg_net`.
- Migrations guard the optional extensions.
- To self-host, run Supabase's self-hosted stack, apply `supabase/migrations`, deploy the two Edge Functions, and build the frontend with your URL and anon key.
