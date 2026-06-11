---
tags: [type/component, status/active, domain/backend]
created: 2026-04-10
---
# RF Cycle Count Services

## Purpose
Services for managing RF-based cycle count operations on the warehouse floor. Two variants exist: the legacy standard cycle count service (now deprecated in favor of rust-work-service) and the active GRS (Good Receipt Stock) cycle count service for location-based batch scanning.

## Services

### RFCycleCountService (`rf-cycle-count.service.ts`)
**Status: DEPRECATED** — migrated to `rust-work-service` via `src/lib/work-service/client.ts`.

Singleton class handling the full lifecycle of standard cycle counts:
- `assignNextCycleCount()` → calls RPC `assign_next_cycle_count` (use `workServiceClient.claimNext()` instead)
- `checkPendingCountsAvailable()` → calls RPC `check_pending_counts_available`
- `getUserAssignedCounts()` → calls RPC `get_user_assigned_counts`
- `startCycleCount(countId, userDisplayName?)` → updates `rr_cyclecount_data` status to `in_progress`
- `validateCycleCount(systemQty, countedQty)` → variance validation with zero-quantity edge cases
- `releaseCycleCountAssignment(countId)` → calls RPC `release_cycle_count_assignment`
- `completeCycleCount(countId, countedQty, notes?)` → marks `rr_cyclecount_data` as `completed`
- `getAbandonedCycleCounts(thresholdMinutes)` → calls RPC `detect_abandoned_cycle_counts`
- `releaseAbandonedCycleCounts(thresholdMinutes)` → calls RPC `release_abandoned_cycle_counts`
- `releaseMyAssignment(countId)` / `releaseMyCount(countId, reason?)`
- `runAbandonmentCleanup()` → auto-releases counts idle >30 minutes

**Migration guide:**
- `assignNextCycleCount()` → `workServiceClient.claimNext()`
- `completeCycleCount()` → `workServiceClient.completeTask()`
- `releaseMyCount()` → `workServiceClient.releaseTask()`
- `startCycleCount()` → `workServiceClient.startTask()`
- Unified hook: `src/hooks/use-unified-cycle-count.ts`

### RFGRSCycleCountService (`rf-grs-cycle-count.service.ts`)
**Status: ACTIVE** — handles GRS (Good Receipt Stock) location-based batch scanning.

Singleton class for warehouse GRS cycle counting workflow:
- `fetchBatchesForLocation(location)` → queries `rr_sq01_data` by `conf_cert_ref`
- `validateLocation(location)` → checks if location exists in `rr_sq01_data`
- `findBatchByNumber(batchNumber)` → searches `rr_sq01_data` by `batch`
- `markBatchAsScanned(batchId, userId, userName)` → sets `grs_scan_status = 'Scanned'`
- `markBatchFoundInDifferentLocation(batchId, actualLocation, userId, userName)` → sets status to `'Found in Different Location'`
- `completeLocationScan(location, scannedBatchIds)` → marks unscanned batches as `'Not Scanned but Location Complete'`
- `getGRSStatistics()` → aggregates batch/location scan progress
- `resetLocationScan(location)` → clears scan status (testing/debug)
- `uploadPhoto(file, batchNumber)` → uploads to Supabase storage bucket `grs-photos`
- `createUnknownBatch(unknownBatch, userId, userName, orgId)` → inserts into `grs_unknown_batches`

## Database Tables
- `rr_cyclecount_data` — standard cycle count records (assignment, status, counted_quantity, variance)
- `rr_sq01_data` — GRS batch inventory records (location, batch, material, scan status)
- `grs_unknown_batches` — batches found during GRS scanning that don't exist in system

## Database RPCs
- `assign_next_cycle_count(p_user_id)`
- `check_pending_counts_available()`
- `get_user_assigned_counts(p_user_id)`
- `release_cycle_count_assignment(p_count_id, p_user_id)`
- `detect_abandoned_cycle_counts(p_abandonment_threshold_minutes)`
- `release_abandoned_cycle_counts(p_abandonment_threshold_minutes, p_max_releases)`

## Storage Buckets
- `grs-photos` — photos of unknown batches found during GRS scanning

## Key Interfaces
- `RFCycleCountOperation` — full cycle count record with count_type, variance, recount fields
- `GRSBatchItem` — batch record with scan status, location, material info
- `GRSLocationScanSession` — in-memory session tracking scanned batches per location
- `GRSUnknownBatch` — unknown batch discovery record

## Related
- [[Architecture]]
- [[RFPickingService - Supabase Service]]
- [[TeamPerformance - Supabase Service]]
- [[ProductivityAndSettings - Supabase Service]]