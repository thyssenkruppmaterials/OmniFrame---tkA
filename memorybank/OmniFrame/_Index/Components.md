---
tags:
  - type/context
  - status/active
created: 2026-04-09
updated: 2026-04-11
---
# Components Index

Map of all documented components, services, and modules.

## Frontend — Auth & Security
- [[SingletonAuthManager - Authentication Core]] — HMR-resistant singleton managing Supabase client and session monitoring
- [[AuthService - Unified Authentication]] — High-level auth wrapper with event system and cached profile/permission fetching
- [[RBACService - Role Based Access Control]] — Full RBAC engine with conditional permissions and role hierarchy
- [[UnifiedAuthProvider - React Provider]] — React context provider bridging auth into component tree
- [[AuthCache - Caching Layer]] — In-memory LRU cache with tag-based invalidation
- [[SecurityServices - Rate Limiting and Anomaly Detection]] — Redis-backed rate limiting, anomaly detection, encrypted storage
- [[SessionManager - Session Lifecycle]] — Predictive session management with visibility-aware monitoring
- [[PermissionGuard - UI Components]] — React components and hooks for permission-gated rendering
- [[RouteProtection - Navigation Security]] — TanStack Router beforeLoad protection

## Frontend — UI Components & Design System
- [[UILibrary - Component Catalog]] — ~100 shadcn/ui components catalog
- [[Layout - App Shell]] — Authenticated layout with sidebar, header, breadcrumbs, command palette
- [[DataTable - Reusable Table]] — Generic data table built on TanStack React Table v8
- [[ThemeSystem - Styling]] — 3-layer theme architecture with OKLCH color generation
- [[PresenceUI - Status Indicators]] — 4-component presence system
- [[Components/NotificationsPanel]] — Tier 2 #2 (2026-05-06) bell-icon + popover for server-pushed notifications. Mounted in the authenticated layout's top action bar; backed by `useNotifications` (bootstrap + WS subscription); 99+ unread badge; mark-read on click; click-to-navigate when `link` set. See [[Implement-Notifications-Panel-Tier2-2]].

## Frontend — State Management & Routing
- [[ZustandStores - State Management]] — All 6 Zustand stores
- [[CustomHooks - React Hooks]] — 52 custom hooks organized by category
- [[AppProviders - Provider Stack]] — Full provider hierarchy
- [[RoutingSystem - TanStack Router]] — Complete route tree (70 files)

## Frontend — Warehouse Operations Features
- [[RF Interface - Feature Module]] — Mobile-first PWA for warehouse floor ops
- [[Outbound Shipping - Feature Module]] — Pack, Shippers, Final Pack, Putback tools
- [[Drone Scanner - Feature Module]] — Vision-analyzed drone scans
- [[Camera System - Feature Module]] — ExacqVision camera monitoring
- [[Weather-Dashboard - Feature Module]] — Real-time weather tracking with animated backgrounds, radar map, forecasts, and metrics
- [[Standard Work - Feature Module]] — SOP management
- [[ProductionBoards - Feature Module]] — TV-display-grade per-hour productivity boards (Hourly Completion Tracker is the first board); polling + Wake Lock + `?tv=1` overlay
- [[CubiScan Integration - Feature Module]] — Dimensioning/weighing console
- [[Kitting System - Feature Module]] — Kit assembly with Kanban board
- [[Customer Portal - Feature Module]] — Support ticket dashboard
- [[Warehouse Map - Feature Module]] — Interactive 2D/3D floor plan

## Frontend — Admin, HR & User Management
- [[DeviceManager - Feature Module]] — MDM admin panel (9 tabs)
- [[RolesPermissions - Feature Module]] — Roles, Permissions, Security Dashboard
- [[SystemSettings - Feature Module]] — System settings, performance, SAP testing
- [[WorkQueue - Feature Module]] — Work queue administration
- [[Onboarding - Feature Module]] — 9-step employee onboarding wizard
- [[HRTimeTracking - Feature Module]] — Reviews, time clock kiosk, time tracker
- [[UserManagement - Feature Module]] — Workforce lifecycle management
- [[VisitorLog - Feature Module]] — Visitor tracking
- [[DashboardSettingsErrors - Feature Module]] — Dashboard, settings, error pages

## Backend — Supabase Services (Core)
- [[Supabase Client Infrastructure - Supabase Service]] — Singleton client, query cache, RPC types
- [[InboundScanService - Supabase Service]] — Receiving dock operations
- [[OutboundTODataService - Supabase Service]] — Full outbound lifecycle
- [[DeliveryStatusService - Supabase Service]] — Master delivery tracking
- [[PutawayLogService - Supabase Service]] — RF putaway operations
- [[HotPartAlert and MaterialValidation - Supabase Service]] — Material validation and alerts
- [[Device Services - Supabase Service]] — Device registration and MDM
- [[Configuration Services - Supabase Service]] — Workflow configs, options

## Backend — Supabase Services (Extended)
- [[RFCycleCountServices - Supabase Service]] — Cycle count operations
- [[KittingServices - Supabase Service]] — Kitting picking, kanban, options
- [[RFPickingService - Supabase Service]] — RF picking
- [[TeamPerformance - Supabase Service]] — Team performance metrics
- [[LaborManagement - Supabase Service]] — Labor management
- [[ProductivityAndSettings - Supabase Service]] — Productivity tracking
- [[StandardWorkAndOperations - Supabase Service]] — Standard work, overtime, queue analytics

## Backend — Rust Microservices
- [[RustService - rust-ai-service]] — Drone scan analysis (Qwen3-VL)
- [[RustService - Core Service]] — Auth gateway, DB engine, Redis, SmartSheet proxy
- [[RustService - Dashboard Service]] — Drone scan metrics aggregation
- [[RustService - MDM Service]] — Apple MDM protocol
- [[RustService - Streaming Service]] — Camera streaming proxy
- [[RustService - Work Service]] — Work queue management
- [[Components/Rust-Work-Service]] — **End-of-Phase-11 (v2.0.0) authoritative overview** of `rust-work-service` as the agent control plane. All REST routes (Phase 4-10), all WS events, all PgListeners, all middleware behaviors (Phase 10 `AuthIdentity` + revocation cache), Redis namespace (Phase 11 sized to `max_size=50`), advertised capabilities. See [[Implementations/Implement-Rust-Work-Service-Full-Integration-Summary]] for the cross-phase arc.
- [[RustCore - Frontend Client]] — TypeScript client library

## SAP Desktop Integration (Citrix)
- [[Omni-Bridge - SAP Bridge]] — Windows `.exe` desktop app (pywebview + SAP COM). Embeds OmniFrame in a WebView2 window with injected JS bar
- [[Omni-Agent - Headless SAP Agent]] — Headless console service on `localhost:8765` (FastAPI + SAP COM). Works with any Chrome browser in Citrix; distributed via Supabase Storage ZIP
- [[Agent-Triggers - Realtime Automation]] — Management UI + runtime engine that turns Supabase Realtime events into automatic SAP fires through the Omni-Agent. Lives as a tab in SAP Testing admin page
- [[Inventory-Management - SAP Query Framework]] — Reads data from SAP (LX03, MB52, MMBE, extensible) via Omni-Agent query handlers. Frontend tab with dynamic inputs + sortable/searchable/exportable results table

## Infrastructure
- [[Infrastructure - Cache and Redis]] — Three-tier cache system
- [[Infrastructure - Monitoring and Performance]] — Performance tracking, health checks

## Related
- [[Architecture]] — System overview
- [[Patterns]] — Code conventions
- [[Decisions]] — Architecture decisions


## Frontend — Inventory Management
- [[ManualCountsSearch - Inventory Tab]] — Manual Counts dashboard with statistics cards, data table, inline filters, work distribution
- [[LiveOperatorStatus - Real-Time Panel]] — Real-time operator status panel with WebSocket connection

- [[SAP-Recorder]] — Self-recording mode (Phase D #12, agent v1.5.0): one-click Record → perform in SAP → Stop → draft Python handler. Hooks-based capture with polling fallback, AES-256-GCM at-rest encryption, translator emits idiomatic OmniFrame Python + 1:1 VBS replay
- [[Agents-Fleet-Manager]] — Multi-agent coordination (Phase D #13): `sap_agents` registry with 30s heartbeat, lease-aware `claim_sap_agent_job` RPC with stale-claim recovery, `assigned_agent_id` pinning, `<AgentsFleetCard />` + `useOnlineSapAgents()` hook, "Pin to agent" picker in BatchModePanel
- [[Scheduled-Jobs]] — Recurring SAP automations (Phase D #14): `sap_agent_schedules` table, `enqueue_due_schedules()` Postgres function (pg_cron + agent fallback), Scheduled Jobs tab with cron presets and "Run now" / Edit / CSV export
- [[SAP-Reversal-Engine]] — Audit-driven rollback engine (Phase D #15): browse `sap_audit_log`, select past mutations, preview computed inverses, queue the reversal batch through the existing job queue. New `prev_state` / `reversal_status` / `reverses_audit_id` columns on the audit log + a `mark_audit_row_reversed` SECURITY DEFINER RPC keep the audit trail strictly append-only at the table level. LT12 confirms are flagged irreversible.


## 2026-05-01 cross-link
- [[Inventory-Counts-Tab-Comprehensive-Redesign]] — redesign + clickable cards + new operator grid.


## 2026-05-24
- [[OmniBelt - Site Tool Launcher]] — Site-wide floating tool launcher mounted at `__root.tsx` with route gate. Tri-state collapse (Mini-Orb → Pill → Panel) via framer-motion `layoutId` morphs, 12 anchor zones with magnetic snap + per-route memory, three skins (`pill` default, `orb`, `skystrip`), and background-job status integration (Mach 3) via existing `workServiceWs`. Hybrid ownership: admin per-role default belts + master allow-list + master kill switch; users customize within constraints. Powered by a new `rust-dashboard-service /omnibelt/bootstrap` endpoint (Redis-cached, read-replica-backed) with a `WsEvent::OmnibeltConfigChanged` hot-reload variant. Dedicated `/admin/omnibelt` sidebar entry + 5-tab dashboard (Overview / Tools / Role Defaults / Analytics / Audit). v1-rich analytics from `omnibelt_tool_events` + 24h materialized view. See [[ADR-OmniBelt-Site-Chrome]], [[OmniBelt-Floating-Launcher]], [[Implement-OmniBelt-MVP]].
