# Database

All migrations live in `supabase/migrations` and are plain SQL. `npm run test:db` applies them in order to a fresh PostgreSQL server with a small Supabase shim (`tests/db/supabase-shim.sql`), then runs the RLS and behaviour tests.

## Migrations

| File | Contents |
|---|---|
| `…0100_core.sql` | Profiles, workspaces, organisations, membership, projects, boards, lists, labels, cards, assignees, watchers, comments, activity log, change feed, invitations, permission helpers, RLS. |
| `…0200_productivity.sql` | Checklists (nested items), custom fields, dependencies (cycle-checked), card links, attachments and the private storage bucket, time entries, notifications, saved views, bookmarks, recurrence, search, My Work, personal inbox, copy and duplicate helpers. |
| `…0300_project_controls.sql` | Partners, reporting periods, work packages (+ members, dependencies), milestones and deliverables (+ dependencies, approval, history), evidence, risks and issues, meetings (decisions, action items → tasks), progress and summary functions, workload, saved templates. |
| `…0400_finance_kpis.sql` | Cost categories, partner finance (person-month rates, overrides), budget lines, expenditures (committed / actual), finance audit, effort allocations and reports, KPIs and measurements. |
| `…0500_blueprints_imports.sql` | `apply_blueprint`, `project_to_blueprint`, `import_plan`, `import_budget`. |
| `…0600_automation.sql` | Automation rules, event queue, runs, integrations and webhook deliveries, worker, scheduler, buttons, calendar feed. |

## Permission model

**Workspace roles**
- `owner` / `admin`: manage members and every project.
- `member`: sees and works in workspace-visible projects.
- `guest`: only projects they were explicitly added to.

**Project roles** (`project_role(project)`)
- `manager`: settings, members, approvals, verification, permanent deletes.
- `member` and `collaborator`: create and edit work.
- `viewer`: read-only.

Personal inbox projects are visible only to their owner, even to workspace admins.

**Finance access** (`finance_access(project)`)
- `edit` for managers.
- Otherwise the member's explicit `finance_access`: `none`, `view` or `edit`.
- All monetary tables use the finance-only RLS policies.
- Their audit trail goes to `finance_audit`, which only finance readers can see. Amounts never enter the general activity log.

**Integrity**
- `BEFORE` triggers derive `project_id` / `board_id` / `workspace_id` from the parent row.
- Cross-project references are rejected.
- A client therefore cannot place rows into a project it cannot write to, even by forging ids.

## Main tables (abbreviated)

```
workspaces ─┬─ workspace_members (role, organisation)
            ├─ organizations ── project_partners ── partner_finance (rates; finance RLS)
            └─ projects ─┬─ project_members (role, finance_access)
                         ├─ boards ── lists ── cards ─┬─ card_assignees / card_labels / card_watchers
                         │                            ├─ checklists ── checklist_items (nested)
                         │                            ├─ comments, attachments, card_field_values
                         │                            └─ card_dependencies, card_links, time_entries
                         ├─ work_packages ── wp_members, wp_dependencies
                         ├─ milestones ── milestone_dependencies, evidence_items
                         ├─ risks, meetings ── meeting_decisions, meeting_actions
                         ├─ reporting_periods
                         ├─ cost_categories, budget_lines, expenditures (finance RLS)
                         ├─ effort_allocations, effort_reports, kpis ── kpi_measurements
                         └─ automation_rules ── automation_runs; integrations ── webhook_deliveries
```

## Key functions

| Function | Purpose |
|---|---|
| `create_workspace`, `create_project`, `accept_invitation`, `my_invitations` | Onboarding and membership. |
| `project_people`, `workspace_people` | Effective members with profile data. |
| `search_all`, `my_work`, `ensure_personal_inbox` | Productivity. |
| `copy_card`, `duplicate_board`, `move_list_to_board` | Recoverable copy and move operations (RLS applies). |
| `work_package_progress`, `project_summary`, `workload`, `planned_effort`, `kpi_status` | Computed from live rows (security invoker). |
| `generate_reporting_periods`, `action_to_card` | Project controls. |
| `apply_blueprint`, `project_to_blueprint`, `import_plan`, `import_budget` | Templates and workbook imports (atomic). |
| `run_scheduler`, `process_automation_queue`, `run_time_rules`, `deliver_webhooks`, `run_button`, `run_rule_now`, `kick_automations` | Automation. |
| `calendar_feed(token)` | iCalendar data for the Edge Function (service role only). |
| `create_integration_token(name)` | Creates a personal access key for outside tools and returns it once; only its SHA-256 hash is stored in `integration_tokens`. |
| `obsidian_context`, `obsidian_create_project`, `obsidian_send_tasks`, `obsidian_card_status` | Called by the Obsidian plugin with an access key. Each resolves the key to its owner and runs as that person, so the usual permission checks and activity records apply. Callable without a session; the key is the credential. |

## Backup and restore
- **Managed Supabase:**
  - Daily backups are included.
  - Point-in-time recovery is available on paid plans.
  - For your own copies, run `supabase db dump --linked -f backup.sql` (schema) and `supabase db dump --linked --data-only -f data.sql`.
- **Restore:** run `psql "$DATABASE_URL" -f backup.sql -f data.sql` into an empty project. Then download storage objects with the Supabase CLI (`supabase storage cp -r ss:///attachments ./attachments-backup`) and upload them again.
- **Per project:** Project settings → *Export everything as JSON* produces a portable copy of all records the user can read. Files are referenced by storage path.
- **Recoverable deletion inside the app:**
  - Tasks, boards, lists and projects are archived or trashed first, and can be restored.
  - Permanent deletion requires a manager and an explicit confirmation.
