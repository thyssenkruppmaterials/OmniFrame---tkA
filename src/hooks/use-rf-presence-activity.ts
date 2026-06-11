// Created and developed by Jai Singh
/**
 * useRfPresenceActivity — RF workflow → presence telemetry bridge.
 *
 * Mounted ONCE inside `<RFInterface>`. Surfaces granular RF activity
 * on the presence payload's `rf_activity` field so supervisors looking
 * at `<LiveOperatorStatus>` can see what an operator is actually doing
 * at a glance — current workflow step, last scan, idle indicator,
 * active work task / zone.
 *
 * **Privacy contract.** Same as `current_page`: the payload is
 * broadcast for every presence-candidate user, but only ONE UI
 * surface reads it (`<LiveOperatorStatus>` inside the Inventory
 * Counts tab, RBAC-gated by `view inventory_apps`). The hook itself
 * does NOT enforce visibility — the broadcast is universal, the
 * consumer-side gate is the contract. See
 * `memorybank/OmniFrame/Decisions/ADR-RF-Activity-Telemetry.md`.
 *
 * **Architecture (Phase 0 findings).** The RF tree has no central
 * state machine — `useUnifiedCycleCount` drives cycle-count, custom
 * `useState({currentStep})` drives put-away / build-kit / inspect-
 * kit / kitting-picking, `useTaskWorkflowRuntime` drives newer
 * pick / zone-audit. Scan completion is processed inside each form's
 * own `handleScan*` callback — no central event bus. We accept that
 * Phase A of this telemetry surface is **work-type-level
 * granularity** (not sub-step-level) and last-input via document-
 * level capture-phase listeners. Future per-form integrations can
 * call `presenceService.updateRfActivity(...)` directly with finer
 * step labels (e.g. `'scanning_material'`, `'confirming_count'`)
 * without breaking this hook — the equality check on the service
 * side coalesces the typical "set step to X then Y then back to X"
 * pattern into one broadcast.
 *
 * **Why `currentView` (not `useLocation().pathname`).** The entire
 * RF tree mounts at the SINGLE route `/rf-interface/` (see
 * `src/routes/rf-interface/index.tsx`). RF sub-views (cycle-count,
 * inbound-part-transfer, putaway, etc.) are switched via
 * `setCurrentView('inbound-part-transfer')` inside `<RFInterface>`,
 * NOT via `navigate({ to: '/rf-interface/inbound-part-transfer' })`
 * — so `useLocation().pathname` is ALWAYS `/rf-interface` regardless
 * of which RF sub-app the operator is in. Switching this hook to a
 * pathname-based source would map every RF sub-view to "RF Terminal"
 * via `resolveFeature()` — strictly worse than the current
 * `currentView`-based granularity. The `^/rf-interface/cycle-count`
 * patterns in `route-features.ts` are forward-looking (they cover the
 * shape if the RF tree ever gets nested file-routes) but they do not
 * fire today. Confirmed during the 2026-05-07 PM debug pass — see
 * `memorybank/OmniFrame/Debug/Fix-RF-Activity-Step-Source-Confusion.md`.
 *
 * **Coalescing.** The hook itself does not debounce. Every
 * meaningful state change calls `presenceService.updateRfActivity(...)`
 * which delegates to the existing `scheduleTrack()` /
 * `scheduleHeartbeat()` debouncer (`TRACK_DEBOUNCE_MS = 1500ms`).
 * Last-input timestamps update local refs but skip the broadcast
 * unless the shape (step / task / zone / scan) actually changed.
 *
 * **Scan capture.** A capture-phase `keydown` listener on
 * `document` watches for `Enter` on inputs with
 * `data-slot="scanner-input"`. The scanner emulates Enter key
 * after a successful read — that's the canonical "scan complete"
 * event in the RF stack today. Value is read off
 * `event.target.value` at the moment of the keypress.
 *
 * **Cleanup.** On unmount (RF tab closed / navigated away from
 * `/rf-interface`) the hook calls `updateRfActivity(null)` so
 * supervisor cards drop the activity panel cleanly.
 */
import { useEffect, useRef } from 'react'
import { presenceService } from '@/lib/presence'
import type { PresenceRfActivity } from '@/lib/presence/types'

/**
 * Throttle for "every input is an activity ping" updates. We only
 * push a fresh `last_input_at` to the service this often — anything
 * tighter is wasted: the service-side debouncer batches at 1500ms
 * anyway, and the panel only cares about ~10s / ~60s thresholds.
 */
const INPUT_PING_THROTTLE_MS = 1_000

/**
 * Map the parent's `currentView` (the top-level RF screen) to a
 * stable snake_case `current_step` label. Free-form on the wire —
 * `<LiveOperatorStatus>` humanises with a small lookup + fallback.
 *
 * Falls through to the raw `currentView` string for unknown values
 * so a new RF screen doesn't lose all telemetry; the supervisor just
 * sees the unmapped label. Keeps this map cheap to extend.
 */
const VIEW_TO_STEP: Record<string, string> = {
  home: 'rf_home',
  scan: 'rf_scanning',
  putaway: 'putaway',
  picking: 'picking',
  'kitting-apps': 'kitting_apps',
  'kitting-picking': 'kitting_picking',
  'build-kit': 'build_kit',
  'inspect-kit': 'inspect_kit',
  'cycle-count': 'cycle_count',
  'grs-cycle-count': 'grs_cycle_count',
  'grs-core-pulls': 'grs_core_pulls',
  'inbound-part-transfer': 'inbound_part_transfer',
  'my-productivity': 'my_productivity',
  'work-queue': 'work_queue',
  'claim-tasks': 'claim_tasks',
  'sap-migo': 'sap_migo',
  inventory: 'rf_inventory',
  locations: 'rf_locations',
  profile: 'rf_profile',
}

export interface UseRfPresenceActivityOptions {
  /**
   * Top-level RF screen the operator is on. Drives `current_step`.
   * `null` / `undefined` while no view is active (the hook emits
   * `null` activity in that case).
   */
  currentView: string | null | undefined
  /**
   * Active work task ID, when the operator has claimed/started one.
   * Today only the cycle-count flow surfaces this to the parent —
   * other flows can extend once their internal state machines learn
   * to bubble this up. `null` means no claimed task.
   */
  workTaskId: string | null | undefined
  /**
   * Active work zone (e.g. `'K3'` derived from `'K3-08-02-2'`).
   * Same caveat as `workTaskId` re: cycle-count-only today.
   */
  workZone: string | null | undefined
}

export function useRfPresenceActivity({
  currentView,
  workTaskId,
  workZone,
}: UseRfPresenceActivityOptions): void {
  // Live refs so the document-level listeners (set up once) always
  // see the latest values without re-binding on every render.
  const stepRef = useRef<string | null>(null)
  const taskRef = useRef<string | null>(null)
  const zoneRef = useRef<string | null>(null)
  const lastScanRef = useRef<PresenceRfActivity['last_scan']>(null)
  const lastInputAtRef = useRef<string | null>(null)
  const lastPingedAtRef = useRef<number>(0)

  // Sync incoming props into refs + emit on shape changes.
  useEffect(() => {
    if (presenceService.isDisabled) return

    const step = currentView ? (VIEW_TO_STEP[currentView] ?? currentView) : null
    stepRef.current = step
    taskRef.current = workTaskId ?? null
    zoneRef.current = workZone ?? null

    // Emit current activity. The service-side equality check on
    // `current_step` + `work_task_id` + `work_zone` + `last_scan`
    // collapses no-op props re-renders; only real shape changes
    // trigger a fresh broadcast through `scheduleTrack()` /
    // `scheduleHeartbeat()`.
    presenceService.updateRfActivity({
      current_step: step,
      last_scan: lastScanRef.current,
      work_task_id: taskRef.current,
      work_zone: zoneRef.current,
      last_input_at: lastInputAtRef.current,
    })
  }, [currentView, workTaskId, workZone])

  // Document-level listeners for last-input + scan capture. Mount
  // once for the lifetime of the RF interface tab; the listener
  // body reads from refs so we never re-bind on every render.
  useEffect(() => {
    if (presenceService.isDisabled) return
    if (typeof document === 'undefined') return

    const recordInput = () => {
      const now = Date.now()
      if (now - lastPingedAtRef.current < INPUT_PING_THROTTLE_MS) {
        // Throttled — still bump the ref so the next real broadcast
        // (e.g. a scan / view change) carries the freshest stamp.
        lastInputAtRef.current = new Date(now).toISOString()
        return
      }
      lastPingedAtRef.current = now
      lastInputAtRef.current = new Date(now).toISOString()
      // Push to service. The service equality check skips the
      // broadcast when only `last_input_at` changed — but in-place
      // mutates `currentPayload.rf_activity.last_input_at`, so any
      // unrelated heartbeat (scheduled-interval, status flip, scan)
      // carries fresh data. This call is the cheapest "tap the ref"
      // primitive available to the hook; it's NOT a broadcast trigger.
      presenceService.updateRfActivity({
        current_step: stepRef.current,
        last_scan: lastScanRef.current,
        work_task_id: taskRef.current,
        work_zone: zoneRef.current,
        last_input_at: lastInputAtRef.current,
      })
    }

    const recordScan = (value: string) => {
      const now = new Date().toISOString()
      lastScanRef.current = {
        type: 'rf_scan',
        value,
        at: now,
      }
      lastInputAtRef.current = now
      lastPingedAtRef.current = Date.now()
      // Scans ARE shape-changing — push to the service. The next
      // heartbeat carries the new `last_scan.value` and the supervisor
      // panel re-renders.
      presenceService.updateRfActivity({
        current_step: stepRef.current,
        last_scan: lastScanRef.current,
        work_task_id: taskRef.current,
        work_zone: zoneRef.current,
        last_input_at: lastInputAtRef.current,
      })
    }

    const onKeyDown = (event: KeyboardEvent) => {
      recordInput()
      // Bluetooth / USB barcode scanners emit `Enter` after the
      // payload — that's the canonical "scan complete" event today.
      // ScannerInput components carry `data-slot="scanner-input"`
      // which lets us delegate without coupling to specific forms.
      if (event.key !== 'Enter') return
      const target = event.target
      if (!(target instanceof HTMLInputElement)) return
      if (target.dataset.slot !== 'scanner-input') return
      const v = target.value?.trim()
      if (!v) return
      recordScan(v)
    }

    const onPointerDown = () => {
      recordInput()
    }

    document.addEventListener('keydown', onKeyDown, { capture: true })
    document.addEventListener('pointerdown', onPointerDown, { capture: true })

    return () => {
      document.removeEventListener('keydown', onKeyDown, { capture: true })
      document.removeEventListener('pointerdown', onPointerDown, {
        capture: true,
      })
    }
  }, [])

  // Cleanup on unmount: clear `rf_activity` so supervisor cards
  // gracefully drop the panel. Empty deps so this only runs at
  // mount/unmount (the live values are kept fresh by the prop-sync
  // effect above + the document listeners).
  useEffect(() => {
    return () => {
      if (presenceService.isDisabled) return
      presenceService.updateRfActivity(null)
    }
  }, [])
}

// Created and developed by Jai Singh
