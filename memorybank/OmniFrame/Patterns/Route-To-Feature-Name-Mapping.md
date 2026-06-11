---
tags: [type/pattern, status/active, domain/frontend]
created: 2026-05-07
---
# Pattern: Route-to-Feature-Name Mapping (`resolveFeature()`)

## Purpose / Context

A URL pathname is a poor user-facing label. `"/rf-interface/cycle-count/abc-123-def-456"` is correct, but a supervisor scanning a panel of 12 active operators wants to see `"RF: Cycle Count"`. This pattern centralises the URL-to-label translation so any supervisor surface that wants to render "who's working on what" can ask a single resolver.

First use — `<LiveOperatorStatus>` (Active Operators panel) consuming the scoped re-enabled `current_page` field on `PresenceUser`. See [[ADR-Scoped-CurrentPage-In-ActiveOperators]] + [[Re-Enable-CurrentPage-In-ActiveOperators]].

## When to use

Apply this pattern when:

- You have a per-user / per-session pathname (typically from `useLocation()` or a presence broadcast) AND
- A supervisor / admin / monitoring surface needs to render that pathname as a human-friendly label AND
- The surface might want to render an icon alongside the label (consistent visual language across pages) AND
- You want to keep raw URLs available for hover/debug tooltips without showing them by default.

Don't use this pattern when:

- The user-facing surface is the URL itself (e.g. a browser-history-style "recent pages" debugging tool). Just render the path.
- You only care about ONE specific route (`if (pathname === '/rf-interface') …`). Premature abstraction.
- The surface already shows a screen TITLE (the same info, but in-page). Don't double-label.

## Anatomy

```typescript
interface RouteFeature {
  pattern: RegExp           // anchored, tested against pathname
  label: string             // human-readable, conversational
  sublabel?: string         // optional secondary context
  icon?: string             // string name; consumer maps to component
}

const ROUTE_FEATURES: readonly RouteFeature[] = [
  // ORDER MATTERS — most-specific patterns first.
  { pattern: /^\/admin\/sap-testing/, label: 'SAP Testing', icon: 'TestTube' },
  { pattern: /^\/admin/,              label: 'Admin',       icon: 'Settings' },
  // …
]

export function resolveFeature(pathname: string | null | undefined):
  ResolvedFeature | null {
  if (!pathname) return null
  for (const f of ROUTE_FEATURES) {
    if (f.pattern.test(pathname)) {
      return { label: f.label, sublabel: f.sublabel, icon: f.icon, raw: pathname }
    }
  }
  return { label: 'Unknown', raw: pathname, icon: 'HelpCircle' }
}
```

Reference implementation: [`src/lib/presence/route-features.ts`](../../src/lib/presence/route-features.ts).

## Design rules

### 1. Order matters — most-specific patterns first

The loop returns the FIRST matching entry. So `/admin/sap-testing` MUST appear BEFORE `/admin`, otherwise every admin sub-route resolves to plain "Admin".

### 2. Anchor with `^`

Unanchored regexes (`/admin/`) cross-match unrelated paths (`/something/admin/x`). Always start with `^`.

### 3. Strip layout-group segments from your test data

TanStack Router file-based routes use `_authenticated`, `(auth)`, `(errors)` as layout groups; **these are stripped from `location.pathname`**. So map against `/apps/inventory`, NOT `/_authenticated/apps/inventory`. Cross-check your mapping against `routeTree.gen.ts`'s `FileRoutesByFullPath` interface — it lists the exact pathnames TanStack Router will produce.

### 4. Never throw on unknown input

Return `{ label: 'Unknown', icon: 'HelpCircle', raw }`. Throwing breaks render passes; silently swallowing the input hides missing-mapping bugs. "Unknown" + the raw pathname (visible via tooltip) makes a missing entry actionable.

### 5. Icons as STRINGS, not component imports

The mapping module stays dependency-free — the consumer chooses how to resolve `icon: 'Boxes'` to a component. Two reasons:
- Tree-shaking: a non-React consumer (e.g. an analytics aggregator) shouldn't pull in `lucide-react`.
- Bundle size: icon imports are NOT tree-shaken if you put them in the mapping file (one icon per entry × 50 entries = a chunk-bloating import). Let the consumer pick a small subset that's relevant to its surface and fall back to a default for the rest.

The canonical fallback resolver in `<LiveOperatorStatus>`:

```typescript
const FEATURE_ICONS: Record<string, LucideIcon> = {
  // Only the icons this surface actually wants to display.
  Boxes, Truck, Smartphone, Settings, Headset, /* … ~12 entries */
}
function resolveIcon(name: string | undefined): LucideIcon {
  if (!name) return Compass
  return FEATURE_ICONS[name] ?? Compass
}
```

Unknown icon names render as `Compass` ("navigation") rather than crashing.

### 6. Keep `raw` on the result

The resolved object always carries the raw pathname. Surfaces typically render the LABEL by default and expose the RAW path on hover (Radix tooltip / title attr). Useful both as a UX affordance for supervisors debugging "where exactly was Sarah?" and as a fallback display when the resolver returns `"Unknown"`.

## Privacy interaction

If the source of the pathname is a presence broadcast (as in the [[ADR-Scoped-CurrentPage-In-ActiveOperators]] case), this pattern collaborates with the ADR's privacy contract:

- The RAW pathname is BROADCAST (so any consumer that wants different label resolution can pick its own).
- The CONSUMER renders the LABEL, not the raw pathname, by default. URL-encoded entity IDs are collapsed at render time.
- The raw pathname is still available behind a hover affordance for in-RBAC supervisors.

This is privacy-in-depth: if the panel ever IS shown to an unauthorised user (bug), they see "Inventory" instead of "/apps/inventory/lots/abc-123". The label exposes less than the URL would.

## Anti-patterns to avoid

- **One regex per feature spread across multiple files.** Centralise in one mapping module so a new top-level route has ONE place to add an entry.
- **Resolving on every keystroke.** The pattern is pure + cheap, but if your surface re-renders 60 times a second with a stable pathname, memoise the call. The reference impl is safe to call per-render.
- **Coupling labels to permission strings.** Labels are user-facing copy. Permissions are wire strings. Don't reuse one for the other; they evolve independently.
- **Allowing the consumer to override individual labels.** If supervisor surface A wants "RF: Cycle Count" and supervisor surface B wants "Cycle Count (RF)", that's a UX inconsistency — fix it in the mapping file, not via per-consumer overrides.
- **Adding entries from `routeTree.gen.ts` mechanically.** That file is auto-generated and includes layout group prefixes. Always strip groups + double-check against `useLocation().pathname` from a real render.

## Related

- [[ADR-Scoped-CurrentPage-In-ActiveOperators]] — the decision that drove this pattern's first use.
- [[Re-Enable-CurrentPage-In-ActiveOperators]] — the implementation note.
- [[Realtime-Presence-Browser-Hardening]] — Privacy considerations section that this pattern composes with.
- [[Components/PresenceUI - Status Indicators]] — the consumer surface.
