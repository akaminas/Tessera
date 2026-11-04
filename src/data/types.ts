/** Row types mirroring the PostgreSQL schema (supabase/migrations). */

export type Family = 'teal' | 'terracotta' | 'indigo' | 'ochre' | 'mauve' | 'moss';
export const FAMILIES: Family[] = ['teal', 'terracotta', 'indigo', 'ochre', 'mauve', 'moss'];
export type LabelColor = Family | 'grey';

export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'guest';
export type ProjectRole = 'manager' | 'member' | 'collaborator' | 'viewer';
export type FinanceAccess = 'none' | 'view' | 'edit';
export type CardStatus = 'open' | 'in_progress' | 'blocked' | 'done';
export type Priority = 'none' | 'low' | 'medium' | 'high' | 'urgent';

export interface Profile {
  id: string;
  email: string | null;
  display_name: string;
  avatar_color: Family;
  timezone: string;
  preferences: UserPreferences;
}

export interface UserPreferences {
  theme?: 'light' | 'dark' | 'system';
  density?: 'comfortable' | 'compact';
  motion?: 'full' | 'reduced';
  reminderDays?: number;
  emailNotifications?: boolean;
  notifyOn?: { assigned?: boolean; mentioned?: boolean; due?: boolean; watching?: boolean; comments?: boolean };
  quietHours?: { from: string; to: string } | null;
  homeLayout?: { collapsed?: string[] };
  shortcuts?: boolean;
  hoursPerPersonMonth?: number;
}

export interface Workspace {
  id: string;
  name: string;
  description: string;
  settings: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  archived_at: string | null;
  version: number;
}

export interface WorkspaceMembership {
  workspace_id: string;
  user_id: string;
  role: WorkspaceRole;
  organization_id: string | null;
}

export interface Person {
  user_id: string;
  display_name: string;
  email: string | null;
  avatar_color: Family;
  role: string;
  finance_access?: FinanceAccess;
  organization_id: string | null;
  explicit?: boolean;
  joined_at?: string;
}

export interface Organization {
  id: string;
  workspace_id: string;
  name: string;
  short_name: string;
  country: string;
  kind: 'university' | 'company' | 'research' | 'public' | 'ngo' | 'other';
  website: string;
}

export type ProjectModule =
  | 'board'
  | 'table'
  | 'calendar'
  | 'timeline'
  | 'dashboard'
  | 'map'
  | 'workpackages'
  | 'milestones'
  | 'budget'
  | 'kpis'
  | 'risks'
  | 'meetings'
  | 'files'
  | 'activity'
  | 'automations';

export interface Project {
  id: string;
  workspace_id: string;
  name: string;
  acronym: string;
  description: string;
  status: 'planning' | 'active' | 'on_hold' | 'completed' | 'cancelled';
  visibility: 'workspace' | 'private';
  start_date: string | null;
  end_date: string | null;
  color: Family;
  modules: ProjectModule[];
  objectives: string;
  outcomes: string;
  funding: ProjectFunding;
  currency: string;
  is_template: boolean;
  template_category: string | null;
  personal_owner: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  deleted_at: string | null;
  version: number;
}

export interface ProjectFunding {
  programme?: string;
  call?: string;
  grant_number?: string;
  funder?: string;
  funding_rate?: string;
  indirect_rate?: string;
  rounding?: 'none' | 'line' | 'category' | 'partner';
  rounding_decimals?: number;
  rounding_mode?: 'half_up' | 'half_even' | 'up' | 'down';
  hours_per_pm?: number;
  financial_year_start_month?: number;
}

export interface Board {
  id: string;
  project_id: string;
  workspace_id: string;
  name: string;
  description: string;
  background: string;
  position: string;
  settings: { cardAging?: boolean; showCompleted?: boolean; defaultView?: string };
  is_template: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  deleted_at: string | null;
  version: number;
}

export interface List {
  id: string;
  board_id: string;
  project_id: string;
  name: string;
  position: string;
  wip_limit: number | null;
  color: string | null;
  archived_at: string | null;
  version: number;
}

export interface Label {
  id: string;
  board_id: string;
  project_id: string;
  name: string;
  color: LabelColor;
}

export interface MonthSchedule {
  /** project-relative months (1-based) */
  planned?: number[];
  due?: number[];
  done?: number[];
}

export interface Card {
  id: string;
  board_id: string;
  list_id: string;
  project_id: string;
  parent_id: string | null;
  title: string;
  description: string;
  position: string;
  status: CardStatus;
  priority: Priority;
  start_date: string | null;
  due_date: string | null;
  due_time: string | null;
  completed_at: string | null;
  cover_color: string | null;
  lat: number | null;
  lng: number | null;
  location_label: string | null;
  estimate_minutes: number | null;
  responsible_text: string;
  schedule: MonthSchedule | null;
  recurrence: Recurrence | null;
  work_package_id: string | null;
  milestone_id: string | null;
  is_template: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  deleted_at: string | null;
  version: number;
}

export interface Recurrence {
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;
  byweekday?: number[]; // 0 = Monday … 6 = Sunday
  until?: string | null;
  /** create the next occurrence when this one is completed */
  mode?: 'on_complete' | 'schedule';
}

/** A card with the relations the board needs. */
export interface CardWithRelations extends Card {
  card_assignees: { user_id: string }[];
  card_labels: { label_id: string }[];
  comments?: { count: number }[];
  checklist_items?: { done: boolean }[];
  attachments?: { count: number }[];
}

export interface Comment {
  id: string;
  card_id: string;
  project_id: string;
  author_id: string | null;
  body: string;
  mentions: string[];
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
}

export interface ActivityEntry {
  id: number;
  workspace_id: string | null;
  project_id: string | null;
  board_id: string | null;
  card_id: string | null;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  summary: string;
  data: Record<string, unknown>;
  created_at: string;
}

export interface Invitation {
  id: string;
  workspace_id: string;
  project_id: string | null;
  email: string;
  role: 'admin' | 'member' | 'guest';
  project_role: ProjectRole | null;
  finance_access: FinanceAccess;
  token: string;
  invited_by: string | null;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
}

export interface MyInvitation {
  id: string;
  token: string;
  workspace_id: string;
  workspace_name: string;
  project_id: string | null;
  project_name: string | null;
  role: string;
  project_role: string | null;
  invited_by_name: string | null;
  created_at: string;
  expires_at: string;
}
