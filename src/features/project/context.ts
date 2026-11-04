import { useOutletContext } from 'react-router';
import type { FinanceAccess, Person, Project, ProjectModule, ProjectRole } from '@/data/types';

export interface ProjectCtx {
  project: Project;
  role: ProjectRole | null;
  finance: FinanceAccess;
  people: Person[];
  canEdit: boolean;
  canManage: boolean;
  openCard(cardId: string): void;
  has(module: ProjectModule): boolean;
}

export function useProjectCtx(): ProjectCtx {
  return useOutletContext<ProjectCtx>();
}

export const MODULES: { id: ProjectModule; label: string; description: string; advanced?: boolean }[] = [
  { id: 'board', label: 'Kanban board', description: 'Boards with lists and cards' },
  { id: 'table', label: 'Table', description: 'Spreadsheet view of every task' },
  { id: 'timeline', label: 'Timeline / Gantt', description: 'Dates, dependencies and project months' },
  { id: 'calendar', label: 'Calendar', description: 'Tasks and milestones by date' },
  { id: 'dashboard', label: 'Dashboard', description: 'Charts of progress and workload' },
  { id: 'map', label: 'Map', description: 'Tasks with a location' },
  { id: 'workpackages', label: 'Work packages', description: 'Structured plan with leads, effort and progress', advanced: true },
  { id: 'milestones', label: 'Milestones & deliverables', description: 'Due dates, evidence and approval', advanced: true },
  { id: 'budget', label: 'Budget', description: 'Budget lines, expenditure, person-months', advanced: true },
  { id: 'kpis', label: 'KPIs', description: 'Targets, measurements and evidence', advanced: true },
  { id: 'risks', label: 'Risks & issues', description: 'Risk register and issue log', advanced: true },
  { id: 'meetings', label: 'Meetings', description: 'Agendas, minutes, decisions, actions', advanced: true },
  { id: 'files', label: 'Files', description: 'Attachments and document links' },
  { id: 'activity', label: 'Activity', description: 'Audit trail of changes' },
  { id: 'automations', label: 'Automations', description: 'Rules, buttons and schedules', advanced: true },
];
