---
tags: [type/context, status/active, domain/database]
created: 2026-04-10
---
# Supabase Configuration

OmniFrame uses **Supabase** as its backend-as-a-service, providing PostgreSQL, Auth, Realtime, Storage, and Edge Functions.

## Project Configuration

### Environment Variables

| Variable | Purpose |
|----------|--------|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Public anonymous key for client-side access |
| `VITE_SUPABASE_SERVICE_ROLE_KEY` | Backend-only service key (NEVER exposed in browser) |

### Client Architecture

**True Singleton Pattern** — a single `SupabaseClient` instance is created and stored on `window.__ONEBOX_SUPABASE_CLIENT__` for HMR resistance. This prevents multiple GoTrueClient instances which corrupt auth state.

File: `src/lib/supabase/client.ts`
- `supabase` — singleton client with PKCE flow, `onebox-auth-token` storage key
- `supabaseAdmin` — returns `null` in browser (admin ops handled via backend API)
- Auth config: `autoRefreshToken: true`, `persistSession: true`, `detectSessionInUrl: true`, `flowType: 'pkce'`
- Custom headers: `x-application-name: onebox-ai`, `x-client-info: onebox-web@1.4.3`
- Realtime: `eventsPerSecond: 10`

### Connection Pool

File: `src/lib/database/connection-pool.ts`
- `DatabaseConnectionPool` singleton wraps `SingletonAuthManager`
- Provides `executeRead()`, `executeWrite()`, `executeAdmin()` with automatic retry
- Batch execution with `executeBatch()` supporting parallel and sequential modes
- Health monitoring with 30-second interval checks
- Metrics tracking: request counts, average response time, health check pass/fail
- Test mode support via `initializeForTesting()` for Vitest integration tests

## Auth Integration

### User Creation Flow

When a new user signs up via Supabase Auth, a PostgreSQL trigger fires `handle_new_user()`:

1. Looks up default organization by `slug = 'default'`
2. Creates a `user_profiles` row with the org's `default_role_id`
3. Falls back to the `viewer` role if no default is set
4. Populates `email`, `username` (from email prefix), `first_name`, `last_name` from auth metadata

### Session Management

- `user_sessions` and `enhanced_user_sessions` tables track active sessions
- Session timeouts are role-configurable (migration 161/167)
- Remember-me support with extended expiry (migration 163)
- Failed auth attempts tracked in `failed_auth_attempts` with rate limiting

## Row Level Security (RLS)

RLS is enabled on **every table** in the public schema. Two primary patterns:

### Pattern 1: Organization Scoping (most common)
```sql
CREATE POLICY "org_access" ON table_name
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM user_profiles WHERE id = auth.uid()
    )
  );
```

### Pattern 2: JWT Metadata Scoping (warehouse map tables)
```sql
CREATE POLICY "org_access" ON table_name
  FOR SELECT USING (
    organization_id = (auth.jwt() -> 'user_metadata' ->> 'organization_id')::UUID
  );
```

### Pattern 3: Role-Based Admin Access
```sql
CREATE POLICY "admin_access" ON table_name
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN roles r ON up.role_id = r.id
      WHERE up.id = auth.uid()
      AND r.name IN ('superadmin', 'admin')
    )
  );
```

### Service Role Policies
```sql
CREATE POLICY "service_full_access" ON table_name
  FOR ALL TO service_role USING (true) WITH CHECK (true);
```

## RPC Functions (Key Functions)

### RBAC Functions
- `get_user_permissions_fast(user_id)` — Returns all permission keys as `resource:action` strings using recursive role chain CTE
- `check_user_permission_fast(user_id, resource, action)` — Boolean permission check with wildcard support
- `get_user_inherited_permissions(user_id)` — Full inherited permissions with source tracking
- `check_permission_with_context(user_id, resource, action, context)` — Comprehensive check with logging and 2FA awareness
- `get_role_hierarchy_detailed(role_id)` — Full role tree with user/permission counts
- `bulk_assign_permissions(target_type, target_id, permission_ids)` — Batch permission assignment with validation
- `validate_permission_assignment(user_id, permission_id)` — Checks for missing dependencies and conflicts
- `get_user_auth_status(user_id)` — Complete auth status: role, permissions count, active sessions

### Warehouse Map Functions
- `get_warehouse_map_layout(map_id)` — Returns full layout: map, settings, zones, racks, background
- `update_location_operational_status(mapping_id, status, reason, changed_by, expected_updated_at)` — Optimistic concurrency update
- `get_warehouse_map_statistics(map_id)` — Utilization stats, occupied bins, unmapped bins
- `get_unassigned_bins(map_id, area_filter, search, limit)` — Finds unassigned SAP bins
- `bulk_assign_locations(rack_id, assignments, org_id)` — Batch bin-to-rack assignment

### Cycle Count Functions
- `get_cycle_count_statistics()` — Org-scoped statistics: total, pending, completed, variance
- `resolve_cycle_count_location(org_id, warehouse, raw_location)` — 3-step resolution: map match → regex rules → unresolved fallback
- `skip_cycle_count_for_operator(count_id, user_id, reason)` — Defer a count to operator's skip queue

### Work Queue Functions
- `get_next_task_for_worker(worker_id, task_types, zones)` — Intelligent task assignment with `FOR UPDATE SKIP LOCKED`
- `calculate_task_priority(task_id)` — Dynamic priority using weighted urgency/age/location/custom scores
- `bulk_assign_tasks(task_ids, strategy)` — Load-balanced batch assignment
- `rebalance_work_queue()` — Redistributes tasks from overloaded workers
- `escalate_stalled_tasks()` — Auto-escalates tasks exceeding warning thresholds

### Security & Audit Functions
- `log_rbac_audit_event(...)` — Structured RBAC change logging with diff calculation
- `log_security_event(...)` — Threat event logging
- `detect_suspicious_activity(user_id, time_window)` — Risk scoring based on failed logins, permission denials, multiple IPs
- `detect_suspicious_sessions()` — Session anomaly detection against restriction rules
- `cleanup_audit_logs(retention_days)` — Retention-based cleanup (90 days default)
- `get_security_metrics(days)` — Security dashboard metrics

## Edge Functions

- `supabase/functions/analytics-api/` — Analytics API edge function (TypeScript/Deno)

## Storage Buckets

- `warehouse-map-backgrounds` — Floor-plan images for warehouse maps (max 10MB, PNG/JPEG/WebP)

## Extensions

- `uuid-ossp` — UUID generation
- Standard PostgreSQL extensions via Supabase

## Related
- [[Database-Schema-Overview]]
- [[Database-Patterns]]
- [[Migration-History]]
- [[SingletonAuthManager - Authentication Core]]
- [[AuthService - Unified Authentication]]
- [[AuthCache - Caching Layer]]