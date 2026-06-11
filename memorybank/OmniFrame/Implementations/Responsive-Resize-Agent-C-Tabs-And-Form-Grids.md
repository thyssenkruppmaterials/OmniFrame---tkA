---
tags: [type/implementation, status/active, domain/frontend]
created: 2026-05-16
---
# Responsive Resize — Agent C (Tabs and Form Grids)

## Purpose / Context
Phase 0 of the Frontend Responsive Resize Plan introduced primitives `StatTile`, `KpiGrid`, `ResponsiveDialog` in `src/components/ui/`. Agent C is responsible for converting bare `TabsList grid-cols-N` and `grid grid-cols-N` (in form dialogs) classes without responsive variants into properly responsive grids so that at narrow viewports (360–768px) tabs no longer crush and dialog form rows stack to 1–2 cols instead of remaining 4 narrow columns.

## Details

### Files changed (9 in declared scope)

| File | Line | Before → After |
|---|---|---|
| `src/features/admin/work-queue/index.tsx` | 54 | `grid w-full grid-cols-5` → `grid w-full grid-cols-2 sm:grid-cols-3 md:grid-cols-5` |
| `src/features/admin/work-engine/work-engine-settings-page.tsx` | 51 | `flex gap-2 border-b` → `flex flex-wrap gap-2 border-b` |
| `src/features/shift-productivity/team-performance/components/historical-view.tsx` | 231 | `grid w-full max-w-md grid-cols-4` → `grid w-full max-w-md grid-cols-2 md:grid-cols-4` |
| `src/features/shift-productivity/settings/labor-management/components/add-area-dialog.tsx` | 175, 207, 330 | `grid grid-cols-4 gap-6` → `grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4` (×3) |
| `src/features/shift-productivity/settings/labor-management/components/add-position-dialog.tsx` | 197, 265, 477 | `grid grid-cols-4 gap-6` → `grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4` (×3) |
| `src/features/shift-productivity/settings/labor-management/components/add-position-dialog.tsx` | 498 | `col-span-3 grid grid-cols-2 gap-6` → `grid grid-cols-1 gap-6 sm:grid-cols-2 lg:col-span-3` |
| `src/features/shift-productivity/settings/labor-management/components/edit-assignment-dialog.tsx` | 293, 486 | `grid grid-cols-4 gap-6` → `grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4` (×2) |
| `src/features/shift-productivity/settings/labor-management/components/edit-assignment-dialog.tsx` | 380 | `grid grid-cols-4 gap-4` → `grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4` |
| `src/features/user-management/components/create-user-dialog.tsx` | 140, 169, 202, 277 | `grid grid-cols-2 gap-4` → `grid grid-cols-1 gap-4 md:grid-cols-2` (×4) |
| `src/features/user-management/components/edit-user-dialog.tsx` | 183, 212, 245 | `grid grid-cols-2 gap-4` → `grid grid-cols-1 gap-4 md:grid-cols-2` (×3) |

`src/routes/_authenticated/apps/smartsheet-integrations.tsx:442` was already responsive (`grid grid-cols-2 gap-4 text-sm md:grid-cols-4`) — no change needed.

### Responsive transformation conventions used

- **5-tab TabsList** → `grid-cols-2 sm:grid-cols-3 md:grid-cols-5` (2 cols at 360px, 3 at sm/640, full 5 at md/768+)
- **4-tab TabsList** → `grid-cols-2 md:grid-cols-4` (2 cols below md, full 4 at md+)
- **Ad-hoc flex tab row** → add `flex-wrap` (wraps to new row instead of overflowing)
- **Wide dialog form `grid-cols-4`** → `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4` (1 col on phones, 2 cols on small tablets, full 4 at lg+)
- **User-management form `grid-cols-2`** → `grid-cols-1 md:grid-cols-2` (single col on phones, 2 cols at md+)

### Self-grep results (matches NOT touched)

The declared scope said "touch only these" 9 files, so additional matches in scope folders were left for a future pass / other agents to address.

**Tab-list matches in scope folders (`src/features/admin/`, `src/features/shift-productivity/`, `src/features/user-management/`):**
- `src/features/admin/roles/components/unified-role-editor.tsx:446` — `TabsList ... grid-cols-5`
- `src/features/admin/roles/components/DynamicRoleManager.tsx:382` — `TabsList ... grid-cols-4`
- `src/features/admin/security/components/SecurityDashboard.tsx:109` — `TabsList ... grid-cols-5`
- `src/features/admin/system-settings/components/ToastNotificationSettings-Enhanced.tsx:402` — `TabsList ... grid-cols-4`
- `src/features/shift-productivity/team-performance/components/manage-overtime-dialog.tsx:840` — `TabsList ... grid-cols-4`
- `src/features/shift-productivity/team-performance/components/manage-events-dialog.tsx:869` — `TabsList ... grid-cols-5`

**Tab-list matches outside scope folders:**
- `src/components/add-counts-from-lx03-modal.tsx:536` — `TabsList ... grid-cols-4`
- `src/components/warehouse-map/diagnostics-panel.tsx:79` — `TabsList grid grid-cols-4`
- `src/features/session-management/index.tsx:149` — `TabsList ... grid-cols-5`

**Dialog form `grid grid-cols-4` matches in labor-management cluster (siblings of declared add/edit dialogs):**
- `edit-area-dialog.tsx:257, 289, 366, 585`
- `edit-position-dialog.tsx:237, 306, 520`
- `edit-standard-dialog.tsx:556, 700`
- `add-standard-dialog.tsx:575, 752`
- `assign-user-dialog.tsx:476`
- `bulk-assign-users-dialog.tsx:511, 589`
- `src/features/user-management/components/user-permissions-dialog.tsx:224`

These share the same wide-dialog (`max-w-[1400px] min-w-[1200px]`) and `grid grid-cols-4 gap-6` form-row pattern as the touched dialogs. Recommend a follow-up sweep with the same `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4` transformation.

### Intentionally left
- `src/routes/_authenticated/apps/smartsheet-integrations.tsx:442` — already responsive (`grid-cols-2 ... md:grid-cols-4`). Adding `sm:grid-cols-2` would be a redundant no-op.
- `TabButton` `min-w-0` on work-engine-settings-page — skipped because `flex-wrap` already prevents crushing (labels wrap to new row instead of shrinking). If labels are crushed in practice, follow-up can add `min-w-0` to the buttons.

### Verification
- `pnpm lint:check` — no new warnings/errors in any of the 9 changed files. Pre-existing project warnings/errors unrelated to this scope (notably `customer-portal.tsx` unused-import errors).
- `pnpm build` — green (`✓ built in 10.94s`).
- No related unit tests existed for the touched files, so no test runs were affected.

## Related
- [[Sessions/2026-05-16]]
