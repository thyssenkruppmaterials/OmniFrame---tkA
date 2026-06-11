---
tags: [type/decision, status/active, domain/frontend, domain/backend, domain/database, domain/infra]
created: 2026-05-24
---
# ADR — OmniBelt Site Chrome

## Status

**Approved 2026-05-24** — design spec at
`docs/superpowers/specs/2026-05-24-omnibelt-design.md`. Implementation
tracked in [[Implement-OmniBelt-MVP]].

## Context

OmniFrame has accumulated a long tail of operator and admin micro-tools
that don't deserve their own page but are too important to leave buried in
sub-routes: SAP status, inventory lookup, quick note, background-job
status, build info, settings shortcut, help. The existing surfaces don't
fit:

- The dual `Cmd+K` palettes ([[Layout - App Shell]] + global
  `SearchProvider`) are nav-search, not action launchers.
- The top-right [[Components/NotificationsPanel]] bell is a passive
  notification feed.
- The sidebar is route-tree, not task-tree.

A site-wide floating launcher is the right primitive — Apple Dynamic
Island, macOS Dock, and Linear's Cmd+K-on-steroids all converge here.

The platform also needs the launcher to integrate **live background-job
status** (SAP imports, agent jobs, scheduled reports) since these long-
running tasks today have no canonical surface; they're scattered across
toasts, the agent panel, and per-page progress bars.

Finally, we have to design for **2,000 concurrent users** (Tier A target
in [[ADR-Scaling-Roadmap-To-100k-Concurrent]]) without adding new
realtime channels (blocked by [[Realtime-Presence-Browser-Hardening]] /
[[realtime-policy]]) or saturating Postgres on bootstrap.

## Decision

### 1. Mount in `__root.tsx` between `<Outlet />` and `<Toaster />`

OmniBelt is one of the few surfaces that needs to live OUTSIDE the
authenticated layout but inside the global provider stack (theme, search,
toast settings). Mounting at the root with a self-gating route check
keeps it portable across future non-authenticated surfaces that might
need it.

Excluded route classes: `/rf-interface/*`, `/rf-signin`,
`/timeclockapp/*`, `/customer-portal/*`, all `(auth)/*`, error pages,
plus a blanket exclusion when `Capacitor.isNativePlatform()`.

### 2. Visual: "Mach Pill" with skin polymorphism

Default skin is the **Pill Dock** (Mockup 2) with a **tri-state collapse**:
Mini-Orb (44px) → Pill (~420×56) → Panel (full grid). Each transition is
a single `framer-motion` `layoutId` morph, not a crossfade.

Two alternate skins ship in v1 — **Orb** (Mockup 1 radial fan) and **Sky
Strip** (Mockup 3 top-center Dynamic-Island morph). Users pick in profile
preferences; the underlying state machine is identical.

### 3. Hybrid ownership

Admins publish per-role default belts via `omnibelt_role_config` and a
master allow-list via `settings.system.omnibelt.allow_list`. Users pin,
reorder, and hide tools within the role-allowed pool via
`omnibelt_user_prefs`. Merge logic runs client-side; unknown tool IDs
are dropped silently so admins can add tools gradually.

### 4. Layered fail-closed visibility gate (6 checks)

Evaluated in order; first hit hides the launcher. Three of the six are
operator-controllable **kill switches** (env, org, user); the other
three are environmental gates (Capacitor native, route exclusion, auth
state).

1. `VITE_OMNIBELT_DISABLED=true` — env, build-time (kill switch)
2. `Capacitor.isNativePlatform()` — environmental gate
3. Route exclusion list — environmental gate
4. `isAuthenticated === false` — environmental gate
5. `settings.system.omnibelt.enabled === false` — org-level (kill switch)
6. `omnibelt_user_prefs.user_hidden === true` — per-user (kill switch)

### 5. Background-job integration via `workServiceWs`

OmniBelt subscribes to the existing `workServiceWs` singleton for
`JobProgress` events. **No new Supabase realtime channels** — honors
[[realtime-policy]]. Default behavior is "halo + auto-expand for 4s when
the current user starts a new job."

### 6. `rust-dashboard-service` powers the bootstrap

A new `GET /omnibelt/bootstrap` endpoint returns prefs + role config +
allow-list + tool registry meta + initial active jobs in a single
30-second-cached call. Reads route through a new `read_pool` (mirroring
the [[Supabase-Read-Replica-Routing]] migration on `rust-core` and
`rust-work`). Hot-reload on admin changes via a new
`WsEvent::OmnibeltConfigChanged` variant + Postgres `NOTIFY` trigger.

### 7. Dedicated admin dashboard

New sidebar entry "OmniBelt" under `Administration`, at `/admin/omnibelt`,
with a 5-tab dashboard (Overview / Tools / Role Defaults / Analytics /
Audit). Backed by a new `omnibelt` permission resource defaulted to
`admin` and `superadmin` roles. All reads via `supabaseRead`; mutations
via primary.

### 8. v1-rich analytics

New `omnibelt_tool_events` table + 24h materialized view refreshed via
`pg_cron` every 5 minutes. Frontend emits batched events (10s rolling
window, 50/min hard cap, sendBeacon on unload). Admin Analytics tab
reads the MV via replica.

### 9. Keyboard: `Cmd/Ctrl+B`

Not `Cmd+K` — that's already double-bound by the global `CommandMenu`
and the authenticated `CommandPalette` ([[Layout - App Shell]]).
Consolidating those palettes is a separate effort tracked outside this
ADR.

### 10. Bundle slice + lazy-load discipline

`feature-omnibelt` in `manualChunks` (target <60 KB gzip). Alt skins and
each tool shell lazy-loaded. No new always-on `setInterval` /
`refetchInterval`.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| **Compass Orb** (Mockup 1) as default | Caps elegantly at ~10 tools; doesn't scale to the long tail OmniFrame will accumulate. Kept as a selectable skin. |
| **Sky Strip** (Mockup 3) as default | Top-center conflicts with breadcrumbs; status-first framing buries the launcher metaphor. Kept as a skin; status integration borrowed for Mach 3. |
| **Single ownership: personal pinboard** | Doesn't scale operationally — admins need to gate which tools floor operators see. |
| **Single ownership: role-curated only** | Removes user customization — kills delight + adoption. |
| **Tab inside `system-settings`** instead of dedicated dashboard | Buries a top-level surface; user explicitly asked for sidebar promotion. |
| **Reuse Cmd+K** | Already double-bound; semantic collision (navigation vs actions vs tools). |
| **Pure-Supabase bootstrap (skip Rust dashboard endpoint)** | Acceptable at <100 users; at 2k users + Rust+Redis caching delivers ~10–30 ms p95 reads vs ~50–150 ms PostgREST. |
| **New Supabase realtime channel for `OmnibeltConfigChanged`** | Blocked by [[realtime-policy]]; using `rust-work-service /ws` is the canonical migration template. |
| **Build the v1.5 telemetry now vs simple aggregates** | User chose v1-rich at the question prompt; the marginal cost (~1.5 days) buys real dashboard value at launch. |
| **Cmd+J / Cmd+. / backslash for shortcut** | Cmd+J is dev-tools convention; Cmd+. is system-level cancel on macOS; backslash conflicts with shell muscle memory. Cmd+B is unused. |

## Consequences

### Positive

- One canonical surface for the long tail of operator/admin tools.
- Status-first UX for long-running jobs — replaces toast spam.
- Per-role admin control + per-user customization simultaneously.
- Layered visibility gate lets us shut OmniBelt off globally
  (env build flag), org-wide (settings row), or per-user (prefs row)
  without code changes; environmental gates (route / Capacitor /
  auth) cover the non-toggleable surfaces.
- Builds the Rust-dashboard-service `read_pool` (gap in
  [[Supabase-Read-Replica-Routing]]) as a side effect.
- Telemetry table gives us org-wide tool-usage signal for future
  product decisions.
- Honors [[realtime-policy]] cleanly — extends `workServiceWs` rather
  than adding a Supabase channel.

### Negative

- New surface to maintain — bundle, motion, RBAC, A11y, analytics.
- Adds a new permission resource (`omnibelt`) — requires role-table
  default-grants in the foundation migration.
- Per-route position memory increases `omnibelt_user_prefs` row size
  modestly (≤10 route classes, bounded).
- Live halo subscribes every user to `JobProgress` — already part of
  the existing WS payload but slightly more re-renders. Mitigated by
  the 1%-progress diff threshold.

### Neutral

- Cmd+K palette consolidation deferred — not made worse, not made better.

## Related

- [[Layout - App Shell]]
- [[AppProviders - Provider Stack]]
- [[Components/NotificationsPanel]]
- [[State-Management-Patterns]]
- [[Sidebar-Pin-Lock]]
- [[Cinematic-Tab-Rotation]]
- [[Realtime-Presence-Browser-Hardening]]
- [[Supabase-Read-Replica-Routing]]
- [[ADR-Scaling-Roadmap-To-100k-Concurrent]]
- [[ADR-Dispatcher-Shell-WS-Handler]]
- [[ADR-WsEvent-Typed-vs-Envelope]]
- [[Roadmap-Rust-WS-Unlocks]]
- [[realtime-policy]]
- [[OmniBelt-Floating-Launcher]] (pattern)
- [[OmniBelt - Site Tool Launcher]] (component)
- [[Implement-OmniBelt-MVP]] (implementation log)
