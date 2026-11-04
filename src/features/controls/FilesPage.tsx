import { useMemo, useRef, useState } from 'react';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { ExternalLink, FileText, Link2, Trash2, Upload } from 'lucide-react';
import { addLinkAttachment, linkKind, openAttachment, removeAttachment, uploadAttachment, useAttachments, type Attachment } from '@/data/cardExtras';
import { useMilestones, useProjectCardsLite } from '@/data/controls';
import { useProjectCtx } from '@/features/project/context';
import { Button, EmptyState, ErrorNote, IconButton, Input, PageHeader, PageLoading, Select } from '@/components/ui';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { Popover } from '@/components/ui/Menu';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';

const SOURCE_LABEL: Record<string, string> = {
  card: 'Task',
  project: 'Project file',
  milestone: 'Milestone evidence',
  evidence: 'Evidence',
  kpi: 'KPI evidence',
  expense: 'Financial evidence',
  meeting: 'Meeting',
  risk: 'Risk',
  work_package: 'Work package',
};

function formatBytes(n: number | null): string {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function FilesPage() {
  const { project, canEdit, people, openCard } = useProjectCtx();
  const files = useAttachments(project.id, { all: true });
  const cards = useProjectCardsLite(project.id);
  const milestones = useMilestones(project.id);
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const [source, setSource] = useState('');
  const [kind, setKind] = useState<'' | 'file' | 'link'>('');
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [confirm, setConfirm] = useState<Attachment | null>(null);

  const cardTitle = useMemo(() => new Map((cards.data ?? []).map((c) => [c.id, c.title])), [cards.data]);
  const msTitle = useMemo(() => new Map((milestones.data ?? []).map((m) => [m.id, `${m.code ? m.code + ' ' : ''}${m.title}`])), [milestones.data]);
  const sources = useMemo(() => [...new Set((files.data ?? []).map((f) => f.entity_type))], [files.data]);
  const list = useMemo(() => {
    const t = text.trim().toLowerCase();
    return (files.data ?? []).filter(
      (f) => (!t || `${f.name} ${f.url ?? ''}`.toLowerCase().includes(t)) && (!source || f.entity_type === source) && (!kind || f.kind === kind),
    );
  }, [files.data, text, source, kind]);

  const upload = async (list: File[]) => {
    if (!list.length) return;
    setBusy(true);
    try {
      for (const f of list) await uploadAttachment(project.id, f, { entityType: 'project' });
      toast.show(`${list.length} file${list.length > 1 ? 's' : ''} uploaded`);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  if (files.isLoading) return <PageLoading />;

  return (
    <div
      className="mx-auto flex max-w-6xl flex-col gap-4 px-3 py-4 sm:px-5"
      onDragOver={(e) => canEdit && e.preventDefault()}
      onDrop={(e) => {
        if (!canEdit) return;
        e.preventDefault();
        upload([...e.dataTransfer.files]);
      }}
    >
      <PageHeader
        title="Files"
        subtitle="Every file and document link in this project. Files are private and opened through short-lived links."
        actions={
          canEdit && (
            <>
              <input ref={fileRef} type="file" multiple hidden onChange={(e) => (upload([...(e.target.files ?? [])]), (e.target.value = ''))} />
              <Popover
                align="end"
                trigger={
                  <Button icon={<Link2 className="size-4" />}>Add link</Button>
                }
              >
                <form
                  className="flex flex-col gap-2"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    try {
                      await addLinkAttachment(project.id, url.trim(), name.trim(), { entityType: 'project' });
                      setUrl('');
                      setName('');
                    } catch (err) {
                      toast.error(err);
                    }
                  }}
                >
                  <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://drive.google.com/…" aria-label="Link address" className="h-8" />
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (optional)" aria-label="Link name" className="h-8" />
                  <Button size="sm" type="submit" variant="primary" disabled={!url.trim()}>
                    Add link
                  </Button>
                </form>
              </Popover>
              <Button variant="primary" loading={busy} icon={<Upload className="size-4" />} onClick={() => fileRef.current?.click()}>
                Upload
              </Button>
            </>
          )
        }
      />
      {files.error && <ErrorNote error={files.error} retry={() => files.refetch()} />}
      <div className="flex flex-wrap items-center gap-2">
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search by name" aria-label="Search files" className="h-8 w-56" />
        <Select value={source} onChange={(e) => setSource(e.target.value)} className="h-8 w-48" aria-label="Source">
          <option value="">All sources</option>
          {sources.map((s) => (
            <option key={s} value={s}>
              {SOURCE_LABEL[s] ?? s}
            </option>
          ))}
        </Select>
        <Select value={kind} onChange={(e) => setKind(e.target.value as '' | 'file' | 'link')} className="h-8 w-32" aria-label="Kind">
          <option value="">Files and links</option>
          <option value="file">Files</option>
          <option value="link">Links</option>
        </Select>
        <span className="num text-xs text-secondary">{list.length} shown</span>
      </div>
      {list.length === 0 ? (
        <EmptyState title={(files.data ?? []).length ? 'Nothing matches' : 'No files yet'}>
          {canEdit ? 'Drop files anywhere on this page, or attach them to tasks, milestones and expenses.' : 'Files attached in this project appear here.'}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-rule text-left">
                <th className="py-2 pr-3 font-bold">Name</th>
                <th className="py-2 pr-3 font-bold">Belongs to</th>
                <th className="py-2 pr-3 font-bold">Type</th>
                <th className="py-2 pr-3 font-bold">Added</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {list.map((f) => {
                const owner = people.find((p) => p.user_id === f.uploaded_by);
                const linked =
                  f.card_id != null ? cardTitle.get(f.card_id) : f.entity_type === 'milestone' && f.entity_id ? msTitle.get(f.entity_id) : undefined;
                return (
                  <tr key={f.id} className="border-b border-grid hover:bg-hover">
                    <td className="py-2 pr-3">
                      <button className="inline-flex max-w-[420px] items-center gap-2 text-left text-link hover:underline" onClick={() => openAttachment(f).catch(toast.error)}>
                        {f.kind === 'file' ? <FileText className="size-4 shrink-0 text-secondary" aria-hidden /> : <ExternalLink className="size-4 shrink-0 text-secondary" aria-hidden />}
                        <span className="truncate">{f.name}</span>
                      </button>
                      {f.is_finance && <span className="ml-2 text-xs text-secondary">finance</span>}
                    </td>
                    <td className="py-2 pr-3">
                      <span className="text-xs text-secondary">{SOURCE_LABEL[f.entity_type] ?? f.entity_type}</span>
                      {linked && (
                        <span className="block max-w-[260px] truncate">
                          {f.card_id ? (
                            <button className="hover:underline" onClick={() => openCard(f.card_id!)}>
                              {linked}
                            </button>
                          ) : (
                            linked
                          )}
                        </span>
                      )}
                    </td>
                    <td className="num py-2 pr-3 text-secondary">{f.kind === 'link' ? linkKind(f.url!) ?? 'Link' : `${(f.mime_type ?? '').split('/')[1] ?? 'file'} · ${formatBytes(f.size_bytes)}`}</td>
                    <td className="py-2 pr-3 text-secondary">
                      {formatDistanceToNow(parseISO(f.created_at), { addSuffix: true })}
                      {owner && <span className="block text-xs">by {owner.display_name}</span>}
                    </td>
                    <td className={cn('py-2 text-right')}>
                      {canEdit && (
                        <IconButton label={`Delete ${f.name}`} onClick={() => setConfirm(f)}>
                          <Trash2 className="size-4" />
                        </IconButton>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmDialog
        open={Boolean(confirm)}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm?.kind === 'file' ? 'Delete this file?' : 'Remove this link?'}
        danger
        confirmLabel="Delete"
        body={confirm?.kind === 'file' ? `“${confirm?.name}” will be deleted from storage. This cannot be undone.` : `The link “${confirm?.name}” will be removed.`}
        onConfirm={async () => {
          if (!confirm) return;
          try {
            await removeAttachment(confirm);
            setConfirm(null);
          } catch (err) {
            toast.error(err);
          }
        }}
      />
    </div>
  );
}
