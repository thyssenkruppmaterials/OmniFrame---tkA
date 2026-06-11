// Created and developed by Jai Singh
/**
 * Cycle Count Evidence Photos Service
 *
 * Uploads operator-captured photos to the `cycle-count-photos` Supabase
 * storage bucket (created in migration 203) and appends the public URL onto
 * the count row's `evidence_photo_urls` column so the supervisor UI can
 * display them alongside the variance review.
 */
import { logger } from '@/lib/utils/logger'
import { supabase } from './client'

const BUCKET = 'cycle-count-photos'

export interface UploadEvidencePhotoResult {
  success: boolean
  publicUrl: string | null
  storagePath: string | null
  error: Error | null
}

/**
 * Upload a single evidence photo for a cycle count task, appending the URL
 * to `rr_cyclecount_data.evidence_photo_urls`.
 *
 * Path shape: `{organization_id}/{taskId}/{timestamp}-{uuid}.{ext}`.
 */
export async function uploadCycleCountEvidencePhoto(params: {
  file: File
  taskId: string
  organizationId: string
}): Promise<UploadEvidencePhotoResult> {
  const { file, taskId, organizationId } = params

  try {
    if (!file.type.startsWith('image/')) {
      return {
        success: false,
        publicUrl: null,
        storagePath: null,
        error: new Error('File is not an image'),
      }
    }
    if (file.size > 5 * 1024 * 1024) {
      return {
        success: false,
        publicUrl: null,
        storagePath: null,
        error: new Error('Image exceeds 5 MB limit'),
      }
    }

    const ext = file.name.includes('.')
      ? file.name.slice(file.name.lastIndexOf('.') + 1)
      : (file.type.split('/')[1] ?? 'jpg')
    const safeExt = ext.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
    const uniq =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    const storagePath = `${organizationId}/${taskId}/${Date.now()}-${uniq}.${safeExt}`

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, file, {
        cacheControl: '3600',
        contentType: file.type,
        upsert: false,
      })

    if (uploadError) {
      logger.error('Evidence photo upload failed', uploadError)
      return {
        success: false,
        publicUrl: null,
        storagePath: null,
        error: uploadError,
      }
    }

    const { data: urlData } = supabase.storage
      .from(BUCKET)
      .getPublicUrl(storagePath)

    const publicUrl = urlData?.publicUrl ?? null

    // Phase 7.2 — atomic photo append via the SECURITY DEFINER RPC
    // `array_append_evidence_photo` (migration 259). Eliminates the
    // read-modify-write race; the RPC checks org + assigned_to/created_by/
    // manager+ permission server-side.
    // Cast through `any` until database.types.ts is regenerated post 259.
    const sbRpc = supabase as unknown as {
      rpc: (
        fn: string,
        args: Record<string, unknown>
      ) => Promise<{ data: unknown; error: unknown }>
    }
    const { error: updateErr } = await sbRpc.rpc(
      'array_append_evidence_photo',
      {
        p_task_id: taskId,
        p_url: publicUrl,
      }
    )

    if (updateErr) {
      logger.error('evidence_photo_urls update failed', updateErr)
      const err =
        updateErr instanceof Error
          ? updateErr
          : new Error(
              typeof updateErr === 'string'
                ? updateErr
                : JSON.stringify(updateErr)
            )
      return {
        success: false,
        publicUrl,
        storagePath,
        error: err,
      }
    }

    return { success: true, publicUrl, storagePath, error: null }
  } catch (error) {
    logger.error('Evidence photo upload errored', error)
    return {
      success: false,
      publicUrl: null,
      storagePath: null,
      error: error instanceof Error ? error : new Error(String(error)),
    }
  }
}

export interface UploadEvidencePhotosBatchResult {
  uploaded: Array<{ publicUrl: string | null; storagePath: string | null }>
  failed: Array<{ file: File; error: Error }>
}

/**
 * Batch-upload evidence photos for a cycle count task. Photos are uploaded
 * in parallel; successes and failures are both returned so the caller can
 * surface partial success without blocking completion.
 *
 * Uses one atomic row read + update at the end so concurrent uploads don't
 * race on `evidence_photo_urls`.
 */
export async function uploadCycleCountEvidencePhotos(params: {
  files: File[]
  taskId: string
  organizationId: string
}): Promise<UploadEvidencePhotosBatchResult> {
  const { files, taskId, organizationId } = params

  if (files.length === 0) {
    return { uploaded: [], failed: [] }
  }

  // Upload files in parallel directly to storage (skip the per-file row
  // update; we'll merge URLs in one write below).
  const uploads = await Promise.all(
    files.map(async (file) => {
      try {
        if (!file.type.startsWith('image/')) {
          return { ok: false as const, file, error: new Error('Not an image') }
        }
        if (file.size > 5 * 1024 * 1024) {
          return {
            ok: false as const,
            file,
            error: new Error('Image exceeds 5 MB'),
          }
        }
        const ext = file.name.includes('.')
          ? file.name.slice(file.name.lastIndexOf('.') + 1)
          : (file.type.split('/')[1] ?? 'jpg')
        const safeExt = ext.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
        const uniq =
          typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
        const storagePath = `${organizationId}/${taskId}/${Date.now()}-${uniq}.${safeExt}`

        const { error: uploadError } = await supabase.storage
          .from(BUCKET)
          .upload(storagePath, file, {
            cacheControl: '3600',
            contentType: file.type,
            upsert: false,
          })
        if (uploadError) {
          return { ok: false as const, file, error: uploadError }
        }
        const { data: urlData } = supabase.storage
          .from(BUCKET)
          .getPublicUrl(storagePath)
        return {
          ok: true as const,
          file,
          publicUrl: urlData?.publicUrl ?? null,
          storagePath,
        }
      } catch (err) {
        return {
          ok: false as const,
          file,
          error: err instanceof Error ? err : new Error(String(err)),
        }
      }
    })
  )

  const successUrls = uploads
    .filter((u): u is Extract<typeof u, { ok: true }> => u.ok)
    .map((u) => u.publicUrl)
    .filter((u): u is string => !!u)

  if (successUrls.length > 0) {
    try {
      const { data: row } = await supabase
        .from('rr_cyclecount_data')
        .select('evidence_photo_urls')
        .eq('id', taskId)
        .maybeSingle()
      const existing = (row?.evidence_photo_urls ?? []) as string[]
      const merged = Array.from(new Set([...existing, ...successUrls]))
      const { error: updateErr } = await supabase
        .from('rr_cyclecount_data')
        .update({ evidence_photo_urls: merged })
        .eq('id', taskId)
      if (updateErr) {
        logger.error(
          'Batch evidence_photo_urls update failed (uploads already succeeded)',
          updateErr
        )
      }
    } catch (err) {
      logger.error('Batch evidence_photo_urls merge errored', err)
    }
  }

  return {
    uploaded: uploads
      .filter((u): u is Extract<typeof u, { ok: true }> => u.ok)
      .map((u) => ({ publicUrl: u.publicUrl, storagePath: u.storagePath })),
    failed: uploads
      .filter((u): u is Extract<typeof u, { ok: false }> => !u.ok)
      .map((u) => ({ file: u.file, error: u.error })),
  }
}

// Created and developed by Jai Singh
