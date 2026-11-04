import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Copy, Download, RefreshCw } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { updateProfile } from '@/data/personal';
import { exportMyData, downloadJSON } from '@/data/portability';
import { sb } from '@/lib/supabase';
import { must } from '@/data/errors';
import { env } from '@/lib/env';
import { applyUiPrefs, readUiPrefs } from '@/lib/prefs';
import { Button, Checkbox, Field, Input, PageHeader, Select } from '@/components/ui';
import { useToast } from '@/components/ui/Toast';
import { useShortcutSettings } from '@/layout/shortcuts';
import { cn } from '@/lib/cn';
import { FAMILIES, type Family, type UserPreferences } from '@/data/types';

const TABS = [
  { id: 'profile', label: 'Profile' },
  { id: 'preferences', label: 'Preferences' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'calendar', label: 'Calendar feed' },
  { id: 'data', label: 'Your data' },
  { id: 'account', label: 'Account' },
];

export default function SettingsPage() {
  const { tab = 'profile' } = useParams();
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-6 sm:px-6">
      <PageHeader title="Settings" />
      <nav className="scroll-thin -mt-2 flex gap-1 overflow-x-auto border-b border-grid" aria-label="Settings sections">
        {TABS.map((t) => (
          <Link key={t.id} to={`/settings/${t.id}`} className={cn('-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm', tab === t.id ? 'border-teal-deep font-bold' : 'border-transparent text-secondary hover:text-ink')}>
            {t.label}
          </Link>
        ))}
      </nav>
      {tab === 'profile' && <Profile />}
      {tab === 'preferences' && <Preferences />}
      {tab === 'notifications' && <Notifications />}
      {tab === 'calendar' && <CalendarFeed />}
      {tab === 'data' && <YourData />}
      {tab === 'account' && <Account />}
    </div>
  );
}

function usePrefs() {
  const { profile } = useAuth();
  const toast = useToast();
  const prefs: UserPreferences = profile?.preferences ?? {};
  const save = (patch: Partial<UserPreferences>) =>
    profile ? updateProfile(profile.id, { preferences: { ...prefs, ...patch } }).catch(toast.error) : Promise.resolve();
  return { prefs, save };
}

function Profile() {
  const { profile } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(profile?.display_name ?? '');
  const [color, setColor] = useState<Family>(profile?.avatar_color ?? 'teal');
  const [tz, setTz] = useState(profile?.timezone ?? 'UTC');
  useEffect(() => {
    if (profile) {
      setName(profile.display_name);
      setColor(profile.avatar_color);
      setTz(profile.timezone);
    }
  }, [profile]);
  const zones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? ['UTC'];
  return (
    <form
      className="flex max-w-md flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        updateProfile(profile!.id, { display_name: name.trim(), avatar_color: color, timezone: tz })
          .then(() => toast.show('Profile saved'))
          .catch(toast.error);
      }}
    >
      <Field label="Name" htmlFor="pf-name">
        <Input id="pf-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
      </Field>
      <fieldset>
        <legend className="mb-1 text-[13px] font-bold">Avatar colour</legend>
        <div className="flex gap-2">
          {FAMILIES.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={color === f}
              aria-label={f}
              onClick={() => setColor(f)}
              className={cn('size-8 rounded-full', `bg-${f}-tint`, color === f && 'ring-2 ring-teal ring-offset-2 ring-offset-[var(--v-surface)]')}
              style={{ background: `var(--v-${f}-tint)` }}
            />
          ))}
        </div>
      </fieldset>
      <Field label="Time zone" htmlFor="pf-tz" hint="Used for reminders and calendar times.">
        <Select id="pf-tz" value={tz} onChange={(e) => setTz(e.target.value)}>
          {zones.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </Select>
      </Field>
      <div>
        <Button type="submit" variant="primary" disabled={!name.trim()}>
          Save profile
        </Button>
      </div>
    </form>
  );
}

function Preferences() {
  const { prefs, save } = usePrefs();
  const local = readUiPrefs();
  const [theme, setTheme] = useState(prefs.theme ?? local.theme ?? 'light');
  const [density, setDensity] = useState(prefs.density ?? local.density ?? 'comfortable');
  const [motion, setMotion] = useState(prefs.motion ?? local.motion ?? 'full');
  const shortcuts = useShortcutSettings();
  const update = (patch: Partial<UserPreferences>) => {
    applyUiPrefs({ theme: patch.theme, density: patch.density, motion: patch.motion });
    save(patch);
  };
  return (
    <div className="flex max-w-md flex-col gap-4">
      <Field label="Theme" htmlFor="pr-theme">
        <Select id="pr-theme" value={theme} onChange={(e) => (setTheme(e.target.value as typeof theme), update({ theme: e.target.value as UserPreferences['theme'] }))}>
          <option value="system">Follow my device</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </Select>
      </Field>
      <Field label="Display density" htmlFor="pr-density" hint="Compact fits more rows on screen.">
        <Select id="pr-density" value={density} onChange={(e) => (setDensity(e.target.value as typeof density), update({ density: e.target.value as UserPreferences['density'] }))}>
          <option value="comfortable">Comfortable</option>
          <option value="compact">Compact</option>
        </Select>
      </Field>
      <Field label="Motion" htmlFor="pr-motion" hint="Reduced turns off transitions. Your device setting is always respected.">
        <Select id="pr-motion" value={motion} onChange={(e) => (setMotion(e.target.value as typeof motion), update({ motion: e.target.value as UserPreferences['motion'] }))}>
          <option value="full">Subtle transitions</option>
          <option value="reduced">Reduced</option>
        </Select>
      </Field>
      <div className="flex flex-col gap-1">
        <Checkbox checked={shortcuts.enabled} onChange={shortcuts.setEnabled} label="Keyboard shortcuts" />
        <button className="self-start text-sm text-link underline" onClick={shortcuts.openHelp}>
          Show all shortcuts (?)
        </button>
      </div>
    </div>
  );
}

function Notifications() {
  const { prefs, save } = usePrefs();
  const on = prefs.notifyOn ?? {};
  const set = (k: keyof NonNullable<UserPreferences['notifyOn']>, v: boolean) => save({ notifyOn: { ...on, [k]: v } });
  return (
    <div className="flex max-w-lg flex-col gap-5">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[13px] font-bold">Notify me in Tessera when</legend>
        <Checkbox checked={on.assigned !== false} onChange={(v) => set('assigned', v)} label="I am assigned to a task" />
        <Checkbox checked={on.mentioned !== false} onChange={(v) => set('mentioned', v)} label="Someone mentions me" />
        <Checkbox checked={on.watching !== false} onChange={(v) => set('watching', v)} label="Tasks I watch get comments or are completed" />
        <Checkbox checked={on.due !== false} onChange={(v) => set('due', v)} label="My tasks are due soon or overdue" />
      </fieldset>
      <Field label="Remind me about due tasks" htmlFor="nt-days">
        <Select id="nt-days" value={String(prefs.reminderDays ?? 1)} onChange={(e) => save({ reminderDays: parseInt(e.target.value, 10) })}>
          <option value="0">On the due date</option>
          <option value="1">1 day before</option>
          <option value="2">2 days before</option>
          <option value="3">3 days before</option>
          <option value="7">1 week before</option>
        </Select>
      </Field>
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-[13px] font-bold">Email</legend>
        <Checkbox checked={prefs.emailNotifications === true} onChange={(v) => save({ emailNotifications: v })} label="Send me a digest of unread notifications by email" />
        <p className="text-xs text-secondary">
          Email digests are sent only if your administrator has configured an email provider for this installation. In-app notifications always work.
        </p>
      </fieldset>
    </div>
  );
}

function CalendarFeed() {
  const { user } = useAuth();
  const toast = useToast();
  const q = useQuery({
    queryKey: ['me', 'calendar-token'],
    queryFn: async () => (must(await sb().from('user_secrets').select('calendar_token').eq('user_id', user!.id).single()) as { calendar_token: string }).calendar_token,
  });
  const url = q.data ? `${env.supabaseUrl}/functions/v1/ical?token=${q.data}` : '';
  return (
    <div className="flex max-w-xl flex-col gap-4 text-sm">
      <p>
        Subscribe to your Tessera dates (tasks assigned to you and milestones of your projects) from Google Calendar, Outlook or Apple Calendar. In Google Calendar use{' '}
        <i>Other calendars → From URL</i>. Calendar apps refresh subscriptions on their own schedule (often every few hours).
      </p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-[3px] border border-grid bg-card px-2 py-1.5 font-mono text-xs">{url || 'Loading…'}</code>
        <Button size="sm" icon={<Copy className="size-3.5" />} disabled={!url} onClick={() => navigator.clipboard.writeText(url).then(() => toast.show('Feed address copied'))}>
          Copy
        </Button>
      </div>
      <p className="text-xs text-secondary">Treat this address like a password: anyone with it can read your task titles and dates. Reset it if it was shared by mistake.</p>
      <div>
        <Button
          size="sm"
          icon={<RefreshCw className="size-3.5" />}
          onClick={async () => {
            try {
              must(await sb().from('user_secrets').update({ calendar_token: crypto.randomUUID() }).eq('user_id', user!.id));
              await q.refetch();
              toast.show('A new feed address was created. Update your calendar subscription.');
            } catch (err) {
              toast.error(err);
            }
          }}
        >
          Reset feed address
        </Button>
      </div>
      <p className="text-xs text-secondary">
        You can also download a one-off .ics file from the Calendar page. Two-way sync with Google Calendar is not available.
      </p>
    </div>
  );
}

function YourData() {
  const { user } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex max-w-xl flex-col gap-3 text-sm">
      <p>Download a machine-readable copy of your own data: profile, preferences, notifications, time entries, bookmarks, saved views and the work assigned to you.</p>
      <p className="text-secondary">To export a whole project (boards, tasks, plans, KPIs and — with finance access — budgets), use Project settings → Export.</p>
      <div>
        <Button
          icon={<Download className="size-4" />}
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              downloadJSON(`tessera-my-data-${new Date().toISOString().slice(0, 10)}.json`, await exportMyData(user!.id));
            } catch (err) {
              toast.error(err);
            } finally {
              setBusy(false);
            }
          }}
        >
          Download my data (JSON)
        </Button>
      </div>
    </div>
  );
}

function Account() {
  const { user, updatePassword, signOut } = useAuth();
  const [pw, setPw] = useState('');
  const toast = useToast();
  return (
    <div className="flex max-w-md flex-col gap-4">
      <p className="text-sm">
        Signed in as <b>{user?.email}</b>.
      </p>
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (pw.length < 8) return toast.error(new Error('Use at least 8 characters.'));
          updatePassword(pw)
            .then(() => {
              setPw('');
              toast.show('Password changed');
            })
            .catch(toast.error);
        }}
      >
        <Field label="New password" htmlFor="ac-pw" hint="At least 8 characters.">
          <Input id="ac-pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        </Field>
        <div>
          <Button type="submit" disabled={!pw}>
            Change password
          </Button>
        </div>
      </form>
      <div className="border-t border-grid pt-4">
        <Button variant="ghost" onClick={() => signOut()}>
          Sign out
        </Button>
      </div>
    </div>
  );
}
