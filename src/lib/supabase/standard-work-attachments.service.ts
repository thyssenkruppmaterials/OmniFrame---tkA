// Created and developed by Jai Singh
/**
 * Standard Work Attachments Service
 *
 * Handles photo / signature uploads for standard work checklist items.
 * Uploads land in the `standard-work-attachments` Supabase storage bucket
 * (created in migration 200) at:
 *   `{organization_id}/{submission_id}/{item_id}/{timestamp}-{uuid}.{ext}`
 *
 * Returns a public URL (the bucket is public; clients without auth can still
 * render the photo if needed for printing or QA review screens).
 */
import { logger } from '@/lib/utils/logger'
import { supabase } from './client'

const BUCKET = 'standard-work-attachments'

export interface UploadAttachmentParams {
  file: Blob | File
  fileName?: string
  contentType?: string
  organizationId: string
  submissionId: string
  itemId: string
}

export interface UploadAttachmentResult {
  success: boolean
  publicUrl: string | null
  storagePath: string | null
  size: number
  contentType: string
  error: Error | null
}

const MAX_BYTES = 8 * 1024 * 1024 // 8 MB ceiling for photos / signature PNGs

function safeRandomId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function deriveExtension(file: Blob | File, contentType: string) {
  if (
    'name' in file &&
    typeof file.name === 'string' &&
    file.name.includes('.')
  ) {
    const ext = file.name.slice(file.name.lastIndexOf('.') + 1)
    return ext.toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin'
  }
  if (contentType) {
    const subtype = contentType.split('/')[1] || 'bin'
    return subtype.replace(/[^a-z0-9]/g, '') || 'bin'
  }
  return 'bin'
}

export async function uploadStandardWorkAttachment(
  params: UploadAttachmentParams
): Promise<UploadAttachmentResult> {
  const { file, organizationId, submissionId, itemId } = params
  const contentType =
    params.contentType || file.type || 'application/octet-stream'

  if (file.size === 0) {
    return {
      success: false,
      publicUrl: null,
      storagePath: null,
      size: 0,
      contentType,
      error: new Error('File is empty'),
    }
  }

  if (file.size > MAX_BYTES) {
    return {
      success: false,
      publicUrl: null,
      storagePath: null,
      size: file.size,
      contentType,
      error: new Error(`File exceeds ${MAX_BYTES / (1024 * 1024)} MB limit`),
    }
  }

  const ext = deriveExtension(file, contentType)
  const id = safeRandomId()
  const storagePath = `${organizationId}/${submissionId}/${itemId}/${Date.now()}-${id}.${ext}`

  try {
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, file, {
        cacheControl: '3600',
        contentType,
        upsert: false,
      })

    if (uploadError) {
      logger.error('Standard work attachment upload failed', uploadError)
      return {
        success: false,
        publicUrl: null,
        storagePath: null,
        size: file.size,
        contentType,
        error: uploadError,
      }
    }

    const { data: urlData } = supabase.storage
      .from(BUCKET)
      .getPublicUrl(storagePath)

    return {
      success: true,
      publicUrl: urlData?.publicUrl ?? null,
      storagePath,
      size: file.size,
      contentType,
      error: null,
    }
  } catch (err) {
    const error = err instanceof Error ? err : new Error('Unknown upload error')
    logger.error('Standard work attachment upload threw', error)
    return {
      success: false,
      publicUrl: null,
      storagePath: null,
      size: file.size,
      contentType,
      error,
    }
  }
}

/**
 * Delete a previously uploaded attachment by storage path. Best-effort: errors
 * are logged but not thrown so the calling UI can still update local state.
 */
export async function deleteStandardWorkAttachment(
  storagePath: string
): Promise<boolean> {
  try {
    const { error } = await supabase.storage.from(BUCKET).remove([storagePath])
    if (error) {
      logger.error('Failed to delete attachment', error)
      return false
    }
    return true
  } catch (err) {
    logger.error('Delete attachment threw', err)
    return false
  }
}

// Created and developed by Jai Singh
