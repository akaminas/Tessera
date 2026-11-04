/**
 * Project templates ("blueprints"). One format serves both the built-in
 * templates below and templates users save from their own projects.
 * Dates are relative: `day` offsets from the project start, `month` = project
 * month (1-based, like M1–M24 schedules). All content is generic and synthetic.
 */
import type { LabelColor, ProjectModule } from '@/data/types';

export interface BlueprintCard {
  title: string;
  description?: string;
  start_day?: number;
  due_day?: number;
  start_month?: number;
  end_month?: number;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  labels?: string[];
  checklist?: string[];
  wp?: string;
  months?: { planned?: number[]; due?: number[] };
  recurrence?: { freq: 'daily' | 'weekly' | 'monthly' | 'yearly'; interval: number; byweekday?: number[] };
  children?: BlueprintCard[];
}

export interface Blueprint {
  version: 1;
  modules: ProjectModule[];
  duration_months?: number;
  labels?: { name: string; color: LabelColor }[];
  boards: { name: string; lists: { name: string; cards?: BlueprintCard[] }[] }[];
  work_packages?: { code: string; name: string; description?: string; start_month: number; end_month: number }[];
  milestones?: {
    code: string;
    title: string;
    kind: 'milestone' | 'deliverable' | 'report' | 'event' | 'control';
    month: number;
    wp?: string;
    verification?: string;
  }[];
  risks?: { title: string; probability: number; impact: number; mitigation: string; category?: string }[];
  kpis?: { code: string; name: string; unit: string; target?: string; baseline?: string; wp?: string }[];
  cost_categories?: { code: string; name: string; kind: string; indirect_base: boolean }[];
  reporting_period_months?: number;
  funding?: Record<string, unknown>;
}

export interface TemplateMeta {
  id: string;
  name: string;
  category: string;
  description: string;
  blueprint: Blueprint;
}

export const BOARD_TEMPLATES = [
  { id: 'kanban', name: 'Simple', lists: ['To do', 'Doing', 'Done'] },
  { id: 'review', name: 'With review', lists: ['Backlog', 'To do', 'In progress', 'Review', 'Done'] },
  { id: 'personal', name: 'Personal week', lists: ['Inbox', 'Today', 'This week', 'Later', 'Done'] },
  { id: 'pipeline', name: 'Pipeline', lists: ['Ideas', 'Qualified', 'In discussion', 'Agreed', 'Closed'] },
  { id: 'empty', name: 'Empty', lists: [] as string[] },
];

const STD_LABELS: { name: string; color: LabelColor }[] = [
  { name: 'Priority', color: 'terracotta' },
  { name: 'Waiting', color: 'ochre' },
  { name: 'Idea', color: 'indigo' },
  { name: 'Admin', color: 'grey' },
];

const CORE: ProjectModule[] = ['board', 'table', 'calendar', 'timeline', 'files', 'activity'];

export const PROJECT_TEMPLATES: TemplateMeta[] = [
  {
    id: 'blank',
    name: 'Blank project',
    category: 'General',
    description: 'One board with To do, Doing and Done. Add modules later if the project grows.',
    blueprint: { version: 1, modules: CORE, boards: [{ name: 'Tasks', lists: [{ name: 'To do' }, { name: 'Doing' }, { name: 'Done' }] }] },
  },
  {
    id: 'personal',
    name: 'Personal task management',
    category: 'Personal',
    description: 'A calm weekly system: capture, plan today, review weekly.',
    blueprint: {
      version: 1,
      modules: ['board', 'table', 'calendar', 'dashboard'],
      labels: [
        { name: 'Deep work', color: 'teal' },
        { name: 'Quick', color: 'moss' },
        { name: 'Waiting', color: 'ochre' },
      ],
      boards: [
        {
          name: 'My week',
          lists: [
            { name: 'Inbox', cards: [{ title: 'Capture anything here, sort it later' }] },
            { name: 'Today' },
            { name: 'This week' },
            { name: 'Later' },
            {
              name: 'Routines',
              cards: [
                {
                  title: 'Weekly review',
                  due_day: 4,
                  recurrence: { freq: 'weekly', interval: 1 },
                  checklist: ['Empty the inbox', 'Check upcoming deadlines', 'Choose three priorities for next week'],
                },
              ],
            },
            { name: 'Done' },
          ],
        },
      ],
    },
  },
  {
    id: 'team',
    name: 'Small-team collaboration',
    category: 'Teams',
    description: 'Shared board with review step, weekly meeting routine and a decision log.',
    blueprint: {
      version: 1,
      modules: [...CORE, 'dashboard', 'meetings'],
      labels: STD_LABELS,
      boards: [
        {
          name: 'Team board',
          lists: [
            { name: 'Backlog' },
            { name: 'This week' },
            { name: 'In progress' },
            { name: 'Review' },
            { name: 'Done' },
          ],
        },
      ],
    },
  },
  {
    id: 'research',
    name: 'Research project',
    category: 'Research',
    description: 'Literature, data collection, analysis and writing, with milestones for submissions.',
    blueprint: {
      version: 1,
      modules: [...CORE, 'dashboard', 'milestones', 'risks', 'meetings'],
      duration_months: 12,
      labels: [
        { name: 'Literature', color: 'indigo' },
        { name: 'Data', color: 'teal' },
        { name: 'Analysis', color: 'moss' },
        { name: 'Writing', color: 'terracotta' },
      ],
      boards: [
        {
          name: 'Research plan',
          lists: [
            {
              name: 'Planned',
              cards: [
                { title: 'Literature review', start_month: 1, end_month: 2, labels: ['Literature'] },
                { title: 'Ethics approval', start_month: 1, end_month: 3, checklist: ['Draft application', 'Submit', 'Respond to comments'] },
                { title: 'Data collection', start_month: 3, end_month: 6, labels: ['Data'] },
                { title: 'Analysis', start_month: 6, end_month: 9, labels: ['Analysis'] },
                { title: 'Manuscript draft', start_month: 9, end_month: 11, labels: ['Writing'] },
              ],
            },
            { name: 'In progress' },
            { name: 'Under review' },
            { name: 'Done' },
          ],
        },
      ],
      milestones: [
        { code: 'M1', title: 'Protocol approved', kind: 'milestone', month: 3, verification: 'Approval letter' },
        { code: 'M2', title: 'Data collection complete', kind: 'milestone', month: 6, verification: 'Dataset archived' },
        { code: 'D1', title: 'Manuscript submitted', kind: 'deliverable', month: 12, verification: 'Submission receipt' },
      ],
      risks: [
        { title: 'Recruitment slower than planned', probability: 3, impact: 4, mitigation: 'Add a second recruitment channel by month 4' },
        { title: 'Key person unavailable', probability: 2, impact: 4, mitigation: 'Document procedures; cross-train a colleague' },
      ],
    },
  },
  {
    id: 'software',
    name: 'Software development',
    category: 'Technology',
    description: 'Backlog, sprint board, review and release checklist.',
    blueprint: {
      version: 1,
      modules: [...CORE, 'dashboard', 'automations'],
      labels: [
        { name: 'Bug', color: 'terracotta' },
        { name: 'Feature', color: 'teal' },
        { name: 'Chore', color: 'grey' },
        { name: 'Docs', color: 'indigo' },
      ],
      boards: [
        {
          name: 'Development',
          lists: [
            { name: 'Backlog' },
            { name: 'Ready' },
            { name: 'In progress' },
            { name: 'Code review' },
            { name: 'Testing' },
            {
              name: 'Done',
              cards: [
                {
                  title: 'Release checklist',
                  checklist: ['Changelog updated', 'Tests passing', 'Version tagged', 'Deployment verified'],
                },
              ],
            },
          ],
        },
      ],
    },
  },
  {
    id: 'consultancy',
    name: 'Consultancy engagement',
    category: 'Services',
    description: 'From proposal to final report, with client meetings, deliverables and time tracking.',
    blueprint: {
      version: 1,
      modules: [...CORE, 'milestones', 'meetings', 'budget', 'dashboard'],
      duration_months: 6,
      labels: [
        { name: 'Client', color: 'indigo' },
        { name: 'Internal', color: 'grey' },
        { name: 'Billable', color: 'moss' },
      ],
      boards: [
        {
          name: 'Engagement',
          lists: [
            { name: 'Scoping', cards: [{ title: 'Kick-off meeting with client', due_day: 7 }, { title: 'Agree scope and success criteria', due_day: 14 }] },
            { name: 'Fieldwork' },
            { name: 'Analysis' },
            { name: 'Reporting', cards: [{ title: 'Draft report', start_month: 5, end_month: 5 }, { title: 'Final presentation', start_month: 6, end_month: 6 }] },
            { name: 'Done' },
          ],
        },
      ],
      milestones: [
        { code: 'D1', title: 'Inception report', kind: 'deliverable', month: 1 },
        { code: 'D2', title: 'Interim findings', kind: 'deliverable', month: 3 },
        { code: 'D3', title: 'Final report', kind: 'deliverable', month: 6 },
      ],
      cost_categories: [
        { code: 'PER', name: 'Personnel', kind: 'personnel', indirect_base: true },
        { code: 'TRV', name: 'Travel', kind: 'travel', indirect_base: true },
        { code: 'OTH', name: 'Other goods and services', kind: 'other', indirect_base: true },
      ],
    },
  },
  {
    id: 'sustainability',
    name: 'Sustainability initiative',
    category: 'Sustainability',
    description: 'Baseline, targets, actions and KPI tracking for an environmental or social programme.',
    blueprint: {
      version: 1,
      modules: [...CORE, 'kpis', 'milestones', 'risks', 'map', 'dashboard'],
      duration_months: 12,
      labels: [
        { name: 'Energy', color: 'ochre' },
        { name: 'Water', color: 'teal' },
        { name: 'Biodiversity', color: 'moss' },
        { name: 'Community', color: 'mauve' },
      ],
      boards: [
        {
          name: 'Actions',
          lists: [
            { name: 'Ideas' },
            { name: 'Planned', cards: [{ title: 'Establish baseline measurements', start_month: 1, end_month: 2 }] },
            { name: 'Implementing' },
            { name: 'Monitoring' },
            { name: 'Done' },
          ],
        },
      ],
      kpis: [
        { code: 'K1', name: 'Energy use', unit: 'MWh / year' },
        { code: 'K2', name: 'Share of renewable energy', unit: '%' },
        { code: 'K3', name: 'Participants engaged', unit: 'people' },
      ],
      milestones: [
        { code: 'M1', title: 'Baseline report', kind: 'report', month: 2 },
        { code: 'M2', title: 'Mid-term review', kind: 'control', month: 6 },
        { code: 'M3', title: 'Annual impact report', kind: 'report', month: 12 },
      ],
    },
  },
  {
    id: 'eu',
    name: 'EU-funded project',
    category: 'Funded projects',
    description: 'Work packages, M1–M24 plan, deliverables, reporting periods, budget and KPIs.',
    blueprint: {
      version: 1,
      modules: [...CORE, 'dashboard', 'workpackages', 'milestones', 'budget', 'kpis', 'risks', 'meetings', 'automations'],
      duration_months: 24,
      reporting_period_months: 6,
      funding: { indirect_rate: '0.25', funding_rate: '1', rounding: 'partner', rounding_decimals: 0, rounding_mode: 'half_up', hours_per_pm: 140 },
      labels: STD_LABELS,
      work_packages: [
        { code: 'WP1', name: 'Project management', start_month: 1, end_month: 24 },
        { code: 'WP2', name: 'Core activities', start_month: 2, end_month: 22 },
        { code: 'WP3', name: 'Dissemination and exploitation', start_month: 1, end_month: 24 },
        { code: 'WP4', name: 'Quality assurance', start_month: 1, end_month: 24 },
      ],
      boards: [
        {
          name: 'Work plan',
          lists: [
            {
              name: 'WP1 Project management',
              cards: [
                { title: 'Kick-off meeting', wp: 'WP1', months: { due: [1] } },
                { title: 'Monthly coordination meetings', wp: 'WP1', start_month: 1, end_month: 24 },
                { title: 'Periodic reporting', wp: 'WP1', months: { due: [6, 12, 18, 24] } },
              ],
            },
            { name: 'WP2 Core activities' },
            { name: 'WP3 Dissemination and exploitation', cards: [{ title: 'Dissemination plan', wp: 'WP3', months: { due: [3] } }] },
            { name: 'WP4 Quality assurance', cards: [{ title: 'Quality plan', wp: 'WP4', months: { due: [4] } }] },
          ],
        },
      ],
      milestones: [
        { code: 'MS1', title: 'Consortium agreement signed', kind: 'milestone', month: 3, wp: 'WP1', verification: 'Signed agreement uploaded' },
        { code: 'D1.1', title: 'Project handbook', kind: 'deliverable', month: 2, wp: 'WP1' },
        { code: 'D3.1', title: 'Dissemination plan', kind: 'deliverable', month: 3, wp: 'WP3' },
        { code: 'D4.1', title: 'Quality assurance plan', kind: 'deliverable', month: 4, wp: 'WP4' },
      ],
      cost_categories: [
        { code: 'A', name: 'Personnel', kind: 'personnel', indirect_base: true },
        { code: 'B', name: 'Subcontracting', kind: 'subcontracting', indirect_base: false },
        { code: 'C1', name: 'Travel and subsistence', kind: 'travel', indirect_base: true },
        { code: 'C2', name: 'Equipment', kind: 'equipment', indirect_base: true },
        { code: 'C3', name: 'Other goods, works and services', kind: 'other', indirect_base: true },
        { code: 'D1', name: 'Financial support to third parties', kind: 'third_party', indirect_base: false },
        { code: 'D7', name: 'Internally invoiced goods and services', kind: 'internal', indirect_base: true },
      ],
      risks: [
        { title: 'Partner leaves the consortium', probability: 2, impact: 4, mitigation: 'Consortium agreement covers task reallocation' },
        { title: 'Delayed deliverables', probability: 3, impact: 3, mitigation: 'Monthly tracking; early-warning automation' },
      ],
    },
  },
  {
    id: 'consortium',
    name: 'Multi-partner consortium',
    category: 'Funded projects',
    description: 'Governance, partner reporting cycles, evidence collection and KPI health checks.',
    blueprint: {
      version: 1,
      modules: [...CORE, 'dashboard', 'workpackages', 'milestones', 'budget', 'kpis', 'risks', 'meetings', 'automations'],
      duration_months: 36,
      reporting_period_months: 12,
      funding: { indirect_rate: '0.25', funding_rate: '1', rounding: 'partner', rounding_decimals: 0, rounding_mode: 'half_up', hours_per_pm: 140 },
      labels: [
        { name: 'Governance', color: 'indigo' },
        { name: 'Reporting', color: 'ochre' },
        { name: 'Evidence', color: 'moss' },
        { name: 'At risk', color: 'terracotta' },
      ],
      work_packages: [
        { code: 'WP1', name: 'Coordination and governance', start_month: 1, end_month: 36 },
        { code: 'WP2', name: 'Joint activities', start_month: 1, end_month: 36 },
        { code: 'WP3', name: 'Impact and sustainability', start_month: 6, end_month: 36 },
      ],
      boards: [
        {
          name: 'Coordination',
          lists: [
            { name: 'Upcoming' },
            {
              name: 'Recurring',
              cards: [
                { title: 'Monthly consortium meeting', wp: 'WP1', recurrence: { freq: 'monthly', interval: 1 }, due_day: 30 },
                { title: 'Quarterly KPI and evidence health check', wp: 'WP1', recurrence: { freq: 'monthly', interval: 3 }, due_day: 90 },
              ],
            },
            { name: 'In progress' },
            { name: 'Awaiting partners' },
            { name: 'Done' },
          ],
        },
      ],
      milestones: [
        { code: 'MS1', title: 'Governance bodies constituted', kind: 'milestone', month: 2, wp: 'WP1' },
        { code: 'R1', title: 'Annual report 1', kind: 'report', month: 12, wp: 'WP1' },
        { code: 'R2', title: 'Annual report 2', kind: 'report', month: 24, wp: 'WP1' },
        { code: 'R3', title: 'Final report', kind: 'report', month: 36, wp: 'WP1' },
      ],
      cost_categories: [
        { code: 'A', name: 'Personnel', kind: 'personnel', indirect_base: true },
        { code: 'B', name: 'Subcontracting', kind: 'subcontracting', indirect_base: false },
        { code: 'C1', name: 'Travel and subsistence', kind: 'travel', indirect_base: true },
        { code: 'C2', name: 'Equipment', kind: 'equipment', indirect_base: true },
        { code: 'C3', name: 'Other goods, works and services', kind: 'other', indirect_base: true },
        { code: 'D1', name: 'Financial support to third parties', kind: 'third_party', indirect_base: false },
        { code: 'D7', name: 'Internally invoiced goods and services', kind: 'internal', indirect_base: true },
      ],
      kpis: [
        { code: 'KPI1', name: 'Participants trained', unit: 'people', wp: 'WP2' },
        { code: 'KPI2', name: 'Joint outputs published', unit: 'outputs', wp: 'WP3' },
      ],
    },
  },
  {
    id: 'event',
    name: 'Event organisation',
    category: 'Events',
    description: 'Venue, speakers, registration, logistics and follow-up, counted back from the event date.',
    blueprint: {
      version: 1,
      modules: [...CORE, 'milestones', 'budget', 'map'],
      duration_months: 4,
      labels: [
        { name: 'Venue', color: 'ochre' },
        { name: 'Speakers', color: 'indigo' },
        { name: 'Comms', color: 'mauve' },
        { name: 'Logistics', color: 'moss' },
      ],
      boards: [
        {
          name: 'Event plan',
          lists: [
            {
              name: 'To do',
              cards: [
                { title: 'Book the venue', due_day: 14, labels: ['Venue'] },
                { title: 'Confirm speakers', due_day: 30, labels: ['Speakers'] },
                { title: 'Open registration', due_day: 45, labels: ['Comms'] },
                { title: 'Catering and accessibility arrangements', due_day: 80, labels: ['Logistics'], checklist: ['Dietary needs collected', 'Step-free access confirmed', 'Quiet room arranged'] },
                { title: 'Send post-event survey', due_day: 110, labels: ['Comms'] },
              ],
            },
            { name: 'In progress' },
            { name: 'Confirmed' },
            { name: 'Done' },
          ],
        },
      ],
      milestones: [
        { code: 'E1', title: 'Registration opens', kind: 'event', month: 2 },
        { code: 'E2', title: 'Event day', kind: 'event', month: 4 },
      ],
    },
  },
];
