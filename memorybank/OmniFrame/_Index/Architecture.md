---
tags:
  - type/context
  - status/active
created: 2026-04-09
updated: 2026-04-09
aliases: [arch, system overview]
---
# System Architecture

## Overview
**OneBoxFullStack** (j-ai-mui v2.0.1) is a full-stack enterprise platform with a React frontend, multiple Rust microservices, a Python API layer, Supabase for database/auth, and SAP integration.

## Tech Stack

### Frontend
- **Framework:** React 19 + Vite 7 (SWC)
- **Routing:** TanStack Router
- **State:** Zustand (global), TanStack Query (server state)
- **UI:** Radix UI primitives + Tailwind CSS 4 + shadcn/ui components
- **Forms:** React Hook Form + Zod v4 validation
- **Visualization:** Recharts, React Three Fiber, Konva
- **Animation:** Framer Motion, Anime.js
- **Mobile:** Capacitor (iOS)
- **PWA:** vite-plugin-pwa

### Backend — Rust Microservices
- `rust-ai-service/` — Vision and inference processing
- `rust-core-service/` — Core business logic
- `rust-dashboard-service/` — Dashboard data aggregation
- `rust-mdm-service/` — Master Data Management
- `rust-streaming-service/` — Real-time streaming
- `rust-work-service/` — Work order management

### Backend — Python API
- `api/` — Python API layer (auth, middleware, models, routers, services)

### Infrastructure
- **Database/Auth:** Supabase (migrations in `supabase/migrations/`)
- **Cache:** Redis (ioredis)
- **Queue:** Bull (job processing)
- **Deployment:** Railway (Dockerfile), Docker
- **CI/CD:** GitHub Actions (`.github/`)
- **Testing:** Vitest (unit + integration), Playwright (E2E)
- **Quality:** ESLint, Prettier, Knip, Husky + lint-staged

### SAP Integration
- `omni_bridge/` — Omni-Bridge desktop app (pywebview + SAP GUI COM automation). See [[Omni-Bridge - SAP Bridge]]
  - Full 6-step shipment process (ZV26, VL02N, LT12, VT01N, VL02N CASE+Output, VL02N PGI)
  - Batch TO confirmation with auto-pagination in Putaway Log Search
- `omni_agent/` — Headless console service (FastAPI + SAP COM). See [[Omni-Agent - Headless SAP Agent]]
  - Same SAP automation as Bridge but headless on `localhost:8765`
  - **Install-free**: runs from wherever user extracts the ZIP; delete the `.exe` to uninstall
  - Distributed as `OmniFrame_Agent.zip` via Supabase Storage `downloads` bucket (bypasses corporate `.exe` CASB blocks)
  - Enables Tier 4 Citrix: user opens any Chrome, web app detects agent via `fetch('http://127.0.0.1:8765/health')`
  - CSP in `api/main.py` must include `http://127.0.0.1:*` in `connect-src`
  - **Agent v2.0.0 (2026-05-07, Phase 11 of the rust-work-service integration plan)** — control plane on `rust-work-service` (WS for row events, REST for queue claim/complete/fail/heartbeat), trigger evaluator runs server-side (Phase 9), agent owns its own credentials via service keys (Phase 10, soft-fallback in 2.0.x). See [[ADR-Agent-2.0.0-Release]] + [[Implement-Rust-Work-Service-Full-Integration-Summary]] for the cross-phase arc.
- **Cross-cutting topology + improvement surface map** for the entire agent stack (omni_agent + omni_bridge + rust-work-service + FastAPI + Supabase) is in [[Omni-Agent-System-Topology]] (2026-05-21), built from a five-worker parallel architectural sweep; read this first before scoping omni_agent improvement work.
- `src/features/admin/sap-testing/` — SAP Testing admin page with tabs:
  - **One Click Ship** — form → SAP write (auto-detects Bridge or Agent)
  - **Agent Triggers** — Phase 9 server-side trigger evaluator + admin CRUD UI (rules live in `public.agent_triggers`). See [[Agent-Triggers - Realtime Automation]] + [[ADR-Trigger-DSL-Evaluator-Phase9]].
  - **Inventory Management** — form → SAP read via query handlers (LX03, MB52, MMBE, LT10, extensible). 2026-05-07 added the **Inventory Adjustment** workflow: LT10 row → ZMM60 price lookup (capability `zmm60-price-lookup`) → INSERT to `public.inventory_adjustment_staging` (migration 288) → stat-card view + Excel export. See [[Inventory-Management - SAP Query Framework]] + [[Implement-Inventory-Adjustment-Workflow]]
  - **Agent Setup** — Phase 10 admin tab for service-key registration / revocation / rotation. See [[ADR-Agent-Identity-V2-Phase10]].
  - Dashboard data via Phase 8 consolidated `/api/v1/sap-testing/dashboard` endpoint (replaces 4-5 ad-hoc Supabase reads).
- `api/services/sap_service.py` — Python SAP RFC service (Z_RFC_WM_TO_CONFIRM etc.) for server-side SAP ops

### Agent control plane: rust-work-service (post-2026-05-07)

`rust-work-service/` is the centralised agent orchestrator — the architecture-shift result of the 12-phase rust-work-service integration plan (Phases 0-11, 2026-05-06 → 2026-05-07). See [[Components/Rust-Work-Service]] for the comprehensive end-of-Phase-11 overview.

```
Browser ←HTTPS→ rust-work-service /api/v1/* (REST: dashboards, agent identity,
   ↑                                          triggers, sap-mutations, sap-console)
   ↓
Browser ←WSS→ rust-work-service /ws (per-org fan-out: SapJobStatusChanged,
                                     RfPutawayChanged, SapAgentChanged,
                                     SapAgentConsoleLine, TriggerFired, …)

omni_agent ←WSS→ rust-work-service /ws (single connection per agent)
omni_agent ←HTTPS→ rust-work-service /api/v1/sap-agents/jobs/{claim,complete,fail,heartbeat}
omni_agent ←HTTPS→ rust-work-service /api/v1/agent-identity/exchange (Phase 10 service-key)
omni_agent ←HTTPS→ rust-work-service /api/v1/sap-console/lines (Phase 6 console relay)
omni_agent ←HTTPS→ rust-work-service /api/v1/sap-mutations/material-master/* (Phase 5)

omni_agent →HTTPS→ Supabase /auth/v1/* (login + refresh — user-launch UX only)
omni_agent →HTTPS→ Supabase /rest/v1/{rf_putaway_operations,work_tasks,sap_agents,sap_audit_log}
                                       (intentional surviving direct-Supabase
                                        domain-mutation surface — see Phase 11.
                                        Audit-log target was sap_transaction_logs
                                        until 2026-05-07 hot-fix repointed it to
                                        sap_audit_log — see [[Implement-Phase10-Service-Key-First-Rollout]]
                                        sibling EOD cleanup in [[Sessions/2026-05-07]].)
```

Supabase remains the **data plane** (auth + domain tables + Realtime for human dashboard subscriptions). rust-work-service is the **agent control plane** (event fan-out + queue + identity + trigger evaluation).

## Directory Map
```
OneBoxFullStack/
├── src/                    # React frontend
│   ├── components/         # UI components (shadcn + custom)
│   ├── features/           # Feature modules
│   ├── routes/             # TanStack Router pages
│   ├── hooks/              # Custom React hooks
│   ├── stores/             # Zustand stores
│   ├── context/            # React context providers
│   ├── providers/          # App-level providers
│   ├── lib/                # Shared utilities
│   ├── config/             # Frontend config
│   ├── middleware/          # Client middleware
│   ├── mobile/             # Capacitor mobile
│   ├── workers/            # Web workers
│   └── utils/              # Utility functions
├── api/                    # Python API backend
│   ├── auth/               # Authentication
│   ├── middleware/          # API middleware
│   ├── models/             # Data models
│   ├── routers/            # API routes
│   ├── services/           # Business logic
│   └── utils/              # Backend utilities
├── rust-*-service/         # Rust microservices (6 services)
├── supabase/               # Supabase config + migrations
├── docs/                   # Documentation
├── scripts/                # Build/utility scripts
├── tests/                  # Integration tests
└── memorybank/OmniFrame/   # Obsidian knowledge vault
```

## Key Configuration Files
- `package.json` — Frontend deps & scripts
- `vite.config.ts` — Build configuration
- `eslint.config.js` — Linting rules
- `capacitor.config.ts` — Mobile config
- `railway.json` — Deployment config
- `Dockerfile` — Container build
- `components.json` — shadcn/ui config

## Related
- [[Components]] — Full component index
- [[Patterns]] — Code conventions
- [[Decisions]] — Architecture decision records
- [[Project-Overview]] — Detailed project context



## Database & Supabase
- [[Database-Schema-Overview]] — All major tables, their purpose, and relationships across 13 domains
- [[Supabase-Configuration]] — Supabase project config, RLS policies, RPC functions, client architecture
- [[Migration-History]] — How the schema grew through 213+ migrations from RBAC core to full WMS
- [[Database-Migration-Workflow]] — Canonical workflow for applying migrations (Supabase MCP `apply_migration`, pre/post verification)
- [[Database-Patterns]] — RLS patterns, SECURITY DEFINER conventions, indexing strategies, migration conventions
- [[Implement-Inbound-Part-Transfer]] — Migration 232 adds `rr_drop_off_areas`, `rr_drop_off_area_associates`, `rr_inbound_part_transfers`, and the `v_latest_inbound_part_transfers` view that joins into Inbound Scan Search.
- [[ADR-Drop-off-Transfer-Granularity]] — One transfer per TKA Batch (latest wins), history retained; associates identified by scan of an org-managed badge code.


## Multi-Session Agent Master (planning)

- [[Implementations/Plan-Multi-Session-Agent-Master]] (2026-05-14) — Evolves the single-session [[Components/Omni-Agent - Headless SAP Agent]] into a Master Controller GUI (CustomTkinter, Python-native, PyInstaller bundle) that supervises 6 worker processes (one per SAP GUI session via `SAPGUI.GetScriptingEngine.Children(i)`). Static session assignment reuses [[Implementations/Implement-SAP-Session-Pinning]]; per-worker identities reuse [[Implementations/Implement-Phase10-Service-Key-First-Rollout]] with per-worker key subfolders; no rust-work-service or web-app changes required. Two EXEs (`OmniFrame_Agent.exe` unchanged + `OmniFrame_AgentMaster.exe` new). Seven phases A→G. Doc-only — implementation gated on the six open questions in Section 11 of the plan.



## Frontend Primitives (2026-05-16)

New shared primitives + hook landed during the 2026-05-16 responsive resize sweep. Use these instead of hand-rolling KPI tiles or wide dialogs.

- **`<StatTile>`** (`src/components/ui/stat-tile.tsx`) — container-query-aware KPI tile. Bakes in `min-w-0` everywhere, `truncate` + `title=` on the value, `@container/stat-tile` typography step-down, and `toLocaleString()` formatting by default. See [[Responsive-StatTile-And-KpiGrid]].
- **`<KpiGrid columns={2|3|4|5|6} density={...}>`** (`src/components/ui/kpi-grid.tsx`) — the canonical wrapper for `<StatTile>` rows. Column count steps down via `@container/kpi-grid`, not viewport breakpoints, so the grid reflows correctly when embedded in sidebars or split panes. See [[Responsive-StatTile-And-KpiGrid]].
- **`<ResponsiveDialog size='sm|md|lg|xl|full'>`** (`src/components/ui/responsive-dialog.tsx`) — replaces the `min-w-[Npx]` anti-pattern on `DialogContent`. Width is `w-[min(100vw-2rem,Npx)]` per size token, with three slots (`Header` / `Body` / `Footer`) where the body owns the only scrollport. See [[ResponsiveDialog-Width-Tokens]].
- **`useContainerWidth(ref)`** (`src/hooks/use-container-width.ts`) — ResizeObserver hook for cases CSS container queries genuinely can't solve (Recharts `width` prop, virtualised list column counts, JS-driven truncation rulers). Prefer `@container/...` for layout decisions; reach for this hook only when the decision can't live in CSS.

The decision to sanction `@container/stat-tile` and `@container/kpi-grid` as new responsive tokens (alongside the existing viewport breakpoint system) is recorded in [[ADR-Container-Query-Stat-Tiles]].
