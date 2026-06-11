// Created and developed by Jai Singh
/**
 * Unit coverage for `useOperatorTaskQueueOrder` and its pure
 * `mergeOrder` helper. These are the contract the
 * `<OperatorTaskQueue>` tab on `<LiveOperatorStatus>` relies on:
 *
 *  - Saved order wins for ids that exist in the canonical list.
 *  - Unknown / new task ids append at the end in canonical order.
 *  - Stale saved ids (task completed / reassigned) are pruned on
 *    next merge.
 *  - localStorage round-trips per operator (keyed by user id).
 *  - Switching the operator re-reads localStorage for the new id.
 */
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, beforeEach } from 'vitest'

// Install an in-memory localStorage shim BEFORE the runtime module
// loads. The vitest jsdom env in this repo registers `--localstorage-file`
// without a path, which leaves `window.localStorage.clear()` undefined
// and breaks any test that touches storage. Same pattern as
// `src/hooks/__tests__/draft-migration.test.ts`.
const _store = new Map<string, string>()
const storageStub: Storage = {
  get length() {
    return _store.size
  },
  clear: () => _store.clear(),
  getItem: (k) => _store.get(k) ?? null,
  setItem: (k, v) => {
    _store.set(k, String(v))
  },
  removeItem: (k) => {
    _store.delete(k)
  },
  key: (i) => Array.from(_store.keys())[i] ?? null,
}
Object.defineProperty(globalThis, 'localStorage', {
  value: storageStub,
  writable: true,
  configurable: true,
})
Object.defineProperty(window, 'localStorage', {
  value: storageStub,
  writable: true,
  configurable: true,
})

const { mergeOrder, useOperatorTaskQueueOrder } =
  await import('../use-operator-task-queue-order')

interface T {
  id: string
}

const ORDER_KEY = (operatorId: string) =>
  `omniframe.operator-task-queue-order.v1.${operatorId}`

beforeEach(() => {
  _store.clear()
})

describe('mergeOrder', () => {
  it('returns canonical order when no saved ids', () => {
    const items: T[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    expect(mergeOrder(null, items).map((t) => t.id)).toEqual(['a', 'b', 'c'])
    expect(mergeOrder([], items).map((t) => t.id)).toEqual(['a', 'b', 'c'])
  })

  it('honours saved order for ids that still exist', () => {
    const items: T[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
    const saved = ['c', 'a', 'b', 'd']
    expect(mergeOrder(saved, items).map((t) => t.id)).toEqual([
      'c',
      'a',
      'b',
      'd',
    ])
  })

  it('appends unknown ids in canonical order at the end', () => {
    const items: T[] = [
      { id: 'a' },
      { id: 'b' },
      { id: 'c' },
      { id: 'd' }, // d is new — wasn't in saved order
      { id: 'e' }, // e is new
    ]
    const saved = ['c', 'a', 'b']
    expect(mergeOrder(saved, items).map((t) => t.id)).toEqual([
      'c',
      'a',
      'b',
      'd',
      'e',
    ])
  })

  it('drops stale saved ids that are no longer in the canonical list', () => {
    const items: T[] = [{ id: 'a' }, { id: 'c' }]
    // 'b' was completed / reassigned, drops out of the visible list.
    const saved = ['b', 'c', 'a']
    expect(mergeOrder(saved, items).map((t) => t.id)).toEqual(['c', 'a'])
  })

  it('handles duplicate saved ids defensively', () => {
    const items: T[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    const saved = ['b', 'b', 'a', 'a']
    expect(mergeOrder(saved, items).map((t) => t.id)).toEqual(['b', 'a', 'c'])
  })
})

describe('useOperatorTaskQueueOrder', () => {
  const operatorA = 'op-a'
  const operatorB = 'op-b'
  const items: T[] = [{ id: 't1' }, { id: 't2' }, { id: 't3' }, { id: 't4' }]

  it('returns canonical order on first mount with no saved state', () => {
    const { result } = renderHook(() =>
      useOperatorTaskQueueOrder({ operatorId: operatorA, items })
    )
    expect(result.current.orderedItems.map((t) => t.id)).toEqual([
      't1',
      't2',
      't3',
      't4',
    ])
    expect(result.current.isCustomOrder).toBe(false)
  })

  it('persists a reorder to localStorage and reflects it in orderedItems', () => {
    const { result } = renderHook(() =>
      useOperatorTaskQueueOrder({ operatorId: operatorA, items })
    )

    act(() => {
      // Drag 't3' onto 't1' — t3 takes position 0, the others shift.
      result.current.reorder('t3', 't1')
    })

    expect(result.current.orderedItems.map((t) => t.id)).toEqual([
      't3',
      't1',
      't2',
      't4',
    ])
    expect(result.current.isCustomOrder).toBe(true)

    const persisted = JSON.parse(
      window.localStorage.getItem(ORDER_KEY(operatorA)) ?? '[]'
    )
    expect(persisted).toEqual(['t3', 't1', 't2', 't4'])
  })

  it('resetOrder clears the localStorage entry and falls back to canonical', () => {
    window.localStorage.setItem(
      ORDER_KEY(operatorA),
      JSON.stringify(['t3', 't1', 't2', 't4'])
    )
    const { result } = renderHook(() =>
      useOperatorTaskQueueOrder({ operatorId: operatorA, items })
    )
    expect(result.current.orderedItems.map((t) => t.id)).toEqual([
      't3',
      't1',
      't2',
      't4',
    ])
    expect(result.current.isCustomOrder).toBe(true)

    act(() => {
      result.current.resetOrder()
    })

    expect(result.current.orderedItems.map((t) => t.id)).toEqual([
      't1',
      't2',
      't3',
      't4',
    ])
    expect(result.current.isCustomOrder).toBe(false)
    expect(window.localStorage.getItem(ORDER_KEY(operatorA))).toBeNull()
  })

  it('switching the operator re-reads the saved order for the new id', () => {
    window.localStorage.setItem(
      ORDER_KEY(operatorA),
      JSON.stringify(['t4', 't3', 't2', 't1'])
    )
    window.localStorage.setItem(
      ORDER_KEY(operatorB),
      JSON.stringify(['t2', 't1'])
    )

    const { result, rerender } = renderHook(
      ({ operatorId }: { operatorId: string }) =>
        useOperatorTaskQueueOrder({ operatorId, items }),
      { initialProps: { operatorId: operatorA } }
    )

    expect(result.current.orderedItems.map((t) => t.id)).toEqual([
      't4',
      't3',
      't2',
      't1',
    ])

    rerender({ operatorId: operatorB })

    expect(result.current.orderedItems.map((t) => t.id)).toEqual([
      't2',
      't1',
      't3',
      't4',
    ])
  })

  it('reorder is a no-op when activeId equals overId', () => {
    const { result } = renderHook(() =>
      useOperatorTaskQueueOrder({ operatorId: operatorA, items })
    )

    act(() => {
      result.current.reorder('t2', 't2')
    })

    expect(result.current.isCustomOrder).toBe(false)
    expect(window.localStorage.getItem(ORDER_KEY(operatorA))).toBeNull()
  })

  it('reorder is a no-op when an id is unknown to the current list', () => {
    const { result } = renderHook(() =>
      useOperatorTaskQueueOrder({ operatorId: operatorA, items })
    )

    act(() => {
      result.current.reorder('does-not-exist', 't1')
    })

    expect(result.current.isCustomOrder).toBe(false)
    expect(window.localStorage.getItem(ORDER_KEY(operatorA))).toBeNull()
  })

  it('a null operatorId disables persistence and returns canonical order', () => {
    const { result } = renderHook(() =>
      useOperatorTaskQueueOrder({ operatorId: null, items })
    )

    act(() => {
      // Should be a no-op since there's no operator to persist for.
      result.current.reorder('t3', 't1')
    })

    expect(result.current.orderedItems.map((t) => t.id)).toEqual([
      't1',
      't2',
      't3',
      't4',
    ])
    expect(result.current.isCustomOrder).toBe(false)
  })
})

// Created and developed by Jai Singh
