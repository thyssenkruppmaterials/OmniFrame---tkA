---
tags: [type/component, status/active, domain/frontend]
created: 2026-04-10
---
# Standard Work

## Purpose
Standard operating procedure (SOP) management system for warehouse operations. Enables creation of checklist templates with a drag-and-drop builder, assignment to workers, scheduling of recurring tasks, and tracking of completion via a dashboard with progress stats and submission history.

## Key Components

### Template Builder
- **TemplateBuilder** (`components/template-builder/template-builder.tsx`) — Main builder container.
- **Canvas** (`components/template-builder/canvas.tsx`) — Drag-and-drop canvas for item arrangement.
- **ItemPalette** (`components/template-builder/item-palette.tsx`) — Draggable item types: Checkbox, Text Input, Number, Dropdown, Multi-Select, Date, Time.
- **SortableItem** (`components/template-builder/sortable-item.tsx`) — Individual sortable item with drag handle.
- **PropertiesPanel** (`components/template-builder/properties-panel.tsx`) — Right-side panel for editing item properties.
- **SectionEditor** (`components/template-builder/section-editor.tsx`) — Section management (add, rename, collapse, reorder).

### Dashboard
- **StandardWorkDashboard** — Main dashboard container.
- **TodayTasks** — Tasks due today with completion status.
- **UpcomingTasks** — Future scheduled tasks.
- **ProgressStats** — Aggregate progress statistics.
- **SubmissionHistory** — Past submission records.

### Management
- **StandardWorkChecklist** — Interactive checklist for completing standard work items.
- **StandardWorkSettings** — Configuration settings.
- **SchedulingPanel** — Recurring task scheduling interface.
- **AssignmentPanel** — Worker assignment management.

## Hooks
- `useStandardWork` (from `@/hooks/use-standard-work`) — Core hook providing `StandardWorkItem` type and CRUD operations.

## State Management
- `BuilderState` with sections, selected item tracking, drag state, and preview mode
- `DragItem` interface for drag-and-drop with palette-item and canvas-item types
- `Section` model groups `StandardWorkItem[]` with collapsible state
- `ITEM_TYPE_CONFIG` defines labels, descriptions, icons, and defaults per item type

## Types
- `ItemType` — checkbox, text, number, select, multi_select, date, time
- `DragItem` — Drag-and-drop item with type discriminator
- `Section` — Named group of `StandardWorkItem[]`
- `BuilderState` — Full builder state

## Routes
- Rendered within the main application standard work section

## Related
- [[Architecture]]



## Comprehensive Rebuild — April 25, 2026

A single-PR overhaul addressing ~30 findings across dashboard, runner, builder, data layer, a11y, and migrations.

### Architecture changes
- New `useStandardWorkOverview` selector at `src/features/standard-work/hooks/use-standard-work-overview.ts` reconciles `useDashboardTasks` + `useUserProgress` + `useUpcomingTasks` into one canonical "today" view, exposing `today.{total,completed,overdue,dueSoon,laterToday,completionPct}`, `progress`, `upcoming`, `isError`, and a unified `refetchAll`.
- Renamed the in-memory dashboard-tasks bucket from `upcoming` -> `laterToday` (Today list) to remove naming collision with the 7-day Upcoming Schedule.
- Standard Work KPI primitive at `dashboard/kpi-card.tsx` (animated number, hover lift, info tooltip, optional progress bar) — Team Performance pattern adapted to Standard Work.
- New attachments service at `src/lib/supabase/standard-work-attachments.service.ts` for `photo` / `signature` item uploads to `standard-work-attachments` bucket (public read, org-prefixed write).
- New runner subcomponents: `runner/photo-capture.tsx`, `runner/signature-pad.tsx`.

### Data-layer fixes
- All submission-lifecycle mutations now invalidate `standard-work-dashboard-tasks`, `standard-work-user-progress`, `standard-work-upcoming-tasks`, `standard-work-overdue-tasks`, `standard-work-scheduled-tasks` (not just submission keys). Dashboard no longer waits for the 60s `refetchInterval` after Start/Submit.
- `startNewSubmission` now sets `due_at` from the template's local due_time so `completed_on_time` / `is_overdue` triggers actually fire correctly.
- `startNewSubmission` calls `findOpenDraft` and resumes existing drafts instead of creating parallel ones; throws `DUPLICATE_SUBMISSION` only when a final submission already exists for the day.
- `reorderItems` now uses `Promise.all` (parallel) instead of N sequential PATCHes.
- `duplicateTemplate` no longer produces literal `"undefined-copy"` codes when the source has no `template_code`.
- `upsertResponse` failures surface a toast on first failure and every 5th repeat (used to silently log and lose work).

### Runner (`standard-work-checklist.tsx`)
- Implemented `photo`, `signature`, true `multi_select` (JSON-array storage), and `conditional_display` filtering.
- Functional setState in `handleResponseChange` (no more stale-merge against React state mid-edit).
- Save-on-exit flush via `visibilitychange` and `beforeunload` (browser-friendly best-effort).
- Required-only progress denominator (with a small "All items: X/Y" sublabel).
- aria-live polite region announces "Saving…" / "Saved" / "Submitted".
- Section headers converted to real `<button aria-expanded aria-controls>` disclosure pattern.
- Single-seed `useEffect` so refetched responses don't stomp local edits mid-session.

### Dashboard (`dashboard/standard-work-dashboard.tsx`)
- Four canonical KPIs: Today's progress / Attention needed / Streak / On-time rate. No more morphing 4th card.
- Streak banner removed from `progress-stats.tsx` (was duplicate of KPI strip).
- Error banner with retry instead of the silent fallback to "All caught up!" empty state.
- Filter chip is now a real focusable `Button` with `aria-label`; Refresh sets `aria-busy` and refetches all three queries (not just tasks).
- Framer-motion entrance for KPIs + AnimatePresence for the today list, honoring `prefers-reduced-motion`.
- Fixed `submissionMap` collision: keyed by `templateId::workingAreaId` so concurrent drafts in different areas resolve correctly.
- Fixed Upcoming Schedule subtitle: "Next 7 days · N tasks across M scheduled days" (no longer claims "N days" when only some days have work).

### Templates & Settings
- Status pill replaces `hasUnsavedChanges`: `Saving…` / `Saved` / `Order pending` clearly distinguish field-level autosave from structural reorder pending an explicit Save.
- `previewMode` is now wired through canvas / section-editor / sortable-item (read-only preview hides drag handles, delete buttons, and the palette/properties panels).
- Section IDs are stable UUIDs (`generateSectionId`) — no slug collisions on similarly-named sections.
- Palette now lists all nine item types (`multi_select`, `photo`, `signature` were missing).
- Builder grid stacks to single column under `lg:`.
- Scheduling panel: timezone label below due-time input, next-5-occurrences preview client-side, removed redundant panel-level toast (mutations already toast).
- Assignment panel: user search failure now surfaces a toast (was silent).

### Migration `234_standard_work_hardening.sql`
- `swr_*` policies replace org-wide responses RLS with submission-ownership scoping (+ supervisor/manager carve-out).
- `swt_manager_all` / `swi_manager_all` enforce the role check the policy names implied.
- `idx_sw_submissions_open_drafts` partial index supports `findOpenDraft` lookups.
- Storage bucket `standard-work-attachments` provisioned with org-prefixed write policies.

### Out of scope
- Mobile DnD audit, realtime subscriptions, cron-string scheduling, holiday/freeze streak rules.

## Related
- [[ADR-StandardWork-Single-Source-Of-Today]]
- [[Redesign-StandardWork-Comprehensive]]
- [[Fix-StandardWork-Cache-Staleness]]
- [[StandardWorkAndOperations - Supabase Service]]
