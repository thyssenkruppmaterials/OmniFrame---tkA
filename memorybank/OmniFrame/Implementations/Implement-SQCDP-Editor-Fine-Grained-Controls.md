---
tags: [type/implementation, status/active, domain/frontend]
created: 2026-05-17
---
# Implement SQCDP Editor Fine-Grained Controls (v14)

## Purpose / Context

Third major editor pass on the v12.3 side-by-side SQCDP metric editor. v12 graduated the body to tabs (Basics / Style / Advanced / History) and v12.3 reshaped the layout into a side-by-side preview / controls split ([[Fix-SQCDP-Editor-Live-Preview-Bleed-Through]]). v14 is the **"fine-grained controls"** pass — substantially more knobs per tab, a more legible tab strip with unsaved-changes badges, and cleaner layout primitives.

The user request was: *"Improve the overall editing of the cards. Add fine-tuned, control-grained editing for each of the menu options. Improve it overall. Make it look much, much nicer. Much better layout."*

## Changes (per tab)

### Tab strip + dialog shell

- Replaced the default shadcn `<TabsList>` with a roomier custom strip — each tab is a button with a dirty-state dot badge (`bg-amber-500` when inactive, `bg-primary` when active). One-line description under the active label.
- Dialog content max width bumped from `1040px` to `1180px` (problem form still at `680px`).
- Dialog title now carries a small color-dot prefix matching the metric's accent so the curator gets a category cue without reading the text.
- Footer adds an "Unsaved changes" indicator beside the Save button when `formState.isDirty`.
- Live-preview aside now hosts a `<ToggleGroup>` for **Stacked** / **Single** preview when sub-metrics exist — the curator can flip between layouts without temporarily deleting their sub-metrics.

### Basics tab — 3 sections

1. **Identity** — Category (Select with palette dot prefix per option) + Title + Subtitle.
2. **Value** — Format + Unit + Current + Target + Prefix + Suffix + **Decimal places via `<Slider>`** with an "Auto" tick. Slider value -1 = `'auto'` enum, 0–4 map to the corresponding `decimalPlaces` enum value. Live readout to the right of the label.
3. **Period & trend** — Trend period Select + a 2-up grid of mini `<SwitchRow>` cards: *Show trend arrow* + *Lower is better*. (v13 had these on the Advanced tab; lifting them into Basics surfaces them where the curator picks the period.)

### Style tab — 3 sections

1. **Card colors** — New **recommended palette** strip (the 9 canonical SQCDP accents) above the existing color-override + accent inputs. Active swatch shows a `IconCircleCheck` ring. **Contrast badge** under the color input — measures WCAG ratio of the picked color vs `#FFFFFF` (the header band title color) and warns when below `3.0` (AA large-text). "Reset to category" ghost button in the section action slot.
2. **Header band** — NEW. `<ToggleGroup>` for height (compact / normal / tall) + alignment (left / center) and a `<SwitchRow>` for **show category icon**. All three persist into `styleConfig.header` ([[Per-Field-Style-Overrides]]).
3. **Typography** — `<FieldStyleRow>` (per-field card) now renders Family / Size / Weight on the top row, plus a **"More" disclosure** that exposes Case (transform), Letter spacing, Alignment, and Text color. Default-collapsed so the tab stays scannable.

### Chart tab — 5 sections

1. **Display** — Chart type as a `<ToggleGroup>` with `IconChartLine` / `IconChartArea` / `IconChartBar` icons. Show-data-points switch with chart-type-aware copy ("Bar charts already mark each bar — this toggle is ignored for bars").
2. **Curve & axis** — Curve type as a `<ToggleGroup>` (Smooth / Straight / Step). Y-axis show toggle + Y-axis min / max via the new `<NumberWithAutoChip>` (numeric input paired with an "Auto" pill that clears the value to `null` so Recharts falls back to its default domain).
3. **Grid** — Horizontal / Vertical toggles + **opacity `<Slider>`** (0–50%). Wired through `chartConfig.grid.opacity` which the chart's `<CartesianGrid strokeOpacity>` now reads (default `6` = parity with v12.x).
4. **Reference lines** — Primary target line color picker + style `<ToggleGroup>` (Solid / Dashed / Dotted) + **width `<Slider>`** (1–3 px) + show-label switch. "Additional goal lines" hosts the existing `<SqcdpGoalLinesEditor>`.
5. **Annotations** — Show-average + highlight-min/max switch row pair.

### Advanced tab — 2 sections (simpler than v13)

1. **Stacked sub-metrics** — Wraps the existing `<SqcdpSubMetricsEditor>`. Empty state restyled into a centered card with a primary CTA ("Add first sub-metric").
2. **Notes & visibility** — Textarea + visibility switch row.

Format number knobs (prefix / suffix / decimal / lower-is-better / show-trend) moved OUT of Advanced into Basics where the curator picks the value format. Advanced is now firmly about "things that override the default render" rather than "things you'll usually touch".

### History tab

The `<SqcdpHistoryEditor>` toolbar got a small polish: header row now has `bg-muted/15` + a bolder title, the "Add data point" button graduated to `variant='default'` (primary CTA) so it leads the eye, and the action label toggles to "Cancel new entry" while the add row is open. `max-h-[320px]` (was 280) — gives an extra ~2 rows of headroom without bloating the dialog body.

## Schema extensions

### `StyleConfig` (lib/style-config.ts)

New fields on `FieldStyle`:

- `align?: 'left' | 'center' | 'right'`
- `letterSpacing?: 'tight' | 'normal' | 'wide'`
- `color?: string` — hex applied via inline `style` (NOT a Tailwind class — the JIT-safe static class map rule from [[Per-Field-Style-Overrides]] doesn't apply to free-form colors).
- `transform` now also accepts `'lowercase'` (was `none | uppercase | capitalize` in v12).

New top-level `header` sub-config:

- `height: 'compact' | 'normal' | 'tall'` → density-aware padding map.
- `align: 'left' | 'center'` → outer flex `justify-*` + inner title group flex-1 / justify-center policy.
- `showIcon: boolean` → gates the category `<Icon>` inside the colored band.

New helpers:

- `ALIGN_CLASS` / `LETTER_SPACING_CLASS` — static class maps.
- `fieldColor(style, defaults)` — resolves the per-field hex into `#RRGGBB` or `undefined`. Card renderer threads onto `style={{ color }}` (we don't compose `text-${color}` because the JIT can't see it — see pattern note).
- `headerClasses(config, density)` — density-aware padding.
- `headerOuterClasses` / `headerGroupClasses` — split outer `justify-*` from inner title-group classes so center alignment coexists with the right-anchored pencil affordance.

`parseStyleConfig` updated to defensively accept all new keys + drop bogus enum values + the legacy v12 shapes.

### `ChartConfig` (lib/chart-config.ts)

- `grid.opacity?: number` (0–50, integer percent, defaults `6`).
- `parseChartConfig` clamps incoming opacity into `[0, 50]` and rounds to integer. Bogus non-numeric values drop silently.
- `<SqcdpChart>`'s `<CartesianGrid strokeOpacity>` now reads `(grid.opacity ?? 6) / 100`.

### Backwards compatibility

All new keys are optional. Existing `style_config` / `chart_config` JSON values render identically — defaults preserve v12.x / v13 behaviour. Hand-edited rows with unknown fields fall through the parse helpers without crashing.

## New shadcn primitives

- `src/components/ui/toggle.tsx` + `src/components/ui/toggle-group.tsx` — installed via the shadcn MCP (`pnpm dlx shadcn@latest add @shadcn/toggle-group`). Normalised to the project's single-quote convention and dropped the auto-installed `data-[spacing=…]` gap utilities that don't compose with our existing Tailwind v4 setup. The primitive backs every `<ToggleGroup>` in the editor (header height/align, chart type, curve type, line style, preview mode, letter spacing, alignment).
- New dependency: `radix-ui@^1.4.3` (a meta-package that bundles every Radix primitive — pulled in transitively by the shadcn install). Smaller than installing `@radix-ui/react-toggle` + `@radix-ui/react-toggle-group` separately because the rest of the codebase will eventually consolidate.

## Files touched

| File | Why |
|------|------|
| `src/components/ui/toggle.tsx` (new) | Underlying primitive for `<ToggleGroup>`. |
| `src/components/ui/toggle-group.tsx` (new) | Used throughout the new editor sections. |
| `src/features/.../sqcdp/lib/style-config.ts` | Schema extensions + helpers (`ALIGN_CLASS`, `LETTER_SPACING_CLASS`, `headerClasses`, `headerOuterClasses`, `headerGroupClasses`, `fieldColor`, `parseStyleConfig` updates). |
| `src/features/.../sqcdp/lib/style-config.test.ts` | New tests for align / letterSpacing / color / lowercase transform / header config / `fieldColor`. |
| `src/features/.../sqcdp/lib/chart-config.ts` | `grid.opacity` field + clamp + default = 6. |
| `src/features/.../sqcdp/lib/chart-config.test.ts` | New test asserting opacity clamping + integer rounding. |
| `src/features/.../sqcdp/components/sqcdp-card.tsx` | Apply `header` config (`headerClasses` / `headerOuterClasses` / `headerGroupClasses` + `showIcon` gate). Thread `fieldColor` results onto title / subtitle / primary inline `style`. `SubMetricBlock` also picks up the new color + classes. |
| `src/features/.../sqcdp/components/sqcdp-chart.tsx` | `<CartesianGrid strokeOpacity>` reads from `chartConfig.grid.opacity`. |
| `src/features/.../sqcdp/components/sqcdp-editor-dialog.tsx` | Full rewrite: new tab strip, dirty badges, footer indicator, preview-mode toggle, expanded Basics / Style / Chart / Advanced bodies, palette strip, contrast badge, `<NumberWithAutoChip>`, `<SwitchRow>` helper. |
| `src/features/.../sqcdp/components/sqcdp-history-editor.tsx` | Header row restyled, primary "Add data point" CTA, taller scroll cap (`max-h-[320px]`). |
| `src/features/.../sqcdp/components/sqcdp-sub-metrics-editor.tsx` | Empty state restyled into a centered card with primary CTA. |
| `package.json` / `pnpm-lock.yaml` | `radix-ui@^1.4.3` (added by shadcn CLI). |

## Verification

- `pnpm vitest run src/features/shift-productivity/production-boards/boards/sqcdp/` — 9 files, **113 tests** all green. Added 12 new tests: 11 in `style-config.test.ts` (new helpers + parse rules), 1 in `chart-config.test.ts` (grid opacity).
- `pnpm eslint <touched files>` — clean. No new warnings or errors.
- `pnpm tsc --noEmit -p tsconfig.app.json` — clean.
- (Pre-existing failures elsewhere on `main`'s working tree — `post-composer-dialog.tsx` etc. — were not in scope for this work and are unaffected.)

## Canonical handles (if you want to tweak further)

- **Add a new tab** → push a descriptor onto `METRIC_TAB_DESCRIPTORS` (the new tab strip auto-derives dirty badges from its `fields` array). Add a matching `<TabsContent>` block.
- **Add a new per-field style dimension** → extend `FieldStyle` in `lib/style-config.ts` + the static class map + `parseStyleConfig` + `fieldClasses`. Then add an entry to the "More" disclosure inside `<FieldStyleRow>`.
- **Tweak the recommended palette** → edit `SQCDP_PALETTE` in `sqcdp-editor-dialog.tsx`. Already matches the canonical 9 category accents.
- **Tighten or loosen the contrast warning threshold** → `contrastAgainstWhite` returns the ratio; the `ContrastBadge` JSX compares against `3` (WCAG AA large text). Bump to `4.5` for AA normal text or `7` for AAA.
- **Add a new chart appearance toggle** → extend `ChartConfig` in `lib/chart-config.ts` (parser + default + interface), thread through `<SqcdpChart>`, then add a `<SwitchRow>` or `<ToggleGroup>` to the matching Chart-tab section.
- **Adjust dialog width** → `<DialogContent>` `sm:max-w-[1180px]` on the metric form; `sm:max-w-[680px]` on the problem form. Stay under ~1280px so it doesn't dominate a 13" laptop viewport.
- **Change which fields drive which tab's dirty badge** → `METRIC_TAB_DESCRIPTORS[*].fields`.

## Decisions

- **Per-field color via inline `style` not Tailwind class.** The [[Per-Field-Style-Overrides]] pattern bans dynamic class composition for size / weight / etc. Color is the exception — a fixed enum (e.g. `red-500`, `emerald-600`) would be too restrictive for curators picking brand colors, and the JIT-safe alternative is to enumerate a palette in code anyway. Inline style is the right escape hatch for free-form hex input. The pattern note has been extended to document this carveout.
- **Header sub-config lives at the top level of `StyleConfig`, not nested under `title`.** The header band's height / alignment / icon-visibility aren't field-level concerns — they affect the band geometry, not the title text. Modeling as a sibling key (`header: { height, align, showIcon }`) maps to the schema better than overloading the title field.
- **Decimal places as a slider, not a select.** v13 used a `<Select>` with values `auto | 0 | 1 | 2 | 3 | 4`. The slider reads faster at glance distance and the inline label shows the resolved value (`Auto (use format default)` or `N digit(s)`). Storage stays the enum string (so `decimal_places` JSON values are stable).
- **"Reset to category" vs "Reset all".** Style tab Card-colors action is `Reset to category` (drops the colorHex / accentHex overrides back to the per-category palette). The Typography section's `Reset all` clears the entire `styleConfig` (typography + header). Different scopes, different buttons.
- **No new Supabase Realtime channels.** Workspace rule honoured — all preview state is driven by `useWatch` on the form, no additional realtime listeners.

## Related

- [[Patterns/Editable-Board-Dialogs]] — the host pattern; v14 reinforces the v12.2 "bordered sections + column headers for dense forms" rhythm and the v12.3 side-by-side layout.
- [[Patterns/Per-Field-Style-Overrides]] — extended with align / letterSpacing / color sub-keys and the inline-color carveout.
- [[Patterns/Selectable-Chart-Variants]] — `grid.opacity` is the second extension of the per-metric chart appearance bag (first was the v13 reference-lines + extremes recipe).
- [[Debug/Fix-SQCDP-Editor-Live-Preview-Bleed-Through]] — the v12.3 side-by-side recipe v14 preserves.
- [[Implementations/Implement-Production-Boards-Hourly-Grid]] — primary implementation log for SQCDP editor evolution (v6 → v10 → v12 → v13 → v14).
- [[Components/ProductionBoards - Feature Module]] — feature module the editor belongs to.
