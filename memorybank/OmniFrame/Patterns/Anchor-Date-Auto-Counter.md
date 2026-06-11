---
tags: [type/pattern, status/active, domain/frontend]
created: 2026-05-24
---
# Anchor-Date Auto-Counter

## Purpose / Context

A recurring need across factory / warehouse boards is the
**"N units since event X"** counter — the value isn't a measurement,
it's the elapsed time since a reset moment that ticks up on its own:

- **Days since last recordable incident** (Safety / TBIR)
- **Days since last quality escape** (Quality)
- **Hours since last unplanned downtime** (Maintenance)
- **Weeks since last 5S audit** (Operations)
- **Months since last process update** (Continuous improvement)

The canonical implementation lives in
`src/features/shift-productivity/production-boards/boards/sqcdp/lib/auto-value.ts`.
When you need this shape on a new surface, follow the recipe below.

## Recipe

### 1. Storage — JSONB bag, not a column-per-knob

```sql
ALTER TABLE <your_table>
  ADD COLUMN IF NOT EXISTS auto_value_config jsonb NOT NULL DEFAULT '{}'::jsonb;
```

Shape:

```ts
interface AutoValueConfig {
  mode?: 'count_up_days' | 'count_up_hours'
       | 'count_up_weeks' | 'count_up_months'
  anchor_at?: string | null   // ISO 8601
  floor_to_midnight?: boolean // Days mode only
}
```

- `NOT NULL DEFAULT '{}'` keeps existing rows rendering exactly as
  before — empty bag = "counter off".
- No CHECK constraint — validate client-side via Zod + a defensive
  `parseAutoValueConfig`. The shape will iterate; you don't want each
  iteration costing a DDL.
- The `mode` enum can grow in the JSONB without a migration. Future
  variants live alongside `count_up_*` (e.g. `count_down_to_anchor`
  for deadlines).
- Always pair with a `COMMENT ON COLUMN ...` documenting the shape so
  the next reader doesn't have to grep for the parser.

### 2. Compute — inject `now`, never call `Date.now()` inside

```ts
export function computeAutoValue(
  cfg: AutoValueConfig | null | undefined,
  now: Date | number = Date.now()
): number | null
```

- **Inject** `now` so tests can freeze the wall clock with
  `vi.setSystemTime` AND so the renderer can share one capture per
  frame across cells.
- **Clamp negative deltas to 0.** A curator picking next-week's date
  by mistake should read "0 Days" not a negative number.
- **Floor on calendar days** by default — incidents at 23:55 should
  read "1 Day" five minutes later, not "0 Days". The opt-out
  (`floor_to_midnight: false`) exists for hourly-precision
  workflows but is rarely the right default.
- **Months use day-of-month rollover** — anchor on the 13th, this
  month's count flips on the 13th, not on the 1st.

### 3. Tick — mode-aware cadence, pause when hidden

```ts
function useAutoValueClock(active: boolean, mode: AutoValueMode | undefined) {
  // setInterval(tickIntervalFor(mode)) when visible.
  // clearInterval on document.visibilitychange → hidden.
  // setNow(Date.now()) on visible-again.
}
```

Don't tick every second. The smallest visually-meaningful change for a
`count_up_days` counter happens at midnight — 60 s is overkill but
feels live. `count_up_months` only changes on the day-of-month
rollover; 5 min is plenty. Burning React renders on a counter that
won't visually change is wasted work and you'll notice it on the TV
variant where every card paints simultaneously.

### 4. Renderer seam — one switch point, not N

```ts
function resolvePrimaryNumber(metric: M, now: number): number | null {
  return isAutoValueActive(metric.autoValueConfig)
    ? computeAutoValue(metric.autoValueConfig, now)
    : metric.currentValue
}
```

Thread `now` through the existing format pipeline (prefix / suffix /
locale / decimal places). The counter doesn't replace the renderer;
it only substitutes the number going in. Curators still pair the
counter with `valueSuffix: ' Days'` to read "123 Days".

### 5. Editor surface — collapsible Section with live preview

- One enable switch at the Section header — the whole panel collapses
  to a one-line muted hint when off so curators who don't need the
  feature never see the controls.
- A `<ToggleGroup>` for the unit (one of N modes — not a `<Select>`,
  the visual weight of a button row matches what curators expect for
  "pick a polarity").
- A `<Input type="datetime-local">` for the anchor. Convert
  to / from UTC ISO at the seam so the persisted shape stays
  canonical regardless of where the curator types from.
- A `<Button variant="outline">` "Reset to current moment" — this is
  the high-value workflow ("we just had an incident, restart the
  counter"). Don't hide it behind an extra click.
- A **live preview pill** showing what the card will display right
  now given the in-flight form values — closes the feedback loop on
  "is the anchor right?" without leaving the dialog.
- **Disable the static value input** when the counter is on, with a
  one-line helper pointing curators back at the counter section.
  Don't hide it — disabled tells them "this is still a knob, just
  inactive".

### 6. History/chart story — explicit, not auto-generated

The historical chart shows recorded points (incidents, audits,
actual events). It does **not** auto-synthesize the daily climb of
the counter. The headline carries the live value; the chart carries
the underlying event timeline. If a curator wants a visible drop-to-0
on reset, they record a 0 history point at the new anchor via the
History tab.

If you later want the climb visible too, add a daily Edge Function
that backfills computed values — don't try to compute it on read.

## Anti-patterns

- **Don't** add separate `unit_mode` / `anchor_at` / `floor_to_midnight`
  columns. The next dimension you want (count-down? cross-metric
  anchor?) costs another DDL. JSONB + a defensive parser is cheaper.
- **Don't** compute inside React without `now` as a parameter. Tests
  become time-bound and flaky; render shares a `Date.now()` per
  frame becomes impossible.
- **Don't** tick at 1 s. The smallest visually-meaningful change for
  a days counter is 24 hours away. Burn no renders the user can't
  see.
- **Don't** auto-overwrite the curator's `valueSuffix` when they
  enable the counter. They may want "Days" or "DAYS SAFE" or
  " days w/o incident" — your guess is wrong half the time.
  Suggest in helper copy, don't mutate.
- **Don't** keep the static value input enabled when the counter is
  on. It looks like both knobs are live and curators waste time
  trying to figure out which one wins.

## Reference implementation

- [[Implement-SQCDP-Auto-Counter]] — the v16 implementation log
  capturing the exact file changes, migration, and verification.
- `src/features/shift-productivity/production-boards/boards/sqcdp/lib/auto-value.ts`
- `src/features/shift-productivity/production-boards/boards/sqcdp/lib/auto-value.test.ts`

## Related

- [[Editable-Board-Dialogs]] — the Section / SwitchRow / dirty-badge
  primitives this pattern lives inside.
- [[Per-Field-Style-Overrides]] — same JSONB-bag pattern, applied
  to typography.
- The v13 `chart_config` bag is the closest sibling — same
  "one JSONB, validate client-side" philosophy applied to chart
  appearance.
