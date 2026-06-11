---
tags: [type/debug, status/active, domain/frontend, omnibelt, performance]
created: 2026-05-31
---
# Fix — OmniBelt flashes on cold load while org-disabled

## Symptom
With the org kill switch set to OFF (`settings.system.omnibelt.enabled = { enabled: false }`),
the launcher still **appeared briefly on the first page load of a session and
then vanished**. Steady-state navigation was fine — only a hard reload / new tab
reproduced it.

## Root cause — fail-OPEN during the loading window
`useOmnibeltVisibility` Layer 5 only hid on an *explicit* `orgEnabled === false`:

```ts
if (orgEnabled === false) return { visible: false, reason: 'org_disabled' }
```

The org-enabled value comes from a TanStack Query
(`['omnibelt','settings','system.omnibelt.enabled']` → `OmnibeltSettingsService.getEnabled()`).
On a cold load that query is in flight, so `orgEnabled === undefined` →
the check fell through → **launcher rendered**. When the query resolved to
`false`, Layer 5 fired and the launcher **unmounted**. That pending → shown →
resolved-false → removed sequence *is* the flash. The original comment chose
this fail-open to "avoid a flash of missing chrome on first paint" — but for a
disabled org it produced the worse, opposite artifact.

The query's `staleTime: 5min` / `gcTime: 30min` is why only the *first* load of
a session flashed: once resolved, the cached `false` keeps every later render
hidden.

## Fix — fail CLOSED + persist a last-known seed
`src/features/omnibelt/hooks/useOmnibeltVisibility.ts`:

1. **Fail closed:** render only once positively confirmed enabled —
   `if (orgEnabled !== true) return { visible: false, reason: 'org_disabled' }`.
   `false` (kill) and `undefined` (pending) both stay hidden. The service layer
   already fails *open* on a missing row / network error (returns `true`), so
   this only fails closed in the brief pre-resolution window — never on a
   transient blip.
2. **Synchronous seed:** persist the real fetched value to
   `localStorage['omniframe.omnibelt.org-enabled.v1']` and feed it back via
   `placeholderData: readLastKnownOrgEnabled` (NOT `initialData` — a real fetch
   still fires so a freshly flipped switch takes effect this session). Repeat
   loads decide on the first frame: an enabled org paints with no flash *and* no
   fade-in; a disabled org never paints.

Net trade: an enabled org's *first-ever* load (no cached seed) now shows the
launcher one frame later (a smooth fade-in once the query resolves) instead of
showing it immediately. A fade-in is unobjectionable; a flash-out is not.

## Latent test bug uncovered
`useOmnibeltVisibility.test.tsx`'s "still loading" case called
`setup({ orgEnabled: undefined })`, but the helper's destructuring default
(`orgEnabled = true`) coerces an explicit `undefined` back to `true` — so the
test had been silently asserting the *enabled* path, which is exactly why the
fail-open behavior went unnoticed. The test now drives the mock directly
(`useQuery.mockReturnValue({ data: undefined })`) to genuinely exercise the
pending state.

## Related perf changes shipped same turn
- `OmniBeltHost` now mounts the side-effecting hooks (`useOmnibeltJobs` WS
  aggregator, `useOmnibeltConfigInvalidator` WS handler, `useOmnibeltKeyboard`
  global listener) inside a `<OmniBeltActiveSurface />` child that renders ONLY
  when visible — so a disabled / route-excluded / native build no longer opens a
  `workServiceWs` connection or a `window` keydown listener on every page.
- Default skin (`skystrip`) is now statically imported in `SKIN_REGISTRY` so the
  resting chrome paints on the first frame instead of after a lazy-chunk
  round-trip + Suspense gap. Alternate skins stay `React.lazy`.

## Verification
- 264 omnibelt unit tests green; `tsc -b` clean; ESLint clean on changed files.
- The pre-existing `storage.getItem is not a function` unhandled rejection in
  `useOmnibeltConfigInvalidator.test.tsx` reproduces on stashed (original) code —
  unrelated to this fix.

## Related
- [[OmniBelt-Floating-Launcher]] — §"Mount discipline" lists the six-layer gate
- [[OmniBelt - Site Tool Launcher]] — component anatomy
- [[Fix-OmniBelt-Settings-RLS-Kill-Switch]] — the org kill-switch read path
- [[Realtime-Presence-Browser-Hardening]] — sibling kill-switch with the same
  fail-closed-while-loading principle
