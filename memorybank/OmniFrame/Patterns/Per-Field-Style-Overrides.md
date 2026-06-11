---
tags: [type/pattern, status/active, domain/frontend]
created: 2026-05-10
---
# Per-Field Style Overrides

## Purpose / Context

Reusable shape for letting curators / admins override font family / size / weight / transform per text field on a card / tile / scorecard surface, persisted as JSON on the row, applied at render-time via Tailwind utility classes that the JIT can actually see.

First extracted from the SQCDP v12 metric editor (2026-05-10) where curators wanted to pick typography per Title / Subtitle / Primary value text on each scorecard card. Likely next adopters: any future scorecard / dashboard / KPI tile that wants curator-controlled typography (Hourly KPI strip, LiveOperatorStatus tiles, customer-portal landing tiles).

## Shape

```ts
export type FontFamily = 'sans' | 'serif' | 'mono'
export type FontSize =
  | 'xs' | 'sm' | 'base' | 'lg' | 'xl' | '2xl' | '3xl'
  | '4xl' | '5xl' | '6xl' | '7xl' | '8xl' | '9xl'
export type FontWeight = 'normal' | 'medium' | 'semibold' | 'bold' | 'black'
export type TextTransform = 'none' | 'uppercase' | 'capitalize'

export interface FieldStyle {
  font?: FontFamily
  size?: FontSize
  weight?: FontWeight
  transform?: TextTransform
}

export interface StyleConfig {
  // One key per configurable text field on the surface.
  title?: FieldStyle
  subtitle?: FieldStyle
  primary?: FieldStyle
  // ...add more keys as the surface grows.
}
```

DB column: `style_config jsonb NOT NULL DEFAULT '{}'::jsonb`. Empty object = use defaults; a present key with an undefined sub-key falls back to the default for that sub-key only.

**Defaults live in code, not the DB.** A `Required<StyleConfig> & Record<keyof StyleConfig, Required<FieldStyle>>` constant exports the per-field default for every text field on the surface. The merge helper (`fieldClasses`) takes the override AND the defaults so callers always get a deterministic class string back.

## The Critical JIT-Safe Static Class Map

Tailwind v4's JIT scans source files for class literals. A dynamically-composed string like `text-${size}` is **invisible to the compiler** — the resulting CSS won't ship the class.

**Don't** ever write:

```ts
// BAD: JIT can't see `text-${merged.size}` so the class won't be generated.
return cn(
  `font-${merged.font}`,
  `text-${merged.size}`,
  `font-${merged.weight}`
)
```

**Do** export a static map per dimension that lists every utility once:

```ts
export const SIZE_CLASS: Record<FontSize, string> = {
  xs: 'text-xs', sm: 'text-sm', base: 'text-base', lg: 'text-lg',
  xl: 'text-xl', '2xl': 'text-2xl', '3xl': 'text-3xl', '4xl': 'text-4xl',
  '5xl': 'text-5xl', '6xl': 'text-6xl', '7xl': 'text-7xl',
  '8xl': 'text-8xl', '9xl': 'text-9xl',
}
export const WEIGHT_CLASS: Record<FontWeight, string> = {
  normal: 'font-normal', medium: 'font-medium', semibold: 'font-semibold',
  bold: 'font-bold', black: 'font-black',
}
export const FONT_FAMILY_CLASS: Record<FontFamily, string> = {
  sans: 'font-sans', serif: 'font-serif', mono: 'font-mono',
}
```

The JIT now sees `text-xs` ... `text-9xl` and `font-normal` ... `font-black` as plain class literals during the source scan.

## Merge helper

```ts
export function fieldClasses(
  style: FieldStyle | undefined,
  defaults: Required<FieldStyle>
): string {
  const merged: Required<FieldStyle> = {
    font: style?.font ?? defaults.font,
    size: style?.size ?? defaults.size,
    weight: style?.weight ?? defaults.weight,
    transform: style?.transform ?? defaults.transform,
  }
  return cn(
    FONT_FAMILY_CLASS[merged.font],
    SIZE_CLASS[merged.size],
    WEIGHT_CLASS[merged.weight],
    TRANSFORM_CLASS[merged.transform] || undefined
  )
}
```

Pure function — unit-test with at least 4 cases:

1. Default merge (no override) returns the defaults as classes.
2. Partial override (one sub-key set, others undefined) merges correctly.
3. Full override (every sub-key set) returns the override entirely.
4. Transform classes (`uppercase` / `capitalize`) only appear when their key is set; `none` resolves to no class.

## DB-shape sanitiser

When the column is read back from the DB, sanitize before trusting the shape:

```ts
export function parseStyleConfig(raw: unknown): StyleConfig {
  if (!raw || typeof raw !== 'object') return {}
  const obj = raw as Record<string, unknown>
  const result: StyleConfig = {}
  for (const key of ['title', 'subtitle', 'primary'] as const) {
    const v = obj[key]
    if (!v || typeof v !== 'object') continue
    const f = v as Record<string, unknown>
    const field: FieldStyle = {}
    if (typeof f.font === 'string' && f.font in FONT_FAMILY_CLASS) {
      field.font = f.font as FontFamily
    }
    if (typeof f.size === 'string' && f.size in SIZE_CLASS) {
      field.size = f.size as FontSize
    }
    // … weight, transform similarly.
    if (Object.keys(field).length > 0) result[key] = field
  }
  return result
}
```

Why: a malformed payload from the DB (someone hand-edits the column, or a future migration drops a field that the code doesn't know about) won't crash the renderer or paint a bogus utility. Unrecognized keys / values just fall through to the defaults.

## Editor UX

For each configurable field, render a 3-column row:

- **Family** `<Select>` listing only families that exist as Tailwind utilities on the project. **Inspect `src/index.css`'s `@theme` block** to confirm what's available before exposing options — some projects don't ship `font-mono`, some ship custom `font-display` etc. The SQCDP v12 picker only exposed `sans` / `serif` / `mono` because there's no `font-display` utility in OmniFrame.
- **Size** `<Select>` with a per-field whitelist (Title doesn't need `text-9xl`, Primary doesn't need `text-xs`).
- **Weight** `<Select>` listing every weight from `WEIGHT_CLASS`.
- **"Reset to default"** link beside each field name that clears the override (`field.onChange(undefined)`).

Keep transform out of the picker by default — it's already opinionated by the Defaults constant and curators rarely want to flip it. Exposing it adds a fourth select that doesn't pull its weight.

## Don't

- **Don't** dynamically compose Tailwind class strings (`text-${size}`). The JIT can't see them.
- **Don't** ship a Tailwind safelist as the workaround — listing utilities in a static map keeps them co-located with the code that uses them and survives any future build-system rename of the safelist mechanism.
- **Don't** expose a free-form numeric font-size input. Users will pick `text-13xl` or `text-fancy` and the JIT won't ship them. Whitelist sizes via the static map.
- **Don't** make every CSS dimension configurable. The SQCDP v12 surface intentionally locks `leading-none` + `tabular-nums` + `tracking-tight` on the primary number — letting curators flip those would risk values landing at different baselines across a row of cards.
- **Don't** persist the merged class string. Persist the override shape (`{ font, size, weight, transform }`); merge at render-time. Merged strings are unstable across code changes; the override shape is data.

## Reusability

Likely next adopters:

- The Hourly KPI strip's `<KpiCard>` (currently uses fixed density tokens — same shape would let curators pick per-tile).
- `LiveOperatorStatus` summary tiles (referenced as a candidate in [[Elevated-KPI-Stat-Cards]]).
- Customer-portal landing-page tiles (would let admins tune typography per landing-page launch without code changes).

If two consumers land outside the SQCDP card, promote `FONT_FAMILY_CLASS` / `SIZE_CLASS` / `WEIGHT_CLASS` / `TRANSFORM_CLASS` / `fieldClasses` to a shared `src/lib/style/style-config.ts` so the helper isn't duplicated.

## Related

- [[Implementations/Implement-Production-Boards-Hourly-Grid]] § v12 — first application; full editor + card integration.
- [[Editable-Board-Dialogs]] — the dialog pattern this lives inside; the `<FieldStyleRow>` helper lives in the Style tab.
- [[Elevated-KPI-Stat-Cards]] — the surface family this shape is most relevant to.
- [[Patterns/Selectable-Chart-Variants]] — sibling "give the curator a fixed enum to pick from" pattern that ships well-typed Recharts variants behind one component. Same instinct: enumerate, don't compose.


## Display labels (curator-facing units)

Added as part of the SQCDP v12.2 editor polish (2026-05-10). The Tailwind enum (`xs` / `sm` / `base` / ... / `9xl`) is great for the **storage shape** — it's compact, JIT-friendly, and survives Tailwind upgrades. But it's terrible as a **picker label** for non-developer curators: Office, Photoshop, Figma all speak points (`12 pt` / `18 pt` / `54 pt`). "What is `2xl`?" is a real question; "What is `18 pt`?" is not.

**The rule:** show concrete units in the picker; keep the Tailwind enum in storage.

### Implementation

Add a `SIZE_POINTS: Record<FontSize, number>` map alongside `SIZE_CLASS` and a `formatSizePoints(size): string` helper. Use the helper inside `<SelectItem>` to render the curator-facing label; the Select's `value` stays the enum string so the form's stored shape is unchanged.

```ts
export const SIZE_POINTS: Record<FontSize, number> = {
  xs: 9, sm: 11, base: 12, lg: 14, xl: 15,
  '2xl': 18, '3xl': 23, '4xl': 27, '5xl': 36,
  '6xl': 45, '7xl': 54, '8xl': 72, '9xl': 96,
}

export function formatSizePoints(size: FontSize): string {
  return `${SIZE_POINTS[size]} pt`
}
```

Mapping is `px / 1.333` (1 pt ≈ 1.333 px) rounded to whole points for cleanliness. Curators expect integer values in font pickers; the 0.5-pt error in tiers like `text-3xl` (22.5 pt rounded to 23 pt) doesn't affect rendering — the underlying class is unchanged.

In the editor:

```tsx
{sizeOptions.map((sz) => (
  <SelectItem key={sz} value={sz}>
    {formatSizePoints(sz)}
  </SelectItem>
))}
```

`<SelectItem value={sz}>` keeps `sz` (the enum string) flowing through `field.onChange` → form state → DB. Only the rendered label changes.

### Test the mapping is exhaustive

A quick test asserts the maps stay in sync as new tiers are added:

```ts
it('every key in SIZE_CLASS has a matching SIZE_POINTS entry', () => {
  const sizeKeys = Object.keys(SIZE_CLASS) as FontSize[]
  const pointKeys = Object.keys(SIZE_POINTS) as FontSize[]
  expect(pointKeys.sort()).toEqual(sizeKeys.sort())
})
```

Without this, a future contributor who adds `text-10xl` to `SIZE_CLASS` will silently break the picker (the new tier shows up but gets `${undefined} pt` / `NaN pt` for its label).

### Don't

- **Don't persist the point value** (`"size": 18`). Persisting integers locks you into a px-to-class lookup at render time and breaks the JIT-safe static class map. The label is purely presentational; the storage shape is the enum.
- **Don't expose a free-form numeric input** for arbitrary point values (e.g. "13 pt", "26 pt"). The whitelisted `SIZE_OPTIONS` per field key already encodes "sensible options for this role"; letting curators type a custom value would either generate JIT-invisible arbitrary classes (`text-[13pt]`) or silently bucket the input to the nearest enum.
- **Don't translate to other units** (rem, em, px). Points are the lingua franca of font pickers across desk-publishing software; rem/em are developer concepts and px values would force the curator to think about pixel densities. Pick one unit, stick to it.

### Reusability

The same pattern applies anywhere a Tailwind enum is exposed to a non-developer end user:

- **Spacing** (`gap-1` / `p-2` / `m-4`) — surface as `4 px` / `8 px` / `16 px`.
- **Border radius** (`rounded-sm` / `rounded-md` / `rounded-lg`) — surface as `2 px` / `6 px` / `10 px`.
- **Shadows** (`shadow-sm` / `shadow` / `shadow-lg`) — surface as labels like `Subtle` / `Default` / `Pronounced` (since the curator can't see numeric shadow values).

For the SQCDP v12.2 ship, points was the obvious unit. For other Tailwind dimensions, pick the unit your audience already uses.



## v14 extensions (2026-05-17) — align / letter-spacing / color + header sub-config

The SQCDP v14 editor pass added more dimensions to the per-field override shape AND a top-level `header` sub-config sibling to the per-field keys.

### Per-field additions

```ts
export interface FieldStyle {
  font?: FontFamily         // v12
  size?: FontSize           // v12
  weight?: FontWeight       // v12
  transform?: TextTransform // v12 (now also accepts 'lowercase')
  align?: TextAlign         // v14 — 'left' | 'center' | 'right'
  letterSpacing?: LetterSpacing // v14 — 'tight' | 'normal' | 'wide'
  color?: string            // v14 — free-form hex, see carveout below
}
```

`align` and `letterSpacing` both follow the JIT-safe static class map convention from this pattern note. New maps:

```ts
export const ALIGN_CLASS: Record<TextAlign, string> = {
  left: 'text-left', center: 'text-center', right: 'text-right',
}
export const LETTER_SPACING_CLASS: Record<LetterSpacing, string> = {
  tight: 'tracking-tight', normal: 'tracking-normal', wide: 'tracking-wide',
}
```

### The free-form `color` carveout (intentional break from the static-class rule)

Unlike size / weight / family / transform / align / letterSpacing — which all enumerate a fixed set of utilities — per-field text color is a **free-form hex string** applied via inline `style={{ color: '#RRGGBB' }}` rather than a Tailwind class. The carveout exists because:

1. **A fixed color enum is too restrictive for curators.** Brand colors, category palettes, and contrast tuning all want arbitrary hex input. A 12-color preset would either be too small (curators want exact hex) or too big (12 entries in a dropdown is unscannable).
2. **The JIT-safe alternative would be a Tailwind safelist + a giant `text-{hex}` map** — both add bundle bloat AND constrain the curator unnecessarily. Inline style is the right escape hatch.
3. **Color is the ONLY dimension worth this exception.** Don't generalize it to e.g. arbitrary line-heights or letter-spacing values — those have natural discrete tiers that read well as a `<ToggleGroup>`.

Resolver:

```ts
export function fieldColor(
  style: FieldStyle | undefined,
  defaults: Required<FieldStyle>
): string | undefined {
  const raw = style?.color ?? defaults.color
  if (!raw) return undefined
  return /^#[0-9A-F]{6}$/i.test(raw) ? raw : undefined
}
```

Malformed input falls through to `undefined` so half-typed input doesn't paint the field with a bogus color while the curator is mid-type. The card renderer applies the result via `style` and a fallback (e.g. for the primary value, the metric's `colorHex` if `fieldColor` returns nothing). The classes returned by `fieldClasses` continue NOT to include any color class — the inline style wins.

### Top-level `header` sub-config

Sibling to the per-field keys (NOT nested inside `title`). Models the colored category band geometry, not the title text inside it:

```ts
export interface StyleConfig {
  title?: FieldStyle
  subtitle?: FieldStyle
  primary?: FieldStyle
  header?: HeaderConfig   // v14
}
export interface HeaderConfig {
  height?: 'compact' | 'normal' | 'tall'
  align?: 'left' | 'center'
  showIcon?: boolean
}
```

Why it's a sibling: the height / alignment / icon-visibility affect the **band**, not the title typography. Modeling these as fields of `title` would conflate two concerns. Curators who want a tall band but small uppercase title need both knobs to live separately.

`headerClasses(config, density)` returns the density-aware padding utility (a value from a static `HEADER_HEIGHT_CLASS[density][height]` map). `headerOuterClasses` returns the outer `justify-*` utility for the flex row. `headerGroupClasses` returns the inner title-group `flex-1 justify-center text-center` only when alignment is `center` — so the right-anchored pencil affordance keeps its slot while the icon + title center themselves inside the remaining row.

### `parseStyleConfig` updates

Defensively narrows the new keys + drops bogus enum values. Specifically:

- `align` only accepted if `in ALIGN_CLASS`.
- `letterSpacing` only accepted if `in LETTER_SPACING_CLASS`.
- `color` only accepted if it matches `/^#[0-9A-F]{6}$/i`; normalized to upper-case.
- `header.height` / `header.align` / `header.showIcon` similarly narrowed.
- Unknown keys at any level drop silently — a forward-compat client landing a `header.shadow` field that an older render doesn't recognise simply renders the v14 default rather than crashing.

### Curator UX

The v14 `<FieldStyleRow>` keeps Family / Size / Weight on the always-visible top row and tucks the v14 additions (transform / align / letter-spacing / color) behind a **"More" disclosure** so the default scan stays clean. The header sub-config gets its own section in the Style tab with `<ToggleGroup>`s for height + align and a `<SwitchRow>` for showIcon.

### Don't

- **Don't extend `color` to other dimensions.** The carveout is specifically for free-form hex text color. Other dimensions (line-height, font-stretch, custom typefaces) should follow the static-class-map convention.
- **Don't bury the recommended palette in a Popover.** The SQCDP `colorHex` palette is one-click discoverable as a visible strip directly in the section body. Hiding it behind a popover trigger adds a click for the most common operation.
- **Don't paint a contrast warning that errors out a save.** The contrast badge under the color override is *informational* (color + soft text), not blocking. Curators may pick a low-contrast color for stylistic reasons (e.g. branding); we surface the trade-off rather than enforce it.
- **Don't centre-align the header by switching to `justify-center` on the outer flex row.** The edit pencil sits in the right slot and `justify-center` puts both children (title-group + pencil) on a single centred cluster. The split outer / inner classes (`headerOuterClasses` + `headerGroupClasses`) keep the pencil anchored and centre only the title group.
