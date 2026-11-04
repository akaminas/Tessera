# Tessera Edge Functions

Two optional Supabase Edge Functions (Deno). The core app, automations and
webhooks do **not** depend on them; they run inside PostgreSQL
(`run_scheduler()` via `pg_cron`, deliveries via `pg_net`).

| Function | Purpose | Auth |
|---|---|---|
| `ical` | Private calendar feed (`.ics`) of a user's assigned tasks and project milestones | Secret per-user token in the URL; **deploy with JWT verification off** |
| `email-digest` | Emails a digest of unread notifications to users who enabled email notifications | `Authorization: Bearer <CRON_SECRET>`; deploy with JWT verification off |

Shared code lives in `_shared/` (RFC 5545 calendar builder).

## Deploy

The Supabase CLI can deploy without Docker by bundling on the server:

```bash
npx supabase functions deploy ical --project-ref <ref> --no-verify-jwt --use-api
npx supabase functions deploy email-digest --project-ref <ref> --no-verify-jwt --use-api
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided to functions by
the platform automatically. Never put the service-role key in the frontend.

### `ical`

Optional secret:

```bash
npx supabase secrets set APP_URL=https://akaminas.github.io/Tessera/ --project-ref <ref>
```

Feed URL for a user (shown in Settings → Calendar feed):

```
https://<ref>.supabase.co/functions/v1/ical?token=<user_secrets.calendar_token>
```

Google Calendar: *Other calendars → From URL*. Outlook: *Add calendar → Subscribe from web*.
Calendar apps refresh subscribed feeds on their own schedule (Google: roughly every
12–24 hours); the function asks for a 5-minute private cache. Resetting a user's
`calendar_token` immediately revokes the old link (unknown tokens return 404).

Events are all-day: tasks span start → due date, milestones their due date.
Only tasks with a due date that are not archived or deleted are included.

### `email-digest`

Secrets (all required for sending; without `RESEND_API_KEY`/`EMAIL_FROM` the
function returns **503 and sends nothing**):

```bash
npx supabase secrets set CRON_SECRET=<long random string> \
  RESEND_API_KEY=<resend key> EMAIL_FROM="Tessera <notifications@your-domain>" \
  APP_URL=https://akaminas.github.io/Tessera/ --project-ref <ref>
```

`EMAIL_FROM` must use a domain verified in Resend.

Each run sends at most one digest per user (up to 25 items listed, the rest
summarised), covering notifications that are unread and not yet emailed, and
then sets `notifications.emailed_at`. Failed sends are retried on the next run.
Users opt in under Settings → Preferences (`profiles.preferences.emailNotifications`).

Schedule it with `pg_cron` + `pg_net`, keeping the secret in Vault:

```sql
-- once: store the secret and the function URL
select vault.create_secret('<same CRON_SECRET>', 'tessera_cron_secret');
select vault.create_secret('https://<ref>.supabase.co/functions/v1/email-digest', 'tessera_digest_url');

-- every 30 minutes
select cron.schedule('tessera-email-digest', '*/30 * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'tessera_digest_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'tessera_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000)
$$);
```

Unschedule with `select cron.unschedule('tessera-email-digest');`.

## Local checks

The calendar builder is plain TypeScript and can be exercised with Node:
`node --input-type=module -e "import('./supabase/functions/_shared/ical.ts')"` (Node ≥ 22.6 strips types).
