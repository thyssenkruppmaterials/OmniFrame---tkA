---
tags: [type/component, status/active, domain/backend, domain/infra]
created: 2026-04-10
---
# Supabase Client Infrastructure

## Purpose
Provides the singleton Supabase client instance used by all services, along with query caching utilities and shared RPC type definitions. This is the foundational layer that every other Supabase service depends on.

## Key Files
- `client.ts` — Singleton client creation and export
- `query-cache.ts` — Client-side caching for Supabase queries
- `rpc-types.ts` — Typed utility interfaces for RPC responses

## Key Functions

### client.ts
- `getSupabaseClient()` — Creates/returns singleton `SupabaseClient<Database>` with HMR resistance via `window.__ONEBOX_SUPABASE_CLIENT__`
- `getSupabaseAdmin()` — Returns `null` in browser (admin client disabled for security); warns if service role key is exposed
- `isSupabaseConfigured()` — Checks env vars present
- `getCurrentSession()` / `getCurrentUser()` — Auth helper wrappers

### query-cache.ts
- `cachedQuery(key, queryFn, ttl)` — Wraps Supabase queries with Map-based cache (default 5min TTL)
- `generateCacheKey(table, params)` — Deterministic key generation
- `invalidateTableCache(table)` / `invalidateOrgCache(orgId)` — Pattern-based invalidation
- `clearQueryCache()` — Full cache reset
- `cachedQueryDecorator(keyPrefix, ttl)` — Class method decorator for automatic caching

### rpc-types.ts
- `SupabaseResult<T>` / `SupabaseSingleResult<T>` / `SupabaseListResult<T>` — Generic result wrappers
- `PermissionJoinRow` / `RolePermissionRow` — Permission join types
- `UserProfileRow` — User profile shape for typed queries

## Client Configuration
- Auth: PKCE flow, auto-refresh, persistent session (key: `onebox-auth-token`)
- Realtime: 10 events/second limit
- Headers: `x-application-name: onebox-ai`, `x-client-info: onebox-web@1.4.3`
- Schema: `public`
- Debug mode enabled in development

## Database Tables
- Indirectly: all tables (this is the client used by every service)
- `user_profiles` (used by admin client checks)

## Dependencies
- `@supabase/supabase-js` (createClient, SupabaseClient, PostgrestError)
- `@/lib/utils/logger`
- `./database.types` (Database type)
- Environment: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`

## Architecture Notes
- True singleton pattern using `window.__ONEBOX_SUPABASE_CLIENT__` to survive HMR
- Admin client intentionally returns `null` in browser to enforce RLS security
- Query cache runs cleanup every 60s, uses Map with TTL-based expiry

## Related
- [[Architecture]] — System overview
- [[InboundScanService - Supabase Service]] — Uses this client
- [[OutboundTODataService - Supabase Service]] — Uses this client
- [[DeliveryStatusService - Supabase Service]] — Uses this client
