---
tags: [type/component, status/active, domain/frontend, domain/backend]
created: 2026-05-24
---
# OmniBelt — Site Tool Launcher

Site-wide floating tool launcher. Mounted on every authenticated,
non-kiosk route. Drag-positionable, morphs between three collapse
states, and integrates background-job status. Configurable per-user;
admin-curated per role.

## Purpose

One canonical surface for the long tail of operator/admin micro-tools
(SAP status, quick note, inventory lookup, background jobs, build info,
help, settings shortcut, quick pick). Replaces the scatter of toasts,
agent panels, and per-page status badges with a single morphing widget.

See [[ADR-OmniBelt-Site-Chrome]] for the architectural reasoning,
[[OmniBelt-Floating-Launcher]] for the reusable pattern, and the
canonical spec at `docs/superpowers/specs/2026-05-24-omnibelt-design.md`.

## Mount point

[`src/routes/__root.tsx`](../../../src/routes/__root.tsx) between
`<Outlet />` and `<Toaster />`. Self-gates via
`useOmnibeltVisibility()`.

Excluded routes: `/rf-interface/*`, `/rf-signin`, `/timeclockapp/*`,
`/customer-portal/*`, `(auth)/*`, error pages, plus blanket exclusion
when `Capacitor.isNativePlatform()`.

## File layout

```
src/features/omnibelt/
├── OmniBeltHost.tsx                 # mount + skin router + route gate
├── store/omnibeltStore.ts           # Zustand + persist
├── hooks/
│   ├── useOmnibeltBootstrap.ts      # TanStack Query → bootstrap endpoint
│   ├── useOmnibeltJobs.ts           # workServiceWs JobProgress
│   ├── useOmnibeltConfigInvalidator.ts
│   ├── useOmnibeltKeyboard.ts       # Cmd/Ctrl+B
│   ├── useOmnibeltPosition.ts
│   ├── useOmnibeltVisibility.ts     # kill-switch evaluation
│   ├── useOmnibeltTelemetry.ts      # batched event emitter
│   └── useOmnibeltCollisionAvoidance.ts
├── skins/{pill,orb,skystrip}/       # lazy-loaded skin components
├── panel/                           # shared expanded Panel
├── tray/                            # Mach 3 status tray + halo rings
├── tools/registry.ts                # ToolDef + 8 v1 definitions
└── lib/{anchors,collision,routeGate,routeClass,motion,telemetry-client}.ts
```

## State (Zustand)

Tier 1 global UI store per [[State-Management-Patterns]]. Per-user
localStorage key: `omniframe.omnibelt.${userId}.v1`.

**Persisted:** `collapseState`, `positionByRoute`, `skin`,
`pinnedToolIds`, `mach3Behavior`, `autoHideAfterSeconds`, `userHidden`.

**Runtime-only:** `activeJobs`, `panelOpen`, `trayOpen`, `dragging`.

## Public surface

No props. Mount once, self-configures from the bootstrap query:

```tsx
// src/routes/__root.tsx
<Outlet />
<OmniBeltHost />
<Toaster />
```

## Backend

- **Endpoint:** `GET /api/omnibelt/bootstrap` (FastAPI proxy →
  `rust-dashboard-service /omnibelt/bootstrap`, 30s Redis cache, read
  pool via [[Supabase-Read-Replica-Routing]] migration adding
  `read_pool` to `rust-dashboard-service`).
- **Writes:** `POST /api/omnibelt/prefs`, `POST /api/omnibelt/events`,
  `POST /api/admin/omnibelt/role-config`,
  `POST /api/admin/omnibelt/kill-switch`. All to primary.
- **Realtime invalidation:** new `WsEvent::OmnibeltConfigChanged`
  variant on `rust-work-service /ws`; PgListener fires from the
  `omnibelt_role_config` trigger.

## Data model

- `omnibelt_role_config` — admin per-role default belts (org-scoped,
  admin-write RLS).
- `omnibelt_user_prefs` — per-user customization (self-only RLS).
- `omnibelt_tool_events` + `omnibelt_tool_events_24h_mv` — v1-rich
  telemetry (insert-own RLS; admin-read).
- `settings.system.omnibelt.enabled` / `system.omnibelt.allow_list` —
  org-wide kill switch + allow-list (existing `settings` table).
- New permission resource: `omnibelt` (defaulted to `admin` +
  `superadmin`).

## Visual skins

Three skins ship in v1:

| Skin | Default? | Visual |
|---|---|---|
| `pill` | ✓ | Horizontal glass pill, free-floating, mini-orb collapse |
| `orb` |   | Corner FAB with radial fan-out, capped ~10 tools |
| `skystrip` |   | Top-center Dynamic-Island morph |

User selects in profile preferences. State machine is identical; only
the rendered shell differs. Cross-skin transitions also morph because
each skin renders `<motion.div layoutId='omnibelt-host'>`.

## Tri-state collapse

```
[Orb 44px] ↔ [Pill ~420×56] ↔ [Panel full-grid]
   ↓ idle 5min                          ↑ Cmd+B / click
[Nub 6px edge sliver]
```

Each transition is a single `layoutId` morph (see
[[OmniBelt-Floating-Launcher]] for the recipe).

## Background-job status (Mach 3)

Subscribes to `workServiceWs` `JobProgress` events; renders a halo ring
per active job around the orb/pill. Color per job type (sap_import,
sap_export, agent_job, report, scheduled, other). Default behavior:
`halo_plus_autoexpand` — when the current user starts a new job, the
Status Tray auto-expands for 4 seconds, then auto-collapses.

Three alternate behaviors selectable in prefs: `halo_only`,
`halo_plus_morph`, `halo_plus_tray_pinned`.

## Position system

12 anchor positions (4 corners TL/TR/BL/BR + 4 edge midpoints
TC/BC/ML/MR + 4 edge nubs NUB_L/NUB_R/NUB_T/NUB_B) plus 2 modes
(FREE-float, PINNED). Drag with framer-motion; `onDragEnd` snaps to
nearest position within 32px deadzone. Per-route memory keyed by route
**class**, not exact pathname.

Collision avoidance reads `NotificationsPanel` bell rect and
`Sonner` toaster position; offsets 56px on ≥4px overlap.

## Keyboard

- `Cmd/Ctrl+B` — toggle visibility / panel state
- `Esc` — close panel
- `/` — focus search (when panel open)
- `Tab` / `Shift+Tab` — cycle tiles
- `Enter` — launch focused tool

Does NOT use `Cmd+K` (already double-bound by `SearchProvider`'s
`CommandMenu` and `AuthenticatedLayout`'s `CommandPalette` — see
[[Layout - App Shell]]).

## Admin dashboard

New sidebar entry "OmniBelt" under `Administration` group in
[`src/components/layout/data/sidebar-data.ts`](../../../src/components/layout/data/sidebar-data.ts),
sibling to "System Settings". Route: `/admin/omnibelt`.

5 tabs:
1. **Overview** — kill switch state, env-override status, live active
   user count, top tools sparkline, recent admin changes.
2. **Tools & Allow-list** — checkbox grid by category.
3. **Role Defaults** — drag-drop per-role belt editor.
4. **Analytics** — sparklines + heatmaps + funnel from the MV.
5. **Audit** — paginated admin change log.

Reads via `supabaseRead`; mutations via primary. New `omnibelt`
permission resource gates access.

## v1 tool roster (8)

| ID | Category | Surface |
|---|---|---|
| `quick_pick` | operations | route → `/operations/pick/quick` |
| `sap_status` | operations | panel shell |
| `inventory_lookup` | operations | panel shell |
| `background_jobs` | self | panel shell |
| `quick_note` | self | panel shell (markdown scratchpad) |
| `build_info` | self | panel shell (git SHA, hash, timestamps) |
| `settings_shortcut` | self | route → `/settings` |
| `help_docs` | help | route → `/help` |

Tool registry is bundle-time. Per-tool RBAC via
`usePermissionStore.hasPermission(action, resource)` — same shape as
[`CommandPalette`](../../../src/components/layout/command-palette.tsx).

## Performance at scale

Designed for 2,000 concurrent users (Tier A target):

- 3-layer cache: TanStack Query (5min staleTime) → Rust + Redis (30s
  TTL) → Postgres replica.
- Pref writes debounced 500ms; batched; optimistic; rolled back on
  error; hard cap 2/sec/user.
- Telemetry batched 10s; hard cap 50/min/user (client + server Redis
  sliding window).
- Zero new `setInterval` / `refetchInterval` — invalidation via
  `WsEvent::OmnibeltConfigChanged`.
- Halo re-renders gated by 1%-progress diff.

Bundle: `feature-omnibelt` chunk <60 KB gzip; alt skins ~15 KB each
lazy-loaded; tool shells lazy-loaded on first open.

## Realtime hygiene

- Job stream + config hot-reload via existing `workServiceWs`
  singleton. **No new Supabase channels** per [[realtime-policy]].
- Matching `WsEventType` enum entry in
  [`src/lib/work-service/types.ts`](../../../src/lib/work-service/types.ts).

## Accessibility

`<MotionConfig reducedMotion='user'>` wraps the subtree. Orb/pill is
`role='button'` + `aria-expanded`; panel is `role='dialog'
aria-modal='false'`. Tool tiles are `role='grid' / role='gridcell'`.
Halo `<title>` per ring. Status tray uses `aria-live='polite'`.
Keyboard-only operation never requires drag.

## Telemetry events

- `tool_launch`, `tool_pin`, `tool_unpin`, `tool_hide`
- `panel_open`, `panel_close`
- `tray_expand`, `tray_collapse`
- `skin_change`, `position_change`
- `belt_visible`, `belt_hidden`

24h materialized view refreshed via `pg_cron` every 5 minutes.

## Related

- [[ADR-OmniBelt-Site-Chrome]] — decision record
- [[OmniBelt-Floating-Launcher]] — pattern
- [[Implement-OmniBelt-MVP]] — implementation log (progressive)
- [[Layout - App Shell]] — sibling chrome
- [[Components/NotificationsPanel]] — spatial neighbor
- [[Supabase-Read-Replica-Routing]] — read-path discipline
- [[Sidebar-Pin-Lock]] — sibling pin/persistence pattern
