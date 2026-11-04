import { useState } from 'react';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { AlertTriangle, CheckCircle2, Clock, Copy, Eye, EyeOff, Plus, Send, Trash2 } from 'lucide-react';
import { Button, Checkbox, EmptyState, ErrorNote, Field, IconButton, Input, PageLoading, Select } from '@/components/ui';
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog';
import { useToast } from '@/components/ui/Toast';
import {
  WEBHOOK_EVENTS,
  createIntegration,
  deleteIntegration,
  updateIntegration,
  useDeliveries,
  useIntegrations,
  validateIntegration,
  type IntegrationRow,
} from '@/data/automation';

const KIND_LABEL: Record<IntegrationRow['kind'], string> = { webhook: 'Webhook (JSON)', slack: 'Slack', teams: 'Microsoft Teams' };
const KIND_HINT: Record<IntegrationRow['kind'], string> = {
  webhook: 'Tessera sends a signed JSON POST to your endpoint.',
  slack: 'Create an “Incoming webhook” in Slack and paste its https://hooks.slack.com/… address.',
  teams: 'In Teams, add an incoming webhook (Workflows: “Post to a channel when a webhook request is received”) and paste its address.',
};

const DELIVERY = {
  pending: { icon: <Clock className="size-3.5 text-secondary" aria-hidden />, word: 'Queued' },
  sent: { icon: <Send className="size-3.5 text-secondary" aria-hidden />, word: 'Sent, awaiting response' },
  delivered: { icon: <CheckCircle2 className="size-3.5 text-good" aria-hidden />, word: 'Delivered' },
  failed: { icon: <AlertTriangle className="size-3.5 text-critical" aria-hidden />, word: 'Failed' },
};

export function IntegrationsTab({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const list = useIntegrations(projectId, canManage);
  const deliveries = useDeliveries(projectId, canManage);
  const [creating, setCreating] = useState(false);
  const [confirm, setConfirm] = useState<IntegrationRow | null>(null);
  const toast = useToast();

  if (!canManage)
    return (
      <section role="tabpanel">
        <EmptyState title="Only project managers can manage integrations">
          Integrations hold web addresses and signing secrets, so they are visible to project managers only.
        </EmptyState>
      </section>
    );

  return (
    <section role="tabpanel" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex-1 text-sm text-secondary">
          Send project events to Slack, Microsoft Teams or any HTTPS endpoint. Deliveries are retried up to three times.
        </p>
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
          Add integration
        </Button>
      </div>
      {list.isLoading && <PageLoading />}
      {list.error && <ErrorNote error={list.error} retry={() => list.refetch()} />}
      {list.data?.length === 0 && <EmptyState title="No integrations yet" />}
      <ul className="flex flex-col gap-3">
        {(list.data ?? []).map((i) => (
          <IntegrationItem key={i.id} i={i} onDelete={() => setConfirm(i)} />
        ))}
      </ul>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm">Recent deliveries</h3>
        {deliveries.error && <ErrorNote error={deliveries.error} />}
        {deliveries.data?.length === 0 && <p className="text-sm text-secondary">Nothing has been sent yet.</p>}
        {(deliveries.data?.length ?? 0) > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-rule text-left">
                  <th className="py-1.5 pr-3 font-bold">When</th>
                  <th className="py-1.5 pr-3 font-bold">Integration</th>
                  <th className="py-1.5 pr-3 font-bold">Event</th>
                  <th className="py-1.5 pr-3 font-bold">Status</th>
                  <th className="py-1.5 pr-3 text-right font-bold">HTTP</th>
                  <th className="py-1.5 pr-3 text-right font-bold">Attempts</th>
                  <th className="py-1.5 font-bold">Error</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.data!.map((d) => (
                  <tr key={d.id} className="border-b border-grid align-top">
                    <td className="whitespace-nowrap py-1.5 pr-3 text-secondary">{formatDistanceToNow(parseISO(d.created_at), { addSuffix: true })}</td>
                    <td className="py-1.5 pr-3">{d.integrations?.name ?? '—'}</td>
                    <td className="py-1.5 pr-3 font-mono text-xs">{d.event}</td>
                    <td className="whitespace-nowrap py-1.5 pr-3">
                      <span className="inline-flex items-center gap-1">
                        {DELIVERY[d.status].icon}
                        {DELIVERY[d.status].word}
                      </span>
                    </td>
                    <td className="num py-1.5 pr-3 text-right">{d.response_status ?? '—'}</td>
                    <td className="num py-1.5 pr-3 text-right">{d.attempts}</td>
                    <td className="py-1.5 text-xs text-secondary">{d.error ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-1 border-l-2 border-teal bg-card px-3 py-2 text-sm">
        <h3 className="text-sm">Verifying webhook signatures</h3>
        <p className="text-secondary">
          Each JSON webhook request carries <code className="font-mono text-xs">X-Tessera-Event</code> and{' '}
          <code className="font-mono text-xs">X-Tessera-Signature: sha256=&lt;hex&gt;</code>. The signature is the HMAC-SHA256 of the raw
          request body using the integration’s secret. Compute it on your server and compare in constant time; reject requests that do not match.
        </p>
        <pre className="overflow-x-auto rounded-[4px] border border-grid bg-surface p-2 font-mono text-xs">{`// Node.js
const expected = 'sha256=' + crypto.createHmac('sha256', SECRET).update(rawBody).digest('hex');
const ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(req.headers['x-tessera-signature']));`}</pre>
      </section>

      {creating && <CreateIntegration projectId={projectId} onClose={() => setCreating(false)} />}
      <ConfirmDialog
        open={Boolean(confirm)}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Delete this integration?"
        danger
        confirmLabel="Delete"
        body={<>Events will no longer be sent to “{confirm?.name}”. Automations that use it will report a failure until edited.</>}
        onConfirm={async () => {
          if (!confirm) return;
          try {
            await deleteIntegration(confirm);
            setConfirm(null);
          } catch (err) {
            toast.error(err);
          }
        }}
      />
    </section>
  );
}

function IntegrationItem({ i, onDelete }: { i: IntegrationRow; onDelete: () => void }) {
  const [reveal, setReveal] = useState(false);
  const toast = useToast();
  const host = (() => {
    try {
      return new URL(i.url).host;
    } catch {
      return i.url;
    }
  })();
  const toggleEvent = (ev: string, on: boolean) => {
    const events = on ? [...new Set([...i.events, ev])] : i.events.filter((x) => x !== ev);
    if (!events.length) {
      toast.show('Keep at least one event, or turn the integration off.');
      return;
    }
    updateIntegration(i, { events }).catch(toast.error);
  };
  return (
    <li className="flex flex-col gap-2 rounded-[4px] border border-grid p-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="checkbox"
          role="switch"
          className="size-4 accent-[var(--v-teal-deep)]"
          checked={i.enabled}
          aria-label={`${i.enabled ? 'Disable' : 'Enable'} ${i.name}`}
          onChange={(e) => updateIntegration(i, { enabled: e.target.checked }).catch(toast.error)}
        />
        <span className="font-bold">{i.name}</span>
        <span className="text-xs text-secondary">
          {KIND_LABEL[i.kind]} · {host}
          {!i.enabled && ' · off'}
        </span>
        <IconButton label={`Delete ${i.name}`} className="ml-auto" onClick={onDelete}>
          <Trash2 className="size-4" />
        </IconButton>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {WEBHOOK_EVENTS.map((ev) => (
          <Checkbox key={ev.id} checked={i.events.includes(ev.id)} onChange={(v) => toggleEvent(ev.id, v)} label={<span className="text-sm">{ev.label}</span>} />
        ))}
      </div>
      {i.kind === 'webhook' && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-secondary">Signing secret</span>
          <code className="rounded-[3px] border border-grid bg-card px-1.5 font-mono text-xs">{reveal ? i.secret : '•'.repeat(24)}</code>
          <IconButton label={reveal ? 'Hide secret' : 'Show secret'} onClick={() => setReveal((v) => !v)}>
            {reveal ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </IconButton>
          <IconButton
            label="Copy secret"
            onClick={() =>
              navigator.clipboard
                .writeText(i.secret)
                .then(() => toast.show('Secret copied'))
                .catch(() => toast.show('Copy failed; reveal the secret and copy it manually.'))
            }
          >
            <Copy className="size-4" />
          </IconButton>
        </div>
      )}
      <p className="text-xs text-secondary">Automations can also send to this integration with the “Send to an integration” action.</p>
    </li>
  );
}

function CreateIntegration({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [kind, setKind] = useState<IntegrationRow['kind']>('slack');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<string[]>(['task.completed', 'milestone.updated']);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Add integration"
      width={520}
      footer={
        <Button
          variant="primary"
          loading={busy}
          onClick={async () => {
            const errs = validateIntegration({ name, url, events });
            setErrors(errs);
            if (errs.length) return;
            setBusy(true);
            try {
              await createIntegration(projectId, { kind, name, url, events });
              toast.show(kind === 'webhook' ? 'Integration added. Copy its signing secret from the list.' : 'Integration added');
              onClose();
            } catch (err) {
              toast.error(err);
            } finally {
              setBusy(false);
            }
          }}
        >
          Add
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Type" htmlFor="int-kind" hint={KIND_HINT[kind]}>
          <Select id="int-kind" value={kind} onChange={(e) => setKind(e.target.value as IntegrationRow['kind'])}>
            <option value="slack">Slack</option>
            <option value="teams">Microsoft Teams</option>
            <option value="webhook">Webhook (JSON, signed)</option>
          </Select>
        </Field>
        <Field label="Name" htmlFor="int-name">
          <Input id="int-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} placeholder="e.g. #project-updates" />
        </Field>
        <Field label="Address" htmlFor="int-url" hint="Must start with https://. Treat it like a password: anyone with it can post to the channel.">
          <Input id="int-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" autoComplete="off" />
        </Field>
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-[13px] font-bold">Send these events</legend>
          {WEBHOOK_EVENTS.map((ev) => (
            <Checkbox
              key={ev.id}
              checked={events.includes(ev.id)}
              onChange={(v) => setEvents((x) => (v ? [...x, ev.id] : x.filter((y) => y !== ev.id)))}
              label={ev.label}
            />
          ))}
        </fieldset>
        {errors.length > 0 && (
          <ul role="alert" className="text-sm text-critical">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
