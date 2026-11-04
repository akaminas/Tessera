import { useState } from 'react';
import { Copy, Download, KeyRound, Trash2 } from 'lucide-react';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { Button, Field, Input } from '@/components/ui';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { useToast } from '@/components/ui/Toast';
import { createIntegrationKey, deleteIntegrationKey, useIntegrationKeys, type IntegrationKey } from '@/data/integrations';
import { appUrl } from '@/lib/env';

const FILES = [
  { file: 'main.js', label: 'main.js' },
  { file: 'manifest.json', label: 'manifest.json' },
  { file: 'styles.css', label: 'styles.css' },
];

/** Settings → Obsidian: connect a vault so tasks and projects can be created from notes. */
export function ObsidianSettings() {
  const toast = useToast();
  const keys = useIntegrationKeys();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [removing, setRemoving] = useState<IntegrationKey | null>(null);

  return (
    <div className="flex max-w-2xl flex-col gap-6 text-sm">
      <p>
        Connect an Obsidian vault to send the tasks in your notes to Tessera, create a project from a note, and tick the boxes in your notes when the tasks are done here. It uses a
        private access key that can do only what you can do, and you can delete it at any time.
      </p>

      <section className="flex flex-col gap-2">
        <h3 className="text-base">1. Install the plugin</h3>
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            Download the three files below into a new folder named <code className="font-mono text-xs">tessera</code> inside your vault’s <code className="font-mono text-xs">.obsidian/plugins</code> folder.
          </li>
          <li>In Obsidian, open Settings → Community plugins, turn off restricted mode, and enable <b>Tessera</b>.</li>
        </ol>
        <div className="flex flex-wrap gap-2">
          {FILES.map((f) => (
            <a
              key={f.file}
              href={appUrl(`obsidian-plugin/${f.file}`)}
              download={f.file}
              className="inline-flex items-center gap-1.5 rounded-[4px] border border-grid px-2.5 py-1.5 hover:bg-hover"
            >
              <Download className="size-3.5" aria-hidden /> {f.label}
            </a>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-base">2. Create an access key</h3>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim()) return;
            setBusy(true);
            try {
              setCode(await createIntegrationKey(name.trim()));
              setName('');
            } catch (err) {
              toast.error(err);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Name" hint="For example, the computer or vault it is for" className="min-w-[14rem] flex-1">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Laptop vault" maxLength={80} />
          </Field>
          <Button type="submit" variant="primary" icon={<KeyRound className="size-4" />} loading={busy} disabled={!name.trim()}>
            Create key
          </Button>
        </form>

        {code && (
          <div role="status" className="flex flex-col gap-2 rounded-[8px] border border-grid bg-card p-3">
            <p className="font-bold">Your connection code</p>
            <p className="text-secondary">Copy it now and paste it into Obsidian (Settings → Tessera). For your safety it is shown only once.</p>
            <textarea readOnly aria-label="Connection code" value={code} rows={3} className="w-full rounded-[4px] border border-grid bg-surface p-2 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
            <div className="flex gap-2">
              <Button size="sm" icon={<Copy className="size-3.5" />} onClick={() => navigator.clipboard.writeText(code).then(() => toast.show('Connection code copied'))}>
                Copy
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setCode(null)}>
                Done
              </Button>
            </div>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-base">Your access keys</h3>
        {keys.data?.length ? (
          <ul className="divide-y divide-grid rounded-[8px] border border-grid">
            {keys.data.map((k) => (
              <li key={k.id} className="flex items-center gap-3 px-3 py-2">
                <KeyRound className="size-4 text-muted" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{k.name}</p>
                  <p className="text-xs text-secondary">
                    Ends in <span className="font-mono">{k.hint}</span> · created {formatDistanceToNow(parseISO(k.created_at), { addSuffix: true })} ·{' '}
                    {k.last_used_at ? `last used ${formatDistanceToNow(parseISO(k.last_used_at), { addSuffix: true })}` : 'not used yet'}
                  </p>
                </div>
                <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} aria-label={`Delete key ${k.name}`} onClick={() => setRemoving(k)}>
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-secondary">{keys.isLoading ? 'Loading…' : 'You have no access keys.'}</p>
        )}
        <p className="text-xs text-secondary">
          Anyone with a connection code can add and change tasks as you, so treat it like a password. If a vault is shared or synced somewhere you do not trust, delete its key here.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-base">3. Use it from Obsidian</h3>
        <p>Open the command palette and search for “Tessera”.</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <b>Send the tasks in this note to Tessera</b> adds each open task (<code className="font-mono text-xs">- [ ] text</code>) to your chosen list, with its due date and priority if you
            wrote them the way the Tasks plugin does (📅 2026-11-20, ⏫). A small ↗ link appears on the line.
          </li>
          <li>Send again after editing a task and the card is updated instead of duplicated.</li>
          <li>
            <b>Create a Tessera project from this note</b> makes a new project and puts the note’s open tasks in its To do list.
          </li>
          <li>
            <b>Tick boxes in this note for tasks done in Tessera</b> brings completed tasks back into the note.
          </li>
        </ul>
      </section>

      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Delete the key “${removing?.name}”?`}
        danger
        confirmLabel="Delete key"
        body="Obsidian vaults using this key stop working until they are connected with a new one. Tasks already sent stay in Tessera."
        onConfirm={() =>
          deleteIntegrationKey(removing!.id)
            .then(() => setRemoving(null))
            .catch(toast.error)
        }
      />
    </div>
  );
}
