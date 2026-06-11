---
tags: [type/context, status/active, domain/database]
created: 2026-04-10
---
# Migration History

The OmniFrame database schema evolved through **213+ sequential SQL migrations** in `supabase/migrations/`. This document summarizes the evolution phases.

## Naming Convention

Most migrations use numeric prefixes: `NNN_descriptive_name.sql` (e.g., `035_create_cycle_count_table.sql`). Some legacy migrations use timestamp prefixes: `YYYYMMDDHHMMSS_name.sql`. Duplicate numbers exist (e.g., two `064_*`, two `086_*`, two `037_*`) — these were likely separate feature branches merged without renumbering.

---

## Phase 1: Foundation (001–010) — Jan 2025

**Focus:** Core schema, multi-tenancy, RBAC foundation

| Migration | What it does |
|-----------|--------------|
| 001 | Initial schema (organizations, user_profiles with enum-based roles) |
| 002 | Outbound/shipping tables |
| 003 | Kitting tables |
| 005 | **Roles table-ification**: Converts enum-based roles to `roles` table with hierarchy support. Creates `handle_new_user()` trigger. Adds RLS on roles |
| 007 | **Permission categories**: `permission_categories`, `permission_dependencies`, `permission_tags`, `permission_tag_assignments`. Risk levels, 2FA requirements, dependency validation functions |
| 008 | **Enhanced audit & sessions**: `rbac_audit_logs`, `permission_usage_logs`, `enhanced_user_sessions`, `failed_auth_attempts`, `permission_cache_events`. Audit triggers on roles/permissions tables |
| 009 | **RBAC functions**: Recursive CTE-based `get_user_inherited_permissions()`, `check_permission_with_context()`, `bulk_assign_permissions()`, `get_permission_analytics()`, role hierarchy validation |
| 010 | **Putback tickets**: `putback_tickets` with `putback_status` enum, sequential numbering (Putback-00001) |

## Phase 2: Inbound & Auth Optimization (011–025) — Jan–Feb 2025

**Focus:** Inbound scanning, auth performance, indexing

| Migration | What it does |
|-----------|--------------|
| 011 | `rr_inbound_scans` table for RF barcode scanning |
| 012 | Enhanced inbound scan fields |
| 013b | Fix audit logs RLS policies |
| 014 | **Optimized auth functions**: `get_user_permissions_fast()`, `check_user_permission_fast()`, `get_user_role_info()`, `get_user_auth_status()` |
| 015 | Delivery status RPC |
| 016 | Putaway operation confirmation fields |
| 021 | Fix tab permissions functions |
| 025 | **Performance indexes**: 50+ CONCURRENTLY-created indexes across RBAC tables. Partial indexes, covering indexes, functional indexes. Extended statistics for query planning. Index monitoring via `get_index_usage_stats()` |

## Phase 3: RBAC & Security Hardening (027–032) — Feb–Sep 2025

**Focus:** RBAC refinements, security monitoring, session management

| Migration | What it does |
|-----------|--------------|
| 027 | Optimized RBAC functions |
| 029 | Add missing user roles |
| 030 | **Security monitoring**: `security_events`, `threat_indicators`, `compliance_reports`, `data_processing_activities`, `session_restrictions`. Suspicious session detection |
| 031 | Conditional permissions system |
| 032 | Session management tables |

## Phase 4: Cycle Count & Work Queue (034–044) — 2025

**Focus:** Inventory counting and task management

| Migration | What it does |
|-----------|--------------|
| 034 | Update inventory movements to manual counts |
| 035 | **Cycle count table**: `rr_cyclecount_data` with `cycle_count_status` enum (pending/in_progress/completed/variance_review/approved/cancelled), variance tracking, recount workflow, `generate_count_number()` function |
| 036 | User assignment for cycle counts |
| 037 | Cycle count priority system + abandonment recovery |
| 038 | Fix abandonment functions |
| 039 | **Work queue system**: 7 tables (`work_queue_config`, `task_types`, `worker_profiles`, `work_queue`, `task_assignment_history`, `worker_performance_metrics`, `queue_rules`). Intelligent assignment with `FOR UPDATE SKIP LOCKED`, dynamic priority calculation, bulk assignment, rebalancing, auto-escalation |
| 040–044 | Cycle count refinements: completed_at, recount status, variance auto-calculation trigger, recount history |

## Phase 5: Outbound & Statistics (047–062) — 2025

**Focus:** Outbound handling, statistics functions, timezone management

| Migration | What it does |
|-----------|--------------|
| 047 | Fix outbound duplicates |
| 050 | Organizational tree function |
| 051 | Putback log statistics function |
| 053 | Position/type/level options |
| 055–062 | **Timezone handling**: Comprehensive EST conversion for all statistics functions, fixing timezone discrepancies across inbound, putback, and putaway statistics |
| 056 | Weekly and day averages for inbound |
| 058 | Device registrations table |
| 059 | Putaway log statistics function |
| 060 | Delivery unique constraint |

## Phase 6: Kitting Kanban & GRS (064–077) — Nov 2025

**Focus:** Kit assembly workflow, GRIP processing, LX03 integration

| Migration | What it does |
|-----------|--------------|
| 064 | **Kit kanban system**: `kit_definitions`, `kit_kanban_columns`, `kit_kanban_tasks`, `kit_kanban_task_history`. Default columns: Planning → In Progress → Quality Check → Completed. Auto-logging trigger for task movements |
| 064 (dup) | Add dispositions to deliveries |
| 065 | `is_deleted` soft-delete on deliveries |
| 066 | GRS delivery status and data manager tabs |
| 069–071 | LX03 aggregation functions, statistics, and empty bins functions |
| 072 | GRS unknown batches table |
| 074–077 | SQ01 statistics, kit priority flags, kit cart viewer tab |

## Phase 7: Org Structure & Overtime (079–090) — Dec 2025

**Focus:** Organizational hierarchy, overtime, standard work

| Migration | What it does |
|-----------|--------------|
| 079 | Onboarding navigation |
| 080 | MCA redirected location tracking |
| 081 | Multiple breaks in shift schedules |
| 082–084 | Area supervisors in org tree, team lead hierarchy fixes |
| 085 | Team performance optimization |
| 086 | **Overtime management** + Dynamic activity configuration |
| 086 (dup) | Dynamic activity events integration |
| 090 | Standard work navigation |

## Phase 8: Standard Work & Ship Short (091–103) — 2025

**Focus:** Checklists, shipping, drone scans

| Migration | What it does |
|-----------|--------------|
| 094 | Standard work checklist system |
| 097 | Shift productivity tabs |
| 099 | Update kitting tabs |
| 101 | Incora ship-short columns |
| 102 | Drone scans system |
| 103 | MCA count start date fix |

## Phase 9: Security Hardening & RBAC MV (151–175) — 2025–2026

**Focus:** Security definer hardening, materialized views, session improvements

| Migration | What it does |
|-----------|--------------|
| 151 | Role hierarchy conflict fix |
| 153 | Weekly summary active associates fix |
| 155 | RPC security validation |
| 157–159 | Inbound scans area column, RPC type mismatches, role sync trigger fixes |
| 161–163 | Session timeouts, `handle_new_user` search path, remember-me columns |
| 165 | **RBAC materialized views** — pre-computed permission lookups |
| 166 | Check conditional permission function |
| 167 | Session timeout role column to text |
| 168 | Pending MCA count excludes confirmed |
| 172 | Hot part alerts table |
| 173 | **SECURITY DEFINER search_path hardening** — Sets explicit `search_path = public` on all SECURITY DEFINER functions |
| 174 | RPC org scoping and tab schema alignment |
| 175 | RBAC materialized view refresh automation |

## Phase 10: Time Adjustments & Kiosk (176–188) — 2026

**Focus:** Time adjustment workflow, kiosk, inbound cart

| Migration | What it does |
|-----------|--------------|
| 176 | Time adjustment requests |
| 177–178 | Kiosk RLS and overtime RLS fixes |
| 179–180 | Authenticated insert for time adjustments, notes/history |
| 186 | Complete putaway and clear cart RPC |
| 187 | Inbound cart tabs and permissions |
| 188 | Cart stow to productivity |

## Phase 11: MDM (Mobile Device Management) (189–195) — 2026

**Focus:** Apple MDM device lifecycle management

| Migration | What it does |
|-----------|--------------|
| 189 | **MDM devices and groups**: `mdm_devices` (serial, UDID, MDM state, hardware telemetry, security), `mdm_device_groups` (static/smart), `mdm_group_memberships` |
| 190 | MDM commands and events tables |
| 192 | MDM profiles, apps, compliance tables |
| 193 | MDM workflows and incidents |
| 195 | MDM RPC functions |

## Phase 12: Latest Features (196–213) — 2026

**Focus:** Warehouse map, cycle count path engine, SAP integration

| Migration | What it does |
|-----------|--------------|
| 196 | WAWF shipping columns |
| 198–199 | Standard work assignment RLS, cycle count number uniqueness fix |
| 201 | Cycle count RLS superadmin visibility |
| 202 | **Warehouse map system**: 9 tables (settings, maps, revisions, background assets, zones, racks, location mappings, status log, auto-map runs). RPC functions for layout retrieval, status updates, statistics, bulk assignment. Storage bucket for floor plans |
| 204 | **Cycle count path rules engine**: Location resolution rules (regex-based), path ordering strategies (serpentine/directional/alternating), operator defer queue, auto-resolve trigger on insert/update |
| 206 | Kit cart color |
| 207 | Extend audit action enum |
| 211 | Kitting dropdown options |
| 212 | Charge code for kitting |
| 213 | **SAP transaction logs**: `sap_transaction_logs` for VL02N Post Goods Issue tracking |

---

## Migration Statistics

- **Total files**: ~170 SQL migration files
- **Date range**: January 2025 – April 2026
- **Major systems introduced**: RBAC (005-009), Work Queue (039), Kit Kanban (064), Security Monitoring (030), MDM (189-195), Warehouse Map (202), Path Engine (204), SAP Integration (213)
- **Common fix patterns**: Timezone corrections (055-062), RLS policy fixes (013b, 177-178, 198, 201), search_path hardening (162, 173)

## Related
- [[Database-Schema-Overview]]
- [[Supabase-Configuration]]
- [[Database-Patterns]]
- [[Database-Migration-Workflow]] — Canonical apply workflow (Supabase MCP `apply_migration` + verification)


## Phase 13: Kitting Chains & Expedites (243–244) — Apr 2026

| Migration | What it does |
|-----------|--------------|
| 243 | **Kit Definition Chains**: New `kit_definition_chains` table (org-scoped, link types `build_order`/`ship_together`/`custom`, status, full RLS, audit triggers). Adds `chain_id` + `chain_sequence_order` columns to `kit_definitions` so each kit BOM can be linked into one chain. |
| 244 | **Expedite Delivery Time**: Adds `part_expedite_delivery_time` (CHECK `critical | 24_hour | 2_day`), `part_expedite_quantity` (NUMERIC), and `part_expedite_description` columns to `RR_Kitting_DATA`. Partial index on rows with non-null `part_expedite_part_number`. |

Driven by the Kitting Apps enhancement work documented in [[Kit-BOM-Chains-Expedites-And-INCORA-Component]].
