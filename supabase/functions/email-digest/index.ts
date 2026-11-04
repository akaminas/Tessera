// Tessera email digest.
//   POST /functions/v1/email-digest   Authorization: Bearer <CRON_SECRET>
// Sends one calm digest per run to each user who turned on email notifications
// (profiles.preferences.emailNotifications = true), covering unread
// notifications not yet emailed, then marks them emailed. Uses Resend.
// Required secrets: CRON_SECRET, RESEND_API_KEY, EMAIL_FROM. Optional: APP_URL.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.118.0';

const MAX_USERS = 200;
const MAX_ITEMS = 25;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Mentions are stored as @[Name](user:uuid); show them as @Name. */
function plain(s: string): string {
  return s.replace(/@\[([^\]]+)\]\(user:[^)]+\)/g, '@$1');
}

interface Note {
  id: string;
  title: string;
  body: string;
  card_id: string | null;
  project_id: string | null;
  created_at: string;
}

function linkFor(appUrl: string, n: Note): string {
  if (n.card_id) return `${appUrl}c/${n.card_id}`;
  if (n.project_id) return `${appUrl}p/${n.project_id}`;
  return `${appUrl}inbox`;
}

function render(appUrl: string, name: string, notes: Note[], more: number) {
  const items = notes
    .map(
      (n) =>
        `<li style="margin:0 0 12px"><a href="${esc(linkFor(appUrl, n))}" style="color:#304168">${esc(plain(n.title))}</a>${
          n.body ? `<div style="color:#5a5650;font-size:13px">${esc(plain(n.body).slice(0, 300))}</div>` : ''
        }</li>`,
    )
    .join('');
  const html = `<!doctype html><html><body style="margin:0;background:#ffffff;font-family:Corbel,Lato,'Segoe UI',sans-serif;color:#2a2825">
<div style="max-width:560px;margin:0 auto;padding:24px">
<p style="font-family:'Palatino Linotype',Palatino,serif;font-size:20px;margin:0 0 4px">Tessera</p>
<p style="color:#8a857c;font-size:13px;margin:0 0 20px">Updates for ${esc(name)}</p>
<ul style="padding-left:18px;margin:0">${items}</ul>
${more > 0 ? `<p style="color:#5a5650;font-size:13px">…and ${more} more in your <a href="${esc(appUrl)}inbox" style="color:#304168">Inbox</a>.</p>` : ''}
<p style="color:#8a857c;font-size:12px;margin-top:24px;border-top:1px solid #e6e0d4;padding-top:12px">You receive this because email notifications are on. Turn them off in Tessera under Settings → Preferences.</p>
</div></body></html>`;
  const text = [
    `Tessera – updates for ${name}`,
    '',
    ...notes.map((n) => `• ${plain(n.title)}\n  ${linkFor(appUrl, n)}`),
    more > 0 ? `\n…and ${more} more in your Inbox: ${appUrl}inbox` : '',
    '',
    'Turn these emails off in Settings → Preferences.',
  ].join('\n');
  return { html, text };
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const cronSecret = Deno.env.get('CRON_SECRET');
  if (!cronSecret) return json(500, { error: 'CRON_SECRET is not configured' });
  const auth = req.headers.get('authorization') ?? '';
  if (!safeEqual(auth, `Bearer ${cronSecret}`)) return json(401, { error: 'Unauthorized' });

  const resendKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('EMAIL_FROM');
  if (!resendKey || !from) {
    return json(503, { error: 'Email delivery is not configured: set RESEND_API_KEY and EMAIL_FROM. Nothing was sent.' });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return json(500, { error: 'Supabase environment is missing' });
  const appUrl = (Deno.env.get('APP_URL') ?? 'https://akaminas.github.io/Tessera/').replace(/\/?$/, '/');
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const users = await db
    .from('profiles')
    .select('id, email, display_name')
    .eq('preferences->>emailNotifications', 'true')
    .not('email', 'is', null)
    .limit(MAX_USERS);
  if (users.error) return json(500, { error: 'Could not read profiles' });

  let sent = 0;
  let failed = 0;
  for (const u of users.data ?? []) {
    const notes = await db
      .from('notifications')
      .select('id, title, body, card_id, project_id, created_at')
      .eq('user_id', u.id)
      .is('read_at', null)
      .is('emailed_at', null)
      .order('created_at', { ascending: false })
      .limit(MAX_ITEMS + 1);
    if (notes.error || !notes.data?.length) continue;
    const list = notes.data.slice(0, MAX_ITEMS) as Note[];
    const countRes = await db
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', u.id)
      .is('read_at', null)
      .is('emailed_at', null);
    const more = Math.max(0, (countRes.count ?? list.length) - list.length);
    const { html, text } = render(appUrl, u.display_name || u.email, list, more);
    const subject = list.length + more === 1 ? `Tessera: ${plain(list[0].title).slice(0, 120)}` : `Tessera: ${list.length + more} updates`;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [u.email], subject, html, text }),
    }).catch(() => null);

    if (!res || !res.ok) {
      failed++;
      continue; // leave emailed_at empty so the next run retries
    }
    // Mark everything included (and older un-emailed items summarised as "more") as emailed.
    const upd = await db
      .from('notifications')
      .update({ emailed_at: new Date().toISOString() })
      .eq('user_id', u.id)
      .is('read_at', null)
      .is('emailed_at', null)
      .lte('created_at', list[0].created_at);
    if (upd.error) failed++;
    else sent++;
  }
  return json(200, { users: users.data?.length ?? 0, sent, failed });
});
