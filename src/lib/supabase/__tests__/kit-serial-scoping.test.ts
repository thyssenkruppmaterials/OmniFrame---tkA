// Created and developed by Jai Singh
/**
 * Regression coverage for the multi-kit-per-PO cross-link fix
 * (memorybank/OmniFrame/Debug/Fix-Kit-Build-Cross-Linked-Parts.md).
 *
 * The bug-affected service paths used to key by kit_po_number alone, so two
 * kits sharing a PO would silently merge. These tests stub the Supabase
 * client and verify the rewritten paths key by kit_serial_number end-to-end.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { KitKanbanService } from '../kit-kanban.service'
// ---------------------------------------------------------------------------
// Imports come after the mock so the singleton picks up the stub.
// ---------------------------------------------------------------------------
import { rfKittingPickingService } from '../rf-kitting-picking.service'
import { RRKittingDataService } from '../rr-kitting-data.service'

// ---------------------------------------------------------------------------
// Supabase client stub
// ---------------------------------------------------------------------------

interface PendingFilter {
  table: string
  op: 'select' | 'update' | 'insert' | 'delete'
  filters: Array<
    | [string, string, unknown]
    | ['order' | 'limit' | 'is' | 'not' | 'in', string, unknown]
  >
  payload?: unknown
  selectColumns?: string
}

const recordedCalls: PendingFilter[] = []

let nextResults: Array<{ data: unknown; error: unknown }> = []

function nextResult() {
  if (nextResults.length === 0) {
    return { data: null, error: null }
  }
  return nextResults.shift()!
}

function makeBuilder(table: string) {
  const state: PendingFilter = { table, op: 'select', filters: [] }
  // primaryOpFrozen flips true once .insert/.update/.delete is invoked, so a
  // subsequent .select('id') projection (used to read back inserted rows)
  // does not retro-overwrite the recorded op.
  let primaryOpFrozen = false

  const builder: any = {
    select(columns?: string) {
      if (!primaryOpFrozen) {
        state.op = 'select'
      }
      state.selectColumns = columns
      return builder
    },
    insert(payload: unknown) {
      state.op = 'insert'
      state.payload = payload
      primaryOpFrozen = true
      return builder
    },
    update(payload: unknown) {
      state.op = 'update'
      state.payload = payload
      primaryOpFrozen = true
      return builder
    },
    delete() {
      state.op = 'delete'
      primaryOpFrozen = true
      return builder
    },
    eq(column: string, value: unknown) {
      state.filters.push([column, 'eq', value])
      return builder
    },
    in(column: string, values: unknown[]) {
      state.filters.push([column, 'in', values])
      return builder
    },
    is(column: string, value: unknown) {
      state.filters.push([column, 'is', value])
      return builder
    },
    not(column: string, op: string, value: unknown) {
      state.filters.push([column, `not.${op}` as any, value])
      return builder
    },
    like(column: string, pattern: unknown) {
      state.filters.push([column, 'like', pattern])
      return builder
    },
    or() {
      return builder
    },
    order(column: string, opts?: unknown) {
      state.filters.push(['order', column, opts])
      return builder
    },
    limit(n: number) {
      state.filters.push(['limit', '', n])
      return builder
    },
    single() {
      recordedCalls.push(state)
      return Promise.resolve(nextResult())
    },
    maybeSingle() {
      recordedCalls.push(state)
      return Promise.resolve(nextResult())
    },
    then(resolve: (v: unknown) => unknown) {
      recordedCalls.push(state)
      return Promise.resolve(nextResult()).then(resolve)
    },
  }

  return builder
}

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'user-test' } },
        error: null,
      }),
    },
    from: vi.fn((table: string) => makeBuilder(table)),
    storage: {
      from: vi.fn(() => ({
        upload: vi.fn(),
        getPublicUrl: vi.fn(),
      })),
    },
  },
}))

beforeEach(() => {
  recordedCalls.length = 0
  nextResults = []
})

function queueResults(...results: Array<{ data: unknown; error?: unknown }>) {
  nextResults = results.map((r) => ({ data: r.data, error: r.error ?? null }))
}

// ---------------------------------------------------------------------------
// verifyKitForPicking — multi-kit disambiguation
// ---------------------------------------------------------------------------

describe('verifyKitForPicking — multi-kit disambiguation', () => {
  it('returns a kits[] list when one PO maps to multiple active kits', async () => {
    queueResults({
      // PO meta lookup
      data: [
        {
          kit_serial_number: 'KIT-20260512-001',
          kit_number: 'C47E/4 Gear Box 1',
          kit_build_status: 'in_progress',
          kit_build_number: '854420',
          transfer_order_number: '7287809',
          kit_to_line_picked_date_time: '2026-05-12T10:00:00Z',
        },
        {
          kit_serial_number: 'KIT-20260512-002',
          kit_number: 'C47E/4 Gear Box 2',
          kit_build_status: 'in_progress',
          kit_build_number: '854420',
          transfer_order_number: '7287810',
          kit_to_line_picked_date_time: null,
        },
      ],
    })

    const result =
      await rfKittingPickingService.verifyKitForPicking('2010102615')

    expect(result.data).toBeNull()
    expect(result.kits).toBeDefined()
    expect(result.kits).toHaveLength(2)
    expect(result.kits!.map((k) => k.kit_serial_number).sort()).toEqual([
      'KIT-20260512-001',
      'KIT-20260512-002',
    ])
    // Internal helper should not leak into the UI payload.
    expect(
      (result.kits![0] as unknown as Record<string, unknown>)._hasValidStatus
    ).toBeUndefined()
  })

  it('proceeds to single-kit verification when the PO has exactly one active kit', async () => {
    queueResults(
      {
        // PO meta lookup
        data: [
          {
            kit_serial_number: 'KIT-20260512-001',
            kit_number: 'C47E/4 Gear Box 1',
            kit_build_status: 'in_progress',
            kit_build_number: '854420',
            transfer_order_number: '7287809',
            kit_to_line_picked_date_time: null,
          },
        ],
      },
      {
        // Full kit row fetch (filtered by kit_serial_number)
        data: [
          {
            id: 'row-1',
            kit_po_number: '2010102615',
            kit_build_number: '854420',
            kit_serial_number: 'KIT-20260512-001',
            engine_program: 'C47E',
            kit_number: 'C47E/4 Gear Box 1',
            kit_build_status: 'in_progress',
            due_date: null,
            transfer_order_number: '7287809',
            material: 'M1',
            material_description: null,
            source_storage_bin: 'K1-01-01',
            dest_storage_bin: 'K1-99-01',
            source_target_qty: '1',
            batch: null,
            kit_to_line_picked_by_user: null,
            kit_to_line_picked_date_time: null,
            kit_flag_type: null,
          },
        ],
      },
      { data: [] }, // black-hat probe (per-serial)
      { data: null } // user_profiles join — never filtered
    )

    const result =
      await rfKittingPickingService.verifyKitForPicking('2010102615')

    expect(result.error).toBeNull()
    expect(result.kits).toBeUndefined()
    expect(result.data?.kit_serial_number).toBe('KIT-20260512-001')

    // Verify the second query (full kit fetch) filtered by serial, not PO.
    const fullFetch = recordedCalls.find(
      (c) =>
        c.table === 'RR_Kitting_DATA' &&
        c.op === 'select' &&
        c.selectColumns?.includes('source_storage_bin')
    )
    expect(fullFetch).toBeDefined()
    expect(
      fullFetch!.filters.find(
        (f) => f[0] === 'kit_serial_number' && f[1] === 'eq'
      )
    ).toBeDefined()
    expect(
      fullFetch!.filters.find((f) => f[0] === 'kit_po_number' && f[1] === 'eq')
    ).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// verifyKitForPickingBySerialNumber — direct serial-number scan path
// ---------------------------------------------------------------------------

describe('verifyKitForPickingBySerialNumber', () => {
  it('loads the kit directly by serial number without any PO meta lookup', async () => {
    queueResults(
      {
        // Full kit row fetch (filtered by kit_serial_number)
        data: [
          {
            id: 'row-1',
            kit_po_number: '2010102616',
            kit_build_number: '854421',
            kit_serial_number: 'KIT-20260515-002',
            engine_program: 'C47E',
            kit_number: 'C47E/4 Gear Box 2',
            kit_build_status: 'in_progress',
            due_date: null,
            transfer_order_number: '7287900',
            material: 'M1',
            material_description: null,
            source_storage_bin: 'K1-01-01',
            dest_storage_bin: 'K1-99-01',
            source_target_qty: '1',
            batch: null,
            kit_to_line_picked_by_user: null,
            kit_to_line_picked_date_time: null,
            kit_flag_type: null,
          },
        ],
      },
      { data: [] }, // black-hat probe (per-serial)
      { data: null } // user_profiles join — never filtered
    )

    const result =
      await rfKittingPickingService.verifyKitForPickingBySerialNumber(
        'KIT-20260515-002'
      )

    expect(result.error).toBeNull()
    expect(result.kits).toBeUndefined()
    expect(result.data?.kit_serial_number).toBe('KIT-20260515-002')
    expect(result.data?.kit_po_number).toBe('2010102616')
    expect(result.data?.floor_pick_items).toHaveLength(1)

    // CRITICAL: the serial-number path must NOT do the PO meta lookup
    // that the legacy PO path does. The only RR_Kitting_DATA select
    // should be the full-payload fetch keyed on kit_serial_number.
    const dataReads = recordedCalls.filter(
      (c) => c.table === 'RR_Kitting_DATA' && c.op === 'select'
    )
    expect(dataReads).toHaveLength(1)
    expect(
      dataReads[0].filters.find(
        (f) => f[0] === 'kit_serial_number' && f[1] === 'eq'
      )?.[2]
    ).toBe('KIT-20260515-002')
    expect(
      dataReads[0].filters.find(
        (f) => f[0] === 'kit_po_number' && f[1] === 'eq'
      )
    ).toBeUndefined()
  })

  it('returns an error (not a kits[] picker) when the serial is unknown', async () => {
    queueResults({ data: [] })

    const result =
      await rfKittingPickingService.verifyKitForPickingBySerialNumber(
        'KIT-20991231-999'
      )

    expect(result.data).toBeNull()
    expect(result.kits).toBeUndefined()
    expect(result.error).toContain('KIT-20991231-999')
  })

  it('trims whitespace and rejects empty input gracefully', async () => {
    const result =
      await rfKittingPickingService.verifyKitForPickingBySerialNumber('   ')

    expect(result.data).toBeNull()
    expect(result.error).toContain('required')
    // Must not have issued any DB reads for empty input.
    expect(
      recordedCalls.filter((c) => c.table === 'RR_Kitting_DATA').length
    ).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// verifyKitForBuildBySerialNumber — direct serial-number scan path
// (mirrors the picking-side suite above for the Build Kit RF flow)
// ---------------------------------------------------------------------------

describe('verifyKitForBuildBySerialNumber', () => {
  it('loads the kit directly by serial number without any PO meta lookup', async () => {
    queueResults(
      {
        // Full kit row fetch (filtered by kit_serial_number)
        data: [
          {
            id: 'row-1',
            kit_po_number: '2010102616',
            kit_build_number: '854421',
            kit_serial_number: 'KIT-20260515-002',
            engine_program: 'C47E',
            kit_number: 'C47E/4 Gear Box 2',
            kit_build_status: 'in_progress',
            deliver_to_plant: 'PLT1',
            due_date: null,
            transfer_order_number: '7287900',
            material: 'MAT-001',
            material_description: 'Test material',
            source_storage_bin: 'K1-01-01',
            dest_storage_bin: 'K1-99-01',
            source_target_qty: '1',
            kit_to_line_kitted_by_user: null,
            kit_to_line_kitted_date_time: null,
          },
        ],
      },
      { data: null } // user_profiles join — never filtered
    )

    const result =
      await RRKittingDataService.verifyKitForBuildBySerialNumber(
        'KIT-20260515-002'
      )

    expect(result.exists).toBe(true)
    expect(result.kitData?.kitPoNumber).toBe('2010102616')
    // The serial must round-trip onto the payload so the form can pass
    // it back to startKitBuild / kitMaterial / completeKitBuild — see
    // `Debug/Fix-Build-Kit-Completion-Multi-Kit-PO.md`.
    expect(result.kitData?.kitSerialNumber).toBe('KIT-20260515-002')
    expect(result.kitData?.toLines).toHaveLength(1)
    expect(result.kitData?.toLines[0].material).toBe('MAT-001')

    // CRITICAL: the serial-number path must NOT do the PO-keyed fetch
    // that the legacy PO path does. The only RR_Kitting_DATA select
    // should be the full-payload fetch keyed on kit_serial_number.
    const dataReads = recordedCalls.filter(
      (c) => c.table === 'RR_Kitting_DATA' && c.op === 'select'
    )
    expect(dataReads).toHaveLength(1)
    expect(
      dataReads[0].filters.find(
        (f) => f[0] === 'kit_serial_number' && f[1] === 'eq'
      )?.[2]
    ).toBe('KIT-20260515-002')
    expect(
      dataReads[0].filters.find(
        (f) => f[0] === 'kit_po_number' && f[1] === 'eq'
      )
    ).toBeUndefined()
  })

  it('returns an exists:false error when the serial is unknown', async () => {
    queueResults({ data: [] })

    const result =
      await RRKittingDataService.verifyKitForBuildBySerialNumber(
        'KIT-20991231-999'
      )

    expect(result.exists).toBe(false)
    expect(result.kitData).toBeUndefined()
    expect(result.error).toContain('KIT-20991231-999')
  })

  it('trims whitespace and rejects empty input gracefully', async () => {
    const result =
      await RRKittingDataService.verifyKitForBuildBySerialNumber('   ')

    expect(result.exists).toBe(false)
    expect(result.error).toContain('required')
    // Must not have issued any DB reads for empty input.
    expect(
      recordedCalls.filter((c) => c.table === 'RR_Kitting_DATA').length
    ).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// completeKitBuild — must be scoped by kit_serial_number when supplied
// (regression for Debug/Fix-Build-Kit-Completion-Multi-Kit-PO.md)
//
// Repro: PO 2010102616 covers two kits — KIT-20260515-001 fully kitted
// (31/31) and KIT-20260515-002 partly kitted (8/18). The operator on
// the floor finished KIT-20260515-001 in the RF Build Kit form, hit
// Complete, and the backend returned `Cannot complete kit: 18 lines
// still need to be kitted` because the verification SELECT and the
// final status UPDATE were keyed on `kit_po_number` alone.
//
// Post-fix the form passes the serial it loaded; the service scopes
// both queries to that serial so the fully-kitted kit completes and
// the partly-kitted sibling stays untouched.
// ---------------------------------------------------------------------------

describe('completeKitBuild — multi-kit-per-PO scoping', () => {
  it('serial-scoped: completes the fully-kitted kit even when a sibling kit on the same PO is partly kitted', async () => {
    // Verification SELECT (filtered by kit_serial_number) — sees only
    // KIT-20260515-001's 31 fully-kitted rows.
    queueResults(
      {
        data: Array.from({ length: 31 }, (_, i) => ({
          kit_to_line_kitted_date_time: '2026-05-17T20:00:00Z',
          transfer_order_number: `7287900-${i}`,
        })),
      },
      // Final UPDATE — succeeds with no error.
      { data: null }
    )

    const result = await RRKittingDataService.completeKitBuild(
      '2010102616',
      'KIT-20260515-001'
    )

    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()

    // The verification SELECT must filter by BOTH PO and serial. If
    // only PO is applied, the test stub returns the partly-kitted
    // sibling's rows on the next pull and the assertion fails.
    const verifyRead = recordedCalls.find(
      (c) =>
        c.table === 'RR_Kitting_DATA' &&
        c.op === 'select' &&
        c.selectColumns?.includes('kit_to_line_kitted_date_time') &&
        c.selectColumns?.includes('transfer_order_number')
    )
    expect(verifyRead).toBeDefined()
    expect(
      verifyRead!.filters.find(
        (f) => f[0] === 'kit_serial_number' && f[1] === 'eq'
      )?.[2]
    ).toBe('KIT-20260515-001')

    // The status UPDATE must also filter by serial — otherwise
    // completing one kit would flip the sibling kit's rows to
    // `kit_built` even though it's still partly kitted.
    const statusUpdate = recordedCalls.find(
      (c) =>
        c.table === 'RR_Kitting_DATA' &&
        c.op === 'update' &&
        (c.payload as Record<string, unknown> | undefined)?.kit_build_status ===
          'kit_built'
    )
    expect(statusUpdate).toBeDefined()
    expect(
      statusUpdate!.filters.find(
        (f) => f[0] === 'kit_serial_number' && f[1] === 'eq'
      )?.[2]
    ).toBe('KIT-20260515-001')
  })

  it('serial-scoped: rejects completion when the requested kit still has unkitted lines (sibling kits ignored)', async () => {
    // Verification SELECT — KIT-20260515-002 has 18 rows, 8 kitted
    // and 10 unkitted. The fact that the sibling KIT-20260515-001 is
    // fully kitted must NOT short-circuit the check; only the
    // requested serial's rows count.
    queueResults({
      data: [
        ...Array.from({ length: 8 }, (_, i) => ({
          kit_to_line_kitted_date_time: '2026-05-17T19:00:00Z',
          transfer_order_number: `7287901-${i}`,
        })),
        ...Array.from({ length: 10 }, (_, i) => ({
          kit_to_line_kitted_date_time: null,
          transfer_order_number: `7287901-${8 + i}`,
        })),
      ],
    })

    const result = await RRKittingDataService.completeKitBuild(
      '2010102616',
      'KIT-20260515-002'
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('10 lines still need to be kitted')

    // No UPDATE should have been issued for the rejected kit.
    const statusUpdate = recordedCalls.find(
      (c) => c.table === 'RR_Kitting_DATA' && c.op === 'update'
    )
    expect(statusUpdate).toBeUndefined()
  })

  it('PO-only legacy path: preserves backward-compatible behaviour when no serial is supplied', async () => {
    queueResults(
      {
        data: Array.from({ length: 5 }, (_, i) => ({
          kit_to_line_kitted_date_time: '2026-05-17T20:00:00Z',
          transfer_order_number: `7287899-${i}`,
        })),
      },
      { data: null }
    )

    const result = await RRKittingDataService.completeKitBuild('2010102600')

    expect(result.success).toBe(true)

    const verifyRead = recordedCalls.find(
      (c) =>
        c.table === 'RR_Kitting_DATA' &&
        c.op === 'select' &&
        c.selectColumns?.includes('kit_to_line_kitted_date_time')
    )
    expect(verifyRead).toBeDefined()
    expect(
      verifyRead!.filters.find(
        (f) => f[0] === 'kit_po_number' && f[1] === 'eq'
      )?.[2]
    ).toBe('2010102600')
    expect(
      verifyRead!.filters.find(
        (f) => f[0] === 'kit_serial_number' && f[1] === 'eq'
      )
    ).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// addFlagBySerialNumber — does not bleed into a sibling kit
// ---------------------------------------------------------------------------

describe('addFlagBySerialNumber', () => {
  it('inserts a flag row keyed on the supplied kit_serial_number', async () => {
    queueResults(
      // dedupe probe
      { data: [] },
      // kit_po_number lookup
      { data: { kit_po_number: '2010102615' } },
      // insert
      { data: { id: 'flag-row-id' } }
    )

    const result = await RRKittingDataService.addFlagBySerialNumber(
      'KIT-20260512-001',
      'black',
      'Auto-flagged from test'
    )

    expect(result.success).toBe(true)
    expect(result.flagId).toBe('flag-row-id')

    const insertCall = recordedCalls.find(
      (c) => c.table === 'kit_build_flags' && c.op === 'insert'
    )
    expect(insertCall).toBeDefined()
    const payload = insertCall!.payload as Record<string, unknown>
    expect(payload.kit_serial_number).toBe('KIT-20260512-001')
    expect(payload.flag_type).toBe('black')
    // PO is still recorded for legacy joins, but the unique-active rule
    // is now per-serial — sibling kits sharing this PO are unaffected.
    expect(payload.kit_po_number).toBe('2010102615')
  })

  it('refuses to add a duplicate active flag for the same serial', async () => {
    queueResults(
      // dedupe probe finds an existing row
      { data: [{ id: 'existing-flag' }] }
    )

    const result = await RRKittingDataService.addFlagBySerialNumber(
      'KIT-20260512-001',
      'black'
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('already exists')
  })
})

// ---------------------------------------------------------------------------
// syncKitProgressFromSerial — per-kit, not aggregated
// ---------------------------------------------------------------------------

describe('syncKitProgressFromSerial', () => {
  it('promotes the kanban card to the completed lane when the kit lands on dock', async () => {
    // RR_Kitting_DATA fetch — every TO line is fully kitted, inspected,
    // and `kit_ready_on_dock_date_time` is stamped. computeKitProgress
    // returns `currentStep = 'on_dock'`, which is the new
    // [[RF-Dock-Staging-Flow]] terminal state.
    queueResults(
      {
        data: [
          {
            kit_to_line_picked_date_time: '2026-05-17T10:00:00Z',
            kit_to_line_kitted_date_time: '2026-05-17T11:00:00Z',
            kit_inspection_completion_date_time: '2026-05-17T12:00:00Z',
            kit_ready_on_dock_date_time: '2026-05-17T13:00:00Z',
            transfer_order_number: '7287900',
          },
        ],
      },
      // getTaskByKitSerialNumber — current task is in `in_progress`.
      {
        data: [
          {
            id: 'task-on-dock-001',
            kit_serial_number: 'KIT-20260517-040',
            column_id: 'column-in-progress',
          },
        ],
      },
      // Lookup of the `completed` column.
      { data: [{ id: 'column-completed' }] },
      // Position-in-column max lookup for the completed column.
      { data: [{ position_in_column: 4 }] },
      // Final UPDATE of the kanban task (column_id flip + counters).
      { data: null }
    )

    const result =
      await KitKanbanService.syncKitProgressFromSerial('KIT-20260517-040')

    expect(result.success).toBe(true)
    expect(result.currentStep).toBe('on_dock')

    // The kanban UPDATE must move the task to the completed column AND
    // refresh the line-progress counters in the same round-trip. The
    // criterion "on dock = done" is the canonical invariant from
    // [[Implementations/Kit-Kanban-Inspection-Aware-Progress-And-Dock-Completion]] —
    // it makes inspection-on and inspection-off orgs land in Completed
    // through the same mechanism (`stageKitToDock` stamps
    // `kit_ready_on_dock_date_time`).
    const taskUpdate = recordedCalls.find(
      (c) => c.table === 'kit_kanban_tasks' && c.op === 'update'
    )
    expect(taskUpdate).toBeDefined()
    const payload = taskUpdate!.payload as Record<string, unknown>
    expect(payload.column_id).toBe('column-completed')
    expect(payload.position_in_column).toBe(5)
    expect(payload.current_step).toBe('on_dock')
  })

  it('reports per-kit progress matching only the requested serial and updates the matching kanban task', async () => {
    queueResults(
      // RR_Kitting_DATA fetch (filtered by kit_serial_number)
      {
        data: [
          {
            kit_to_line_picked_date_time: '2026-05-12T10:00:00Z',
            kit_to_line_kitted_date_time: null,
            kit_inspection_completion_date_time: null,
            kit_ready_on_dock_date_time: null,
            transfer_order_number: '7287809',
          },
          {
            kit_to_line_picked_date_time: null,
            kit_to_line_kitted_date_time: null,
            kit_inspection_completion_date_time: null,
            kit_ready_on_dock_date_time: null,
            transfer_order_number: '7287809',
          },
          {
            kit_to_line_picked_date_time: null,
            kit_to_line_kitted_date_time: null,
            kit_inspection_completion_date_time: null,
            kit_ready_on_dock_date_time: null,
            transfer_order_number: '7287809',
          },
        ],
      },
      // getTaskByKitSerialNumber
      { data: [{ id: 'task-001', kit_serial_number: 'KIT-20260512-001' }] },
      // kanban task UPDATE
      { data: null }
    )

    const result =
      await KitKanbanService.syncKitProgressFromSerial('KIT-20260512-001')

    expect(result.success).toBe(true)
    expect(result.totalLines).toBe(3)
    expect(result.toLinesPicked).toBe(1)
    expect(result.currentStep).toBe('picking')

    // The line-fetch must filter by kit_serial_number — never PO.
    const lineFetch = recordedCalls.find(
      (c) =>
        c.table === 'RR_Kitting_DATA' &&
        c.op === 'select' &&
        c.selectColumns?.includes('kit_to_line_picked_date_time')
    )
    expect(lineFetch).toBeDefined()
    expect(
      lineFetch!.filters.find(
        (f) => f[0] === 'kit_serial_number' && f[1] === 'eq'
      )?.[2]
    ).toBe('KIT-20260512-001')
    expect(
      lineFetch!.filters.find((f) => f[0] === 'kit_po_number' && f[1] === 'eq')
    ).toBeUndefined()

    // The kanban task UPDATE must be addressed by task id (which was
    // looked up via the per-serial helper, not the legacy PO lookup).
    const taskUpdate = recordedCalls.find(
      (c) => c.table === 'kit_kanban_tasks' && c.op === 'update'
    )
    expect(taskUpdate).toBeDefined()
    expect(
      taskUpdate!.filters.find((f) => f[0] === 'id' && f[1] === 'eq')?.[2]
    ).toBe('task-001')
  })
})

// ---------------------------------------------------------------------------
// createKitBuildPlan — kanban link stamp must not clobber sibling kits
// ---------------------------------------------------------------------------

describe('createKitBuildPlan kanban link stamp', () => {
  it('stamps kanban_task_id by kit_serial_number, not kit_po_number', async () => {
    // Sequence of supabase calls inside createKitBuildPlan (with TOs branch):
    //   1. generateKitSerialNumber: select(kit_serial_number).like(...).order().limit(1)
    //   2. getNextPriority: select(kit_priority).not(...).order().limit(1)
    //   3. INSERT records
    //   4. KitKanbanService.createTask:
    //      a. ensureDefaultColumns: select.from(COLUMNS_TABLE).select('id').limit(1)
    //      b. find planning column: select.from(COLUMNS_TABLE).eq('column_name','planning').limit(1)
    //      c. find next position: select.from(TASKS_TABLE).eq('column_id',...).order().limit(1)
    //      d. INSERT kanban task .select('id').single()
    //   5. UPDATE RR_Kitting_DATA SET kanban_task_id = ? .eq(kit_serial_number, ...)
    queueResults(
      { data: [{ kit_serial_number: 'KIT-20260512-005' }] }, // generateKitSerialNumber → next will be -006
      { data: [{ kit_priority: 4 }] }, // getNextPriority
      { data: [{ id: 'rr-row-1' }] }, // RR_Kitting_DATA INSERT .select('id')
      { data: [{ id: 'col-1' }] }, // ensureDefaultColumns existing
      { data: [{ id: 'col-1' }] }, // find planning column
      { data: [{ position_in_column: 0 }] }, // find next position
      { data: { id: 'kanban-006' } }, // kanban INSERT single
      { data: null } // UPDATE RR_Kitting_DATA SET kanban_task_id ...
    )

    const result = await RRKittingDataService.createKitBuildPlan({
      kitBuildNumber: '854421',
      kitPoNumber: '2010102615',
      engineProgram: 'C47E',
      kitNumber: 'C47E/4 Gear Box 3',
      deliverToPlant: 'PLT1',
      dueDate: null,
      incoraItems: [],
      authorizedShipShortItems: [],
      importedTOs: [
        {
          destStorageBin: 'K1-99-01',
          transferOrderNumber: '7287900',
          sourceStorageType: 'STORAGE',
          warehouseNumber: 'WH1',
          destStorageType: 'KIT',
          movementTypeIM: '999',
          movementTypeWM: '999',
          sourceStorageBin: 'K1-01-01',
          plant: 'PLT1',
          storageLocation: 'SLOC',
          material: 'MAT-001',
          materialDescription: 'Test material',
          batch: '',
          sourceTargetQty: '1',
          creationDate: '',
          creationTime: '',
          user: '',
          printer: '',
          specialStockNumber: '',
        },
      ],
    } as any)

    expect(result.success).toBe(true)

    // The post-kanban-creation UPDATE must filter by kit_serial_number.
    // This is the regression — pre-fix it filtered by kit_po_number and
    // clobbered the kanban link of every sibling kit sharing the PO.
    const stampUpdate = recordedCalls.find(
      (c) =>
        c.table === 'RR_Kitting_DATA' &&
        c.op === 'update' &&
        (c.payload as Record<string, unknown> | undefined)?.kanban_task_id ===
          'kanban-006'
    )
    expect(stampUpdate).toBeDefined()
    expect(
      stampUpdate!.filters.find(
        (f) => f[0] === 'kit_serial_number' && f[1] === 'eq'
      )?.[2]
    ).toBe('KIT-20260512-006')
    expect(
      stampUpdate!.filters.find(
        (f) => f[0] === 'kit_po_number' && f[1] === 'eq'
      )
    ).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// markKitAsPrintedBySerialNumber — multi-kit-per-PO print scoping
// (regression coverage for the cover-sheet "wrong kit on a shared PO" bug:
// starting/printing one kit must not flip every sibling kit on the same PO
// to `printed`).
// ---------------------------------------------------------------------------

describe('markKitAsPrintedBySerialNumber', () => {
  it('stamps kit_build_status=printed scoped by kit_serial_number, never by PO', async () => {
    queueResults({ data: null }) // the UPDATE

    const result =
      await RRKittingDataService.markKitAsPrintedBySerialNumber(
        'KIT-20260526-002'
      )

    expect(result.success).toBe(true)

    const printUpdate = recordedCalls.find(
      (c) =>
        c.table === 'RR_Kitting_DATA' &&
        c.op === 'update' &&
        (c.payload as Record<string, unknown> | undefined)?.kit_build_status ===
          'printed'
    )
    expect(printUpdate).toBeDefined()
    // Scoped to the exact kit serial…
    expect(
      printUpdate!.filters.find(
        (f) => f[0] === 'kit_serial_number' && f[1] === 'eq'
      )?.[2]
    ).toBe('KIT-20260526-002')
    // …and NEVER by PO (that would flip every sibling kit on the PO).
    expect(
      printUpdate!.filters.find((f) => f[0] === 'kit_po_number')
    ).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// completeKitBuild — skipInspection bypass mode
// (regression coverage for
// memorybank/OmniFrame/Implementations/Optional-Kit-Inspection-Toggle.md
// AND the on-dock decoupling correction in
// memorybank/OmniFrame/Implementations/RF-Dock-Staging-Flow.md)
//
// When the org has the kit_inspection_required workflow flag OFF, the
// completion path must:
//   1. Stamp `kit_build_status = 'kit_inspected'` (not 'kit_built').
//   2. Auto-mark the per-line inspection columns
//      (`kit_inspection_by_user`, `kit_inspection_completion_date_time`).
//   3. **NOT** stamp the on-dock columns. The actual on-dock stamp
//      moved out of `completeKitBuild` into the new RF Dock Staging
//      flow (`stageKitToDock`) so kits in BOTH inspection-on and
//      inspection-off modes capture an operator-scanned dock location
//      via the same UI path. See
//      memorybank/OmniFrame/Implementations/RF-Dock-Staging-Flow.md
//      "Correction to completeKitBuild" for the rationale.
//
// The WHERE clause is still scoped by serial when supplied (so the
// multi-kit-per-PO fix shipped earlier today is not regressed).
// ---------------------------------------------------------------------------

describe('completeKitBuild — skipInspection bypass mode', () => {
  it('stamps inspection columns and lands at kit_inspected — but does NOT stamp on-dock (RF Dock Staging is now responsible)', async () => {
    queueResults(
      {
        data: Array.from({ length: 5 }, (_, i) => ({
          kit_to_line_kitted_date_time: '2026-05-17T20:00:00Z',
          transfer_order_number: `7287902-${i}`,
        })),
      },
      { data: null }
    )

    const result = await RRKittingDataService.completeKitBuild(
      '2010102617',
      'KIT-20260517-001',
      { skipInspection: true }
    )

    expect(result.success).toBe(true)
    expect(result.skippedInspection).toBe(true)

    const statusUpdate = recordedCalls.find(
      (c) => c.table === 'RR_Kitting_DATA' && c.op === 'update'
    )
    expect(statusUpdate).toBeDefined()
    const payload = statusUpdate!.payload as Record<string, unknown>

    // 1. Status — kit_inspected, not kit_built.
    expect(payload.kit_build_status).toBe('kit_inspected')

    // 2. Inspection auto-stamp (still required so the production
    //    tracker stage calculator stays coherent if the workflow
    //    flag is later flipped back on).
    expect(payload.kit_inspection_completion_date_time).toBeDefined()
    expect(typeof payload.kit_inspection_completion_date_time).toBe('string')
    expect(payload.kit_inspection_by_user).toBe('user-test')

    // 3. On-dock columns NOT touched — RF Dock Staging owns this stamp.
    expect(payload.kit_ready_on_dock_date_time).toBeUndefined()
    expect(payload.kit_ready_on_dock_by_user).toBeUndefined()
    expect(payload.kit_dock_location).toBeUndefined()

    // Multi-kit-per-PO scoping must still hold.
    expect(
      statusUpdate!.filters.find(
        (f) => f[0] === 'kit_serial_number' && f[1] === 'eq'
      )?.[2]
    ).toBe('KIT-20260517-001')
  })

  it('legacy path (no options) still moves the kit only to kit_built — inspection + on-dock columns untouched', async () => {
    queueResults(
      {
        data: Array.from({ length: 3 }, (_, i) => ({
          kit_to_line_kitted_date_time: '2026-05-17T20:00:00Z',
          transfer_order_number: `7287903-${i}`,
        })),
      },
      { data: null }
    )

    const result = await RRKittingDataService.completeKitBuild(
      '2010102618',
      'KIT-20260517-002'
    )

    expect(result.success).toBe(true)
    expect(result.skippedInspection).toBeFalsy()

    const statusUpdate = recordedCalls.find(
      (c) => c.table === 'RR_Kitting_DATA' && c.op === 'update'
    )
    expect(statusUpdate).toBeDefined()
    const payload = statusUpdate!.payload as Record<string, unknown>

    expect(payload.kit_build_status).toBe('kit_built')
    expect(payload.kit_inspection_completion_date_time).toBeUndefined()
    expect(payload.kit_inspection_by_user).toBeUndefined()
    expect(payload.kit_ready_on_dock_date_time).toBeUndefined()
    expect(payload.kit_ready_on_dock_by_user).toBeUndefined()
    expect(payload.kit_dock_location).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Dock Staging — verifyKitForDockStaging + stageKitToDock
// (regression coverage for
// memorybank/OmniFrame/Implementations/RF-Dock-Staging-Flow.md)
//
// The dock-staging predicate splits on the org's kit_inspection_required
// flag:
//   - inspection ON  → require kit_inspection_completion_date_time set.
//   - inspection OFF → require build complete (every TO line kitted, OR
//                      the inspection column auto-stamped by the
//                      skip-inspection branch in completeKitBuild).
// In both modes, kit_ready_on_dock_date_time MUST be unset — re-staging
// an already-staged kit is rejected with a friendly error.
//
// The stageKitToDock UPDATE must scope by kit_serial_number so multi-kit
// POs do not cross-link (preserves the
// Fix-Build-Kit-Completion-Multi-Kit-PO invariant for the new flow).
// ---------------------------------------------------------------------------

describe('verifyKitForDockStaging — inspection-required path', () => {
  it('accepts a kit whose inspection is complete and not yet on dock', async () => {
    queueResults({
      data: [
        {
          kit_po_number: '2010102619',
          kit_serial_number: 'KIT-20260517-010',
          kit_build_number: '854500',
          kit_number: 'C47E/4 Gear Box 9',
          engine_program: 'C47E',
          deliver_to_plant: 'PLT1',
          due_date: null,
          kit_build_status: 'kit_inspected',
          kit_inspection_completion_date_time: '2026-05-17T19:00:00Z',
          kit_to_line_kitted_date_time: '2026-05-17T18:00:00Z',
          kit_ready_on_dock_date_time: null,
          kit_dock_location: null,
          transfer_order_number: '7287910',
        },
      ],
    })

    const result = await RRKittingDataService.verifyKitForDockStaging({
      kitSerialNumber: 'KIT-20260517-010',
      kitInspectionRequired: true,
    })

    expect(result.success).toBe(true)
    expect(result.kitData?.kitSerialNumber).toBe('KIT-20260517-010')
    expect(result.kitData?.kitDockLocation).toBeNull()

    // The fetch must filter by kit_serial_number (not by PO).
    const fetch = recordedCalls.find(
      (c) =>
        c.table === 'RR_Kitting_DATA' &&
        c.op === 'select' &&
        c.selectColumns?.includes('kit_dock_location')
    )
    expect(fetch).toBeDefined()
    expect(
      fetch!.filters.find(
        (f) => f[0] === 'kit_serial_number' && f[1] === 'eq'
      )?.[2]
    ).toBe('KIT-20260517-010')
  })

  it('rejects an inspection-required kit whose inspection has not been completed', async () => {
    queueResults({
      data: [
        {
          kit_po_number: '2010102619',
          kit_serial_number: 'KIT-20260517-011',
          kit_build_number: '854501',
          kit_number: 'C47E/4 Gear Box 9b',
          engine_program: 'C47E',
          deliver_to_plant: 'PLT1',
          due_date: null,
          kit_build_status: 'kit_built',
          kit_inspection_completion_date_time: null,
          kit_to_line_kitted_date_time: '2026-05-17T18:00:00Z',
          kit_ready_on_dock_date_time: null,
          kit_dock_location: null,
          transfer_order_number: '7287911',
        },
      ],
    })

    const result = await RRKittingDataService.verifyKitForDockStaging({
      kitSerialNumber: 'KIT-20260517-011',
      kitInspectionRequired: true,
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('inspection has not been completed')
  })

  it('rejects a kit that is already staged on dock (with friendly location)', async () => {
    queueResults({
      data: [
        {
          kit_po_number: '2010102620',
          kit_serial_number: 'KIT-20260517-012',
          kit_build_number: '854502',
          kit_number: 'C47E/4 Gear Box 12',
          engine_program: 'C47E',
          deliver_to_plant: 'PLT1',
          due_date: null,
          kit_build_status: 'on_dock',
          kit_inspection_completion_date_time: '2026-05-17T19:00:00Z',
          kit_to_line_kitted_date_time: '2026-05-17T18:00:00Z',
          kit_ready_on_dock_date_time: '2026-05-17T19:30:00Z',
          kit_dock_location: 'DOCK-1',
          transfer_order_number: '7287912',
        },
      ],
    })

    const result = await RRKittingDataService.verifyKitForDockStaging({
      kitSerialNumber: 'KIT-20260517-012',
      kitInspectionRequired: true,
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('already staged')
    expect(result.error).toContain('DOCK-1')
  })
})

describe('verifyKitForDockStaging — inspection-bypassed path', () => {
  it('accepts a kit whose build is complete (every TO line kitted) when inspection is bypassed', async () => {
    queueResults({
      data: [
        {
          kit_po_number: '2010102621',
          kit_serial_number: 'KIT-20260517-020',
          kit_build_number: '854510',
          kit_number: 'C47E/4 Gear Box 20',
          engine_program: 'C47E',
          deliver_to_plant: 'PLT1',
          due_date: null,
          // Skip-inspection branch in completeKitBuild already stamped
          // this column when the operator hit "Complete".
          kit_build_status: 'kit_inspected',
          kit_inspection_completion_date_time: '2026-05-17T18:30:00Z',
          kit_to_line_kitted_date_time: '2026-05-17T18:00:00Z',
          kit_ready_on_dock_date_time: null,
          kit_dock_location: null,
          transfer_order_number: '7287920',
        },
      ],
    })

    const result = await RRKittingDataService.verifyKitForDockStaging({
      kitSerialNumber: 'KIT-20260517-020',
      kitInspectionRequired: false,
    })

    expect(result.success).toBe(true)
    expect(result.kitData?.kitSerialNumber).toBe('KIT-20260517-020')
  })

  it('rejects a kit with an unkitted line when inspection is bypassed', async () => {
    queueResults({
      data: [
        {
          kit_po_number: '2010102622',
          kit_serial_number: 'KIT-20260517-021',
          kit_build_number: '854511',
          kit_number: 'C47E/4 Gear Box 21',
          engine_program: 'C47E',
          deliver_to_plant: 'PLT1',
          due_date: null,
          kit_build_status: 'in_progress',
          kit_inspection_completion_date_time: null,
          kit_to_line_kitted_date_time: '2026-05-17T18:00:00Z',
          kit_ready_on_dock_date_time: null,
          kit_dock_location: null,
          transfer_order_number: '7287921',
        },
        {
          kit_po_number: '2010102622',
          kit_serial_number: 'KIT-20260517-021',
          kit_build_number: '854511',
          kit_number: 'C47E/4 Gear Box 21',
          engine_program: 'C47E',
          deliver_to_plant: 'PLT1',
          due_date: null,
          kit_build_status: 'in_progress',
          kit_inspection_completion_date_time: null,
          kit_to_line_kitted_date_time: null, // ← unkitted line
          kit_ready_on_dock_date_time: null,
          kit_dock_location: null,
          transfer_order_number: '7287922',
        },
      ],
    })

    const result = await RRKittingDataService.verifyKitForDockStaging({
      kitSerialNumber: 'KIT-20260517-021',
      kitInspectionRequired: false,
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('build is not complete')
  })
})

describe('stageKitToDock', () => {
  it('UPDATEs RR_Kitting_DATA scoped by kit_serial_number with the operator + dock location + completed status', async () => {
    queueResults({ data: null })

    const result = await RRKittingDataService.stageKitToDock(
      'KIT-20260517-030',
      'DOCK-2'
    )

    expect(result.success).toBe(true)

    const update = recordedCalls.find(
      (c) => c.table === 'RR_Kitting_DATA' && c.op === 'update'
    )
    expect(update).toBeDefined()
    const payload = update!.payload as Record<string, unknown>

    // The three on-dock columns + dock-location are stamped.
    expect(payload.kit_dock_location).toBe('DOCK-2')
    expect(payload.kit_ready_on_dock_by_user).toBe('user-test')
    expect(typeof payload.kit_ready_on_dock_date_time).toBe('string')
    // The status flips to `completed` so the Kit Assembly Board's
    // lane-derivation can use a single canonical invariant
    // ("on dock = done") in both inspection-on and inspection-off
    // modes (see [[Implementations/Kit-Kanban-Inspection-Aware-Progress-And-Dock-Completion]]).
    expect(payload.kit_build_status).toBe('completed')

    // Critical: the WHERE clause is keyed on kit_serial_number, NOT on
    // kit_po_number. A PO-only UPDATE would clobber every sibling kit
    // sharing the PO — same regression class as
    // Fix-Build-Kit-Completion-Multi-Kit-PO.
    expect(
      update!.filters.find(
        (f) => f[0] === 'kit_serial_number' && f[1] === 'eq'
      )?.[2]
    ).toBe('KIT-20260517-030')
    expect(
      update!.filters.find((f) => f[0] === 'kit_po_number' && f[1] === 'eq')
    ).toBeUndefined()
  })

  it('rejects an empty dock location', async () => {
    const result = await RRKittingDataService.stageKitToDock(
      'KIT-20260517-031',
      ''
    )
    expect(result.success).toBe(false)
    expect(result.error).toContain('Dock location')
  })

  it('rejects an empty kit serial number', async () => {
    const result = await RRKittingDataService.stageKitToDock('', 'DOCK-1')
    expect(result.success).toBe(false)
    expect(result.error).toContain('Kit serial number')
  })
})

// Created and developed by Jai Singh
