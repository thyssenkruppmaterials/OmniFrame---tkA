---
title: Restore all wiped admin reassignments (second pass)
date: 2026-04-22
tags: [cycle-count, zone-exclusivity, backfill, supervisor-intent, data-integrity]
status: fixed
---

# Second-pass cleanup: restore all wiped admin reassignments

After migration 231 fixed the policy going forward, three more counts from the same Angela-reassigned batch were still in limbo (wiped `assigned_to` from the earlier bulk-release that ran before the fix shipped). Whichever one Phase 2 returned first, Jai got it on his next Pull Next. That's why the same bug appeared to repeat even though the policy was corrected.

## Orphans found and restored

| Count | Reassigned by | Reassigned to | When |
|---|---|---|---|
| CC-20260326-0008 | Angela Torres | Alessandro Lopez | 2026-04-21 23:37 |
| CC-20260326-0019 | Angela Torres | Alessandro Lopez | 2026-04-21 23:41 |
| CC-20260325-0390 | Angela Torres | Alessandro Lopez | 2026-04-21 23:43 |
| CC-20260413-0073 | Angela Torres | Alessandro Lopez | 2026-04-22 00:29 |
| CC-20260325-0092 | Angela Torres | David Simmons   | 2026-04-17 02:14 |
| CC-20260325-0046 | Angela Torres | Erick Robinson  | 2026-04-15 17:42 |
| CC-20260325-0045 | Angela Torres | Erick Robinson  | 2026-04-15 17:42 |

All 7 rows now have:
- `status = 'pending'`
- `assigned_to = <the latest admin-reassignee>`
- `counted_quantity = NULL` (where Jai had started counting)
- Audit note: `[Restored original admin reassignment to X at … — was auto-released by legacy scheduler path pre-migration 231]`

## Query used (reproducible)

```sql
BEGIN;
SET LOCAL app.cycle_count_zone_lock_bypass = 'on';

WITH latest AS (
  SELECT h.count_id, h.new_counter_id, h.new_counter_name, h.reassigned_at,
         ROW_NUMBER() OVER (PARTITION BY h.count_id ORDER BY h.reassigned_at DESC) AS rn
  FROM cycle_count_assignment_history h
  JOIN rr_cyclecount_data cc ON cc.id = h.count_id
  WHERE cc.organization_id = <org>
    AND cc.assigned_to IS NULL
    AND cc.notes ILIKE '%Auto-released%'
    AND h.reassigned_by IS NOT NULL
    AND h.reassigned_by <> h.new_counter_id
),
targets AS (SELECT * FROM latest WHERE rn = 1)
UPDATE rr_cyclecount_data target
SET assigned_to = t.new_counter_id,
    counter_name = t.new_counter_name,
    assigned_at = t.reassigned_at,
    status = 'pending',
    push_mode = 'pull', pushed_by = NULL, pushed_at = NULL, push_acknowledged = false,
    updated_at = NOW(),
    notes = COALESCE(target.notes || E'\n','') || format(...)
FROM targets t
WHERE target.id = t.count_id;

COMMIT;
```

Pattern (for future ops): identifies rows where an admin explicitly reassigned but the row later got wiped by a hard auto-release.

## Verification

- Re-ran the orphan detector: 0 rows.
- Phase 2 of the Rust claim query (filter `assigned_to IS NULL`) cannot return any of the 7.
- Each row will route to its designated assignee on their next Pull Next via Phase 1.

## Side note — the 21 other auto-released rows

Still ~21 other rows in the pool with `[Auto-released: abandoned after 30 minutes]` notes and `assigned_to = NULL`. Checked their assignment history: none had an admin reassignment that was different from the organic claim. They're legitimate abandoned-by-operator rows. Correct for them to sit in the general pool.
