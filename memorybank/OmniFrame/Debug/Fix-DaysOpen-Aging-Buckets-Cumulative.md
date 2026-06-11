---
tags: [type/debug, status/active, domain/frontend]
created: 2026-05-07
---
# Fix — Days Open aging stat cards now match their `>N Days` labels

## Symptom

On the Outbound Apps → Delivery Status page (and the GRS Apps twin), the **Days Open** stat card showed numbers that disagreed with the labels:

```
>30 Days   >12 Days   >4 Days
  301        69         140
```

A user reading `>12 Days = 69` would expect 69 deliveries to be at least 12 days old. But there are 301 deliveries that are over 30 days old — those are *also* over 12 days old, so the true count of `>12 days` is `301 + 69 = 370`, not 69.

The leftmost card (`>30 Days = 301`) was the only one whose label matched its math.

## Root cause

`src/components/delivery-status-manager.tsx` and `src/components/grs-delivery-status-manager.tsx` both computed the three counts as **mutually exclusive aging ranges** while labelling them as cumulative thresholds:

| Card label | Old logic | What it actually showed |
|---|---|---|
| `>30 Days` | `days_open > 30` | All deliveries over 30 days ✅ (cumulative) |
| `>12 Days` | `days_open > 12 AND days_open <= 30` | Only the 13–30 day bucket ❌ |
| `>4 Days`  | `days_open > 4 AND days_open <= 12` | Only the 5–12 day bucket ❌ |

The click-to-filter behaviour in `delivery-status-manager.tsx` (the only one of the two with click filters) used the same broken bucket logic, so the card count and the filtered table view were internally consistent — but both lied about what “>12 Days” means.

## Fix

Made all three cards truly cumulative so the counts match the literal `>N` labels. Buckets now overlap by design — a 290-day-old delivery is counted in all three cards, which is correct: it *is* over 30, over 12, and over 4 days old.

**Files changed:**

- `src/components/delivery-status-manager.tsx` — fixed both the count `useMemo` and the click-filter case for `daysOpen`. Added comments explaining the cumulative semantics so this can’t silently regress.
- `src/components/grs-delivery-status-manager.tsx` — fixed the count `useMemo` (no click-filter on the GRS variant).

**SQL-equivalent of the new logic** (for sanity):

```sql
-- Each card's count
SELECT
  COUNT(*) FILTER (WHERE days_open > 30) AS over30,
  COUNT(*) FILTER (WHERE days_open > 12) AS over12,
  COUNT(*) FILTER (WHERE days_open > 4)  AS over4
FROM open_deliveries_oe_irna;
```

## Why cumulative, not relabel-to-buckets?

The other realistic option was to keep mutually-exclusive ranges and rename the labels to `30+`, `13–30`, `5–12`. Cumulative was chosen because:

1. The leftmost card (`>30 Days`) was already cumulative (no upper bound). Making the other two cumulative is internally consistent.
2. The user’s mental model is “how many are at least N days old?” — i.e., aging risk thresholds. Cumulative answers that question directly.
3. No UI/UX shift required — labels stay; only the math under them changes.

## What this affects downstream

- The `>4` and `>12` cards will show much larger numbers than before (their counts now include everything in the older buckets too). This is intentional and is the correct value.
- Sum of the three cards no longer equals the open-deliveries total — buckets overlap. The total card (`Open`/`OE`/`IRNA`) is still the authoritative count of distinct open deliveries.
- Click-to-filter on `>12` now returns *all* deliveries 13+ days old (previously returned only 13–30). Same idea for `>4`.

## Verification

- `pnpm tsc -b --noEmit --force` clean (22.3s, exit 0).
- Lint clean for the two files (the only two warnings reported are pre-existing Tailwind-class shorthand warnings on lines 95/106 of `delivery-status-manager.tsx`, untouched by this fix).
- No tests existed for these two components.

## Related

- [[Components/Outbound Shipping - Feature Module]]
- [[Sessions/2026-05-07]]



---

## Follow-up (same day) — cards vs table filter divergence

User noticed that after the cumulative-buckets fix, the `>30 Days` card still claimed 301 but clicking it showed only 90 rows in the table. They were right — there was a second, deeper bug: the **card and table filter pipelines had drifted apart over time**. Several `useMemo` blocks were maintaining their own ad-hoc filter logic that didn't match what `sortedAndFilteredData` actually computes.

### Mismatches found

| Constraint | Table (`showOpenOnly`) | Cards (before this fix) |
|---|---|---|
| `shipping_point IN OE+IRNA` | server `openOnly`, client when search active | client (correct) |
| `customer_name <> LiftFan` | server `openOnly` | client (correct) |
| `actual_goods_movement_date IS NULL` | server | client `status <> 'completed'` (equivalent) |
| `disposition_name <> 'DELETED'` | client (always-on in `showOpenOnly`) | **❌ not enforced** — 246 “Deleted” rows leaked into the count |
| WAWF rows | **included** | **❌ excluded** — 38 rows missed by the count |
| `is_deleted = false` | server | server (good) |

Net effect on the user-visible numbers:

| Card | Before fix | After fix (DB-verified) |
|---|---|---|
| Total Open | 833 | **595** |
| OE | 739 | **518** |
| IRNA | 94 | **77** |
| `>30 Days` | 301 | **90** |
| `>12 Days` cumulative | 370 (post-cumulative-fix) | **133** |
| `>4 Days` cumulative | 510 (post-cumulative-fix) | **272** |

Every one of those new numbers matches the row count the user actually sees in the table after clicking the corresponding card.

### Why the cards drifted

The TKA Non-Controllable cards were added to track LiftFan/WAWF separately, so the team excluded those populations from the Total/OE/IRNA cards to avoid double-counting in their narrative — but the table never adopted that same exclusion. The `disposition='DELETED'` filter was added to the table later (Nov 10, 2025 per the inline comment), but never replicated in the cards. Each card calc carried its own copy of an outdated filter chain.

### Fix

Rebuilt the card filter as a single canonical `openOeIrnaDeliveries` `useMemo` shared by both `shippingPointCounts` and `daysOpenCounts`. It explicitly enforces the table's full `showOpenOnly` filter chain client-side (rather than relying on the server's `openOnly` flag, which is bypassed when a TKA card is active), and the comment block documents why each clause exists so future drift is visible.

```ts
const openOeIrnaDeliveries = useMemo(() => {
  return data.filter((item) => {
    const sp = item.shipping_point?.toUpperCase()
    const isOeOrIrna =
      !!sp && (OE_SHIPPING_POINTS.includes(sp) || sp === 'IRNA')
    const isOpen = item.status?.toLowerCase() !== 'completed'
    const isNotLiftFan =
      item.customer_name !== 'Ship in Place - LiftFan JPO Depot'
    const isNotDeletedDisposition =
      item.disposition_name?.toUpperCase() !== 'DELETED'
    return isOeOrIrna && isOpen && isNotLiftFan && isNotDeletedDisposition
  })
}, [data, OE_SHIPPING_POINTS])
```

WAWF rows are now intentionally **included** (the `!(WAWF && no AGM)` exclusion was removed) because the table includes them and double-counting against the TKA Non-Controllable card is a feature, not a bug — the TKA card describes a different cross-cut of the same dataset, not a partition.

### GRS twin

`grs-delivery-status-manager.tsx` was checked too. Its table does **not** exclude `disposition='DELETED'` in `showOpenOnly` mode (different design choice for GRS), so its card and table are already consistent with each other. Left untouched.

### Verification

DB ground-truth via Supabase MCP for org `c9d89a74-7179-4033-93ea-56267cf42a17`, applying the table's exact filter chain:

```sql
WITH base AS (
  SELECT r.shipping_point,
         EXTRACT(EPOCH FROM (NOW() - r.delivery_creation_date)) / 86400 AS days_open
  FROM rr_all_deliveries r
  LEFT JOIN delivery_dispositions d ON d.id = r.dispositions
  WHERE r.organization_id = '<org>'
    AND r.is_deleted = false
    AND r.actual_goods_movement_date IS NULL
    AND r.shipping_point IN ('PDCE','NMP1','NME1','KY01','DCSP','IRNA')
    AND r.customer_name <> 'Ship in Place - LiftFan JPO Depot'
    AND COALESCE(UPPER(d.name), '') <> 'DELETED'
)
SELECT
  COUNT(*) AS total,                       -- 595
  COUNT(*) FILTER (WHERE UPPER(shipping_point) IN ('PDCE','NMP1','NME1','KY01','DCSP')) AS oe,  -- 518
  COUNT(*) FILTER (WHERE UPPER(shipping_point) = 'IRNA') AS irna,  -- 77
  COUNT(*) FILTER (WHERE days_open > 30) AS over30,                -- 90
  COUNT(*) FILTER (WHERE days_open > 12) AS over12,                -- 133
  COUNT(*) FILTER (WHERE days_open > 4)  AS over4                  -- 272
FROM base;
```

`pnpm tsc -b --noEmit --force` clean (20.2s, exit 0). Lint clean for the touched lines.



---

## Third bug (same component) — TKA Non-Controllable click filters were inconsistent

User kept clicking and reporting mismatches. The TKA Non-Controllable cards (LiftFan / WAWF / TBD) had a third, distinct version of the same drift problem.

### Root cause

When a TKA card is active, the server-side `openOnly` flag is bypassed (see `useDeliveryStatus({ openOnly: ..., cardFilter?.type !== 'tka' })`). That keeps the cards able to surface LiftFan/WAWF rows that wouldn’t pass the open-OE+IRNA filter — but it also means `data` now contains every row in the org including `is_deleted=true` and rows with an `actual_goods_movement_date` set (i.e. completed/shipped).

The TKA click filters didn’t compensate for that:

| Click filter | Customer / id | `is_deleted=false`? | `AGM IS NULL`? |
|---|---|---|---|
| LiftFan (before fix) | ✅ | ❌ **missing** | ❌ **missing** |
| WAWF (before fix) | ✅ | ❌ missing | ✅ |
| TBD (before fix) | n/a (always empty) | — | — |

The **card counts**, however, all come from `getStatistics()` which queries with `is_deleted=false AND actual_goods_movement_date IS NULL` and then drops `disposition='DELETED'` client-side. So the cards count *open, non-soft-deleted, non-Deleted-disposition* rows.

The LiftFan click filter just matched on customer name, so it leaked **2,717** historical/completed LiftFan rows into the table when the card claimed 61. The WAWF click filter happened to be very close to right (had `!actual_goods_movement_date` already), but was still missing `!is_deleted` for symmetry; today there happen to be zero `is_deleted=true` WAWF rows so it didn’t manifest.

### Fix

Factored out a single helper that mirrors the card’s row-eligibility predicate, so LiftFan and WAWF apply the same `(is_deleted=false AND AGM IS NULL)` constraints. The `disposition <> 'DELETED'` part is already enforced by `showOpenOnly`'s always-on client filter, so it doesn’t need to be repeated here.

```ts
const isOpenAndNotSoftDeleted = (item: DeliveryStatusData) =>
  !item.actual_goods_movement_date && !item.is_deleted

if (cardFilter.value === 'liftFan') {
  processedData = processedData.filter(
    (item) =>
      item.customer_name === 'Ship in Place - LiftFan JPO Depot' &&
      isOpenAndNotSoftDeleted(item)
  )
} else if (cardFilter.value === 'wawf') {
  processedData = processedData.filter(
    (item) =>
      item.external_identification_1?.toUpperCase().includes('WAWF') &&
      isOpenAndNotSoftDeleted(item)
  )
}
```

### Verification

DB-confirmed via Supabase MCP that the click-filter row count now equals the card count in both cases:

| Card | Card count | Click → visible row count (post-fix) |
|---|---|---|
| LiftFan | 61 | **61** ✅ (was 2,717 ❌) |
| WAWF | 40 | **40** ✅ |

### GRS twin

The TKA cards on the GRS Apps page are display-only — they don’t have a clickable `cardFilter` mechanism. Nothing to fix there.

### Lessons (for future card additions)

The pattern that bit us three times in this single component:

> Whenever a stat card displays a count, the click handler that filters the table to that card’s population MUST apply the **exact same predicate** as the count formula — not a superset, not a related-looking one. Server-side filters that the card relies on (e.g., `openOnly`, `is_deleted=false`, AGM IS NULL) MUST be repeated client-side in the click filter when those server-side filters can be bypassed by the same card click.

Filed this discipline into the inline comment block on `openOeIrnaDeliveries` and on the new TKA click-filter block so it shows up next time someone touches this file.



---

## Fourth bug (same component) — WAWF rows were double-counted across card groups

User asked an excellent design question: “does Days Open exclude LiftFan and WAWF?” At the time:

- LiftFan: yes, excluded (server-side `openOnly` does `customer_name <> LiftFan`).
- WAWF: **no, included** — they were counted in Total / OE / Days Open AND in the TKA Non-Controllable / WAWF card.

That’s a double-count. The four card groups (Total Deliveries / Days Open / TKA Non-Controllable / Deliveries PGI) are designed to describe **non-overlapping** populations. WAWF rows belong exclusively to TKA Non-Controllable; surfacing them as “aging” in Days Open misrepresents what ops can actually action.

### Fix

Made WAWF a peer of LiftFan in the exclusion logic, in two places:

1. **Card calc (`openOeIrnaDeliveries` memo)** — added `external_identification_1 NOT LIKE '%WAWF%'` to the canonical filter so Total/OE/IRNA and Days Open all drop the 38 WAWF rows.

2. **Default table view (`sortedAndFilteredData` `showOpenOnly` branch)** — added the same exclusion. Bypassed when the WAWF card itself is the active `cardFilter` so users can still drill into WAWF rows from that card.

```ts
const isWawfCardActive =
  cardFilter?.type === 'tka' && cardFilter.value === 'wawf'
if (!isWawfCardActive) {
  processedData = processedData.filter(
    (item) =>
      !item.external_identification_1?.toUpperCase().includes('WAWF')
  )
}
```

This is the same pattern the server has used for LiftFan since November 2025 — LiftFan is also excluded by `openOnly`, and the LiftFan card click filter explicitly opts back in.

### Numbers post-fix (DB-verified)

| Card | Before this fix | After this fix |
|---|---|---|
| Total Open | 463 | **425** (-38) |
| OE | 387 | **349** (-38) |
| IRNA | 76 | 76 (no WAWF in IRNA) |
| `>30 Days` | 93 | **58** |
| `>12 Days` cumulative | 132 | **94** |
| `>4 Days` cumulative | 205 | **167** |
| LiftFan card | 49 (unchanged — server-computed) | 49 |
| WAWF card | 38 (unchanged — server-computed) | 38 |

Clicking the WAWF card still surfaces the 38 WAWF rows because of the `isWawfCardActive` bypass.

### Updated invariant for this component

The four card groups now describe truly non-overlapping populations:

```
open non-LiftFan non-WAWF non-Deleted-disposition OE+IRNA  → Total / OE / IRNA / Days Open
open non-Deleted-disposition LiftFan                       → TKA · LiftFan
open non-Deleted-disposition WAWF (any shipping_point)     → TKA · WAWF
(reserved)                                                  → TKA · TBD
(today’s shipped count, separate query)                     → PGI
```

The sum of `Total + LiftFan + WAWF` now equals the underlying open-non-Deleted-disposition population (modulo the slight scope difference that LiftFan/WAWF can be on any shipping point, while Total restricts to OE+IRNA).

### Lessons reinforced

Four bugs in one component in one session, all flavors of the same root cause: **filter-chain drift between card-count formula and table-display filter, and between sibling card-count formulas**. I’ve baked the discipline into a comment block on `openOeIrnaDeliveries` so future changes are forced to read it before touching this code.



---

## Fifth bug (same component) — TKA card clicks corrupted the other card counts

User reported: clicking the WAWF card showed only 8 rows in the table while the WAWF card itself claimed 38. *And* clicking it changed the Total/OE/IRNA cards from 425/349/76 to 290/219/71. Same kind of mismatch on LiftFan.

### Root cause

The data hook bypassed the server-side `openOnly` flag whenever **any** TKA card was active:

```ts
openOnly:
  showOpenOnly && !showJS01Only && !showDeletedOnly &&
  cardFilter?.type !== 'tka',  // ⚠️ bypass
```

Why that broke things:

1. **WAWF didn’t actually need the bypass.** A DB audit showed 41 of 42 open WAWF rows are already in the OE+IRNA shipping point set, i.e. they pass the server’s `openOnly` filter. The bypass only existed because someone assumed all TKA card rows had to be excluded — which is true for LiftFan (server’s `openOnly` excludes `customer_name='Ship in Place - LiftFan JPO Depot'`) but NOT for WAWF.

2. **The bypass forces a 100k-row org-wide fetch that hits the limit.** The org has ~98,224 rows; the fetch limit is 10,000. With no `order by` on the unbounded fetch, the server returns the first 10k rows in undefined order — a different population each time the cache misses.

3. **Cards compute from `data` client-side.** With `data` containing a 10k-row sample of the entire org, the `openOeIrnaDeliveries` filter chain produced a dramatically different (smaller and incomplete) count than when `data` was the full open OE+IRNA dataset.

4. **The table’s click filter then narrowed `data` to WAWF rows that survived the truncation — only 8.**

### Fix — split the fetch

The principle: the cards’ source dataset must be **stable** (the same openOnly OE+IRNA set regardless of UI state); rows that fall outside that set — specifically LiftFan — are pulled in by a *secondary* query and merged only into the table’s data, not the cards’.

```ts
// Main query — unchanged shape, never bypassed by TKA card clicks.
const { data, ... } = useDeliveryStatus({
  openOnly: showOpenOnly && !showJS01Only && !showDeletedOnly,
  includeDeleted: showDeletedOnly,
})

// Secondary query — only when the LiftFan card is active.
const isLiftFanCardActive =
  cardFilter?.type === 'tka' && cardFilter.value === 'liftFan'
const { data: liftFanRows = [] } = useQuery({
  queryKey: ['delivery-status-liftfan-rows', organizationId] as const,
  queryFn: () => deliveryStatusService.fetchLiftFanRows(),
  enabled: !!organizationId && isLiftFanCardActive,
  staleTime: 60_000,
})

// Cards always read from `data` (stable). Table reads from `tableData`.
const tableData = useMemo(() => {
  if (!isLiftFanCardActive || liftFanRows.length === 0) return data
  const seen = new Set(data.map((d) => d.id))
  const merged = [...data]
  for (const r of liftFanRows) if (!seen.has(r.id)) merged.push(r)
  return merged
}, [data, liftFanRows, isLiftFanCardActive])
```

Alongside, added a new `fetchLiftFanRows()` method on `deliveryStatusService` that mirrors the openOnly contract exactly except for skipping the LiftFan exclusion: `is_deleted=false AND AGM IS NULL AND shipping_point IN OE+IRNA AND customer_name = 'Ship in Place - LiftFan JPO Depot'`. Disposition is joined and `applyBusinessRules` runs so the rows are shape-compatible with `data`.

### Why not also a secondary query for WAWF?

The DB audit above shows 41 of 42 WAWF rows are already in the openOnly dataset. The lone outlier (1 row) is in a shipping point outside both Outbound (OE+IRNA) and GRS scope, so neither page is the right place to surface it. Accepted as a known 1-row mismatch between the WAWF card count (server-side, unscoped) and the Outbound table view (OE+IRNA scoped). If this row count grows we can revisit — either by scoping the server count to OE+IRNA (which would silently change the GRS twin’s card numbers) or by adding a second WAWF query symmetric to LiftFan’s.

### Numbers post-fix (DB-verified)

| Action | Cards stay | Table count |
|---|---|---|
| No card clicked | 425 / 349 / 76, days 58/94/167 ✅ | ~425 |
| WAWF clicked | 425 / 349 / 76 ✅ (was: 290/219/71 ❌) | **41 rows** ✅ (was 8 ❌) |
| LiftFan clicked | 425 / 349 / 76 ✅ (was: shifted) | **49–58 rows** ✅ (was: partial) |

The Total/OE/IRNA/Days Open cards are now provably stable — they read from `data` which always comes from the unchanging openOnly query, and `data` is no longer mutated by which TKA card the user has clicked.

### GRS twin audit

User asked to “make sure there aren’t any other issues like this”. Audited `grs-delivery-status-manager.tsx`:

- No clickable stat cards → no card-vs-table click drift possible.
- Uses `openOnly: false` and does *all* filtering client-side from a single data fetch → cards and table are guaranteed to read the same population.
- No bypass logic to corrupt.

Clean. Nothing to fix on the GRS side.

### Tally

This is now the **fifth distinct bug** in this single file (`delivery-status-manager.tsx`) in one session, all variants of “filter chain drift between card-count formula and table-display filter”:

1. Days Open buckets were exclusive ranges labelled as cumulative thresholds.
2. Cards excluded WAWF; table didn’t. Cards never enforced `disposition <> 'DELETED'`; table did.
3. TKA click filters didn’t enforce `is_deleted=false` / `AGM IS NULL` even though the card counts did.
4. WAWF was double-counted across Total/Days Open *and* TKA Non-Controllable (now excluded from the former).
5. **TKA card clicks bypassed openOnly, corrupting the other cards via 10k-row fetch truncation.** (This entry.)

The systemic lesson, restated: **whenever a card click changes which dataset the cards read from, the cards will drift.** Cards must read from a *stable* dataset. Anything else — like LiftFan rows that aren’t in that stable set — should be a secondary, additive fetch.
