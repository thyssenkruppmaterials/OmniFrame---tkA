/**
 * Ticket Update Detection Hook (Option B – Delta Comparator)
 *
 * Detects externally-changed ticket rows by comparing `updated_at`
 * timestamps across consecutive React Query refetches.  This approach
 * works for ANY field change (RR Updates, TKA Updates, status, etc.)
 * and does not depend on Smartsheet webhook delivery.
 *
 * The hook accepts the current `allTickets` array from `useTickets()`
 * and on every new dataset:
 *   1. Compares each row's `updated_at` against a stored snapshot.
 *   2. Marks rows whose timestamp changed as "recently updated".
 *   3. Calls the `onUpdatesDetected` callback with the changed row IDs.
 *
 * First-load initialisation is treated as a baseline snapshot — no
 * false-positive flood.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

// ==================== CONSTANTS ====================

const DEFAULT_HIGHLIGHT_DURATION = 30_000 // 30 seconds
const DEFAULT_SUPPRESS_DURATION = 10_000 // 10 seconds — ignore own edits
const MAX_TRACKED_ROWS = 50

// ==================== TYPES ====================

/** Minimal ticket shape required by the hook. */
export interface TicketSnapshot {
  row_id: number
  updated_at?: string
}

/** Options accepted by `useTicketUpdates`. */
export interface UseTicketUpdatesOptions {
  /** Whether detection is enabled (default `true`). */
  enabled?: boolean
  /** How long a row stays in the "recently updated" set, in ms (default 30 000). */
  highlightDuration?: number
  /** Callback fired whenever new updated row IDs are detected. */
  onUpdatesDetected?: (rowIds: number[]) => void
}

/** Return value of the `useTicketUpdates` hook. */
export interface UseTicketUpdatesReturn {
  /** Row IDs that were updated within the last `highlightDuration` ms. */
  recentlyUpdatedRowIds: Set<number>
  /** Manually dismiss a single row highlight. */
  clearUpdatedRow: (rowId: number) => void
  /** Dismiss all row highlights. */
  clearAllUpdates: () => void
  /**
   * Temporarily suppress notifications for a row.
   * Call this before/after the current user makes a mutation so their
   * own edit doesn't trigger a false-positive notification.
   */
  suppressRow: (rowId: number) => void
}

// ==================== HOOK ====================

/**
 * Detects ticket row changes by comparing `updated_at` timestamps
 * across consecutive ticket list snapshots from React Query.
 *
 * @param tickets  Current ticket list (typically `allTickets` from `useTickets()`).
 * @param options  Configuration options.
 */
export function useTicketUpdates(
  tickets: TicketSnapshot[],
  options?: UseTicketUpdatesOptions
): UseTicketUpdatesReturn {
  const {
    enabled = true,
    highlightDuration = DEFAULT_HIGHLIGHT_DURATION,
    onUpdatesDetected,
  } = options ?? {}

  // --- State ---

  // Map<rowId, addedAt (ms)> — tracks highlighted rows with their insertion time.
  const updatedRowsRef = useRef<Map<number, number>>(new Map())
  // Counter to force re-renders when the Set contents change.
  const [, setRenderTick] = useState(0)
  const forceRender = useCallback(() => setRenderTick((t) => t + 1), [])

  // Stable ref for the callback to avoid stale closures.
  const onUpdatesDetectedRef = useRef(onUpdatesDetected)
  useEffect(() => {
    onUpdatesDetectedRef.current = onUpdatesDetected
  }, [onUpdatesDetected])

  // Expiry timers for auto-clearing row highlights.
  const expiryTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(
    new Map()
  )

  // Previous snapshot: Map<row_id, updated_at>.
  const snapshotRef = useRef<Map<number, string | undefined> | null>(null)

  // Suppressed rows: rows the current user just edited.
  // Map<rowId, expiryTimer> — auto-clears after DEFAULT_SUPPRESS_DURATION.
  const suppressedRowsRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(
    new Map()
  )

  /** Temporarily suppress a row from triggering notifications. */
  const suppressRow = useCallback((rowId: number) => {
    // Clear any existing timer for this row.
    const existing = suppressedRowsRef.current.get(rowId)
    if (existing) clearTimeout(existing)

    const timer = setTimeout(() => {
      suppressedRowsRef.current.delete(rowId)
    }, DEFAULT_SUPPRESS_DURATION)

    suppressedRowsRef.current.set(rowId, timer)

    // Also update the snapshot so the next refetch with the new
    // updated_at won't be seen as a delta.
    // We set it to undefined so any incoming value is accepted silently.
    if (snapshotRef.current) {
      snapshotRef.current.delete(rowId)
    }
  }, [])

  // --- Row highlight management ---

  const scheduleExpiry = useCallback(
    (rowId: number) => {
      const existing = expiryTimersRef.current.get(rowId)
      if (existing) clearTimeout(existing)

      const timer = setTimeout(() => {
        updatedRowsRef.current.delete(rowId)
        expiryTimersRef.current.delete(rowId)
        forceRender()
      }, highlightDuration)

      expiryTimersRef.current.set(rowId, timer)
    },
    [highlightDuration, forceRender]
  )

  const clearUpdatedRow = useCallback(
    (rowId: number) => {
      updatedRowsRef.current.delete(rowId)
      const timer = expiryTimersRef.current.get(rowId)
      if (timer) {
        clearTimeout(timer)
        expiryTimersRef.current.delete(rowId)
      }
      forceRender()
    },
    [forceRender]
  )

  const clearAllUpdates = useCallback(() => {
    updatedRowsRef.current.clear()
    for (const timer of expiryTimersRef.current.values()) {
      clearTimeout(timer)
    }
    expiryTimersRef.current.clear()
    forceRender()
  }, [forceRender])

  // --- Delta detection ---

  useEffect(() => {
    if (!enabled || tickets.length === 0) return

    // Build new snapshot from current ticket data.
    const newSnapshot = new Map<number, string | undefined>()
    for (const t of tickets) {
      newSnapshot.set(t.row_id, t.updated_at)
    }

    const prevSnapshot = snapshotRef.current

    if (prevSnapshot === null) {
      // First load — store baseline, do NOT flag anything as updated.
      snapshotRef.current = newSnapshot
      return
    }

    // Compare: find rows whose updated_at changed.
    const changedRowIds: number[] = []
    for (const [rowId, newUpdatedAt] of newSnapshot) {
      // Skip rows the current user just edited (suppressed).
      if (suppressedRowsRef.current.has(rowId)) continue

      const prevUpdatedAt = prevSnapshot.get(rowId)
      // Changed if: timestamp differs, OR row is new (not in previous snapshot)
      if (newUpdatedAt !== prevUpdatedAt) {
        // Only flag if NOT already tracked (avoid restarting highlight timer)
        if (!updatedRowsRef.current.has(rowId)) {
          changedRowIds.push(rowId)
        }
      }
    }

    // Update snapshot for next comparison.
    snapshotRef.current = newSnapshot

    if (changedRowIds.length === 0) return

    // Track changed rows.
    const now = Date.now()
    for (const rowId of changedRowIds) {
      updatedRowsRef.current.set(rowId, now)
      scheduleExpiry(rowId)
    }

    // Enforce max tracked rows — evict oldest first.
    if (updatedRowsRef.current.size > MAX_TRACKED_ROWS) {
      const sorted = [...updatedRowsRef.current.entries()].sort(
        (a, b) => a[1] - b[1]
      )
      const toRemove = sorted.slice(
        0,
        updatedRowsRef.current.size - MAX_TRACKED_ROWS
      )
      for (const [rowId] of toRemove) {
        updatedRowsRef.current.delete(rowId)
        const timer = expiryTimersRef.current.get(rowId)
        if (timer) {
          clearTimeout(timer)
          expiryTimersRef.current.delete(rowId)
        }
      }
    }

    forceRender()

    // Notify caller (via ref to avoid stale closure).
    onUpdatesDetectedRef.current?.(changedRowIds)
  }, [tickets, enabled, scheduleExpiry, forceRender])

  // Cleanup all timers on unmount.
  useEffect(() => {
    const expiryTimers = expiryTimersRef.current
    const suppressedRows = suppressedRowsRef.current
    return () => {
      for (const timer of expiryTimers.values()) {
        clearTimeout(timer)
      }
      expiryTimers.clear()
      for (const timer of suppressedRows.values()) {
        clearTimeout(timer)
      }
      suppressedRows.clear()
    }
  }, [])

  // --- Derive the public Set from the internal Map ---

  const recentlyUpdatedRowIds = new Set(updatedRowsRef.current.keys())

  return {
    recentlyUpdatedRowIds,
    clearUpdatedRow,
    clearAllUpdates,
    suppressRow,
  }
}
