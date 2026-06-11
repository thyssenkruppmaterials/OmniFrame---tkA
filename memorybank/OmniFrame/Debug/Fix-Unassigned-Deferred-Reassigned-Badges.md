---
tags: [type/debug, status/active, domain/frontend]
created: 2026-04-19
---
# Fix: Unassigned rows showing Deferred + Reassigned badges

## Purpose / Context
In the Manual Counts dashboard, unassigned counts (`assigned_to === null`, "Unassigned" in the Assigned To column) were rendering both the **Deferred** sub-badge under Status and the **Reassigned** sub-badge under Counter. Misleading because:

- **Deferred** is a per-user defer marker — meaningless when no one is currently assigned.
- **Reassigned** is contextual history for the *current* assignee. After the row returns to the open pool, showing it just adds noise.

## Fix
`src/components/manual-counts-search.tsx` body-row renders:
- Gated the **Deferred** badge behind `!!item.assigned_to &&`.
- Gated the **Reassigned** badge behind `!!item.assigned_to &&`.
- The Deferred badge inside the Assigned To column was already correctly gated (it only renders when `item.assigned_to_user` is set).

## Verification
- `npx tsc -b --noEmit` — 0 errors.
- `npx eslint src/components/manual-counts-search.tsx` — 0 errors (only pre-existing `any` warnings unrelated to this change).

## Related
- [[Part-Number-Verification-Workflow-Step]]
- [[Wire-Cycle-Count-Workflow-To-RF-Counter]]


## 2026-04-19 follow-up — Rename display label "Deferred" → "Skipped"
Two sub-badges in `manual-counts-search.tsx` (the Status column and the Assigned To column) now read **Skipped** instead of **Deferred**. The underlying DB / service names are kept (`active_defer`, `cycle_count_operator_deferred_counts`, `deferred_pending`) to avoid churn in Rust / migrations / service code — the change is UI-only.
