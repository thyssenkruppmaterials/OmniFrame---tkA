// Created and developed by Jai Singh
import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/utils/logger'

export interface AuditWriteResult {
  audit_status: 'written' | 'failed' | 'skipped'
  audit_id: string | null
  audit_error_code?: string
}

export async function writeAuditLog(
  supabase: SupabaseClient,
  entry: {
    user_id: string
    action: string
    resource_type: string
    resource_id?: string
    changes?: Record<string, unknown>
    ip_address?: string
    user_agent?: string
    metadata?: Record<string, unknown>
  }
): Promise<AuditWriteResult> {
  try {
    const row: Record<string, unknown> = {
      user_id: entry.user_id,
      action: entry.action,
      resource_type: entry.resource_type,
    }

    if (entry.resource_id !== undefined) row.resource_id = entry.resource_id
    if (entry.changes !== undefined) row.changes = entry.changes
    if (entry.ip_address !== undefined) row.ip_address = entry.ip_address
    if (entry.user_agent !== undefined) row.user_agent = entry.user_agent
    if (entry.metadata !== undefined) row.metadata = entry.metadata

    const { data, error } = await supabase
      .from('audit_logs')
      .insert(row)
      .select('id')
      .single()

    if (error) {
      logger.error('Audit log insert failed:', error)
      return {
        audit_status: 'failed',
        audit_id: null,
        audit_error_code: error.code || 'UNKNOWN',
      }
    }

    return { audit_status: 'written', audit_id: data.id }
  } catch (err) {
    const code =
      err instanceof Error && 'code' in err
        ? String((err as Record<string, unknown>).code)
        : 'UNKNOWN'
    logger.error('Audit log write threw unexpectedly:', err)
    return { audit_status: 'failed', audit_id: null, audit_error_code: code }
  }
}

// Created and developed by Jai Singh
