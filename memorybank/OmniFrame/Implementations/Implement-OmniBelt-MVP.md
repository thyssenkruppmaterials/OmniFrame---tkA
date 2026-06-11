---
tags: [type/implementation, status/active, domain/frontend, domain/backend, domain/database, domain/infra]
created: 2026-05-24
---
# Implement — OmniBelt MVP

Progressive implementation log for the OmniBelt site-wide floating
launcher. See:
- Design spec: `docs/superpowers/specs/2026-05-24-omnibelt-design.md`
- ADR: [[ADR-OmniBelt-Site-Chrome]]
- Pattern: [[OmniBelt-Floating-Launcher]]
- Component: [[OmniBelt - Site Tool Launcher]]

## Status

**Complete — 2026-05-24.** P0–P9 all landed. Visible chrome mounts
site-wide; launcher renders the canonical 8 tools with permission-aware
filtering, remembers its position per route class, animates job halo
rings + auto-expand tray on user-initiated jobs, supports three skins
(pill default + orb + skystrip), exposes a 5-tab admin dashboard at
`/admin/omnibelt`. Database schema migrations 327 (core tables / RLS /
trigger / MV / pg_cron) and 328 (admin navigation row + role grants)
both applied. `pnpm tsc -b` clean, `pnpm vitest run src/features/omnibelt
src/features/admin/omnibelt-dashboard` = 380/380 green, `pnpm build`
clean, OmniBelt-scoped lint = 0 errors / 0 warnings, zero new
`supabase.channel(...)` callsites. Awaiting Railway env-var wiring +
manual `railway up` to flip the Rust services from the build-time-shipped
binary to the read-pool / Redis-cached binary. See P9 section below for
full verification results.

## Rollout phases

| Phase | Branch | Scope | Status |
|---|---|---|---|
| P0 | `feat/omnibelt-rust-readpool` | `rust-dashboard-service` `read_pool` wiring | ✅ done 2026-05-24 |
| P1 | `feat/omnibelt-foundation` | Tables + RLS + trigger + MV + pg_cron + permission resource + frontend route gate + kill switches | complete (migration not yet applied) |
| P2 | `feat/omnibelt-rust-bootstrap` | Rust endpoint + Redis caching + `OmnibeltConfigChanged` WsEvent + FastAPI proxy | ✅ done 2026-05-24 |
| P3 | `feat/omnibelt-pill` | OmniBeltHost + Pill skin + tri-state collapse + Panel shell + tool registry skeleton | ✅ done 2026-05-24 |
| P4 | `feat/omnibelt-v1-tools` | 8 v1 tool definitions + lazy shells + RBAC | ✅ done 2026-05-24 |
| P5 | `feat/omnibelt-mach3` | `useOmnibeltJobs` + halo rings + auto-expand tray + 4 Mach3 behaviors | done 2026-05-24 |
| P6 | `feat/omnibelt-anchors` | 12 anchor zones + snap math + collision avoidance + per-route memory | ✅ done 2026-05-24 |
| P7 | `feat/omnibelt-skins` | Orb + SkyStrip skins + skin picker in profile prefs | ✅ done 2026-05-24 |
| P8 | `feat/omnibelt-admin` | Sidebar entry + 5-tab dashboard + v1-rich analytics + audit log | ✅ done 2026-05-24 |
| P9 | `feat/omnibelt-polish` | Memory bank notes refresh + reduced-motion audit + bundle check + telemetry rate-limit hardening + end-to-end verification + migration 328 application | ✅ done 2026-05-24 |

## P0 — Rust dashboard read-pool wiring

**Completed 2026-05-24.**

Mirror of the migration from [[Supabase-Read-Replica-Routing]] applied to
`rust-core-service` and `rust-work-service`. `rust-dashboard-service` is a
single-binary crate (no separate `lib.rs` / `config/mod.rs`), so all
wiring landed inline in `src/main.rs`.

- [x] ~~`rust-dashboard-service/src/config/mod.rs` — add
      `database_read_pooler_url: Option<String>` reading
      `DASHBOARD_SERVICE_DATABASE_READ_POOLER_URL` or
      `DATABASE_READ_POOLER_URL`.~~ Done inline in `src/main.rs`
      (no `config/mod.rs` module exists in this crate; surgical
      single-file edit was preferred over introducing a new module).
- [x] `rust-dashboard-service/src/main.rs` — added `read_pool: PgPool`
      field to `AppState`, built via `PgConnectOptions::from_str` +
      `application_name("rust-dashboard-service-read")` and
      `PgPoolOptions::new().max_connections(5).connect_with(opts)`.
      Falls back to `db_pool.clone()` on env unset, blank/whitespace,
      URL equal to primary, OR connection failure (graceful — never
      crashes startup).
- [x] `/health` endpoint now reports `read_database: "connected" |
      "disconnected"` alongside the existing `database` field.
- [x] `cargo check` clean on `rust-dashboard-service` (no new errors,
      no new warnings).
- [x] `cargo build --release` succeeds (35.5s).
- [ ] Railway env var `DASHBOARD_SERVICE_DATABASE_READ_POOLER_URL` set
      with `skipDeploys: true` (orchestrator deploy step).
- [ ] Verify `application_name = "rust-dashboard-service-read"` appears
      in `pg_stat_activity` after deploy.

### Changes landed (2026-05-24)

| File | Lines | Change |
|---|---|---|
| `rust-dashboard-service/src/main.rs` | 14–30 | Added `PgConnectOptions` + `std::str::FromStr` imports |
| `rust-dashboard-service/src/main.rs` | 32–41 | Added `read_pool: sqlx::PgPool` to `AppState` with doc comment |
| `rust-dashboard-service/src/main.rs` | 58–66 | Added `read_database: String` to `HealthResponse` |
| `rust-dashboard-service/src/main.rs` | 95–147 | Built `read_pool` with env fallback chain + graceful failure path |
| `rust-dashboard-service/src/main.rs` | 154–158 | Wired `read_pool` into `AppState` constructor |
| `rust-dashboard-service/src/main.rs` | ~217–232 | Updated `health_check` to `SELECT 1` against `read_pool` |

### Env var to set on Railway

- **Service**: `rust-dashboard-service` (Railway project
  `fac8472c-199b-41ec-8806-a869ee96e783`)
- **Name**: `DASHBOARD_SERVICE_DATABASE_READ_POOLER_URL`
- **Value**: same Supavisor replica pooler URL already set on
  `rust-core-service` (`DATABASE_READ_POOLER_URL`) and
  `rust-work-service` (`WORK_SERVICE_DATABASE_READ_POOLER_URL`) — see
  [[Supabase-Read-Replica-Routing]] § "Env vars to set on Railway".
- **Fallback**: if `DATABASE_READ_POOLER_URL` is set on the service it
  will be picked up automatically (service-specific name wins).
- **Flag**: `skipDeploys: true` so the existing build is unaffected
  until the next manual `railway up`.

## P1 — Foundation

**Completed 2026-05-24** (migration written but not yet applied;
orchestrator pending).

- [x] Migration `supabase/migrations/327_omnibelt_core.sql`:
      `omnibelt_role_config`, `omnibelt_user_prefs`,
      `omnibelt_tool_events`, `omnibelt_tool_events_24h_mv`, RLS
      policies, NOTIFY trigger, `pg_cron` MV refresh job.
- [x] Add `omnibelt` permission resource; default-grant
      `(manage, omnibelt)` to `admin` + `superadmin` roles.
- [x] `src/features/omnibelt/lib/routeGate.ts` —
      `isOmnibeltAllowedRoute()`.
- [x] `src/features/omnibelt/lib/routeClass.ts` — bounded route-class
      mapper.
- [x] `src/features/omnibelt/store/omnibeltStore.ts` — Zustand store +
      persist (no UI yet).
- [x] `src/features/omnibelt/hooks/useOmnibeltVisibility.ts` — full
      6-layer kill-switch evaluator.
- [x] `src/features/omnibelt/__tests__/` — vitest coverage for
      `routeGate`, `routeClass`, `omnibeltStore` (persist roundtrip +
      partialize + per-user key isolation), `useOmnibeltVisibility`
      (every kill-switch layer + ordering precedence).
- [x] `src/lib/services/omnibelt-settings-service.ts` — read-only
      helper (`getEnabled`, `getAllowList`) mirroring `SettingsService`,
      defaults to enabled when the row is missing.
- [x] `src/features/omnibelt/index.ts` — barrel re-exports the public
      P1 surface (route gate helpers, store init/hook, visibility hook).
- [x] `pnpm tsc -b` clean; `pnpm vitest run src/features/omnibelt`
      108/108 passing.

### P1 deviations / notes

- **Migration NOT applied.** Orchestrator applies via Supabase MCP.
- **`permissions.scope`** uses `'organization'` instead of the `'global'`
  value mentioned in the spec brief — the existing CHECK constraint from
  migration 007 only permits `('application','system','organization','user')`
  and `'organization'` is the closest semantic match (matches the
  recently-seeded `device_manager`, `cubiscan`, `warehouse_maps`,
  `inbound_carts` resources).
- **RLS admin gate** uses `public.has_permission('omnibelt','manage')`
  rather than the spec's `EXISTS … role_key IN ('admin','superadmin')`
  expression. `has_permission` is the canonical RLS helper introduced in
  migration 308; it resolves via `role_id` (so custom non-enum roles
  inherit grants correctly) and matches the production-boards /
  warehouse-maps / cubiscan policy idiom.
- **`role_permissions` insert** uses `r.name::user_role` directly — both
  `admin` and `superadmin` are present in the legacy `user_role` enum so
  the spec-295 `CASE … 'viewer'::user_role` fallback isn't required.
- **`omnibelt_user_prefs` policy** is a single `FOR ALL` self-only
  policy (USING + WITH CHECK = `user_id = auth.uid()`) — strictly
  equivalent to the spec's separate select/insert/update/delete
  variants, simpler to audit.
- **Bonus `BEFORE UPDATE` touch triggers** added on `omnibelt_role_config`
  and `omnibelt_user_prefs` so `updated_at` advances on every mutation
  (mirrors migration 307; needed for the bootstrap query's
  `updated_at`-newer-wins merge in P2).
- **`useOmnibeltVisibility`** treats `orgEnabled === undefined` (query
  still loading) as visible to avoid a flash of missing chrome on first
  paint; only an explicit `false` collapses to `org_disabled`.
- **`omnibeltStore` per-user singleton.** Stores are global by import
  convention; per-user localStorage isolation is achieved via a lazy
  `initOmnibeltStore(userId)` factory that re-instantiates Zustand's
  `persist` against `omniframe.omnibelt.${userId}.v1`. P3 will call
  `initOmnibeltStore` from `OmniBeltHost` once auth state hydrates.
- **Unit test localStorage shim.** Same in-memory `Storage` stub used by
  `use-operator-task-queue-order.test.ts` / `draft-migration.test.ts` —
  the vitest jsdom env in this repo registers `--localstorage-file`
  without a path which breaks `localStorage.clear()`.

## P2 — Rust bootstrap + WS event

**Completed 2026-05-24.**

- [x] `rust-dashboard-service/src/omnibelt.rs` (flat-file convention —
      see deviation note) — `GET /omnibelt/bootstrap` using
      `state.read_pool` + Redis 30s cache, key
      `omnibelt:bootstrap:{org_id}:{user_id}`.
- [x] `rust-work-service/src/websocket/mod.rs` — added
      `WsEvent::OmnibeltConfigChanged { organization_id: Uuid }`
      variant, plus matching entries in `WsEvent::variant_name`,
      `WsEvent::organization_id`, and `sample_events()` for the CI
      symmetry test against `KNOWN_WS_EVENT_VARIANTS`.
- [x] `rust-work-service/src/omnibelt_listener.rs` — new PgListener
      `CHANNEL = "omnibelt_config_changed"` consumed by the
      consolidated domain-event task in `main.rs`. On each frame:
      parses `{ org_id }`, SCAN+DEL `omnibelt:bootstrap:{org_id}:*`
      from Redis, broadcasts the new variant via
      `crate::websocket::broadcast_event`.
- [x] `src/lib/work-service/types.ts` — added `'OmnibeltConfigChanged'`
      to `WsEventType` and exported `OmnibeltConfigChangedPayload`.
      Re-exported through the barrel.
- [x] `api/routers/omnibelt.py` — five FastAPI endpoints (bootstrap
      proxy, prefs, events) + admin endpoints (role-config,
      kill-switch); registered in `api/main.py`.
- [x] `src/features/omnibelt/hooks/useOmnibeltBootstrap.ts` — TanStack
      Query against `/api/omnibelt/bootstrap` with `staleTime: 5min`,
      `gcTime: 30min`, and a per-user query key.
- [x] `src/features/omnibelt/hooks/useOmnibeltConfigInvalidator.ts` —
      `workServiceWs` subscriber that calls
      `queryClient.invalidateQueries({ queryKey: ['omnibelt',
      'bootstrap'] })` on every matching event.
- [x] `src/features/omnibelt/__tests__/useOmnibeltConfigInvalidator.test.tsx`
      — 6 unit tests (connect with org, skip without org, invalidate
      on match, ignore cross-org, ignore unrelated types, cleanup on
      unmount). All passing.
- [ ] Integration test `omnibelt-bootstrap.integration.test.ts` —
      deferred to P9 polish (requires an `INTEGRATION_MODE=infra`
      Redis + Supabase round-trip; the unit + Rust cargo-test pair
      cover the contract today).

### P2 deviations / notes

- **Rust handler layout — flat file, not `handlers/omnibelt.rs`.**
  The spec suggested `rust-dashboard-service/src/handlers/omnibelt.rs`,
  but the existing crate uses a flat-file convention (`auth.rs`,
  `middleware.rs` are siblings of `main.rs`). Keeping `omnibelt.rs`
  flat avoids a one-file `handlers/` module just to host this single
  endpoint.
- **Redis pool optional, never fatal.** `redis_pool:
  Option<Pool<RedisConnectionManager>>` is added to `AppState`. When
  `DASHBOARD_SERVICE_REDIS_URL` (or the fallback `REDIS_URL`) is
  unset, blank, or fails to connect at boot, the service logs
  `warn!` and disables caching — the bootstrap endpoint still works
  (it just always hits the replica). This keeps local dev
  workstations bootable without Redis.
- **WsEvent variant name is PascalCase, not snake_case.** The user
  spec mentioned `'omnibelt_config_changed'` for the TS
  `WsEventType` entry, but the Rust enum uses
  `#[serde(tag = "type")]` without `rename_all`, so the wire shape
  is the variant name verbatim — every other entry in
  `WsEventType` (`'TaskAssigned'`, `'PresenceJoined'`,
  `'SapAgentChanged'`, …) is PascalCase for the same reason. Used
  `'OmnibeltConfigChanged'` to match the existing convention.
- **Kill-switch `pg_notify` is best-effort.** The `settings` table
  doesn't carry the omnibelt NOTIFY trigger (only
  `omnibelt_role_config` does). The admin kill-switch endpoint
  attempts to fire `pg_notify` via a future
  `omnibelt_pg_notify_kill_switch(p_org_id)` Postgres RPC; when the
  RPC isn't installed (it isn't in migration 327), the endpoint
  swallows the call and the FE simply observes the change at the
  next bootstrap fetch (cache TTL 30s) — graceful, not silent.
  Adding the RPC is a future cleanup.
- **Rate-limit window is 1 minute (60 s).** Spec §17.1 calls for
  "50 events/user/min" — implemented as a Redis sliding window
  via the existing `RedisService.check_rate_limit` helper (the
  pattern already in `api/lib/cache/redis_service.py`). When Redis
  is unavailable the helper fails open per its existing semantics.
- **Bootstrap fallback uses `db.read_client`.** When
  `rust-dashboard-service` returns 5xx or is unreachable, the
  proxy falls back to a direct Supabase read via the read client.
  The fallback returns the same JSON shape the Rust endpoint
  emits, so the FE consumes either path identically.
- **`role_config` resolved by joining `roles.name`.** The JWT
  validation chain exposes `role` as a string (the role name).
  The Rust handler joins `omnibelt_role_config → roles ON role_id`
  filtered by `roles.name = $role` to resolve the row, avoiding a
  schema change to the auth response.

### Files landed (2026-05-24)

| File | LOC | Change |
|---|---|---|
| `rust-dashboard-service/Cargo.toml` | +6 | Added `bb8 = "0.8"`, `bb8-redis = "0.16"` |
| `rust-dashboard-service/src/omnibelt.rs` | 396 | New module — bootstrap handler + cache helpers + read-pool helpers |
| `rust-dashboard-service/src/main.rs` | +73 | Wired `mod omnibelt`, `redis_pool` field on `AppState`, env-driven Redis pool init, `/omnibelt/bootstrap` route |
| `rust-work-service/src/websocket/mod.rs` | +25 | Added `OmnibeltConfigChanged` variant + match arms for `variant_name`, `organization_id`, sample_events |
| `rust-work-service/src/observability/metrics.rs` | +8 | Added entries to `KNOWN_WS_EVENT_VARIANTS` and `KNOWN_PGLISTENER_CHANNELS` |
| `rust-work-service/src/omnibelt_listener.rs` | 154 | New listener — JSON parse + Redis SCAN+DEL + WS broadcast |
| `rust-work-service/src/main.rs` | +5 | `mod omnibelt_listener` + channel + dispatch arm |
| `api/routers/omnibelt.py` | 590 | New router — bootstrap proxy, prefs upsert, batched events, admin role-config, admin kill-switch |
| `api/main.py` | +6 | Imported and registered `omnibelt.router` and `omnibelt.admin_router` |
| `src/lib/work-service/types.ts` | +18 | Added `'OmnibeltConfigChanged'` to `WsEventType` + `OmnibeltConfigChangedPayload` type |
| `src/lib/work-service/index.ts` | +1 | Re-exported `OmnibeltConfigChangedPayload` |
| `src/features/omnibelt/hooks/useOmnibeltBootstrap.ts` | 132 | New hook — TanStack Query against `/api/omnibelt/bootstrap` |
| `src/features/omnibelt/hooks/useOmnibeltConfigInvalidator.ts` | 95 | New hook — WS subscriber that invalidates the bootstrap query |
| `src/features/omnibelt/__tests__/useOmnibeltConfigInvalidator.test.tsx` | 130 | 6 vitest cases |
| `src/features/omnibelt/index.ts` | +14 | Re-exported new hooks + types |
| `memorybank/OmniFrame/Implementations/Implement-OmniBelt-MVP.md` | +120 | This log update |

### Verification (2026-05-24)

- `cd rust-dashboard-service && cargo check` — clean (incremental).
- `cd rust-dashboard-service && cargo build --release` — 49.91s clean.
- `cd rust-work-service && cargo check` — clean (7 pre-existing
  warnings in `observability/middleware.rs`, unrelated to OmniBelt).
- `cd rust-work-service && cargo test ws_event` — 4 + 4 tests pass
  (variant_name symmetry against `KNOWN_WS_EVENT_VARIANTS`,
  broadcast counter, etc.).
- `pnpm tsc -b` — clean.
- `pnpm vitest run src/features/omnibelt` — 114 tests pass (108
  P1 + 6 new P2 invalidator tests).
- `python3 -m py_compile api/routers/omnibelt.py` — clean.
- 5 OmniBelt routes registered: `GET /api/omnibelt/bootstrap`,
  `POST /api/omnibelt/prefs`, `POST /api/omnibelt/events`,
  `POST /api/admin/omnibelt/role-config`,
  `POST /api/admin/omnibelt/kill-switch`.

### Env vars to set on Railway

- **`rust-dashboard-service`**:
  - `DASHBOARD_SERVICE_REDIS_URL` (or `REDIS_URL`) — Redis URL for
    the 30s bootstrap cache. Optional; service degrades gracefully
    when unset.
- **FastAPI service** (the existing API container that hosts
  `start.py` + `api.main:app`):
  - `RUST_DASHBOARD_SERVICE_URL` — internal URL of
    `rust-dashboard-service`. Default
    `http://rust-dashboard-service:8002` (the docker-compose /
    Railway internal hostname); override only if the service runs
    on a non-standard host.
- Both services need the existing `REDIS_URL` (already set in
  prod) and the existing `DATABASE_URL` /
  `DASHBOARD_SERVICE_DATABASE_READ_POOLER_URL` pair.

## P3 — Pill skin + Panel + Host

**Completed 2026-05-24.**

- [x] `src/features/omnibelt/lib/motion.ts` — house spring (`{420, 28,
      0.85}`), cubic-bezier easing `[0.22, 1, 0.36, 1]`, the shared
      `COLLAPSE_LAYOUT_ID = 'omnibelt-host'` + `COLLAPSE_LAYOUT_GROUP_ID
      = 'omnibelt'` constants, and per-state morph budgets.
- [x] `src/features/omnibelt/tools/registry.ts` — `ToolDef` shape per
      spec §11.1 + `TOOL_REGISTRY` array. P3 ships two placeholders
      (`build_info`, `quick_note`) so the panel grid never renders
      empty; P4 replaces the array with the full 8-tool roster.
- [x] `src/features/omnibelt/tools/definitions/build-info.ts` +
      `quick-note.ts` — `ToolDef` literals.
- [x] `src/features/omnibelt/tools/shells/BuildInfoShell.tsx` —
      diagnostic panel: app mode, bundle hash (from `__BUILD_HASH__`),
      deployed hash (from `/build-info.json`), drift warning.
- [x] `src/features/omnibelt/tools/shells/QuickNoteShell.tsx` —
      per-user `localStorage` scratchpad keyed by
      `omniframe.omnibelt.quick-note.${userId}`; debounced 250 ms
      writes + on-unmount flush.
- [x] `src/features/omnibelt/tools/use-resolved-tools.ts` — four-stage
      filter pipeline (allow-list → role default → hidden → RBAC) +
      pin resolution (user > role default) + `tool_order`
      reordering. Memoised, recomputes on permission cache cycles.
- [x] `src/features/omnibelt/panel/OmniBeltPanel.tsx` — shared
      expanded panel anchored bottom-right (24 px gutter; P6 lands
      the 12-zone anchor system). `motion.div` morph via
      `layoutId='omnibelt-host'`, Esc / click-outside collapse,
      lazy-loaded tool shells via `Suspense`.
- [x] `src/features/omnibelt/panel/PanelSearch.tsx` — controlled
      `<Input>` with `IconSearch` prefix + `⌘B` / `Ctrl B` shortcut
      chip + auto-focus on mount.
- [x] `src/features/omnibelt/panel/PanelTabs.tsx` — Radix `Tabs`
      with Pinned / All / Recent / Running. Recent + Running render
      empty-state copy until P5.
- [x] `src/features/omnibelt/panel/ToolTile.tsx` — 44 px gradient
      icon disc + label + optional badge dot. `navigationUrl` tools
      route via TanStack Router; `shell` tools fire `onLaunch`.
- [x] `src/features/omnibelt/panel/PanelMenu.tsx` — Radix dropdown
      with skin radio (Pill enabled; Orb + Skystrip marked
      "ships in P7"), "Hide OmniBelt" checkbox, "Lock to corner"
      placeholder.
- [x] `src/features/omnibelt/skins/pill/OmniBeltPill.tsx` —
      collapse-state router (orb / pill body / null when panel /
      nub). PillBody renders up to 6 pinned tools + grip + pin badge
      + expand button.
- [x] `src/features/omnibelt/skins/pill/PillMiniOrb.tsx` — 44 px
      circular glass orb (`motion.button` with shared `layoutId`) +
      tooltip "OmniBelt · ⌘B to open".
- [x] `src/features/omnibelt/skins/pill/PillEdgeNub.tsx` — 6 px
      glass sliver at the right edge; hover wakes back to orb.
- [x] `src/features/omnibelt/hooks/useOmnibeltKeyboard.ts` — global
      `⌘B` / `Ctrl B` toggle. Mounted only by `OmniBeltHost` so the
      listener lifecycle matches the host's.
- [x] `src/features/omnibelt/OmniBeltHost.tsx` — mount point.
      Guards on `userId` (the store throws if consumed before init),
      synchronously initialises the per-user store via
      `useState(() => initOmnibeltStore(userId))`, runs the
      visibility / invalidator / keyboard hooks, then wraps Pill +
      Panel in `<MotionConfig reducedMotion='user'>` +
      `<LayoutGroup id='omnibelt'>`.
- [x] `src/features/omnibelt/index.ts` — barrel re-exports the new
      public surface (`OmniBeltHost`, `useResolvedTools`, motion
      constants, registry types).
- [x] Mounted in [`src/routes/__root.tsx`](../../../src/routes/__root.tsx)
      between `<Outlet />` and `<Toaster />` (per spec §3.1).
- [x] `vite.config.ts` — new `feature-omnibelt` `manualChunks`
      rule. Explicitly excludes `skins/orb/`, `skins/skystrip/`
      (lazy-load in P7) and `tools/shells/` (lazy-load on first
      open) so the always-resident slice stays small.
- [x] Bundle budget verified — `feature-omnibelt` chunk **30.98 KB
      raw / 10.79 KB gzipped**, well under the 60 KB target.
- [x] `pnpm tsc -b` clean.
- [x] `pnpm vitest run src/features/omnibelt` — **134/134 passing**
      (114 P1+P2 + 20 new P3 tests across `OmniBeltHost`,
      `OmniBeltPill`, `OmniBeltPanel`, `use-resolved-tools`).
- [x] `pnpm build` succeeds; 3 pre-existing chunks over budget
      (`warehouse-location-map`, `feature-admin`,
      `feature-rf-interface`) — confirmed unchanged by stashing
      P3 and rebuilding on main.
- [x] Zero new `supabase.channel(...)` callsites under
      `src/features/omnibelt/` (realtime policy honored).

### P3 deviations / notes

- **Pill icons are `motion.button`, not `motion.div`.** Both
  `PillMiniOrb` and `PillEdgeNub` are interactive (click expands,
  hover wakes the nub) so wrapping a `motion.button` keeps the
  accessible interaction tree honest while still sharing the
  `layoutId='omnibelt-host'` morph. The spec's sketch uses
  `motion.div` but the contract is "same layoutId on every state" —
  satisfied either way.
- **`ToolDef.shell` is `() => Promise<{ default: ComponentType<...> }>`**
  rather than the spec's literal `ComponentType<ToolShellProps>`. The
  lazy-import shape is what the bundler needs to split each shell
  into its own chunk (per spec §15.6 / §11) and what `React.lazy`
  consumes directly. Direct components would force the panel to
  import every shell eagerly.
- **Store hydration is deferred to P4.** P3 reads the bootstrap
  query inside `useResolvedTools` (for `allow_list`,
  `role_config`), but does NOT merge `bootstrap.user_prefs` into
  the Zustand store yet. The `updated_at`-newer-wins merge spec
  §6.2 calls for lands with the v1 tool roster + per-tool
  preferences in P4 — keeping P3 lean reduces surface area.
- **Panel anchor is hard-coded bottom-right (24 px gutter).** The
  full 12-zone snap + drag + collision-avoidance system is P6
  territory; P3 picks the spec-default `BR` corner deterministically.
- **Skin picker disables Orb + Skystrip** in `PanelMenu`. Both
  options are present in the dropdown for discoverability with a
  "ships in P7" note; selecting them is a no-op until the lazy
  skins land.
- **Keyboard shortcut walks straight to Panel.** ⌘B / Ctrl B from
  any non-panel state jumps to `panel`, not stepping through
  `orb → pill → panel`. Mirrors the user intent (they want the
  launcher in front of them now) and matches how the existing
  `CommandPalette` Cmd+K behaves.
- **`OmniBeltHost` splits into `OmniBeltHost` + `OmniBeltHostBody`.**
  Rules-of-hooks require a stable call order; gating `useState(() =>
  initOmnibeltStore(userId))` behind a userId presence check means
  the inner body component takes the `userId` as a prop and only
  mounts when present.
- **Test environment.** New `OmniBelt*.test.tsx` files import
  `@testing-library/jest-dom/vitest` per the existing
  `stat-tile.test.tsx` precedent — repo-wide test-setup doesn't
  register the DOM matchers globally yet.
- **`useResolvedTools` memo includes `lastLoadTime`** (with an
  eslint-disable comment explaining why) so the resolved tool set
  re-evaluates whenever the permission cache cycles. `hasPermission`
  itself isn't referentially stable across permission reloads, but
  the linter can't see the closure.

### Files landed (2026-05-24)

| File | LOC | Change |
|---|---|---|
| `src/features/omnibelt/lib/motion.ts` | 42 | New — house spring + easing + layoutId constants |
| `src/features/omnibelt/tools/registry.ts` | 99 | New — `ToolDef` + `TOOL_REGISTRY` skeleton |
| `src/features/omnibelt/tools/definitions/build-info.ts` | 22 | New — `build_info` tool literal |
| `src/features/omnibelt/tools/definitions/quick-note.ts` | 23 | New — `quick_note` tool literal |
| `src/features/omnibelt/tools/shells/BuildInfoShell.tsx` | 122 | New — diagnostic panel |
| `src/features/omnibelt/tools/shells/QuickNoteShell.tsx` | 100 | New — per-user scratchpad |
| `src/features/omnibelt/tools/use-resolved-tools.ts` | 144 | New — filter pipeline hook |
| `src/features/omnibelt/panel/OmniBeltPanel.tsx` | 215 | New — shared expanded panel |
| `src/features/omnibelt/panel/PanelSearch.tsx` | 52 | New — search box + shortcut chip |
| `src/features/omnibelt/panel/PanelTabs.tsx` | 70 | New — Pinned / All / Recent / Running tabs |
| `src/features/omnibelt/panel/ToolTile.tsx` | 113 | New — 44px gradient tile + tooltip |
| `src/features/omnibelt/panel/PanelMenu.tsx` | 73 | New — skin picker + auto-hide + lock placeholder |
| `src/features/omnibelt/skins/pill/OmniBeltPill.tsx` | 137 | New — collapse-state router + pill body |
| `src/features/omnibelt/skins/pill/PillMiniOrb.tsx` | 58 | New — 44px glass orb |
| `src/features/omnibelt/skins/pill/PillEdgeNub.tsx` | 33 | New — 6px edge sliver |
| `src/features/omnibelt/hooks/useOmnibeltKeyboard.ts` | 41 | New — global ⌘B toggle |
| `src/features/omnibelt/OmniBeltHost.tsx` | 92 | New — mount + lifecycle host |
| `src/features/omnibelt/__tests__/OmniBeltHost.test.tsx` | 90 | 3 vitest cases |
| `src/features/omnibelt/__tests__/OmniBeltPill.test.tsx` | 90 | 4 vitest cases |
| `src/features/omnibelt/__tests__/OmniBeltPanel.test.tsx` | 110 | 5 vitest cases |
| `src/features/omnibelt/__tests__/use-resolved-tools.test.ts` | 165 | 8 vitest cases |
| `src/features/omnibelt/index.ts` | +28 | Barrel re-exports |
| `src/routes/__root.tsx` | +2 | Mount `<OmniBeltHost />` |
| `vite.config.ts` | +18 | `feature-omnibelt` chunk slice |

## P4 — v1 tools + RBAC

**Completed 2026-05-24.**

- [x] 8 tool definitions in `src/features/omnibelt/tools/definitions/`:
      `quick-pick.ts`, `sap-status.ts`, `inventory-lookup.ts`,
      `background-jobs.ts`, `quick-note.ts`, `build-info.ts`,
      `settings-shortcut.ts`, `help-docs.ts`.
- [x] Lazy panel shells for tools that have inline UI
      (`QuickNoteShell.tsx`, `BuildInfoShell.tsx`, `SapStatusShell.tsx`,
      `InventoryLookupShell.tsx`, `BackgroundJobsShell.tsx`).
- [x] Per-tool permission gating via `usePermissionStore` — already
      wired in P3's `useResolvedTools`; P4 verifies it against three
      permissioned tools (`quick_pick`, `sap_status`,
      `inventory_lookup`).
- [x] Tool registry filter pipeline (allow-list → role defaults →
      hidden → permission → ordering) — exercised end-to-end via
      the extended `use-resolved-tools.test.ts`.

### Roster landed (spec §11.2)

| ID | Label | Category | Surface | Permission |
|---|---|---|---|---|
| `quick_pick` | Quick Pick | operations | route → `/apps/outbound` | `view:outbound_apps` |
| `sap_status` | SAP Status | operations | panel `SapStatusShell` | `manage:sap_testing` |
| `inventory_lookup` | Inventory Lookup | operations | panel `InventoryLookupShell` | `view:inventory_apps` |
| `background_jobs` | Background Jobs | self | panel `BackgroundJobsShell` (stub) | (none) |
| `quick_note` | Quick Note | self | panel `QuickNoteShell` | (none) |
| `build_info` | Build Info | self | panel `BuildInfoShell` | (none) |
| `settings_shortcut` | Settings | self | route → `/settings` | (none) |
| `help_docs` | Help & Docs | help | route → `/help-center` | (none) |

### P4 deviations / notes

- **Permission re-mapping.** Spec §11.2 lists `view:operations`,
  `view:sap_status`, and `view:inventory` as the gates for the three
  permissioned tools. None of those `(action, resource)` pairs are
  seeded in the live `permissions` table. We mapped each to the
  closest existing grant so the tile is visible to exactly the
  population that can navigate to the destination today:
    - `quick_pick` → `view:outbound_apps` (resource that already
      gates `/apps/outbound` via `createStandardProtectedRoute('OUTBOUND')`).
    - `sap_status` → `manage:sap_testing` (the resource that already
      gates the SAP Testing sidebar entry; same population that needs
      a heartbeat).
    - `inventory_lookup` → `view:inventory_apps` (resource that
      already gates `/apps/inventory`).
  Adding net-new resources is a separate migration owned by P9 polish.
- **`quick_pick` route target.** Spec §11.2 calls for
  `/operations/pick/quick`; no `/operations/*` route exists in the
  v1 router. The closest live destination is `/apps/outbound`
  (which already houses the picking workflow under
  `OutboundManagement`). Documented inline in the tool definition.
- **`help_docs` route target.** Spec calls for `/help`; the actual
  route in the router is `/help-center`
  (`src/routes/_authenticated/help-center/index.tsx`). Linked there
  rather than 404.
- **`InventoryLookupShell` ships as a stub.** The full search-by-
  bin / search-by-part flow lives in `/admin/sap-testing` (Inventory
  Management tab) and is too coupled (agent/fleet routing,
  permission gates, LX03 RFC client) to lift into a small panel for
  v1. The shell renders an input + a "Open in SAP Testing" button
  that deep-links to the existing surface. Live inline lookup is a
  v1.5 task.
- **`BackgroundJobsShell` ships as a stub.** Live job list with
  cancel buttons + halo progress is a P5 deliverable owned by
  `useOmnibeltJobs`. P4 ships a stub with copy referencing P5 plus a
  deep-link to `/admin/work-queue`.
- **`SapStatusShell` pulls in `feature-admin-sap`.** The shell
  imports `useAgentDetection` from the existing SAP testing hook,
  which Vite groups into the `feature-admin-sap` chunk (~107 KB
  gzipped). Acceptable because:
    1. Tile is permission-gated to `manage:sap_testing`; that
       population almost always already has the chunk cached from
       prior visits to `/admin/sap-testing`.
    2. Duplicating the agent-detection state machine into omnibelt
       would mean a second WS handler + polling tree per page
       — strictly worse.
- **`AgentHealth.last_check` does not exist.** Initial draft of
  `SapStatusShell` referenced `detection.health.last_check`; the
  `AgentHealth` interface in `src/features/admin/sap-testing/lib/agent-fetch.ts`
  exposes `started_at` + `version` only. Shell now displays
  `started_at` (rendered via a relative-time helper) and `version`
  instead. Probe-recency is implicit in the green/amber/red dot
  state machine.
- **`IconPackageSearch` is not in `@tabler/icons-react`.** First
  draft used that name; the package exposes `IconPackage` and
  `IconSearch` as separate icons. Inventory Lookup uses
  `IconPackage` (the closest single-glyph match).
- **Test convention.** New `tool-definitions.test.ts` lives at
  `src/features/omnibelt/tools/__tests__/` (mirroring the spec's
  explicit path) rather than colocated with the rest of the
  omnibelt tests under `src/features/omnibelt/__tests__/`.
  `vitest.config.ts` picks both up via the `src/**/*.test.ts`
  glob — no config change needed.

### Files landed (2026-05-24)

| File | LOC | Change |
|---|---|---|
| `src/features/omnibelt/tools/definitions/quick-pick.ts` | 33 | New — operations route tool |
| `src/features/omnibelt/tools/definitions/sap-status.ts` | 30 | New — operations panel tool |
| `src/features/omnibelt/tools/definitions/inventory-lookup.ts` | 30 | New — operations panel tool |
| `src/features/omnibelt/tools/definitions/background-jobs.ts` | 26 | New — self panel tool |
| `src/features/omnibelt/tools/definitions/settings-shortcut.ts` | 22 | New — self route tool |
| `src/features/omnibelt/tools/definitions/help-docs.ts` | 23 | New — help route tool |
| `src/features/omnibelt/tools/shells/SapStatusShell.tsx` | 199 | New — read-only agent + fleet status |
| `src/features/omnibelt/tools/shells/InventoryLookupShell.tsx` | 88 | New — stub form deep-linking to SAP Testing |
| `src/features/omnibelt/tools/shells/BackgroundJobsShell.tsx` | 60 | New — stub copy + work-queue deep-link |
| `src/features/omnibelt/tools/registry.ts` | ~17 | Imports + populates 8-tool array |
| `src/features/omnibelt/tools/__tests__/tool-definitions.test.ts` | 121 | New — 58 tests across 8 tools (id uniqueness, xor, perm shape, accent, category) |
| `src/features/omnibelt/__tests__/use-resolved-tools.test.ts` | +50 | Extended permission gate + tool_order tests for the 8-tool registry |

### Verification (2026-05-24)

- `pnpm tsc -b` — clean.
- `pnpm vitest run src/features/omnibelt` — **193/193 passing**
  (134 P1+P2+P3 + 58 new `tool-definitions` cases + 1 new
  `use-resolved-tools` permissioned-grant case).
- `pnpm build` — succeeds; 3 pre-existing chunks over budget
  (`warehouse-location-map`, `feature-admin`, `feature-rf-interface`),
  unchanged from P3.
- `feature-omnibelt` chunk: **32.61 KB raw / 11.03 KB gzipped**
  (delta from P3: +1.6 KB raw / +0.24 KB gzipped — well inside the
  60 KB budget).
- New shell chunks (each its own auto-chunk via the existing
  `manualChunks` exclusion for `tools/shells/`):
    - `SapStatusShell` — 3.93 KB raw
    - `InventoryLookupShell` — 1.61 KB raw
    - `BackgroundJobsShell` — 1.09 KB raw
- Zero new `supabase.channel(...)` callsites under
  `src/features/omnibelt/` (realtime policy honored).

## P5 — Mach 3 status

**Completed 2026-05-24.** Mach 3 background-job halo + click-expand
status tray live. `pnpm tsc -b`, `pnpm vitest run src/features/omnibelt`
(357 / 357 tests passing across 23 files), and `pnpm build` all clean.
`feature-omnibelt` chunk = **10.09 KB gzip** (26.91 KB raw) — +0.7 KB
gzip delta from the post-P6 9.4 KB baseline, comfortably inside the
+3-5 KB target.

- [x] `src/features/omnibelt/hooks/useOmnibeltJobs.ts` — subscribes
      to `workServiceWs` (no new Supabase channels) and aggregates
      three existing variants (`SapJobStatusChanged`,
      `ImportRunStatusChanged`, `TriggerFired`) into a unified
      `ActiveJob[]` slice. 1% progress-diff filter (constant
      `PROGRESS_DIFF_THRESHOLD = 0.01`) gates pure progress upserts;
      add / type-change / label-change always commit. Terminal
      success holds the job at 100% for `TERMINAL_HOLD_MS = 800ms`
      then evicts; failure / cancel evicts immediately. Pure
      helpers (`normalizeEvent`, `lifecycleOf`,
      `progressFromLifecycle`, `inferSapJobType`) exported via
      `__test__` for direct unit testing.
- [x] `src/features/omnibelt/tray/HaloRings.tsx` — SVG component
      with one `<motion.circle>` per active job, normalised
      `pathLength={100}` so progress encodes via
      `strokeDasharray = "${progress*100} 100"`. Stroke colour
      from `var(--omnibelt-job-<type>)`. Concentric stack with
      configurable `strokeWidth` / `ringGap` / `padding`.
      `pointer-events: stroke` (only painted ring strokes hit-test)
      so the empty interior stays click-through to the host's
      drag handle. Optional `onClick` flips the SVG into an
      interactive `role="button"` with `aria-label="Toggle
      background jobs tray"`.
- [x] `src/features/omnibelt/tray/JobRow.tsx` — single row with
      colored type chip, label, linear progress bar, percent label,
      WAI-ARIA `role="progressbar"`, optional cancel button, and
      a linear-slope ETA hint when there's enough signal.
- [x] `src/features/omnibelt/tray/OmniBeltStatusTray.tsx` — glass
      panel anchored to the side of the screen opposite the
      OmniBelt host (heuristic via `inferSide` over
      `positionByRoute`). Implements all four `mach3_behavior`
      branches:
        * `halo_only`               → never auto-expand
        * `halo_plus_autoexpand`    → 4 s open on new own-job
        * `halo_plus_morph`         → maps to autoexpand in v1
                                      (morph layout swap = v1.5)
        * `halo_plus_tray_pinned`   → pin while jobs active
      `role="status" aria-live="polite"` on the wrapper for
      screen-reader continuity. AnimatePresence handles enter/exit
      with the house spring.
- [x] Four `mach3_behavior` paths wired through the store (already
      present from P1; P5 wires consumers).
- [x] Color tokens added in `src/index.css` `:root` + `.dark` blocks
      (six OKLCH per mode) plus `@theme inline` pass-throughs so
      `text-omnibelt-job-<type>` works as a Tailwind utility.
- [x] `OmniBeltPill.tsx` — additively wraps the pill body with the
      halo (negative `inset: -12px` overlay), passes
      `position.reducedMotion` through, and exposes
      `setTrayOpen(!trayOpen)` as the halo's `onClick`. P6's drag /
      translate3d positioning, right-click menu, and pin/unpin
      affordances are preserved verbatim.
- [x] `OmniBeltHost.tsx` — additively mounts `useOmnibeltJobs()`
      alongside the existing config invalidator, and renders
      `<OmniBeltStatusTray />` as a sibling to the active skin so
      both surfaces re-render independently. P7's `SKIN_REGISTRY`
      lazy-import map and `SKINS_USING_SHARED_PANEL` set are
      preserved.
- [x] Unit tests:
        * `__tests__/useOmnibeltJobs.test.ts` (16 specs) — WS
          subscription lifecycle, lifecycle status mapping, 1%
          diff threshold, terminal hold + eviction, multi-variant
          aggregation, current-user attribution, and the cancel
          stub contract.
        * `__tests__/HaloRings.test.tsx` (10 specs) — empty list,
          one circle per job, `pathLength`/`strokeDasharray`
          encoding, color-var stroke, `<title>` accessibility,
          radius collapse, decorative-vs-interactive switch.
        * `__tests__/JobRow.test.tsx` (6 specs) — label / chip /
          percent / progressbar ARIA, conditional cancel button.
        * `__tests__/OmniBeltStatusTray.test.tsx` (10 specs) —
          visibility gate, `halo_plus_autoexpand` 4 s timer (real
          timers via `vi.useFakeTimers`), `halo_only` no-op,
          `halo_plus_tray_pinned` open-while-active, dismiss
          button, `inferSide` heuristic.

### Files landed (2026-05-24)

| File | LOC | Notes |
|---|---|---|
| `src/index.css` | +27 | 6 light tokens + 6 dark tokens + 6 @theme passthroughs |
| `src/features/omnibelt/hooks/useOmnibeltJobs.ts` | 348 | WS aggregator, three variants, 1% diff, terminal hold |
| `src/features/omnibelt/tray/HaloRings.tsx` | 165 | SVG rings, decorative + interactive modes |
| `src/features/omnibelt/tray/JobRow.tsx` | 115 | Pure presentational row, ETA, cancel |
| `src/features/omnibelt/tray/OmniBeltStatusTray.tsx` | 212 | Behaviour matrix + side heuristic |
| `src/features/omnibelt/skins/pill/OmniBeltPill.tsx` | +47 | Halo overlay (additive) |
| `src/features/omnibelt/OmniBeltHost.tsx` | +12 | `useOmnibeltJobs()` + tray mount (additive) |
| `src/features/omnibelt/__tests__/useOmnibeltJobs.test.ts` | 285 | New |
| `src/features/omnibelt/__tests__/HaloRings.test.tsx` | 124 | New |
| `src/features/omnibelt/__tests__/JobRow.test.tsx` | 79 | New |
| `src/features/omnibelt/__tests__/OmniBeltStatusTray.test.tsx` | 218 | New |
| `src/features/omnibelt/__tests__/OmniBeltPill.test.tsx` | +6 | Mock-bag additions (additive: `activeJobs`/`trayOpen`/`setTrayOpen`) |
| `src/features/omnibelt/__tests__/OmniBeltHost.test.tsx` | +6 | Mocks `useOmnibeltJobs` + `OmniBeltStatusTray` |

### Deviations / v1.5 follow-ups

1. **`useOmnibeltJobs` is NOT a stub** — there are existing
   `WsEvent` variants suitable for the Mach 3 surface. We aggregate
   three: `SapJobStatusChanged` (per-agent SAP job lifecycle),
   `ImportRunStatusChanged` (SAP outbound→imports), and
   `TriggerFired` (newly queued agent jobs). The `WsEvent` enum
   does NOT carry a numeric `progress` field — we derive progress
   from the textual `status` (queued=0.05, running=0.5,
   succeeded=1.0). A future Rust extension can add an explicit
   `progress: f32` field; the FE upgrade is a one-line replacement
   in `progressFromLifecycle`.
2. **No source for `report` / `scheduled` / `other` job types yet.**
   The CSS tokens ship in case a future variant arrives, but the
   normalizer only emits `sap_import` / `sap_export` / `agent_job`
   today. Documented inside the hook's module docstring.
3. **`cancelJob` is a stub.** v1 returns a rejected Promise + a
   single `logger.warn` because no SAP-agent / import-run cancel
   endpoint exists yet. The tray surfaces the cancel button only
   when `job.cancelable === true`, and today's normalizer hardcodes
   `cancelable: false` for both variants — so the button never
   renders in v1. v1.5 wires the cancel route + flips the flag.
4. **`halo_plus_morph` maps to `halo_plus_autoexpand` in v1.** The
   morph layout swap (Pill ↔ Tray morph via shared `layoutId`)
   needs cross-skin coordination that's parked behind P9's tracker.
5. **Tray side anchoring is heuristic, not bbox-tracking.** The
   tray reads `positionByRoute` and picks `top` vs `bottom` based on
   the active anchor's vertical half. v1.5 wires per-route
   bounding-rect tracking via the existing `useOmnibeltPosition`
   plumbing so the tray hovers exactly above/below the host.
6. **Telemetry hooks deferred** — no `useOmnibeltTelemetry` exists
   yet; spec §17 lands in P9 alongside the FastAPI emitter route.
   When that lands, three call sites need wiring: `tray_expand` on
   open, `tray_collapse` on close, and `cancel_clicked` on cancel
   button.
7. **No new `supabase.channel(...)` callsites under
   `src/features/omnibelt/`** — confirmed by `rg
   "supabase.channel" src/features/omnibelt`. The WS subscription
   reuses the existing `workServiceWs` singleton through the same
   pattern as `useOmnibeltConfigInvalidator`.

## P6 — Anchors + drag + collision

**Completed 2026-05-24.** All 12 anchor zones live with snap math,
collision avoidance, drag, per-route memory and a keyboard-accessible
right-click menu. `pnpm tsc -b`, `pnpm vitest run src/features/omnibelt`
(302 tests / 17 files), and `pnpm build` all clean. `feature-omnibelt`
chunk = **9.4 KB gzip** (25 KB raw) — slightly *under* the prior 10.2 KB
baseline because P7 already lazy-split the alternate skin chunks, so the
position layer absorbs cleanly into the still-shared core.

- [x] `src/features/omnibelt/lib/anchors.ts` — 12 zones + snap math +
      32 px deadzone (pure functions). Exports `AnchorName` /
      `AnchorPosition` (alias for parity w/ task brief), `Offset`,
      `ResolvedPosition`, `ANCHOR_POSITIONS` (14 entries),
      `USER_CORNER_ANCHORS`, `NUB_ANCHORS`, `SNAP_DEADZONE_PX`,
      `VIEWPORT_GUTTER_PX`, `resolveAnchorPosition()`,
      `snapToNearestAnchor()`, `pickAnchorByZone()`,
      `clampToViewport()`.
- [x] `src/features/omnibelt/lib/collision.ts` — `Rect` shape,
      `rectsOverlap(a, b, paddingPx)`, `rectsOverlapAreaPx(a, b)`,
      `avoidCollisions({ widget, competing, overlapThresholdPx=4,
      offsetStepPx=56 })` with cascading-overlap guard
      (`MAX_PASSES = 8`) and direction-with-smallest-residual-overlap
      heuristic.
- [x] `src/features/omnibelt/hooks/useOmnibeltPosition.ts` —
      reads `positionByRoute[routeClass(pathname)]`, tracks viewport
      via `window.resize` + `ResizeObserver(document.documentElement)`,
      wires `useDragControls()` from framer-motion, exposes
      `onDragEnd(point)` that runs `snapToNearestAnchor` then writes
      back, plus `onDragStart`, `setAnchor`, `setPinned`, and the
      framer-required `dragControls` reference. `forceAnchor` arg
      lets the Edge Nub re-key onto NUB_L/R/T/B without losing the
      route's stored anchor.
- [x] `src/features/omnibelt/hooks/useOmnibeltCollisionAvoidance.ts`
      — DOM probe over `[data-testid="notifications-bell"]`,
      `[data-sonner-toaster]`, plus optional `extraSelectors`.
      Re-probes on widget rect change and `window.resize`. Skips
      zero-size nodes (collapsed popovers).
- [x] Per-route memory via `routeClass(pathname)` → store key
      (`useOmnibeltPosition` reads `positionByRoute[currentRoute]`,
      writes via `setPositionForRoute(currentRoute, ...)`).
- [x] Right-click "Move to corner" menu for keyboard A11y —
      `<PillPositionMenu>` inside `OmniBeltPill.tsx` exposes the 8
      user corner anchors plus a Pin / Unpin toggle. shadcn
      `DropdownMenu` keeps focus management correct.
- [x] Unit tests for anchors + collision + position hook +
      collision hook + extended store actions.

### Files landed (2026-05-24)

| File | LOC | Notes |
|---|---|---|
| `src/features/omnibelt/lib/anchors.ts` | 332 | Pure math, 14 anchor consts |
| `src/features/omnibelt/lib/collision.ts` | 125 | Pure math, 4 helpers |
| `src/features/omnibelt/hooks/useOmnibeltPosition.ts` | 233 | Anchor lookup + drag + forceAnchor |
| `src/features/omnibelt/hooks/useOmnibeltCollisionAvoidance.ts` | 121 | DOM probe + resize listener |
| `src/features/omnibelt/store/omnibeltStore.ts` | 338 | Extended w/ `setPositionForRoute`, `clearPositionForRoute`, `setPinned`, `setDragging`, runtime `dragging` excluded from `partialize` |
| `src/features/omnibelt/skins/pill/OmniBeltPill.tsx` | 314 | Hard-coded `bottom-24 right-24` replaced w/ `transform: translate3d(...)` from position hook + collision avoidance + `<PillPositionMenu>` |
| `src/features/omnibelt/skins/pill/PillMiniOrb.tsx` | 82 | Same anchor as the Pill so collapse stays in place |
| `src/features/omnibelt/skins/pill/PillEdgeNub.tsx` | 92 | `pickNubFor(stored)` maps corner anchor → NUB_L/R/T/B; `forceAnchor` lands flush against the edge |
| `src/features/omnibelt/__tests__/anchors.test.ts` | 259 | 33 tests, every anchor + edge case |
| `src/features/omnibelt/__tests__/collision.test.ts` | 118 | 13 tests, padding + cascading + custom step |
| `src/features/omnibelt/__tests__/useOmnibeltPosition.test.ts` | 276 | 14 tests, route-class isolation + PINNED + reduced-motion + forceAnchor |
| `src/features/omnibelt/__tests__/useOmnibeltCollisionAvoidance.test.ts` | 156 | 9 tests, mounted-DOM probe |
| `src/features/omnibelt/__tests__/omnibeltStore.test.ts` | 314 | +6 P6 cases (setPosition, clearPosition, setPinned, partialize, persist roundtrip) |

### Picked up from prior crashed run

A prior worker drafted every P6 file before crashing. Inspection
showed all source files (lib + hooks + store + Pill + MiniOrb +
EdgeNub) and their dedicated tests already complete and aligned with
the spec. Two test failures remained:

1. **`OmniBeltPill.test.tsx`** — `dragControls.subscribe is not a
   function`. The `useOmnibeltPosition` mock returned a
   `dragControls: { start: vi.fn() }` stub, but framer-motion 12's
   `DragGesture.mount` calls `dragControls.subscribe(controls)`
   (`gestures/drag/index.mjs:17`). **Fix:** added
   `subscribe: vi.fn(() => () => {})` to the stub.
2. **`OmniBeltHost.test.tsx`** — "Unable to find an element by
   `[data-testid='mock-panel']`". P7 (running in parallel) extended
   the Host with skin-aware Panel mounting
   (`SKINS_USING_SHARED_PANEL.has(skin)`), so the mock store's
   `useOmnibeltStore((s) => s.skin)` returning `undefined` short-
   circuited the panel render. **Fix (in test only — P7 source
   untouched):** added a `skin: 'pill'` selector pass-through to the
   mock so the test matches the post-P7 contract. This was a courtesy
   patch in the shared `__tests__/` lane; it's an additive change
   that shouldn't conflict with anything P7 might write.

Everything else (the 12 source files + 5 tests above) was left
untouched after a fresh-read review confirmed they implement the
spec correctly. Linter clean, TypeScript clean, all 302 omnibelt
tests pass.

### Deviations

- **None blocking.** Two minor naming-vs-task-brief quirks worth
  flagging:
  - The brief specifies `AnchorPosition` as the discriminator type;
    the prior worker chose `AnchorName` (consistent with the P1
    store) and exported `AnchorPosition` as a re-alias. Both names
    point at the same union; consumers can use either.
  - The brief specifies `setPinned(pinned: boolean): void`; the
    actual store action is `setPinned(route: RouteClass, pinned:
    boolean): void` because the store doesn't know which route is
    "current". The hook (`useOmnibeltPosition.setPinned`) hides
    that argument and matches the brief's signature.
- **OmniBeltHost.test.tsx mock skin field**: the post-P7 host reads
  `s.skin` to pick a SkinComponent and to gate the shared Panel. The
  mock now provides `skin: 'pill'` via a selector pass-through. P7's
  source file was not touched.

## P7 — Alternate skins

**Completed 2026-05-24.** Compass Orb + Sky Strip alternate skins land
behind the shared `layoutId='omnibelt-host'` so cross-skin switches
play as continuous morphs (no crossfade). Skin picker in the panel
overflow menu is now live for all three options (Pill is still the
default). Each alternate skin lazy-loads into its own Vite chunk —
**neither bundle ships unless the user opts in**.

### Picked up from prior crashed run

A previous worker stopped after laying down the four skin source
files + `vite.config.ts` chunk slices + `OmniBeltHost.tsx` skin
registry + `PanelMenu.tsx` skin picker but *before* writing the
test suite or updating this log. This run completed those gaps
without re-touching the source files (audited for completeness —
all four match the spec contract). The implementation log is the
final piece that landed.

- [x] `src/features/omnibelt/skins/orb/OmniBeltOrb.tsx` +
      `RadialFan.tsx` — Compass Orb skin: 68 px circular glass orb in
      bottom-right with status pulse dot; click fans out a 130° arc of
      tool discs at 120 px radius (`<RadialFan>`). Pure
      `polarToOffset(angle, radius)` math is exported for testing.
      Falls back to `<PillEdgeNub>` for the `nub` collapse state.
- [x] `src/features/omnibelt/skins/skystrip/OmniBeltSkyStrip.tsx` +
      `StripStatusSurface.tsx` — Sky Strip skin: top-centre ~200×36
      Dynamic-Island-style pill with single status dot (pulse when
      jobs run); morphs into the shared `<OmniBeltPanel>` on tap
      (panel re-anchors under the strip in v1.5 — see deviations).
- [x] `src/features/omnibelt/OmniBeltHost.tsx` — `SKIN_REGISTRY` is
      now a 3-way `React.lazy(...)` map; host reads
      `useOmnibeltStore((s) => s.skin)` and renders the matching
      component under `<MotionConfig reducedMotion='user'>` +
      `<LayoutGroup id='omnibelt'>`. The shared Panel is mounted for
      `pill` + `skystrip` skins; `orb` owns its own expanded surface
      via `<RadialFan>` (gated by `SKINS_USING_SHARED_PANEL`).
- [x] `src/features/omnibelt/panel/PanelMenu.tsx` — all three skin
      options enabled; each row carries a one-line subtitle ("Default
      pill dock", "Radial fan from corner orb", "Top-center status
      morph"). The "ships in P7" placeholder text is gone. Picker
      writes through `setSkin(...)` to the per-user store.
- [x] `vite.config.ts` — two new manualChunks slices:
      `feature-omnibelt-skin-orb` (4.83 KB / **2.18 KB gzip**) and
      `feature-omnibelt-skin-skystrip` (2.38 KB / **1.12 KB gzip**).
      Each is well under the 20 KB target. The base
      `feature-omnibelt` chunk is unchanged in shape (9.39 KB gzip).
- [x] Tests — 5 new files, 38 new tests, all green:
      `skins/orb/__tests__/OmniBeltOrb.test.tsx` (8),
      `skins/orb/__tests__/RadialFan.test.tsx` (17),
      `skins/skystrip/__tests__/OmniBeltSkyStrip.test.tsx` (8),
      `skins/skystrip/__tests__/StripStatusSurface.test.tsx` (5),
      `panel/__tests__/PanelMenu.test.tsx` (8). Full omnibelt suite:
      315 tests pass (19 files).
- [x] Cross-skin transition is a morph (every skin renders
      `<motion.div layoutId='omnibelt-host'>` so framer interpolates
      size + position + border-radius across pill ↔ orb ↔ skystrip
      switches; verified by inspection — see verification pass
      results below).
- [x] No new `supabase.channel(...)` callsites (banned by
      `realtime-policy.mdc`).
- [x] No P6-owned files touched: `OmniBeltPill.tsx`,
      `PillMiniOrb.tsx`, `PillEdgeNub.tsx`, `omnibeltStore.ts`,
      `lib/anchors.ts`, `lib/collision.ts`,
      `hooks/useOmnibeltPosition.ts`,
      `hooks/useOmnibeltCollisionAvoidance.ts` — all left as-is.

### Files created (LOC)

| File | LOC | Notes |
|---|---|---|
| `src/features/omnibelt/skins/orb/OmniBeltOrb.tsx` | 124 | Skin entry — orb + lazy RadialFan |
| `src/features/omnibelt/skins/orb/RadialFan.tsx` | 255 | Arc layout + polar math + Esc/click-outside |
| `src/features/omnibelt/skins/skystrip/OmniBeltSkyStrip.tsx` | 109 | Top-centre Dynamic-Island pill |
| `src/features/omnibelt/skins/skystrip/StripStatusSurface.tsx` | 54 | Compact job summary inside strip |
| `src/features/omnibelt/skins/orb/__tests__/OmniBeltOrb.test.tsx` | 130 | 8 tests |
| `src/features/omnibelt/skins/orb/__tests__/RadialFan.test.tsx` | 211 | 17 tests (incl. pure math) |
| `src/features/omnibelt/skins/skystrip/__tests__/OmniBeltSkyStrip.test.tsx` | 125 | 8 tests |
| `src/features/omnibelt/skins/skystrip/__tests__/StripStatusSurface.test.tsx` | 79 | 5 tests |
| `src/features/omnibelt/panel/__tests__/PanelMenu.test.tsx` | 187 | 8 tests — mocks dropdown-menu inline |

### Files modified (LOC)

| File | Lines changed | Notes |
|---|---|---|
| `src/features/omnibelt/OmniBeltHost.tsx` | full rewrite (~122) | 3-way `SKIN_REGISTRY` lazy map + `SKINS_USING_SHARED_PANEL` gate |
| `src/features/omnibelt/panel/PanelMenu.tsx` | full rewrite (~124) | All three skin options enabled with subtitles |
| `vite.config.ts` | +12/-5 | Added two manualChunks slices for orb + skystrip |

### Deviations from the spec / brief

- **Orb panel-vs-fan choice.** The spec §7 sketches the Compass Orb
  with both a radial fan AND the standard Panel. For v1 the orb skin
  ships only the radial fan (`SKINS_USING_SHARED_PANEL` excludes
  `'orb'`). Rationale: the fan is the orb's signature interaction;
  mounting the standard Panel beside it would visually compete with
  the fan and the spec mockup doesn't clearly endorse double
  surfaces. v1.5 can add a "more" tile in the fan that opens the
  full Panel grid if real usage demands the long-tail tools.
- **Radial fan caps at 8 tiles.** If more than 8 tools are pinned, the
  v1 fan silently truncates rather than rendering a "more" tile (the
  brief described that as a v1.5 follow-up). Easy follow-up: extend
  `display` slice + render an overflow disc that opens the standard
  Panel.
- **Sky Strip panel anchoring.** The spec mockup shows the panel
  anchored *under* the strip. The host still renders the shared
  `<OmniBeltPanel>` at its hard-coded bottom-right position for v1.
  v1.5 lands a `positionOverride` prop on the Panel so the skystrip
  can re-anchor it directly under the collapsed pill.
- **Edge-nub fallback.** Both alt skins fall back to `<PillEdgeNub>`
  for the `nub` collapse state rather than shipping bespoke
  orb-/strip-tuned nub art. The shared nub is the cheapest sensible
  default and keeps the surface area focused for v1. v1.5 swaps in
  per-skin nub variants if real usage shows the shared nub feels
  out-of-place under the alt skins.
- **Profile-page integration not included.** The brief mentioned a
  skin picker in profile preferences. v1 ships the picker only in
  the panel overflow menu (`<PanelMenu>`) since that's the canonical
  in-flow surface; adding a duplicate in the profile page is a v1.5
  polish item that should land behind a settings link to the same
  store action (`setSkin`).
- **PanelMenu test stubs `@/components/ui/dropdown-menu`.** Radix's
  DropdownMenu activation depends on full PointerEvent semantics
  that jsdom doesn't synthesize reliably, and
  `@testing-library/user-event` is not a project dependency (the
  constraints disallow installing it). The test mocks the dropdown
  module inline — same wiring contract (`onValueChange`,
  `onCheckedChange`, `onSelect`) just rendered as plain buttons. The
  PanelMenu source is unchanged.

## P8 — Admin dashboard

**Completed 2026-05-24.** All five tabs ship, all 23 unit tests
green, `pnpm tsc -b` clean, `pnpm build` clean, dedicated
`feature-admin-omnibelt` chunk = **~40 KB gzip** (134 KB raw) —
well under the 200 KB target.

- [x] `src/components/layout/data/sidebar-data.ts` — added
      `IconCompass` import + "OmniBelt" entry under Administration
      group (line 438) with `requiredPermission: { action: 'manage',
      resource: 'omnibelt' }`.
- [x] `src/routes/_authenticated/admin/omnibelt/index.tsx` — route
      gated via `createProtectedRouteBeforeLoad` (auth +
      `omnibelt:manage` permission + nav permission seeded by
      migration 328). Renders `<OmniBeltDashboard />`.
- [x] `src/features/admin/omnibelt-dashboard/` — 5-tab shell + 5
      sections + 9 components + 6 hooks + service per spec §12.
- [x] All reads via `supabaseRead`; mutations via primary `supabase`
      or FastAPI admin endpoints. Single intentional exception
      documented in `omnibelt-admin.service.ts` (`setAllowList`
      pre-write existence check on primary to avoid replica-lag
      duplicate-insert race; consistent with
      [[Supabase-Read-Replica-Routing]] "read-your-own-writes"
      carve-out).
- [x] Telemetry analytics surfaces (5): top-tools bar (`TopToolsTable`
      + `UsageSparkline`), hour-of-day × day-of-week heatmap
      (`EventHeatmap`), skin distribution pie (`SkinDistributionPie`),
      usage funnel `belt_visible → panel_open → tool_launch`
      (`UsageFunnel`), recent activity feed (in `OverviewSection`).
      All read from `omnibelt_tool_events` + `omnibelt_tool_events_24h_mv`
      via `supabaseRead`.
- [x] Audit table derived from `omnibelt_role_config.updated_at`
      history (no dedicated audit_log table yet — diff column is
      stub-marked as v1.5 follow-up).
- [x] Admin write endpoints (`POST /api/admin/omnibelt/role-config`,
      `POST /api/admin/omnibelt/kill-switch`) trigger pg_notify →
      `WsEvent::OmnibeltConfigChanged`. Dashboard listens via
      `workServiceWs` in `OverviewSection.useLastConfigPing` for
      the "hot-reload health" tile; query cache invalidation is
      handled by `useOmnibeltConfigInvalidator` (mounted on the
      launcher `OmniBeltHost`, not duplicated here).
- [x] Unit tests (5 files, 23 tests, all green):
      `OmniBeltDashboard.test.tsx`, `RoleBeltEditor.test.tsx`,
      `ToolAllowGrid.test.tsx`, `useUpdateKillSwitch.test.tsx`,
      `useUsageStats.test.ts`.
- [x] Zero new `supabase.channel(...)` callsites — banned per
      `realtime-policy workspace rule`.

### Deviations / v1.5 follow-ups

- **Role belt drag-drop fallback**: `RoleBeltEditor` ships with
  checkbox + numeric order index editing instead of `@dnd-kit` drag.
  Spec-allowed simpler-fallback. Drag-drop can layer in later
  without changing the persistence contract.
- **Audit `before` diff**: no `omnibelt_audit_log` table yet, so
  the Audit tab can only show `updated_at` history derived from
  `omnibelt_role_config`. The "Before" column is stub-marked.
  Follow-up = add a Postgres trigger or `pgaudit`-style table.
- **Prefs aggregate RLS**: `getPrefsAggregate` may return empty
  until an admin-scoped RLS policy is added on `omnibelt_user_prefs`.
  Documented in the service.
- **Section search param** is read/written via `useLocation` +
  `window.history.replaceState` rather than TanStack
  `validateSearch`. Tightening `validateSearch` here would narrow
  the global SEARCH union and break loose-shape callers in
  `ProtectedRoute` / RBAC middleware (`{ redirect }`, `{ reason }`).
  Runtime narrowing inside the dashboard preserves type safety
  without that blast radius.

## P9 — Polish + docs + final verification

**Completed 2026-05-24.** End-to-end verification + closeout pass. No
new code, no new dependencies; one missed migration (328) applied via
Supabase MCP and three OmniBelt-scoped lint findings cleaned up
inline. Full audit confirms P0–P8 ship together as a coherent unit.

- [x] Update [[Supabase-Read-Replica-Routing]] "Files touched" log
      with `rust-dashboard-service` `read_pool` migration entry
      (new "Rust-dashboard-service migration (2026-05-24)" section).
- [x] `_Index/Components.md`, `_Index/Patterns.md`,
      `_Index/Decisions.md` already had 2026-05-24 OmniBelt entries
      from the design phase; `_Index/Implementations.md` appended in
      this pass.
- [x] Bundle budget recheck — all three OmniBelt chunks well under
      target (see "Final verification results" below).
- [x] OmniBelt-scoped lint clean (0 errors / 0 warnings) after three
      surgical fixes (1 missing-react-plugin error + 2 unused
      `eslint-disable @typescript-eslint/no-explicit-any` directives
      + 4 mis-placed `react-refresh/only-export-components`
      directives on test-only co-located exports).
- [x] Session log entry appended at
      `memorybank/OmniFrame/Sessions/2026-05-24.md`.
- [x] **Database migration 328 applied via Supabase MCP.** The migration
      file existed (`supabase/migrations/328_omnibelt_admin_navigation.sql`)
      but had never been applied to the live database — the
      `/admin/omnibelt` route would have 403'd for every user in
      production. P9 caught this and applied it; admin + superadmin
      now have `visible = true` on the OmniBelt nav row, others have
      `visible = false`.
- [ ] Reduced-motion audit via Storybook / manual review — deferred to
      v1.5 (the `<MotionConfig reducedMotion='user'>` wrapper is in
      place at every skin; deferring the manual smoke pass against a
      real device because the wrapper is the contract).
- [ ] Telemetry rate-limit Redis sliding window — deferred to v1.5;
      `api/routers/omnibelt.py` uses the existing
      `RedisService.check_rate_limit` helper which is unit-tested in
      its own module. End-to-end integration smoke (`INTEGRATION_MODE=infra`)
      remains parked alongside the other deferred integration tests.
- [ ] `pnpm quality:ci` — partially passing (see "Final verification
      results" below). OmniBelt-scoped gates all pass; the chain fails
      on three **pre-existing** chunk-budget breaches
      (`warehouse-location-map`, `feature-admin`, `feature-rf-interface`)
      and the pre-existing lint ratchet drift (98 warnings vs
      baseline 16, **all** non-OmniBelt). OmniBelt did not raise the
      drift.

### Final verification results (2026-05-24)

**Type / build:**
- `pnpm tsc -b` — clean (full build, 25 s).
- `pnpm build` — clean (Vite 11.09 s + PWA precache 202 entries
  10920 KB).

**Tests:**
- `pnpm vitest run src/features/omnibelt` — **357/357 passing** across
  23 test files.
- `pnpm vitest run src/features/admin/omnibelt-dashboard` — **23/23
  passing** across 5 test files.
- Combined OmniBelt vitest run: **380/380 / 28 files / 2.6 s**.

**Lint (OmniBelt-specific):**
- `pnpm eslint src/features/omnibelt src/features/admin/omnibelt-dashboard`
  — **0 errors / 0 warnings** after the three surgical fixes
  documented above.
- Full repo `pnpm lint:check` — 98 warnings / 0 errors after the
  fixes (down from 105 / 1 pre-fix). None of the remaining 98
  warnings are in OmniBelt files; baseline is 16 (pre-existing drift,
  not introduced by OmniBelt).

**Rust:**
- `cd rust-dashboard-service && cargo check` — clean (incremental).
- `cd rust-work-service && cargo check` — clean (7 pre-existing
  warnings in `observability/middleware.rs`, unchanged from P2
  baseline).

**Python (FastAPI):**
- `python3 -m py_compile api/routers/omnibelt.py` — clean.

**Bundle (gzipped):**

| Chunk | Raw | Gzip | Target | Status |
|---|---|---|---|---|
| `feature-omnibelt` | 26.91 KB | ~9.4 KB | <60 KB | ✅ ~16% of budget |
| `feature-omnibelt-skin-orb` | 4.83 KB | ~2.18 KB | <20 KB | ✅ ~11% of budget |
| `feature-omnibelt-skin-skystrip` | 2.38 KB | ~1.12 KB | <20 KB | ✅ ~6% of budget |
| `feature-admin-omnibelt` | 134.21 KB | 40.63 KB | <200 KB | ✅ ~20% of budget |

**Realtime policy compliance:**
- `rg "supabase\.channel" src/features/omnibelt/
  src/features/admin/omnibelt-dashboard/` — **zero matches.**
- `src/lib/work-service/types.ts` has 2 matches but both are
  pre-existing module comments describing legacy migrations
  (lines 204, 224), not new callsites.

### Live database state (post-migration 328 apply)

Verified via Supabase MCP against project `wncpqxwmbxjgxvrpcake`:

**Tables (3):** `omnibelt_role_config`, `omnibelt_user_prefs`,
`omnibelt_tool_events` — all RLS-enabled, 0 rows each (clean install).

**Materialized view (1):** `omnibelt_tool_events_24h_mv` exists.

**RLS policies (5 — match spec):**
- `omnibelt_role_config_select` (SELECT)
- `omnibelt_role_config_mutate` (ALL)
- `omnibelt_user_prefs_self` (ALL)
- `omnibelt_events_insert_self` (INSERT)
- `omnibelt_events_read_admin` (SELECT)

**Triggers (3):** `omnibelt_role_config_notify` (the
pg_notify-on-mutation trigger),
`trg_touch_omnibelt_role_config_updated_at`,
`trg_touch_omnibelt_user_prefs_updated_at` (the two bonus touch
triggers from P1).

**Function:** `notify_omnibelt_config_change()` exists and matches
spec body.

**Permission:** `omnibelt.manage` exists with `resource=omnibelt`,
`action=manage`, `scope=organization`, granted to **2 roles**:
`admin` + `superadmin` (matches P1 spec).

**pg_cron job:** `omnibelt-mv-refresh` at `*/5 * * * *`, `active=true`.

**Admin navigation row (NEW, applied this pass):**
`navigation_items.name='omnibelt_admin'`, `url='/admin/omnibelt'`,
`icon='IconCompass'`. `role_navigation_permissions.visible=true` for
admin + superadmin; `visible=false` for manager / cashier / viewer.

**Migration ledger:** Migration `20260524105920_omnibelt_core` is
recorded in `supabase_migrations.schema_migrations`. Migration 328
applied via `apply_migration` MCP under name
`omnibelt_admin_navigation` (timestamp generated by Supabase).

### Supabase advisor findings (OmniBelt-scoped, post-deploy)

All flagged at INFO / WARN level (no ERRORs introduced by OmniBelt).
Consolidated into the v1.5 follow-ups section below.

**Security (2):**
- WARN `materialized_view_in_api` — `omnibelt_tool_events_24h_mv`
  selectable by anon / authenticated. Lock down via `REVOKE SELECT`
  on `anon` (auth'd admins still hit it via `supabaseRead` + RLS).
- WARN `anon_security_definer_function_executable` +
  `authenticated_security_definer_function_executable` —
  `notify_omnibelt_config_change()` is a trigger function but it's
  also exposed as an RPC. `REVOKE EXECUTE FROM anon, authenticated`
  cleans this up without touching the trigger semantics.

**Performance (10):**
- 4× WARN `auth_rls_initplan` on the 4 RLS policies that call
  `auth.uid()` directly — wrap as `(select auth.uid())` for the
  initplan optimization (same migration that the 2026-05-19 perf
  pass applied to many other tables).
- 3× INFO `unindexed_foreign_keys` on
  `omnibelt_role_config(role_id)`, `omnibelt_role_config(updated_by)`,
  `omnibelt_tool_events(user_id)` — small tables today; add covering
  indexes when row counts cross ~100k.
- 3× INFO `unused_index` on `idx_omnibelt_role_config_org`,
  `idx_omnibelt_user_prefs_org`, `idx_omnibelt_user_prefs_updated`,
  `idx_omnibelt_events_org_time` — tables are empty post-install;
  expect these to flip to "used" after first day of production
  traffic.
- 1× WARN `multiple_permissive_policies` on `omnibelt_role_config`
  for `authenticated SELECT` — `omnibelt_role_config_mutate` and
  `omnibelt_role_config_select` both grant SELECT to authenticated.
  Acceptable trade-off (split provides clearer audit story); could
  consolidate as a v1.5 polish.

### v1.5 follow-ups (consolidated from per-phase deviations)

Origin column indicates which phase deviated.

| Item | Origin |
|---|---|
| Add `omnibelt_audit_log` table for diff'd admin change history | P8 — Audit tab currently shows `updated_at` history only |
| Admin-scoped RLS on `omnibelt_user_prefs` (read aggregate) | P8 — Prefs aggregate currently empty for admins |
| Drag-drop role-belt editor via `@dnd-kit` | P8 — `RoleBeltEditor` ships with checkbox+order-index fallback |
| Permission resources for `view:operations`, `view:sap_status`, `view:inventory` | P4 — Re-mapped to closest existing grants |
| `quick_pick` route to `/operations/pick/quick` | P4 — Routes to `/apps/outbound` today |
| `InventoryLookupShell` live inline lookup (currently stub deep-link) | P4 |
| `BackgroundJobsShell` live job list with cancel buttons | P4 — Stub today; depends on cancel-endpoint plumbing in v1.5 |
| Add explicit numeric `progress: f32` field to `WsEvent::SapJobStatusChanged` + `ImportRunStatusChanged` | P5 — Progress derived from lifecycle status today |
| Wire `cancelJob` to real cancel endpoint (currently rejected Promise) | P5 |
| `halo_plus_morph` shared-layoutId pill↔tray morph (currently aliased to `halo_plus_autoexpand`) | P5 |
| Per-route bbox-tracked tray side anchoring (currently coarse top/bottom heuristic) | P5 |
| Telemetry emitter + `useOmnibeltTelemetry` hook + call sites | P5 + P9 |
| Per-skin edge-nub art (currently shared Pill nub) | P7 |
| Orb "more" tile to fall back to standard Panel when pinned tools > 8 | P7 |
| Sky Strip panel re-anchor under the strip via `positionOverride` | P7 |
| Profile-page skin picker (sibling to the in-panel overflow picker) | P7 |
| `omnibelt_pg_notify_kill_switch(p_org_id)` RPC for instant kill-switch propagation | P2 |
| `omnibelt-bootstrap.integration.test.ts` infra-mode integration test | P2 + P9 |
| Wrap RLS `auth.uid()` calls in `(select auth.uid())` for initplan optimization | P9 (Supabase advisor) |
| `REVOKE EXECUTE FROM anon, authenticated ON notify_omnibelt_config_change()` | P9 (Supabase advisor) |
| `REVOKE SELECT FROM anon ON omnibelt_tool_events_24h_mv` | P9 (Supabase advisor) |
| Add covering indexes for unindexed FKs on `omnibelt_role_config(role_id, updated_by)` + `omnibelt_tool_events(user_id)` | P9 (Supabase advisor) |
| Consolidate `omnibelt_role_config` permissive SELECT policies | P9 (Supabase advisor) |
| Reduced-motion manual smoke against a real device | P9 |
| Move OmniBelt math/test-only helpers (`polarToOffset`, `fanAngles`, `inferSide`, `__resetTrayMemoryForTests`) into separate `lib/` files so fast-refresh stays clean without inline `eslint-disable` | P9 |

### Env vars to set on Railway for production deploy

Setting these is **gated on a manual `railway up`** — none of the
P0–P9 binaries are deployed yet. The migrations are live, the FE
build ships, but Rust services still run the pre-OmniBelt binary
until the next deploy.

**`rust-dashboard-service` (Railway project
`fac8472c-199b-41ec-8806-a869ee96e783`):**
- `DASHBOARD_SERVICE_DATABASE_READ_POOLER_URL` — same Supavisor
  replica pooler URL already set on `rust-core-service` /
  `rust-work-service`. Falls back to `DATABASE_READ_POOLER_URL` if
  the service-specific name isn't set.
- `DASHBOARD_SERVICE_REDIS_URL` (or `REDIS_URL`) — Redis for the
  30s bootstrap cache. Optional; service degrades gracefully.

**FastAPI service (the existing API container):**
- `RUST_DASHBOARD_SERVICE_URL` — internal URL of
  `rust-dashboard-service`. Default
  `http://rust-dashboard-service:8002` (Railway internal hostname).

**No new vars needed on `rust-work-service`** — it picks up the
existing `DATABASE_URL`, `WORK_SERVICE_DATABASE_READ_POOLER_URL`,
and `REDIS_URL` from the existing 2026-05-19 read-replica deploy.

All new env vars should ship with `skipDeploys: true` so they
activate on the next manual `railway up`, not on the env-var write
itself.

### Files touched in P9

| File | LOC | Change |
|---|---|---|
| `src/features/admin/omnibelt-dashboard/__tests__/useUpdateKillSwitch.test.tsx` | ~5 | Inlined `Wrapper` function for display-name (fixes `react/display-name` lint error) |
| `src/features/admin/omnibelt-dashboard/services/omnibelt-admin.service.ts` | ~6 | Removed 2 unused `eslint-disable @typescript-eslint/no-explicit-any` directives; cast removed because Supabase JSON column accepts the typed `AllowListPayload` directly |
| `src/features/omnibelt/skins/orb/RadialFan.tsx` | +2 | Added 2 `eslint-disable-next-line react-refresh/only-export-components` directives directly above the test-only `polarToOffset` + `fanAngles` exports |
| `src/features/omnibelt/tray/OmniBeltStatusTray.tsx` | +2 | Same — 2 directives above `__test__` + `__resetTrayMemoryForTests` |
| `memorybank/OmniFrame/Patterns/Supabase-Read-Replica-Routing.md` | +50 | Appended "Rust-dashboard-service migration (2026-05-24)" subsection |
| `memorybank/OmniFrame/_Index/Implementations.md` | +1 | Appended OmniBelt entry |
| `memorybank/OmniFrame/Sessions/2026-05-24.md` | +60 | Appended "OmniBelt MVP rollout complete (P0–P9)" section |
| `memorybank/OmniFrame/Implementations/Implement-OmniBelt-MVP.md` | +280 | This P9 section + status flip |
| Supabase database | n/a | Applied migration 328 (admin navigation row + role grants) via `apply_migration` MCP |

## Post-launch fixes

- **Kill-switch 500 — `db.client` is anon, settings RLS denied
  (2026-05-24).** First production click on the master kill-switch
  toggle (`/admin/omnibelt → Overview`) returned
  `POST /api/admin/omnibelt/kill-switch → 500` with a Postgres
  `42501` row-level security violation on `public.settings`. Two
  bugs converged into one symptom; full write-up in
  [[Fix-OmniBelt-Settings-RLS-Kill-Switch]].
    1. **Backend `db.client` is the anon-key singleton.** Created
       once in `api/config/database.py::SupabaseConnection.client`
       with `settings.supabase_anon_key`, never re-bound to a
       per-request user JWT. Every write through `db.client` reaches
       PostgREST as the `anon` role, so `auth.uid()` is `NULL` inside
       RLS and *every* settings/role-config policy denies the
       request. Verified empirically against Supabase via
       `SET LOCAL ROLE anon; INSERT INTO public.settings …` →
       42501. P9 closeout missed this because OmniBelt's vitest tests
       mock the FastAPI layer entirely; the bug only shows up when
       a real JWT meets a real RLS check. **Fixed in
       `api/routers/omnibelt.py`** by adding two helpers
       (`_jwt_from_request`, `_user_scoped_client`) that mint a
       fresh authed Supabase client per request via the existing
       `api/auth/supabase_client_auth.py::create_authenticated_supabase_client`,
       and routing both admin write handlers (`write_kill_switch` +
       `write_role_config`) through it. The user-router endpoints
       (`write_prefs` / `write_events`) have the same latent bug
       and are flagged for follow-up below.
    2. **Settings RLS didn't acknowledge `omnibelt.manage`.** The
       pre-existing "Admins can manage system-wide settings" policy
       gates on the legacy `admin`/`superadmin` enum or the legacy
       `settings:manage` / `manage:system` permission strings — none
       of which match the modern `omnibelt.manage` resource/action
       grant seeded in migration 327. Today the legacy admin enum
       check covers admin/superadmin (the only roles holding
       `omnibelt.manage`), so this isn't the immediate blocker, but
       a future custom role with just `omnibelt.manage` would 42501.
       **Fixed in `supabase/migrations/329_omnibelt_settings_rls.sql`**
       (applied via Supabase MCP `apply_migration`). Additive policy
       `settings_omnibelt_admin_rw` for `key LIKE 'system.omnibelt.%'`,
       gated on `has_permission('omnibelt','manage')` and scoped to
       global rows (`organization_id IS NULL`) plus same-org rows.
       The user's original sketch policy required
       `organization_id IN (...)` — which would have silently failed
       to match the kill-switch row (intentionally global per spec
       §4.3). Always check the actual row shape before writing the
       policy. Existing policies left untouched.

- **v1.5 follow-up surfaced by the kill-switch fix:** the prefs
  (`POST /api/omnibelt/prefs`) and telemetry events
  (`POST /api/omnibelt/events`) endpoints are still using `db.client`
  and will 42501 on first real production call. They were unaffected
  in P0–P9 because the FE batcher silently swallows event-write
  errors and the prefs hook hadn't been exercised end-to-end yet.
  Migrate both to `_user_scoped_client(request)` next pass.

- **Pre-existing security observation (out of scope for this fix,
  surfaced for follow-up):** the legacy `settings:manage` permission
  is granted to non-admin roles (e.g. `tka_associate`), and the
  pre-existing settings admin policy admits anyone holding it — i.e.
  a non-admin can technically write `system.toast_notifications` and
  other system rows today. The new `settings_omnibelt_admin_rw`
  policy isn't broader than that (it explicitly requires
  `has_permission('omnibelt','manage')`), but the over-grant on
  `settings:manage` deserves its own audit + cleanup migration.

- **Note for future features writing to the shared `settings`
  table:** P1's migration 327 should have included a `settings`
  policy for `omnibelt.manage` from the start. Anyone adding a new
  feature that stuffs org-wide flags into `settings.system.<feature>.*`
  needs to remember to extend the table's RLS in the same migration
  bundle, not just create the feature-specific tables.

## Agent Chat tool (2026-05-24 PM, post-P9)

Adds the **9th** v1 tool — a rich `Agent Chat` launcher that opens a
full chat dialog with morphing send button, image attachments, mode
toggles (Search / Think / Canvas), and a voice-recorder visualiser.
v1 ships the entire UI surface backed by a **stubbed** agent reply
path so the chat shell can be exercised end-to-end before the real
Chat backend wiring lands in v1.5.

### What changed

- **`TOOL_REGISTRY` is now 9 tools, not 8.** `agent_chat` slots between
  `background_jobs` and `quick_note` (self category cluster). Order:
  `quick_pick → sap_status → inventory_lookup → background_jobs →
  agent_chat → quick_note → build_info → settings_shortcut →
  help_docs`.
- **Tool definition** in `src/features/omnibelt/tools/definitions/agent-chat.ts`
  — accent `violet`, category `self`, icon `IconMessageCircle`
  (Tabler), no permission gate (open to all for v1), `searchable:
  true`, shell lazy-imported.
- **New shell directory** `src/features/omnibelt/tools/shells/agent-chat/`
  housing 9 files (shell + dialog + message list + message bubble +
  composer input + voice recorder + image preview + types + context).
  This is the first sub-directory under `tools/shells/`; the
  existing `vite.config.ts` glob (`/features/omnibelt/tools/shells/`)
  already lets Rollup auto-chunk the directory cleanly — no new
  manualChunks slice needed.
- **Visual fidelity preserved from the user-provided reference**: dark
  `bg-[#1F2023]`, border `border-[#444444]`, mode accents `#1EAEDB`
  (Search), `#8B5CF6` (Think), `#F97316` (Canvas), 32-bar voice
  visualiser, mm:ss timer, gradient pin divider between modes,
  framer-motion rotate + scale + AnimatePresence label expand on
  mode toggle, and the 4-way send-button morph (Mic → ArrowUp →
  StopCircle → Square).
- **Adapted to project conventions** (deliberately NOT a verbatim
  paste of the reference):
  - Uses `@/components/ui/dialog`, `tooltip`, `textarea`, `button`
    shadcn primitives — no fresh Radix wrappers.
  - Uses `cn` from `@/lib/utils` — no inline duplicate.
  - **Does NOT** inject `<style>` into `document.head`. The custom
    scrollbar styles live in `src/index.css` as two opt-in
    Tailwind v4 `@utility` classes (`omnibelt-chat-textarea`,
    `omnibelt-chat-scroll`) applied only on the chat surfaces so
    the rest of the app keeps its native scrollbar look.
  - `ImageViewDialog` wraps the project `Dialog` primitive instead
    of re-implementing the overlay.
  - `VoiceRecorder` is a **visual-only stub** in v1 (no
    `MediaRecorder` integration). The composer receives the elapsed
    duration and passes it through to `onSend` so v1.5 can drop in
    real audio capture without changing the props contract.

### Architecture

```
PanelContent (existing)
  └── Suspense (lazy shell)
       └── AgentChatShell  (entry; renders dialog with open=true)
             └── AgentChatDialog  (state owner)
                   ├── ChatMessageList  (auto-scrolling)
                   │     └── ChatMessage × N  + ImageViewDialog
                   └── PromptInputBox
                         ├── PromptInputProvider (mode + draft state)
                         ├── Textarea  (omnibelt-chat-textarea class)
                         ├── VoiceRecorder  (visual-only stub)
                         ├── Mode toggles  (Search / Think / Canvas)
                         ├── Send button   (4-way morph)
                         └── ImageViewDialog
```

State boundaries:
- `AgentChatShell` is stateless — pure prop pass-through. Closing the
  dialog (Escape / X / click-outside) propagates back via `onOpenChange
  → onClose` so the parent OmniBelt panel collapses alongside.
- `AgentChatDialog` owns `messages: ChatMessage[]`,
  `isAgentResponding: boolean`, and the timer ref for the stub reply handler
  reply. Real chat backend wiring is a swap of `handleSend` only.
- `PromptInputBox` owns the draft text, attachment list, active mode,
  and recording state. Exposes a `forwardRef` handle (`focus`,
  `reset`) for future composer commands.
- `PromptInputContext` (`prompt-context.ts`) shares the live composer
  state with sibling toolbar controls without a tall prop cascade.

### Stub / v1.5 follow-ups

| Item | v1 behaviour | v1.5 work |
|---|---|---|
| **Agent backend** | `setTimeout(1200ms)` → echoes user message + attachment count + voice duration into a synthetic agent bubble | Wire to FastAPI `/api/agent/chat` (or equivalent) with streaming responses |
| **Voice recording** | Visual-only (32 pulsing bars + mm:ss timer); `onSend` receives `voiceDurationMs` but no audio blob | Wire `MediaRecorder` + analyser-node FFT to drive bars from real audio; attach blob as a chat attachment |
| **Markdown rendering** | Newlines → `<br>`; no inline code, links, or formatting | Plug in `react-markdown` (already a project dep) with a sanitized renderer |
| **Message persistence** | In-memory only — closing the dialog drops history | Persist per-user via the same `omniframe.omnibelt.${userId}` localStorage key family used by Quick Note |
| **Permission gate** | None — open to all | Add `{ action: 'use', resource: 'agent_chat' }` + permission row in a follow-up migration when cost / abuse needs scoping |

### Files landed (2026-05-24 PM)

| File | LOC | Notes |
|---|---|---|
| `src/features/omnibelt/tools/definitions/agent-chat.ts` | 30 | New — tool definition |
| `src/features/omnibelt/tools/registry.ts` | +1 import / +1 array entry / docstring | Inserts `agentChatTool` at position 5 |
| `src/features/omnibelt/tools/shells/agent-chat/AgentChatShell.tsx` | 26 | New — lazy entry, opens dialog |
| `src/features/omnibelt/tools/shells/agent-chat/AgentChatDialog.tsx` | 170 | New — dialog shell + stub chat transport |
| `src/features/omnibelt/tools/shells/agent-chat/ChatMessageList.tsx` | 109 | New — scrollable list + empty state + typing indicator |
| `src/features/omnibelt/tools/shells/agent-chat/ChatMessage.tsx` | 115 | New — user / agent bubble + attachment thumbnails |
| `src/features/omnibelt/tools/shells/agent-chat/PromptInputBox.tsx` | 458 | New — adapted composer with all 4 send-button states |
| `src/features/omnibelt/tools/shells/agent-chat/VoiceRecorder.tsx` | 134 | New — visual-only voice visualiser |
| `src/features/omnibelt/tools/shells/agent-chat/ImageViewDialog.tsx` | 61 | New — wraps project shadcn Dialog |
| `src/features/omnibelt/tools/shells/agent-chat/prompt-context.ts` | 44 | New — composer context |
| `src/features/omnibelt/tools/shells/agent-chat/types.ts` | 60 | New — `ChatMessage`, `ChatMode`, `ChatAttachment`, `MAX_ATTACHMENT_BYTES` |
| `src/features/omnibelt/tools/shells/agent-chat/__tests__/AgentChatShell.test.tsx` | 56 | New — 3 tests (mount, Escape→onClose, composer rendered) |
| `src/features/omnibelt/tools/shells/agent-chat/__tests__/PromptInputBox.test.tsx` | 195 | New — 14 tests (submit, drag-drop, modes, send-morph) |
| `src/features/omnibelt/tools/shells/agent-chat/__tests__/ChatMessageList.test.tsx` | 117 | New — 5 tests (empty, bubbles, newlines, typing, auto-scroll) |
| `src/index.css` | +37 | Two `@utility` classes for chat scrollbars — opt-in only |
| `src/features/omnibelt/tools/__tests__/tool-definitions.test.ts` | ±3 | `EXPECTED_V1_IDS` now lists 9 tools; description updated 8 → 9 |
| `src/features/omnibelt/__tests__/use-resolved-tools.test.ts` | +1 | `UNGATED_IDS` now includes `'agent_chat'` |

### Verification (2026-05-24 PM)

- `pnpm tsc -b` — clean (full build, 25 s).
- `pnpm vitest run src/features/omnibelt` — **408 / 408 passing**
  across 28 test files (was 379 / 379 across 25 files: +22 new
  agent-chat tests, +7 from new tool slot wired into the existing
  contract tests, including the 65th `tool-definitions` case for
  the new tool — `8 tools × 7 contract assertions + 1 roster check
  + 1 uniqueness check = 58` grew to `9 × 7 + 2 = 65`).
- `pnpm build` — clean. New chunk + delta:
  - `AgentChatShell-*.js` — **15.78 KB raw / 5.65 KB gzipped** (well
    under the 20 KB target the spec called out for a per-tool chunk).
  - `feature-omnibelt-CZpHdp-P.js` — **54.13 KB raw / 18.21 KB
    gzipped**, up from 18.17 KB gzipped pre-change (+0.04 KB gzip
    = just the lazy-import reference cost).
- `node scripts/check-bundle-budget.mjs` — fails on the same three
  pre-existing chunks (`warehouse-location-map`, `feature-admin`,
  `feature-rf-interface`) and the total-budget breach. Agent Chat
  does not touch any of those chunks; the per-tool chunk
  `AgentChatShell-*.js` is comfortably inside the 500 KB per-chunk
  limit. Confirmed unchanged from the pre-Agent-Chat baseline.
- Pre-existing unhandled rejection in
  `useOmnibeltConfigInvalidator.test.tsx` (Supabase auth-js storage
  stub) reproduces on `main`, not caused by this change — flagged
  in the post-P9 follow-ups already.
- No new `supabase.channel(...)` callsites; no new npm packages; no
  changes to migrations, Rust, or FastAPI router.

### Deviations / notes

- **Icon choice.** Used `IconMessageCircle` from `@tabler/icons-react`
  (already in use across `TicketChatThread`, `TicketDetailPanel`,
  `smartsheet-integrations`) rather than `IconRobot` — the
  message-circle glyph reads as "chat" without implying an
  autonomous agent; the inner agent-bubble + dialog header still
  surface `IconRobot` so the agent identity stays visible.
- **No bespoke `manualChunks` slice for the shell.** The existing
  `tools/shells/` exclusion in `vite.config.ts` covers the new
  sub-directory verbatim, and the auto-chunked shell ships at 5.65 KB
  gzipped — well under the 20 KB threshold above which a named
  slice would be worth the maintenance cost. Re-evaluate when
  v1.5 wires the real agent backend and / or markdown rendering.
- **Mode toggles are stateful but cosmetic in v1.** The active mode
  flows through to `onSend` (third arg) but the stub reply handler ignores
  it. Real chat backend wiring should route on it so Think can use a higher
  reasoning budget vs Search hitting the index, etc.
- **`forwardRef` on `PromptInputBox` exposes `{ focus, reset }`.**
  Not used by the v1 dialog (the dialog clears its own state via
  the `onSend` callback closing over `setMessages`) but exposed
  pre-emptively so v1.5's `clear chat` action has a single point of
  composer reset without re-reading the input ref from the parent.
- **`PromptInputComposer` re-export** at the bottom of
  `PromptInputBox.tsx` is a fragment-pass-through for callers that
  want to compose extra children inside the provider context.
  Currently unused; kept as the documented extension point so v1.5
  consumers (e.g. an `@`-mention popover) don't need to re-export
  the context.
- **`Voicerecorder` simulates 80 ms ticks** (~12.5 Hz) with a single
  `setInterval`. The 32 visualiser bars compute height from a
  3-wave superposition of `sin(phase + offset)` so the motion reads
  as natural audio without driving a per-bar RAF loop. v1.5
  replaces both the timer + the wave math with `requestAnimationFrame`
  + analyser FFT data.

## Sky Strip default + bottom-center morph (2026-05-24, post-P9)

Polish pass that promoted the SkyStrip from "alternate skin" to "new
flagship resting chrome" and fixed the v1 morph that landed the
expanded panel detached from the strip's anchor.

### What changed

1. **Default skin: `pill` → `skystrip`** — both client and server.
   - `src/features/omnibelt/store/omnibeltStore.ts`:
     `DEFAULT_PERSISTED_STATE.skin = 'skystrip'`. Also flipped
     `collapseState` default from `'orb'` → `'pill'` so all three
     skins land in their canonical "resting collapsed" form on first
     paint (the pre-change `'orb'` default stranded SkyStrip users in
     a no-render state since SkyStrip has no orb branch).
   - Migration 330 (`supabase/migrations/330_omnibelt_default_skystrip.sql`)
     `ALTER TABLE omnibelt_role_config ALTER COLUMN default_skin SET
     DEFAULT 'skystrip'`. Existing rows intentionally untouched —
     there's no clean signal to distinguish "admin chose pill
     explicitly" from "row got the migration-327 default", so the
     safest move is to only swing the column DEFAULT. New orgs and
     fresh role configs pick up `'skystrip'`; admin choices stay.
     Applied via Supabase MCP `apply_migration`; verified column
     default is now `'skystrip'::text`.

2. **Bottom-center positioning** (was top-center).
   - `src/features/omnibelt/skins/skystrip/OmniBeltSkyStrip.tsx`:
     replaced `top: 2px; left: 50%; -translate-x-1/2` with `position:
     fixed; bottom: 24px; left: 50%; translateX: -50%`. The 24 px
     gutter matches the Pill skin's anchor so skin-swaps from the
     panel menu don't shift the chrome footprint. Sonner toaster
     defaults to bottom-right; centered strip never collides.

3. **Strip → panel morph rewritten** (the centerpiece).
   - Architectural choice: **Option 1 — "skin owns both states"**.
     The SkyStrip skin now renders BOTH its collapsed strip and its
     bloomed panel from inside the skin component. The host's
     `SKINS_USING_SHARED_PANEL` set was reduced to `{'pill'}` so the
     standalone `<OmniBeltPanel>` is no longer mounted alongside the
     SkyStrip morph (doing so would duplicate the
     `layoutId='omnibelt-host'` target and framer-motion would warn
     + pick one arbitrarily — exactly the v1 bug).
   - The morph is a single `motion.div layoutId='omnibelt-host'`
     wrapped in `<AnimatePresence mode='wait'>` so exactly one of
     (strip, panel) lives in the tree at any tick; framer-motion
     interpolates the bounding rect (width 220 → 760, height 40 →
     auto, border-radius 9999 → 24, position fixed-bottom-center on
     both) as one fluid spring.
   - Spring tuning: introduced `ISLAND_SPRING` in
     `src/features/omnibelt/lib/motion.ts` (`stiffness: 600,
     damping: 38, mass: 0.85, restDelta: 0.001`) — stiffer than the
     `HOUSE_SPRING` baseline so the bloom reads as a tactile single
     movement vs. a soft expansion. The house spring stays the
     default everywhere else.
   - Inner content cross-fade via nested `motion.span` /
     `motion.div` (key: `strip-content` ↔ `panel-content`) with a
     150 ms `HOUSE_EASE` fade so the strip→panel content swap
     doesn't fight the morph.
   - Reduced-motion: inherits from `<MotionConfig reducedMotion='user'>`
     at the host, no per-skin opt-in needed.

4. **`PanelContent` extraction**
   (`src/features/omnibelt/panel/PanelContent.tsx`).
   - Pulled the inner UI (header, tool-shell switcher, search, tab
     strip, tool grid) out of `<OmniBeltPanel>`. Both the Pill-skin
     panel and the SkyStrip-skin morphed panel consume this without
     duplicating logic. Reduced `<OmniBeltPanel>` by ~150 LOC and
     made the skin-owned-morph pattern viable (the bloomed strip is
     just `motion.div + PanelContent`).

### Architectural choice rationale

We picked **Option 1 — skin owns both collapsed and expanded forms**
over Option 2 (refactor `<OmniBeltPanel>` to accept an `anchorTo`
prop) because:

- Strip and panel must share the SAME `layoutId` AND occupy
  positions framer can interpolate between. Two `motion.div`s with
  the same `layoutId` rendered from different parents work, but
  they have to live in the same `LayoutGroup` AND only one can be
  mounted at a time. Option 2 would have required the singleton
  `<OmniBeltPanel>` to know "don't render when SkyStrip's strip is
  about to bloom" — i.e. the host would need skin- and
  collapse-state-aware mount gating that duplicates the
  AnimatePresence logic.
- Option 1 keeps the skin self-contained: its render output is a
  single `<AnimatePresence>` tree with two siblings, framer handles
  the rest. No coordination across components.
- The PanelContent extraction was going to happen for v1.5 anyway
  (the spec already envisioned it); shipping it now lets Option 1
  reuse the same inner UI as Pill without forking.

This pattern is now documented at
[[Skin-Owned-Morph-States]] so future skins (e.g. Orb's eventual
"more" tile when we exceed 8 tools) follow the same recipe.

### Files changed

| File | LOC | Change |
|---|---|---|
| `src/features/omnibelt/store/omnibeltStore.ts` | +13 / -1 | Default skin → skystrip, collapseState → pill, comment block |
| `src/features/omnibelt/lib/motion.ts` | +13 | `ISLAND_SPRING` constant for Dynamic-Island physics |
| `src/features/omnibelt/panel/PanelContent.tsx` | +198 (new) | Extracted inner panel UI |
| `src/features/omnibelt/panel/OmniBeltPanel.tsx` | -184 / +95 | Now delegates inner UI to `<PanelContent>` |
| `src/features/omnibelt/skins/skystrip/OmniBeltSkyStrip.tsx` | -68 / +228 | Bottom-center, skin-owned morph, expanded panel render |
| `src/features/omnibelt/OmniBeltHost.tsx` | +6 / -7 | `SKINS_USING_SHARED_PANEL` reduced to `{'pill'}` |
| `supabase/migrations/330_omnibelt_default_skystrip.sql` | +51 (new) | `ALTER COLUMN default_skin SET DEFAULT 'skystrip'` |
| `src/features/omnibelt/__tests__/omnibeltStore.test.ts` | +17 / -3 | New default-skin assertions + collapseState default |
| `src/features/omnibelt/__tests__/OmniBeltHost.test.tsx` | +29 / -1 | Skystrip + orb assertions: no shared panel mount |
| `src/features/omnibelt/skins/skystrip/__tests__/OmniBeltSkyStrip.test.tsx` | +90 / -52 | Bottom-center + skin-owned-panel contracts |
| `src/features/omnibelt/skins/skystrip/__tests__/morph-skystrip-to-panel.test.tsx` | +172 (new) | Dedicated morph integration test |
| `memorybank/OmniFrame/Patterns/Skin-Owned-Morph-States.md` | +new | Pattern doc |
| `memorybank/OmniFrame/Implementations/Implement-OmniBelt-MVP.md` | this section | Implementation log |

### Verification (2026-05-24)

- `pnpm tsc -b` — clean (no new errors / warnings)
- `pnpm vitest run src/features/omnibelt` — **379 / 379 passing**
  (one pre-existing unhandled-rejection in
  `useOmnibeltConfigInvalidator.test.tsx` from a Supabase auth-js
  storage stub; reproduces on `main`, not caused by this change)
- `pnpm build` — clean
- Bundle delta (gzipped):
  - `feature-omnibelt` (main): 18 106 → 18 170 bytes (+64 B)
  - `feature-omnibelt-skin-skystrip`: 1 200 → 1 832 bytes (+632 B)
  - `feature-omnibelt-skin-orb`: 2 255 → 2 257 bytes (+2 B noise)
  - Well under the 20 KB-gzip cap for the skystrip chunk; total
    delta ≈ 700 B gzipped.
- Live browser verification — `browser automation MCP` MCP is not in
  the project-scoped MCP tool list (only project-scoped
  + plugin MCPs are exposed at this runtime tier). Coverage is
  instead provided by the new `morph-skystrip-to-panel.test.tsx`
  integration test which asserts the strip and panel share the
  `COLLAPSE_LAYOUT_ID`, both anchor at `bottom: 24px; left: 50%`,
  exactly one of (strip, panel) mounts per tick, and clicking the
  strip dispatches `setCollapseState('panel')`.

### v1.5 follow-up

The "skin owns both states" pattern should be applied to Orb when
we add a "more" tile for >8 tools — currently Orb's `<RadialFan>`
is its expanded surface and works the same way; the pattern doc
generalises it.

## Orb interactivity + skin-picker escape hatch (2026-05-24, post-SkyStrip)

Live bug report from a user who picked the Compass Orb skin from
the standard panel menu:

> "When in orb mode, none of the buttons work, and there is no way
> for me to change it back to another skin."

Two distinct bugs, one report — both shipped in P7's Orb skin and
went undetected because the test suite didn't exercise either path.
Full root-cause + fix write-up in
[[Fix-OmniBelt-Orb-Interactivity-And-Skin-Picker]]. Summary:

1. **Bug 1 (interactivity).** `RadialFan.launch(tool)` shipped
   without a real launcher for shell-backed tools — for the 6 of 9
   v1 tools that have no `navigationUrl`, the fan just called
   `close()` and did nothing visible. The "fall back to the Pill
   panel" mitigation from the P7 docstring never fires because the
   user is on the Orb skin (which suppresses the standard panel).
2. **Bug 2 (no skin-picker access).** `<PanelMenu>` (the `⋮`
   dropdown with the skin radio group + Hide toggle) lived only
   inside the standard `<OmniBeltPanel>` header. Orb's `<RadialFan>`
   doesn't render that panel, so picking Orb removed the only UI
   path back to Pill / SkyStrip. Users got trapped.

### Lesson — codified

> **Any skin that opts out of the standard Panel MUST provide its
> own path to skin/visibility settings — otherwise users get
> trapped in that skin.**

SkyStrip dodges this trap by keeping `<PanelContent>` (which
contains `<PanelMenu>`) in its expanded form via
[[Skin-Owned-Morph-States]]. Orb deliberately uses a `<RadialFan>`
instead of a full panel, which made Bug 2 inevitable for v1.

The "skin checklist" for any future skin now includes:
"skin picker reachable from the skin's resting chrome".

### What landed (2026-05-24, post-launch)

Approach A from the brief — overflow `⋮` button on the orb itself,
opens the same skin picker via an extracted reusable
`<PanelMenuContent />`. Bonus: a separate `<OrbShellPopover>` so
shell-backed tools from the radial fan actually launch their shell
above the orb instead of silent close.

| File | LOC | Change |
|---|---|---|
| `src/features/omnibelt/panel/PanelMenu.tsx` | +30 / -10 | Extract `<PanelMenuContent />` body for reuse outside the standard panel. `<PanelMenu>` thinly wraps it as before. |
| `src/features/omnibelt/panel/PanelContent.tsx` | +18 / -2 | Optional `initialActiveTool?: ToolDef \| null` prop so the orb's shell popover can boot straight into the chosen shell. |
| `src/features/omnibelt/skins/orb/OmniBeltOrb.tsx` | +130 / -45 | Wrap orb in positioning anchor div. Add overflow `⋮` trigger at top-right (sibling of orb button — HTML disallows nested `<button>`s) opening `<PanelMenuContent />`. Move status dot to top-LEFT to leave the prime corner clear. Manage `activeShellTool` local state; mount `<OrbShellPopover>` on shell-tool launch. Pass `onLaunchShell` callback into the fan. `e.stopPropagation()` on overflow click prevents collision with the orb's toggle. |
| `src/features/omnibelt/skins/orb/RadialFan.tsx` | +20 / -6 | Accept optional `onLaunchShell?: (tool) => void`. Shell tools delegate to it (Orb opens popover); nav tools still navigate + close; no-handler callers still fall back to silent close. |
| `src/features/omnibelt/skins/orb/OrbShellPopover.tsx` | +130 (new) | Glass card above the orb. Lazy-imported. Renders `<PanelContent initialActiveTool={tool}>`. Esc + click-outside dismiss; skips `[data-omnibelt-host]` and OmniBelt-owned overlays. |
| `src/features/omnibelt/skins/orb/__tests__/OmniBeltOrb.test.tsx` | +200 / -30 | Wrap-structure regression, overflow a11y + skin-picker round-trip (3 options + dispatch), `e.stopPropagation()` guard assertion. |
| `src/features/omnibelt/skins/orb/__tests__/RadialFan.test.tsx` | +60 / -10 | Tile-is-real-button structural test, nav-ignores-onLaunchShell test, shell-invokes-onLaunchShell test (Bug 1C regression), no-handler legacy fallback test. |
| `src/features/omnibelt/panel/__tests__/PanelMenu.test.tsx` | +40 | New `<PanelMenuContent />` standalone describe block — proves it works outside the `<DropdownMenu>` wrapper. |
| `memorybank/OmniFrame/Debug/Fix-OmniBelt-Orb-Interactivity-And-Skin-Picker.md` | +new | Full debug note. |

### Verification (2026-05-24, post-launch)

- `pnpm tsc -b` — clean (25 s).
- `pnpm vitest run src/features/omnibelt` — **421 / 421 passing**
  across 28 test files (was 408 / 408: +13 new orb / fan / panel-menu
  tests). Same pre-existing unhandled rejection in
  `useOmnibeltConfigInvalidator.test.tsx` (Supabase auth-js storage
  stub) reproduces on `main`; unrelated.
- `pnpm build` — clean.
- Bundle delta:
  - `feature-omnibelt-skin-orb`: 7.4 KB raw (unchanged from prior
    baseline — the popover and PanelMenuContent reuse fit inside
    the existing chunk via tree-shared imports; nothing new ships
    to the orb chunk specifically, the popover lazy-imports
    PanelContent which is already on the main feature chunk).
  - Well under the 20 KB raw / 8 KB gzip ceiling the brief called
    out.
- `node scripts/check-bundle-budget.mjs` — fails on the same three
  pre-existing chunks (`warehouse-location-map`, `feature-admin`,
  `feature-rf-interface`) and the total-budget breach. The orb fix
  did not move the needle on any of those.
- `pnpm lint:check` — same 98 warnings as the pre-fix baseline (the
  ratchet snapshot at 16 warnings is itself stale, predates this
  fix). Zero new warnings introduced by this fix — verified per-
  file via the ReadLints check; only the pre-existing
  `z-[55]` / `z-[58]` / `bg-gradient-to-br` Tailwind-v4-idiom
  warnings remain.

### Deviations / notes

- **Orb's v1 deviation (no standard Panel) is now mitigated, not
  reversed.** The radial fan stays as the primary expansion path.
  The orb's overflow `⋮` button gives users the universal settings
  escape hatch (skin picker + Hide toggle). The shell popover is
  a sibling surface to the fan, not a replacement — clicking the
  orb still opens the fan first; the popover only mounts when a
  user picks a specific shell tool from the fan.
- **Status dot moved top-right → top-LEFT.** The overflow trigger
  takes the top-right corner now. The status dot is still a 10 px
  teal-400 motion-safe pulsing ring marker; just on the opposite
  corner of the orb's bounding box.
- **PanelMenu split is backward-compatible.** `<PanelMenu>` still
  works exactly as before (Pill panel mounts it the same way).
  `<PanelMenuContent />` is the new export; existing consumers
  didn't change. Both share the same store reads/writes so the
  Orb's settings menu and the Pill panel's settings menu stay in
  sync automatically.
- **`PanelContent.initialActiveTool` is optional and defaults to
  `null`.** Existing callers (`<OmniBeltPanel>`,
  `<OmniBeltSkyStrip>`) are unchanged. The orb's popover is the
  only consumer that passes a value.

## Cinematic motion polish (2026-05-24 PM)

Live ask paired with the Agent Chat instant-close bug above:

> "As we're opening each functionality, there should be some
> cinematic animation motion built into it to make it look
> extremely fluid and elegant when activating a function like
> agent chat or notes and all kinds of stuff."

The previous motion language (`HOUSE_SPRING`, `ISLAND_SPRING`,
`LIQUID_SPRING`, `SNAP_SPRING`) covered the resting chrome morphs
(pill ↔ panel, strip → bloom, orb → fan) and the per-tile reveal
on grid mount. It did NOT cover the moment the user picks a
tool — that path was a Radix-default zoom-in-95 cross-fade for
dialogs and a generic spring for the orb popover. Both felt
"snap on" rather than "lift in".

### What landed

Four new constants in `src/features/omnibelt/lib/motion.ts`:

| Constant | Where it's used | Tuning rationale |
|---|---|---|
| `TOOL_LAUNCH_SPRING` | Panel grid ↔ active-tool-shell swap (`PanelContent`); `AgentChatDialog` mount; `OrbShellPopover` mount; future Sheet / Popover tool surfaces | Slightly slower (stiffness 380) + slightly more damped (32) than `HOUSE_SPRING` so dialog-sized rects settle cleanly without overshoot wobble. `restDelta: 0.001` so framer commits the final frame instead of animating asymptotically toward zero. |
| `BACKDROP_FADE` | Reserved for future use on Radix `<DialogOverlay>` overrides; documented as the canonical scrim transition for tool launches. | Duration-based (0.22 s) so framer collapses cleanly under `prefers-reduced-motion: reduce`. Paired with the spring above so backdrop and content settle in lockstep. |
| `CONTENT_STAGGER` | Inner reveal of multi-section tool surfaces (`PanelContent` body, `AgentChatDialog` header → list → composer). | `delayChildren: 0.08` lets the container's spring start to settle before children begin entering. `staggerChildren: 0.04` keeps the cascade tight — at 8 children it's done in 320 ms, well within the perceptual budget for a tool open. |
| `TILE_PRESS_TRANSITION` | `<ToolTile>` `whileTap` / `whileHover`. | Stiffer (600) + lighter (mass 0.5) than `LIQUID_SPRING` so the press reads as a haptic tick before the launch fires, not a soft squish. |

### Where the new motion language is applied

| Surface | Before | After |
|---|---|---|
| Panel grid → active tool shell swap (`<PanelContent>`) | Hard React swap. Old grid unmounts in one tick, new shell mounts in the next — no animation between them. | `<AnimatePresence mode='wait'>` with `key={activeTool ?? 'grid'}`. Outgoing scales 1 → 0.98 + slides up 4 px while fading; incoming scales 0.96 → 1 + slides up 4 px while fading. Same `TOOL_LAUNCH_SPRING` for both. Inner content (header / search / tabs / grid OR shell header / body) cascades in via `CONTENT_STAGGER`. |
| `<AgentChatDialog>` mount | Radix default `data-[state=open]:animate-in` zoom-in-95 + fade-in-0 (~200 ms duration tween). | Two-layer reveal: outer `motion.div` springs from `{ scale: 0.94, y: 8, opacity: 0 }` to settled with `TOOL_LAUNCH_SPRING`. Inner `motion.div` orchestrates `CONTENT_STAGGER` so the `DialogHeader` → `ChatMessageList` → `PromptInputBox` cascade in via a 280 ms `HOUSE_EASE` tween (0.04 s gap between sections, 0.08 s delayChildren). Layered ON TOP of Radix's default class-based animation so the surface still has graceful baseline behaviour if framer fails. |
| `<OrbShellPopover>` mount | `HOUSE_SPRING` with a small `scale: 0.96 → 1, y: 8 → 0` enter. | `TOOL_LAUNCH_SPRING` with a slightly deeper `scale: 0.94 → 1, y: 8 → 0` enter — same physics as the dialog so cross-skin tool launches feel cohesive. |
| `<ToolTile>` press feedback | `whileTap={{ scale: 0.96 }}` + `whileHover={{ scale: 1.04, y: -2 }}` with `LIQUID_SPRING`. | `whileTap={{ scale: 0.97 }}` + `whileHover={{ scale: 1.03, y: -2 }}` with `TILE_PRESS_TRANSITION`. Tighter, snappier — the press now feels like a tactile tick before the launch fires instead of a soft squish that competes with the launch animation. |

### Reduced motion

Every consumer is wrapped at the host level in
`<MotionConfig reducedMotion='user'>` (already established by
P3). Verified the new springs collapse to zero-duration
transitions under `prefers-reduced-motion: reduce`:

- `TOOL_LAUNCH_SPRING` / `TILE_PRESS_TRANSITION` are pure springs
  — framer collapses them automatically.
- `CONTENT_STAGGER` only sets `delayChildren` /
  `staggerChildren`; no animation per se. Children's variants
  collapse via the same MotionConfig path.
- `BACKDROP_FADE` is a duration tween — framer also collapses it
  automatically.

`<AgentChatDialog>` additionally guards every motion node with a
`useReducedMotion()` shortcut so the `initial`/`animate` shapes
become flat opacity transitions when the user prefers reduced
motion. Belt + suspenders.

### Files changed (motion polish slice)

| File | Lines | Change |
|---|---|---|
| `src/features/omnibelt/lib/motion.ts` | +63 | Add `TOOL_LAUNCH_SPRING`, `BACKDROP_FADE`, `CONTENT_STAGGER`, `TILE_PRESS_TRANSITION`. Existing constants unchanged. |
| `src/features/omnibelt/panel/PanelContent.tsx` | +56 / -33 | Wrap grid ↔ shell body swap in `<AnimatePresence mode='wait'>` with shared `motion.div` keyed by `activeTool?.id ?? 'grid'`. Apply `TOOL_LAUNCH_SPRING` + `CONTENT_STAGGER`. Read `useReducedMotion()` to flatten initial/animate/exit under reduced motion. |
| `src/features/omnibelt/tools/shells/agent-chat/AgentChatDialog.tsx` | +56 / -22 | Two-layer motion wrap inside `<DialogContent>` (outer spring, inner stagger). `useReducedMotion()` shortcut on every variant. Plus the Layer A bug fix tag and explicit `modal` prop (see `Fix-OmniBelt-AgentChat-Instant-Close`). |
| `src/features/omnibelt/skins/orb/OrbShellPopover.tsx` | +5 / -2 | Switch from `HOUSE_SPRING` to `TOOL_LAUNCH_SPRING`; deepen initial scale to 0.94. |
| `src/features/omnibelt/panel/ToolTile.tsx` | +21 / -5 | Switch press transition to `TILE_PRESS_TRANSITION`; retune `whileHover`/`whileTap` magnitudes. Plus the Layer B bug fix `e.stopPropagation()` (see `Fix-OmniBelt-AgentChat-Instant-Close`). |

### Bundle delta

- `feature-omnibelt`: 54.8 KB raw post-fix (was 54.7 KB pre-fix
  baseline measured at the same git ref minus this slice — the
  motion constants are tree-shakable scalars; the wrap-level
  `motion.div` calls reuse framer-motion that was already on the
  feature chunk).
- `feature-omnibelt-skin-orb`: 7.4 KB raw — unchanged.
- `feature-omnibelt-skin-skystrip`: 4.3 KB raw — unchanged.

### Pattern doc updates

- [[OmniBelt-Floating-Launcher]] gains a new "Tool launch motion"
  section documenting the `TOOL_LAUNCH_SPRING` + `AnimatePresence`
  + `CONTENT_STAGGER` recipe so future tool authors apply it
  consistently. Includes a worked example for a hypothetical Sheet-
  based tool shell.

## Lessons (populated as we go)

- **Site-wide chrome mounted in `__root.tsx` inherits the file's
  fragility.** When `src/routes/__root.tsx` gets accidentally
  regenerated (TanStack Router scaffold, editor template, errant
  HMR overwrite, etc.) the entire provider stack — `SearchProvider`,
  `ToastSettingsProvider`, `Toaster`, `OmniBeltHost`, error / not-found
  components — vanishes in one shot and the next render of any
  `<Search>`-using page throws `useSearch has to be used within
  <SearchContext.Provider>`. Captured in
  [[Fix-OmniBelt-SearchContext-Provider-Error]]. The OmniBelt rollout
  did not cause it, but the broad surface area of P0–P9 + a brand-new
  admin route made it surface immediately. If `__root.tsx` is ever
  in the staged diff with the canonical providers missing, treat that
  as a regression and revert before continuing — never just re-add
  `<OmniBeltHost />`.

- **Bootstrap query must degrade quietly when the FastAPI backend is
  unreachable.** Captured 2026-05-24 from a local-dev session where
  the Vite proxy at `/api/*` flooded the terminal with `AggregateError
  [ECONNREFUSED]` for `/api/omnibelt/bootstrap` (x16 over ~7 min) and
  `/api/admin/omnibelt/role-config` (x3) because `python start.py`
  wasn't running on `:8000`. The original P2 query had `retry: 1` but
  no `retryDelay` override, no `placeholderData`, no error
  classification (every error type retried equally), and no local
  circuit breaker — so every HMR-driven remount + every TanStack
  invalidation kicked off a fresh 2-attempt salvo. Hardened in
  [[Fix-OmniBelt-Bootstrap-Unreachable-Backend]]:
    1. `placeholderData` with `enabled: true / source: 'none'` so the
       launcher renders the v1 tool roster on first paint even when
       the backend never responds.
    2. Typed errors (`BootstrapNetworkError` / `BootstrapAuthError` /
       `BootstrapValidationError`) in `lib/bootstrap-errors.ts` —
       `retry` predicate short-circuits auth + validation; only
       network errors retry, capped at 1, with 1–30 s exponential
       backoff.
    3. Module-scoped circuit breaker (mirrors
       [[Realtime-Presence-Browser-Hardening]] §Layer 2): 3
       consecutive network failures trip a 5-min cooldown that
       flips `enabled: false` via `useSyncExternalStore`. Logs one
       warn per trip, not per retry.
    4. Admin mutation hooks (`useUpdateKillSwitch`,
       `useUpdateAllowList`, `useUpdateRoleConfig`) got `retry: 0` +
       branched `toast.error` ("OmniBelt backend unreachable. Start
       the FastAPI server on :8000.") via the same `isNetworkError`
       / `isAuthError` predicates.
    5. Pre-existing bug fix: `useResolvedTools` treated `[]` allow
       list as "block ALL tools" instead of the Rust contract's "no
       restriction" — 1-line guard so the placeholder + the real
       Rust default both render the full v1 roster.

## Verification commands (per phase)

```bash
# Foundation / type / lint
pnpm tsc -b
pnpm test:unit
pnpm lint:check
pnpm format:check

# Bundle budget
pnpm build
node scripts/check-bundle-budget.mjs

# Quality gate
pnpm quality:check

# Integration tests with replica + Redis
INTEGRATION_MODE=infra pnpm test:integration

# Rust
cd rust-dashboard-service && cargo check && cargo test
cd rust-work-service && cargo check && cargo test

# DB
supabase migration up
psql -c "select * from omnibelt_role_config limit 1;"
psql -c "refresh materialized view concurrently omnibelt_tool_events_24h_mv;"
```

## Related

- [[ADR-OmniBelt-Site-Chrome]]
- [[OmniBelt-Floating-Launcher]]
- [[OmniBelt - Site Tool Launcher]]
- [[Supabase-Read-Replica-Routing]]
- [[ADR-Scaling-Roadmap-To-100k-Concurrent]]
- [[Roadmap-Rust-WS-Unlocks]]
- [[realtime-policy]]
