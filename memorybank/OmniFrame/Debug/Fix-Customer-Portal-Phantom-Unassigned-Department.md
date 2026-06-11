---
tags: [type/debug, status/active, domain/frontend]
created: 2026-05-08
---
# Fix: Phantom "Unassigned" Department in Customer Portal Charts

## Purpose / Context

User reported that the **Avg Open Days by Department** bar chart on the
Customer Portal → Customer Metrics tab was showing an `Unassigned`
department bar even though they believed every ticket in their
Smartsheet had an ILC Department assigned.

The screenshot showed `Based on 4247 total tickets in the system` with
an `Unassigned` bar appearing in the top-N departments alongside
`Quality`, `Containment`, `JEST`, etc.

## Root Cause

In `src/routes/_authenticated/apps/customer-portal.tsx`, both
`AvgOpenDaysByDeptChart` and `OpenRequestsByDeptChart` used:

```ts
const dept = ticket.ilc_department || 'Unassigned'
```

This hard-codes a synthetic "Unassigned" group whenever
`ilc_department` is `undefined`, `null`, or `''`. Two things conspired:

1. **All 4,247 tickets are aggregated**, including resolved/closed
   historical rows. Legacy tickets created before the ILC Department
   field was widely populated all collapse into the synthetic bucket.
2. **Whitespace-only cells bypass `||`** — Smartsheet returns `' '` as
   a truthy string, so a stray space looks like a real department to
   the falsy-fallback check (and would NOT have been caught by `||`).

There's no row in Smartsheet literally named `Unassigned` — the label
is entirely a frontend-side rollup artifact. The user's mental model
("my active tickets all have a department") is correct; the chart was
just silently surfacing legacy gaps.

## Fix

Replace the falsy-fallback with a `.trim()` check that **excludes**
tickets without a real department instead of bucketing them. If a
ticket ever genuinely has the literal text `Unassigned` in Smartsheet,
that will now appear naturally as a real department.

Applied to:

- `AvgOpenDaysByDeptChart` (the bar chart that triggered the report)
- `OpenRequestsByDeptChart` — both the unique-departments dropdown
  list AND the `all` rollup pie chart
- The status breakdown for a selected department now uses `'Blank'`
  as the fallback label (was misnamed `'Unassigned'`) since it's
  actually about ticket *status*, not department

The third dept chart (`RequestsByTypeChart` for Requestor Dept) uses
`requestor_department || 'Unspecified'` and was NOT touched — user
didn't report an issue there and "Unspecified" is arguably a real
requestor-side classification (external customers may genuinely not
have a known department).

## Verification

- `ReadLints` clean on the modified file
- Manual check: open Customer Portal → Customer Metrics tab; the
  `Unassigned` bar should be gone unless Smartsheet literally has a
  `Unassigned` value typed into ILC Department

If the user wants to confirm there ARE legacy blank rows behind the
old behavior, run a Smartsheet filter on the ticket sheet
(`2987059899748228`) for `ILC Department is blank`. The count of
rows that come back will match what was being bucketed as
`Unassigned` before this fix.

## Related
- [[Components/Customer Portal - Feature Module]]
