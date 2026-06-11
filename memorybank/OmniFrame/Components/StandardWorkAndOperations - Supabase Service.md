---
tags: [type/component, status/active, domain/backend]
created: 2026-04-10
---
# Standard Work, Activity Config & Operations Services

## Purpose
A group of services covering standard work checklists, dynamic activity source configuration for timeline tracking, overtime auto-pick logic, and queue analytics monitoring.

## Services

### StandardWorkService (`standard-work.service.ts`)
**Comprehensive standard work checklist management** — templates, items, submissions, responses, scheduling, streaks, and assignments.

Singleton class organized into sections:

#### Templates
- `getTemplates(orgId, options?)` → with joined working_area and items_count
- `getTemplate(templateId)` / `createTemplate(template)` / `updateTemplate(id, updates)` / `deleteTemplate(id)` (soft-delete to archived)
- `duplicateTemplate(templateId, newName)` → copies template + all items
- Frequencies: `daily`, `weekly`, `monthly`, `shift_start`, `shift_end`, `as_needed`
- Scheduling: `schedule_config` (days_of_week, days_of_month), `due_time`, `grace_period_minutes`, `notification_settings`

#### Items (Checklist Fields)
- `getTemplateItems(templateId)` / `getItem(itemId)` / `createItem(item)` / `updateItem(id, updates)` / `deleteItem(id)` (soft-delete)
- `reorderItems(templateId, itemOrders)` / `bulkCreateItems(items)`
- Item types: `checkbox`, `text`, `number`, `select`, `multi_select`, `date`, `time`, `photo`, `signature`
- Conditional display support: `depends_on`, `condition`, `value`

#### Submissions & Responses
- `getSubmissions(orgId, options?)` → paginated with template/area/submitter joins, date range filtering
- `getSubmission(submissionId)` / `createSubmission(sub)` / `updateSubmission(id, updates)` / `submitChecklist(id)` / `deleteSubmission(id)`
- `getSubmissionResponses(submissionId)` / `upsertResponse(response)` / `bulkUpsertResponses(responses)` — upsert on `submission_id,item_id` conflict
- `startNewSubmission(orgId, templateId, userId, areaId?, submitterInfo?)` → creates draft + initial empty responses for all items
- Status lifecycle: `draft` → `in_progress` → `submitted` → `reviewed` → `approved` / `rejected`

#### Scheduling & Progress
- `getScheduledTasks(orgId, userId, date?, areaId?)` → calls RPC `get_scheduled_tasks_for_date`
- `getUpcomingTasks(orgId, userId, days?, areaId?)` → parallel fetch for N days
- `getUserStats(orgId, userId, days?)` → calls RPC `get_user_standard_work_stats`
- `getUserStreak(orgId, userId, templateId?)` → from `standard_work_user_streaks` table
- `getOverdueTasks(orgId, userId)` / `getDashboardTasks(orgId, userId, areaId?)` → categorized by overdue/dueSoon/upcoming/completed

#### Statistics
- `getStatistics(orgId, startDate?, endDate?)` → calls RPC `get_standard_work_statistics` — totals, area breakdown, user completion
- `getUserDailyCompletion(orgId, days?)` → calls RPC `get_user_daily_completion`

#### Template Assignments
- `getTemplateAssignments(templateId)` → with joined user/position/area
- `createAssignment(assignment)` / `deleteAssignment(id)` / `updateAssignment(id, updates)` / `getAssignmentCount(templateId)`
- Assignment types: `required`, `optional`, `recommended`

---

### ActivitySourceConfigService (`activity-source-config.service.ts`)
**Dynamic activity source configuration** — enables admins to add new activity types to the labor management timeline without code changes.

Singleton class:
- `getActivitySourceConfigs(orgId)` → all configs (global + org-specific) from `activity_source_config`
- `getActivitySourceConfig(id)` / `createActivitySourceConfig(input)` / `updateActivitySourceConfig(id, updates)` / `deleteActivitySourceConfig(id)`
- `toggleActivitySourceActive(id, isActive)`
- `getActivityConfigurations(orgId)` → calls RPC `get_activity_configurations` for merged source+display config
- `getAvailableTables()` → calls RPC `get_available_activity_tables` (fallback: hardcoded list)
- `getTableColumns(tableName)` → calls RPC `get_table_columns`
- `validateTableConfiguration(table, userIdCol, timestampCol, orgIdCol?)` → validates table/column existence
- `getActivityCategories()` → work, admin, quality, maintenance, training, other
- `getPresetColors()` → 16 Tailwind color options for timeline blocks

System configs are immutable; user-created configs can be modified/deleted.

---

### OvertimeAutopickService (`overtime-autopick.service.ts`)
**Automatic overtime assignment logic.**

Exported function:
- `runAutoPick(requestId)` → processes an approved overtime request:
  - `noop` if already assigned, not approved, or cannot extend further
  - `extended` if not enough signups — extends `signup_cutoff_time` by 1 hour (max: OT start time)
  - `selected` if enough signups — assigns oldest active signup as winner, updates `assigned_user_ids` and signup status

---

### QueueAnalyticsService (`queue-analytics.service.ts`)
**Queue performance monitoring** (currently mock/placeholder implementation).

Singleton class:
- `getRealTimeMetrics()` → queue depth, active workers, tasks/min, wait time, utilization, SLA compliance
- `analyzeBottlenecks()` → health score, identified bottlenecks with severity, performance trends
- `getPerformanceReport(timeframe)` → 1h/24h/7d/30d reports with worker performance
- `getWorkerPerformance()` → per-worker tasks, completion time, efficiency, error rate

## Database Tables
- `standard_work_templates` — checklist template definitions with scheduling
- `standard_work_items` — checklist item definitions (fields)
- `standard_work_submissions` — completed/in-progress checklist instances
- `standard_work_responses` — individual item responses within submissions
- `standard_work_template_assignments` — who must complete which templates
- `standard_work_user_streaks` — completion streak tracking
- `activity_source_config` — dynamic activity type definitions (source table, columns, display)
- `activity_display_config` — per-activity display overrides (timeline visibility, efficiency weight)
- `overtime_requests` — overtime request records with signup_cutoff_time, assigned_user_ids
- `overtime_signups` — user signups for overtime requests

## Database RPCs
- `get_standard_work_statistics(p_organization_id, p_start_date, p_end_date)`
- `get_user_daily_completion(p_organization_id, p_days)`
- `get_submission_with_responses(p_submission_id)`
- `get_scheduled_tasks_for_date(p_organization_id, p_user_id, p_date, p_working_area_id)`
- `get_user_standard_work_stats(p_organization_id, p_user_id, p_days)`
- `get_activity_configurations(p_organization_id)`
- `get_available_activity_tables()`
- `get_table_columns(p_table_name)`

## Related
- [[Architecture]]
- [[LaborManagement - Supabase Service]]
- [[TeamPerformance - Supabase Service]]
- [[ProductivityAndSettings - Supabase Service]]



## April 25, 2026 — Service hardening

Applied alongside the Standard Work comprehensive rebuild ([[Redesign-StandardWork-Comprehensive]]).

- `startNewSubmission` now computes `due_at` from the template's local `due_time` (browser timezone) so the `BEFORE UPDATE` trigger that sets `completed_on_time` and `is_overdue` actually has a deadline to compare against. Without it, the existing trigger treated every submission as on-time.
- `startNewSubmission` calls `findOpenDraft(orgId, templateId, submittedBy, shiftDate, areaId?)` and resumes an existing open draft instead of creating a parallel one. If a final-state submission already exists for the day, it throws a structured `DUPLICATE_SUBMISSION` error (with the existing row attached) so the runner can surface a friendly toast.
- `reorderItems` now batches updates with `Promise.all` instead of a serial loop — large templates no longer pay N round-trips when reordering.
- `duplicateTemplate` no longer produces literal `"undefined-copy"` `template_code` values when the source has no code.
- New helper service `standard-work-attachments.service.ts` uploads photo / signature blobs to the `standard-work-attachments` storage bucket (created in migration 234).
- New `findOpenDraft` method exposed on the service for the duplicate-resume flow described above.

### Storage bucket
- `standard-work-attachments` (public read, org-prefixed write) — see `supabase/migrations/234_standard_work_hardening.sql`.

### RLS hardening (migration 234)
- `swr_*` policies replace the org-wide responses RLS with submission ownership scoping (+ supervisor/manager carve-out).
- `swt_manager_all` / `swi_manager_all` enforce the role check the policy names always implied.
- New partial index `idx_sw_submissions_open_drafts (organization_id, template_id, shift_date, submitted_by) WHERE status IN ('draft','in_progress')` supports `findOpenDraft`.

## Related
- [[Standard Work - Feature Module]]
- [[Redesign-StandardWork-Comprehensive]]
- [[ADR-StandardWork-Single-Source-Of-Today]]
- [[Fix-StandardWork-Cache-Staleness]]
