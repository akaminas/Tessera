# End-to-end tests

These tests drive a real browser against a real Supabase backend. Nothing is mocked. They create throw-away users through the Auth admin API and delete them afterwards.

```bash
npx playwright install chromium
export E2E_SUPABASE_URL=https://<ref>.supabase.co
export E2E_SERVICE_ROLE_KEY=<service role key>      # never commit; used only to create/delete test users
# Test the deployed site:
export E2E_BASE_URL=https://akaminas.github.io/Tessera/
npm run test:e2e
# ...or a local production build (needs VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in .env.local):
unset E2E_BASE_URL && npm run test:e2e
```

Covered:
- account creation and sign-in;
- workspace and project creation;
- persistence after reload;
- invitations;
- realtime updates between two users;
- mentions and notifications;
- outsider isolation;
- GitHub Pages deep links;
- phone layout without horizontal scrolling;
- light and dark themes.
