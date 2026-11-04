import { useMemo } from 'react';
import { useMyWork, type WorkItem } from '@/data/personal';
import { BUCKET_LABEL, groupWork } from '@/domain/workGroups';
import { Checkbox, ErrorNote, Input, PageHeader, PageLoading, Section, Select, EmptyState } from '@/components/ui';
import { WorkItemRow } from '@/features/work/WorkItemRow';
import { usePersistentState } from '@/lib/usePersistentState';

export default function MyWorkPage() {
  const [prefs, setPrefs] = usePersistentState('mywork', { includeDone: false, group: 'due' as 'due' | 'project', text: '', hideChecklist: false });
  const work = useMyWork(prefs.includeDone);

  const items = useMemo(() => {
    const t = prefs.text.trim().toLowerCase();
    return (work.data ?? []).filter(
      (w) => (!t || w.title.toLowerCase().includes(t) || w.project_name.toLowerCase().includes(t)) && (!prefs.hideChecklist || w.source === 'card'),
    );
  }, [work.data, prefs.text, prefs.hideChecklist]);

  const groups = useMemo(() => {
    if (prefs.group === 'due') return groupWork(items).map((g) => ({ key: g.bucket, title: BUCKET_LABEL[g.bucket], items: g.items }));
    const byProject = new Map<string, WorkItem[]>();
    for (const w of items) byProject.set(w.project_name, [...(byProject.get(w.project_name) ?? []), w]);
    return [...byProject.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, list]) => ({ key: name, title: name, items: list.sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999')) }));
  }, [items, prefs.group]);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 px-4 py-6 sm:px-6">
      <PageHeader title="My Work" subtitle="Everything assigned to you across projects, including checklist items." />
      <div className="flex flex-wrap items-center gap-3">
        <Input value={prefs.text} onChange={(e) => setPrefs({ ...prefs, text: e.target.value })} placeholder="Filter" aria-label="Filter my work" className="h-8 w-56" />
        <Select value={prefs.group} onChange={(e) => setPrefs({ ...prefs, group: e.target.value as 'due' | 'project' })} className="h-8 w-44" aria-label="Group by">
          <option value="due">Group by due date</option>
          <option value="project">Group by project</option>
        </Select>
        <Checkbox checked={prefs.includeDone} onChange={(v) => setPrefs({ ...prefs, includeDone: v })} label="Show completed" />
        <Checkbox checked={prefs.hideChecklist} onChange={(v) => setPrefs({ ...prefs, hideChecklist: v })} label="Hide checklist items" />
      </div>
      {work.isLoading && <PageLoading />}
      {work.error && <ErrorNote error={work.error} retry={() => work.refetch()} />}
      {!work.isLoading && groups.length === 0 && (
        <EmptyState title="Nothing assigned to you">Tasks and checklist items assigned to you in any project appear here.</EmptyState>
      )}
      {groups.map((g) => (
        <Section key={g.key} id={`mywork-${prefs.group}-${g.key}`} title={g.title} count={g.items.length} defaultOpen={g.key !== 'done'}>
          <ul className="divide-y divide-grid">
            {g.items.map((w) => (
              <WorkItemRow key={w.card_id + (w.checklist_item_id ?? '')} item={w} showProject={prefs.group === 'due'} />
            ))}
          </ul>
        </Section>
      ))}
    </div>
  );
}
