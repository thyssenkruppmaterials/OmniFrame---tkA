---
tags: [type/pattern, status/active, domain/frontend]
created: 2026-04-10
---
# React Query Patterns

## Purpose
Documents how TanStack Query (React Query) is used across the OneBox application for server state management, including key conventions, mutation patterns, and cache strategies.

## Setup

- `QueryClient` is created in `src/main.tsx` and passed to both `<QueryClientProvider>` and TanStack Router via `createRootRouteWithContext<{ queryClient: QueryClient }>()`
- Dev tools: `<ReactQueryDevtools>` enabled in development mode (positioned bottom-left)

## Query Key Conventions

Query keys are defined as module-level constants, typically as plain strings or tuples:

```typescript
// Simple string keys
const INBOUND_SCANS_QUERY_KEY = 'inbound-scans'
const INBOUND_SCANS_PAGINATED_QUERY_KEY = 'inbound-scans-paginated'
const INBOUND_STATISTICS_QUERY_KEY = 'inbound-statistics'

// Work queue keys
export const WORK_QUEUE_QUERY_KEY = 'work-queue'
export const QUEUE_STATS_QUERY_KEY = 'queue-stats'
```

**Naming pattern:** `FEATURE_TYPE_QUERY_KEY` in SCREAMING_SNAKE_CASE. Exported when shared across hooks.

## Query Patterns

### Standard Query Hook
```typescript
const { data, isLoading, error, isFetching } = useQuery({
  queryKey: [INBOUND_SCANS_PAGINATED_QUERY_KEY, currentPage, pageSize],
  queryFn: () => inboundScanService.getPaginated(currentPage, pageSize),
  placeholderData: keepPreviousData,  // Smooth page transitions
  enabled: someCondition,
})
```

### Polling Pattern
Used for real-time data like work queues:
```typescript
const { data: queue } = useQuery({
  queryKey: [WORK_QUEUE_QUERY_KEY],
  queryFn: () => workServiceClient.getQueue(),
  refetchInterval: enablePolling ? pollingInterval : false,  // Configurable, default 60s
})
```

### Pagination with `keepPreviousData`
The inbound scans hook demonstrates paginated queries:
- Query key includes page number and page size: `[key, currentPage, pageSize]`
- Uses `placeholderData: keepPreviousData` to show old data while new page loads
- Exposes `isFetching` separately from `isLoading` to distinguish initial load vs page transition
- Tracks `isPageTransition = isFetching && !isLoading`

## Mutation Patterns

### Standard Mutation with Cache Invalidation
```typescript
const createMutation = useMutation({
  mutationFn: (scanData: Partial<InboundScanData>) => 
    inboundScanService.create(scanData),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: [INBOUND_SCANS_QUERY_KEY] })
    queryClient.invalidateQueries({ queryKey: [INBOUND_STATISTICS_QUERY_KEY] })
    toast.success('Scan created successfully')
  },
  onError: (error) => {
    toast.error(`Failed to create scan: ${error.message}`)
  },
})
```

### Optimistic Updates
Work queue mutations use optimistic patterns for task state changes:
```typescript
const claimMutation = useMutation({
  mutationFn: () => workServiceClient.claimNext(),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: [WORK_QUEUE_QUERY_KEY] })
    queryClient.invalidateQueries({ queryKey: [QUEUE_STATS_QUERY_KEY] })
  },
})
```

### Multi-Key Invalidation
Mutations that affect multiple views invalidate all related keys:
```typescript
onSuccess: () => {
  queryClient.invalidateQueries({ queryKey: [WORK_QUEUE_QUERY_KEY] })
  queryClient.invalidateQueries({ queryKey: [QUEUE_STATS_QUERY_KEY] })
}
```

## Cache Invalidation Strategy

| Trigger | Action |
|---------|--------|
| Mutation success | `invalidateQueries` on related keys |
| User-initiated refresh | `queryClient.invalidateQueries` via exposed `refreshData()` |
| Realtime subscription | Supabase realtime events trigger `invalidateQueries` |
| Idle recovery | `useIdleRecovery` — delegates to PermissionProvider (does NOT invalidate all queries) |
| Tab focus | Not used globally — only specific hooks opt in |

## Hook Return Shape Convention

All data hooks follow a consistent return interface:
```typescript
interface UseFeatureReturn {
  // Data
  data: FeatureData[]
  statistics: FeatureStats | null
  
  // Pagination (if applicable)
  totalRecords: number
  currentPage: number
  totalPages: number
  setCurrentPage: (page: number) => void
  
  // Loading states
  isLoading: boolean       // Initial load
  isFetching: boolean      // Any fetch (including background)
  isPageTransition: boolean // Showing stale data during page change
  
  // Error states
  error: Error | null
  
  // CRUD operations
  createItem: (data) => Promise<void>
  updateItem: (id, data) => Promise<void>
  deleteItem: (id) => Promise<void>
  
  // Utilities
  refreshData: () => void
  exportToCSV: () => string
}
```

## Toast Integration

All mutations integrate with Sonner toast notifications:
- `onSuccess` → `toast.success('...')`
- `onError` → `toast.error('...')`
- Import operations show progress via `importProgress` state

## Data Sources

TanStack Query hooks communicate with multiple backends:

| Backend | Client | Used By |
|---------|--------|---------|
| Supabase (Postgres) | `supabase` client / `singletonAuthManager` | Most data hooks |
| Rust work service | `workServiceClient` | `useWorkQueue`, `usePushedWork` |
| Smartsheet API | Direct fetch | `useSmartsheet` |
| Inbound scan service | `inboundScanService` (may use Rust) | `useInboundScans` |

## Related
- [[State-Management-Patterns]]
- [[CustomHooks - React Hooks]]
- [[ZustandStores - State Management]]
- [[AppProviders - Provider Stack]]