import { sb } from '@/lib/supabase';
import { must } from './errors';

/**
 * Full JSON export of a project for data portability and offline archiving.
 * Exports exactly what the signed-in user may read (RLS applies); financial
 * tables are included only when the user has finance access.
 */
export async function exportProjectJSON(projectId: string, includeFinance: boolean): Promise<Record<string, unknown>> {
  const byProject = async (table: string, order = 'created_at') =>
    must(await sb().from(table).select('*').eq('project_id', projectId).order(order)) as unknown[];
  const project = must(await sb().from('projects').select('*').eq('id', projectId).single());
  const [boards, lists, labels, cards, assignees, cardLabels, checklists, items, comments, fields, fieldValues, deps, links, attachments, time] =
    await Promise.all([
      byProject('boards'),
      byProject('lists'),
      byProject('labels'),
      byProject('cards'),
      byProject('card_assignees', 'assigned_at'),
      sb().from('card_labels').select('*').eq('project_id', projectId).then((r) => must(r) as unknown[]),
      byProject('checklists'),
      byProject('checklist_items'),
      byProject('comments'),
      byProject('custom_fields'),
      byProject('card_field_values', 'updated_at'),
      byProject('card_dependencies'),
      byProject('card_links'),
      byProject('attachments'),
      byProject('time_entries'),
    ]);
  const [partners, periods, wps, wpMembers, milestones, evidence, risks, meetings, decisions, actions, kpis, measurements, allocations, effortReports, rules] =
    await Promise.all([
      byProject('project_partners'),
      byProject('reporting_periods', 'start_date'),
      byProject('work_packages'),
      sb().from('wp_members').select('*').eq('project_id', projectId).then((r) => must(r) as unknown[]),
      byProject('milestones'),
      byProject('evidence_items'),
      byProject('risks'),
      byProject('meetings'),
      byProject('meeting_decisions'),
      byProject('meeting_actions'),
      byProject('kpis'),
      byProject('kpi_measurements'),
      byProject('effort_allocations'),
      byProject('effort_reports'),
      byProject('automation_rules'),
    ]);
  const finance = includeFinance
    ? {
        cost_categories: await byProject('cost_categories'),
        partner_finance: await byProject('partner_finance', 'updated_at'),
        budget_lines: await byProject('budget_lines'),
        expenditures: await byProject('expenditures'),
      }
    : null;
  return {
    format: 'tessera-project-export',
    version: 1,
    exported_at: new Date().toISOString(),
    note: 'Contains only records the exporting user was allowed to read. Files are referenced by storage path; download them separately.',
    project,
    boards,
    lists,
    labels,
    cards,
    card_assignees: assignees,
    card_labels: cardLabels,
    checklists,
    checklist_items: items,
    comments,
    custom_fields: fields,
    card_field_values: fieldValues,
    card_dependencies: deps,
    card_links: links,
    attachments,
    time_entries: time,
    project_partners: partners,
    reporting_periods: periods,
    work_packages: wps,
    wp_members: wpMembers,
    milestones,
    evidence_items: evidence,
    risks,
    meetings,
    meeting_decisions: decisions,
    meeting_actions: actions,
    kpis,
    kpi_measurements: measurements,
    effort_allocations: allocations,
    effort_reports: effortReports,
    automation_rules: rules,
    finance,
  };
}

export function downloadJSON(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Export the signed-in user's own data (profile, notifications, time, assigned work). */
export async function exportMyData(userId: string) {
  const [profile, notifications, time, bookmarks, views, work] = await Promise.all([
    sb().from('profiles').select('*').eq('id', userId).single(),
    sb().from('notifications').select('*').order('created_at'),
    sb().from('time_entries').select('*').eq('user_id', userId).order('entry_date'),
    sb().from('bookmarks').select('*'),
    sb().from('saved_views').select('*').eq('user_id', userId),
    sb().rpc('my_work', { p_include_done: true }),
  ]);
  return {
    format: 'tessera-personal-export',
    version: 1,
    exported_at: new Date().toISOString(),
    profile: must(profile),
    notifications: must(notifications),
    time_entries: must(time),
    bookmarks: must(bookmarks),
    saved_views: must(views),
    assigned_work: must(work),
  };
}
