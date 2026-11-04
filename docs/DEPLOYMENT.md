# Deployment and configuration

The frontend is a static site on **GitHub Pages**. The backend is a **Supabase** project. GitHub Actions builds and deploys on every push to `main`, and applies database migrations when the secrets below are present.

## 1. Create the Supabase project
1. Create a project at <https://supabase.com>. For EU projects, choose the Frankfurt region.
2. From **Project Settings → API**, note the project URL `https://<ref>.supabase.co` and the **anon / publishable** key. This key is public by design; Row Level Security protects the data.
3. Only for deploying Edge Functions: create a short-lived, project-scoped personal access token under **Account → Access tokens**, with **Edge Functions: read-write** and **Project Settings: read**. CI does not need it.

## 2. Apply the database
```bash
npx supabase link --project-ref <ref> --password <db-password>
npx supabase db push --password <db-password>
```
The migrations enable `pg_cron` (if offered) and schedule `run_scheduler()` every minute. Check with `select * from cron.job;`.

## 3. Configure authentication
Under **Authentication → URL configuration**:
- **Site URL:** `https://akaminas.github.io/Tessera/`
- **Redirect URLs:**
  - `https://akaminas.github.io/Tessera/auth/callback`
  - `https://akaminas.github.io/Tessera/auth/reset`
  - The same two paths under `http://localhost:5173/Tessera/` for local development.

Email confirmation is on by default. Supabase's built-in email sender has a low hourly limit, so configure your own SMTP under **Authentication → SMTP** for real use.

## 4. Edge Functions
```bash
npx supabase functions deploy ical --no-verify-jwt --use-api
npx supabase functions deploy email-digest --no-verify-jwt --use-api
npx supabase secrets set APP_URL=https://akaminas.github.io/Tessera/
# Optional email digests:
npx supabase secrets set RESEND_API_KEY=... EMAIL_FROM="Tessera <noreply@your-domain>" CRON_SECRET=<random>
```
See `supabase/functions/README.md` for scheduling the digest.

## 5. GitHub repository settings
- **Settings → Pages → Source:** GitHub Actions.
- **Settings → Secrets and variables → Actions:**
  - Variables:
    - `VITE_SUPABASE_URL` = `https://<ref>.supabase.co`
    - `VITE_SUPABASE_ANON_KEY` = the anon / publishable key
    - `SUPABASE_PROJECT_REF` = `<ref>`
  - Secret `SUPABASE_DB_PASSWORD`: lets the Deploy workflow apply new migrations through the session pooler.
  - Optional variable `SUPABASE_POOLER_HOST`: the default is `aws-1-eu-central-1.pooler.supabase.com`. The host is shown under **Connect → Session pooler** in the Supabase dashboard.

Push to `main` (or run **Deploy** manually). The site appears at `https://akaminas.github.io/Tessera/`. If the variables are missing, the deployed site says the backend is not connected; it never shows sample data.

## Local development
```bash
cp .env.example .env.local   # fill in URL and anon key of a development project
npm install
npm run dev                  # http://localhost:5173/Tessera/
npm test                     # unit tests
npm run test:db              # migrations + RLS + automation tests on embedded PostgreSQL
npm run test:e2e             # browser tests against a running backend (see tests/e2e/README.md)
```

## Environment summary

| Name | Where | Secret? |
|---|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | build (GitHub variables / `.env.local`) | No (public) |
| `VITE_BASE_PATH` | build (CI sets `/<repo>/`) | No |
| `SUPABASE_DB_PASSWORD` | GitHub secret (migrations) | **Yes** |
| `SUPABASE_ACCESS_TOKEN` | your machine only, for deploying Edge Functions | **Yes** |
| `SUPABASE_SERVICE_ROLE_KEY` | provided automatically inside Edge Functions | **Yes**, never in the frontend |
| `RESEND_API_KEY`, `EMAIL_FROM`, `CRON_SECRET`, `APP_URL` | Supabase function secrets | **Yes** (except `APP_URL`) |
