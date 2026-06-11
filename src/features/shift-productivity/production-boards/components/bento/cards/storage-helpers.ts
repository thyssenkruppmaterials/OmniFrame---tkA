// Created and developed by Jai Singh
/**
 * Storage URL helpers shared by the variant cards.
 *
 * Posts persist attachments as JSONB with `storage_path` pointing into
 * the `production-board-images` bucket. The public URL is derived via
 * `supabase.storage.from(...).getPublicUrl(path)` at render time so the
 * cards stay portable across orgs (which sit behind different bucket
 * URLs depending on the Supabase project).
 */
import { supabase } from '@/lib/supabase/client'
import type { PostAttachment } from '../../../hooks/use-board-posts'

const BUCKET = 'production-board-images'

export function publicImageUrl(path: string | null | undefined): string | null {
  if (!path) return null
  try {
    return (
      supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl ?? null
    )
  } catch {
    return null
  }
}

export function imageAttachmentsOf(
  attachments: readonly PostAttachment[] | undefined
): PostAttachment[] {
  if (!attachments) return []
  return attachments
    .filter((a) => a.mime_type.startsWith('image/'))
    .sort((a, b) => a.display_order - b.display_order)
}

export function firstImageUrlOf(
  attachments: readonly PostAttachment[] | undefined,
  fallback: string | null | undefined
): string | null {
  const imgs = imageAttachmentsOf(attachments)
  if (imgs.length > 0) {
    return publicImageUrl(imgs[0].storage_path)
  }
  return fallback ?? null
}

// Created and developed by Jai Singh
