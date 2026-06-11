// Created and developed by Jai Singh
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { writeAuditLog } from '@/lib/audit/audit-log-writer'

const mockInsert = vi.fn()
const mockSelect = vi.fn()
const mockSingle = vi.fn()

const mockSupabase = {
  from: vi.fn(() => ({
    insert: mockInsert.mockReturnValue({
      select: mockSelect.mockReturnValue({
        single: mockSingle,
      }),
    }),
  })),
} as any

describe('Audit Integrity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('writes to audit_logs with correct column names', async () => {
    mockSingle.mockResolvedValue({ data: { id: 'audit-uuid-123' }, error: null })

    const result = await writeAuditLog(mockSupabase, {
      user_id: 'user-1',
      action: 'view',
      resource_type: 'permission_check',
      metadata: { granted: true },
    })

    expect(result.audit_status).toBe('written')
    expect(result.audit_id).toBe('audit-uuid-123')
    expect(mockSupabase.from).toHaveBeenCalledWith('audit_logs')
    const insertArg = mockInsert.mock.calls[0][0]
    expect(insertArg).toHaveProperty('metadata')
    expect(insertArg).not.toHaveProperty('new_value')
    expect(insertArg).not.toHaveProperty('details')
  })

  it('returns null audit_id on failure without synthetic IDs', async () => {
    mockSingle.mockResolvedValue({ data: null, error: { code: 'PGRST204', message: 'Column not found' } })

    const result = await writeAuditLog(mockSupabase, {
      user_id: 'user-1',
      action: 'view',
      resource_type: 'permission_check',
    })

    expect(result.audit_status).toBe('failed')
    expect(result.audit_id).toBeNull()
    expect(result.audit_error_code).toBe('PGRST204')
  })

  it('handles thrown exceptions gracefully', async () => {
    mockSingle.mockRejectedValue(new Error('Network error'))

    const result = await writeAuditLog(mockSupabase, {
      user_id: 'user-1',
      action: 'create',
      resource_type: 'user',
    })

    expect(result.audit_status).toBe('failed')
    expect(result.audit_id).toBeNull()
  })
})

// Created and developed by Jai Singh
