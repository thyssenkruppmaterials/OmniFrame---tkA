---
tags: [type/implementation, status/active, domain/frontend, domain/database]
created: 2026-05-24
---
# Implement SQCDP Auto-Counter (v16, 2026-05-24)

## Purpose / Context

Curators asked for the **Safety / TBIR** card's `861 Days` headline to tick
up automatically as days pass without an incident, and snap back to 0 when
an incident is recorded. The same pattern recurs across the SQCDP grid
— "Days since last quality escape", "Hours since last unplanned downtime",
"Weeks since last 5S audit", "Months since last process update".

v16 generalises that into a per-metric **auto-counter** config: any
SQCDP metric can replace its static `current_value` with a live count
from an anchor timestamp. The shape is in JSONB so a future `count_down`
variant (deadline countdown) lands without another `ALTER TABLE`.

## Architecture

```
 sqcdp_metrics.auto_value_config jsonb
          │
          ▼ parseAutoValueConfig + AutoValueConfig type (lib/auto-value.ts)
          │
          ▼ SqcdpMetricRow.autoValueConfig (use-sqcdp-metrics.ts)
          │
          ├─ SqcdpCard → useAutoValueClock(metric) → computeAutoValue
          │     → renderPrimaryValue(metric, now) replaces currentValue
          │
          └─ SqcdpEditorDialog → Basics tab §3 "Auto-counter" section
                (toggle, unit, anchor datetime, midnight-floor, live preview, reset-to-now)
```

### Storage shape

```ts
interface AutoValueConfig {
  mode?: 'count_up_days' | 'count_up_hours'
       | 'count_up_weeks' | 'count_up_months'
  anchor_at?: string | null   // ISO 8601
  floor_to_midnight?: boolean // Days mode only; default true
}
```

Empty `{}` = no auto-counter (card keeps reading the static
`current_value`). DB column is `jsonb NOT NULL DEFAULT '{}'` so existing
rows render exactly as before.

### Compute helpers (`lib/auto-value.ts`)

- `isAutoValueActive(cfg)` — narrow predicate (`mode` set + parseable
  `anchor_at`). Anything malformed collapses to inactive so corrupted
  payloads never blank a card.
- `computeAutoValue(cfg, now)` — returns the integer count. `now` is
  injected (not read inside) so tests are deterministic and the
  renderer can share one `Date.now()` capture per frame. Clamps
  negative deltas (anchor in the future) to 0.
- `tickIntervalFor(mode)` — mode-aware re-render cadence used by the
  card's clock. Days / hours = 60 s; weeks / months = 5 min so the
  rare monthly counter doesn't burn renders 60× per minute.
- `parseAutoValueConfig(raw)` — defensive narrowing for the DB JSONB,
  mirrors `parseChartConfig` / `parseStyleConfig`.

### Card integration (`components/sqcdp-card.tsx`)

- `resolvePrimaryNumber(metric, now)` is the single seam: returns the
  computed counter when active, otherwise `metric.currentValue`.
- `renderPrimaryValue(metric, now)` threads `now` through the existing
  format chain (prefix / suffix / decimal places untouched — the curator
  still pairs the counter with `valueSuffix: ' Days'`).
- `useAutoValueClock(metric)` is the only new hook. Internally:
  - Returns a stable mount timestamp when the metric isn't in auto
    mode (no needless re-renders).
  - When active, ticks via `setInterval(tickIntervalFor(mode))`.
  - Listens to `document.visibilitychange` so background tabs stop
    ticking (and immediately refresh on return).

### Editor integration (`components/sqcdp-editor-dialog.tsx`)

New Section `3 · Auto-counter` in the Basics tab between Value and
Period & trend (the old `3 · Period & trend` renumbers to `4`). The
entire control surface lives inside an `<AutoCounterSection>` component
colocated with `BasicsTab` to keep the Basics-tab JSX scannable.

UX:
- The Section header has an enable switch — the whole panel collapses
  to a one-line muted hint when off (curators who don't need it never
  see the controls).
- When on:
  - `<ToggleGroup>` picks the unit (Days / Hours / Weeks / Months).
  - `<Input type="datetime-local">` picks the anchor. We convert to /
    from UTC ISO via `isoToLocalInput` + `localInputToIso` so the
    persisted shape stays canonical regardless of where the curator
    types from.
  - `<Button>` "Reset counter to current moment" snaps the anchor to
    `Date.now()` — the "we just had an incident" workflow.
  - Days mode gets an extra `<SwitchRow>` for `floor_to_midnight`
    (default on; off means rolling-24h windows).
  - A live-preview pill at the bottom shows what the card will
    display *right now* given the in-flight form values.
- The static `Current value` input in Section 2 is `disabled` whenever
  the counter is on, with helper copy pointing back at Section 3.

## Files added / changed

- **NEW** `src/features/shift-productivity/production-boards/boards/sqcdp/lib/auto-value.ts` — types, defaults, compute, parse.
- **NEW** `src/features/shift-productivity/production-boards/boards/sqcdp/lib/auto-value.test.ts` — 21 unit tests covering compute (days / hours / weeks / months / floor / clamp / same-day), parse (nullish / unknown / partial), and tick cadence.
- **NEW** `supabase/migrations/310_sqcdp_auto_value_config.sql` — adds `auto_value_config jsonb NOT NULL DEFAULT '{}'` + column comment + `NOTIFY pgrst`. Applied to `wncpqxwmbxjgxvrpcake` via Supabase MCP `apply_migration`.
- **EDIT** `src/features/.../sqcdp/hooks/use-sqcdp-metrics.ts` — row interface (+ JSDoc), `CreateSqcdpMetricInput`, raw row, mapRow, SELECT projection, INSERT, UPDATE patch path, and the optimistic onMutate branch.
- **EDIT** `src/features/.../sqcdp/components/sqcdp-card.tsx` — `useAutoValueClock` hook, `resolvePrimaryNumber` seam, `renderPrimaryValue(metric, now)` threading.
- **EDIT** `src/features/.../sqcdp/components/sqcdp-editor-dialog.tsx` — `autoValueConfigSchema`, form defaults, submit payload, `buildPreviewMetric` field, new `<AutoCounterSection>` UI, disabled state on `Current value`, retitle Section 3 → 4 (Period & trend).
- **EDIT** Three test fixture files — `sqcdp-card.test.tsx` (+3 auto-counter tests), `sqcdp-chart.test.tsx`, `sqcdp-history-editor.test.tsx` — added `autoValueConfig: {}` to satisfy the new required field on `SqcdpMetricRow`.

## Verification

- **Migration applied:** `SELECT column_name, data_type, column_default, is_nullable FROM information_schema.columns WHERE table_name='sqcdp_metrics' AND column_name='auto_value_config'` returns `jsonb / '{}'::jsonb / NO`.
- **TypeScript:** `pnpm tsc -b` green.
- **Tests:** 199/199 SQCDP tests pass (21 new auto-value pure-fn + 3 new card smoke + 175 carry-over). 722/747 total unit tests pass; the 25 failures are the same pre-existing security / RBAC / RF-interface failures captured in [[Sessions/2026-05-22]].
- **Lint:** 0 new errors, 0 new warnings (98 warnings is the existing project drift; the lint ratchet is busted at baseline against `main` — not introduced by this PR).
- **Build:** green; total JS 10,310.81 KB (vs 10,277.89 KB pre-change → +33 KB delta, all in the lazy `sqcdp-board` chunk which holds at ~146.5 KB). Pre-existing budget violators (`warehouse-location-map`, `feature-admin`, `feature-rf-interface`) unchanged.

## Why this shape (vs alternatives)

- **JSONB bag instead of per-column knobs.** Same rationale as v13's
  `chart_config` bag (migration 302) — each new counter dimension
  (mode / anchor / floor / future count-down) would otherwise cost an
  `ALTER TABLE` + a PostgREST NOTIFY + a frontend-vs-backend deploy
  ordering window. Client-side Zod + a defensive parser give us the
  same safety without the migration tax.
- **Compute at render, not at write.** A scheduled job (daily cron
  inserting history rows) was the alternative. Render-time compute is
  simpler, doesn't need a worker, doesn't risk drift between the
  scheduled tick and curator's clock, and is cheap (one `Math.floor`
  per card per minute). The trade-off is the chart's history series
  only shows actual recorded points, not the synthesised daily climb
  — that's deliberate; the headline carries the live value, the chart
  shows the underlying incident timeline.
- **`now` is injected, not read inside `computeAutoValue`.** Lets the
  tests freeze the wall clock with `vi.setSystemTime` and lets the
  renderer share a single `Date.now()` per frame across the card.
- **Mode enum can extend without DDL.** A future `count_down`
  (deadline countdown), `since_event_at` (multi-event consolidator),
  or `relative_to_other_metric_id` (cross-metric anchor) lands by
  adding a new branch to `computeAutoValue` and a new option to the
  editor's `<ToggleGroup>`.

## Follow-ups

- **History synthesis on reset.** When curator clicks `Reset counter to
  current moment`, today we only move the anchor — we don't write a
  `0` row to `sqcdp_metric_history`. So the chart shows the pre-reset
  trajectory + flat segment after, not a visible drop to 0. Adding the
  history insert is a 5-line change once we decide what the "last
  count before reset" point should be (peak value? final headline?
  manual entry?).
- **Daily backfill cron.** Optional later — a once-per-day Edge
  Function that inserts the computed value into
  `sqcdp_metric_history` for any metric with an active counter, so
  the chart shows the gradual climb. Not needed for v16 (the headline
  already shows the live value); ship if curators ask for it.
- **TV measured-hero overflow safety.** The auto-counter sits inside
  the existing `useUniformHeroFit` chain. Once values cross 4 digits
  (e.g. "1,234 Days") the measured-hero floor (56 px) handles wrap,
  but if a curator pins a large size override AND lets the counter
  run for a decade the rendered text could overflow. Document the
  curator-facing hint in `<FieldStyleRow>` when this becomes a real
  user report.

## Related

- [[Implement-SQCDP-Editor-Fine-Grained-Controls]] — v14 / v15 editor
  pass this builds on (the tab structure, `Section` / `SwitchRow`
  primitives, dirty-badge `fields` list).
- [[ADR-SQCDP-Measured-vs-Viewport-Hero-Typography]] — v15.2 measured
  hero typography that the live-computed value participates in.
- [[Editable-Board-Dialogs]] — canonical pattern for the editor
  surface this extends.
- [[Fix-SQCDP-Metric-Editor-Uncaught-ZodError-2026-05-22]] — prior
  session's resolver upgrade; the new `autoValueConfig` Zod schema
  uses the same v5 `@hookform/resolvers` codepath without an `as
  never` cast (`AutoValueConfig`'s shape is all-optional so input =
  output for this branch).
