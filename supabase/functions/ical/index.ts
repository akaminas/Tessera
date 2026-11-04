// Tessera private calendar feed.
//   GET /functions/v1/ical?token=<calendar token>
// The token is each user's secret calendar_token (user_secrets). The feed lists
// tasks assigned to the user that have a due date, and milestones of projects
// they belong to. Deploy with JWT verification disabled (calendar apps cannot
// send Supabase JWTs); the unguessable token is the credential.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.118.0';
import { buildCalendar, type CalendarEvent } from '../_shared/ical.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function text(status: number, body: string): Response {
  return new Response(body, { status, headers: { ...cors, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET' && req.method !== 'HEAD') return text(405, 'Method not allowed');

  const url = new URL(req.url);
  const token = (url.searchParams.get('token') ?? '').trim().replace(/\.ics$/i, '');
  if (!UUID.test(token)) return text(400, 'Missing or malformed token');

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return text(500, 'Calendar feed is not configured');

  const appUrl = (Deno.env.get('APP_URL') ?? 'https://akaminas.github.io/Tessera/').replace(/\/?$/, '/');
  const domain = new URL(appUrl).host;

  const client = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // Unknown tokens return no rows; distinguish them so revoked feeds fail visibly.
  const known = await client.from('user_secrets').select('user_id').eq('calendar_token', token).maybeSingle();
  if (known.error) return text(500, 'Could not read the calendar');
  if (!known.data) return text(404, 'Calendar not found. The link may have been reset.');

  const { data, error } = await client.rpc('calendar_feed', { p_token: token });
  if (error) return text(500, 'Could not read the calendar');

  const rows = (data ?? []) as { uid: string; title: string; starts: string | null; ends: string | null; description: string | null; url_path: string | null }[];
  const events: CalendarEvent[] = rows
    .filter((r) => r.starts)
    .map((r) => ({
      uid: r.uid,
      title: r.title,
      starts: r.starts!,
      ends: r.ends,
      description: r.description,
      url: r.url_path ? appUrl + r.url_path.replace(/^\//, '') : null,
    }));

  const body = buildCalendar(events, { name: 'Tessera', domain });
  return new Response(req.method === 'HEAD' ? null : body, {
    status: 200,
    headers: {
      ...cors,
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="tessera.ics"',
      'Cache-Control': 'private, max-age=300',
    },
  });
});
