// Created and developed by Jai Singh
import { describe, expect, it } from 'vitest'

/**
 * Standalone unit tests for the search filter logic extracted from
 * useCycleCountOperations. These validate null-safety and joined-field
 * coverage without needing the full React Query context.
 */

interface MinimalCycleCountRow {
  material_number: string | null
  material_description: string | null
  location: string | null
  warehouse: string | null
  count_number: string | null
  counter_name: string | null
  batch_number: string | null
  status: string | null
  count_type: string | null
  count_date: string | null
  assigned_to_user?: { full_name: string; email: string } | null
}

function filterRow(item: MinimalCycleCountRow, searchQuery: string): boolean {
  if (!searchQuery) return true
  const searchTerm = searchQuery.toLowerCase()
  const s = (v: string | null | undefined) =>
    v ? v.toLowerCase().includes(searchTerm) : false

  return (
    s(item.material_number) ||
    s(item.material_description) ||
    s(item.location) ||
    s(item.warehouse) ||
    s(item.count_number) ||
    s(item.counter_name) ||
    s(item.batch_number) ||
    s(item.status) ||
    s(item.count_type) ||
    s(item.count_date) ||
    s(item.assigned_to_user?.full_name) ||
    s(item.assigned_to_user?.email)
  )
}

const baseRow: MinimalCycleCountRow = {
  material_number: 'MAT-001',
  material_description: null,
  location: 'A-01-B-02',
  warehouse: null,
  count_number: 'CC-20260328-0001',
  counter_name: null,
  batch_number: null,
  status: 'pending',
  count_type: 'quantity_check',
  count_date: '2026-03-28',
  assigned_to_user: null,
}

describe('cycle count search filter', () => {
  it('returns true for empty search', () => {
    expect(filterRow(baseRow, '')).toBe(true)
  })

  it('is null-safe when all nullable fields are null', () => {
    expect(filterRow(baseRow, 'anything')).toBe(false)
  })

  it('matches material_number', () => {
    expect(filterRow(baseRow, 'mat-001')).toBe(true)
  })

  it('matches count_number', () => {
    expect(filterRow(baseRow, '20260328')).toBe(true)
  })

  it('matches location', () => {
    expect(filterRow(baseRow, 'a-01')).toBe(true)
  })

  it('matches status', () => {
    expect(filterRow(baseRow, 'pending')).toBe(true)
  })

  it('matches count_date', () => {
    expect(filterRow(baseRow, '2026-03')).toBe(true)
  })

  it('matches assigned user full_name', () => {
    const row = {
      ...baseRow,
      assigned_to_user: { full_name: 'Jane Smith', email: 'j@x.com' },
    }
    expect(filterRow(row, 'jane')).toBe(true)
  })

  it('matches assigned user email', () => {
    const row = {
      ...baseRow,
      assigned_to_user: { full_name: 'Jane', email: 'jane@warehouse.com' },
    }
    expect(filterRow(row, 'warehouse.com')).toBe(true)
  })

  it('does not match when no field contains the term', () => {
    expect(filterRow(baseRow, 'zzzzz')).toBe(false)
  })
})

// Created and developed by Jai Singh
