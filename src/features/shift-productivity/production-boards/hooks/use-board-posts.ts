// Created and developed by Jai Singh
/**
 * Shared CRUD hook for `production_board_posts`. Three boards stack on top
 * of this single table:
 *
 *   - Announcements (`scope = 'announcement'`)
 *   - HR News      (`scope = 'hr_news'`)
 *   - Safety Alerts (`scope = 'safety_alert'`)
 *
 * Posts can be filtered by working_area_id (announcements) or branch_id
 * (HR news). Safety alerts ignore filters.
 *
 * Polling: 60 s, visibility-gated (matches the SQCDP hooks).
 *
 * Acknowledgements: only meaningful on safety_alert posts where
 * `acknowledged_required = true`. The hook exposes `acknowledgePost` for
 * every scope (it's a no-op on non-safety scopes server-side, and the
 * frontend just won't render the button on those scopes). The shared
 * `production_board_post_acks` table has its own RLS policy permitting
 * INSERT-by-self even without `production_boards:edit`.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { supabase } from '@/lib/supabase/client'
import { logger } from '@/lib/utils/logger'

export type PostScope = 'announcement' | 'hr_news' | 'safety_alert'
export type PostSeverity = 'info' | 'success' | 'warning' | 'danger'
export type PostPriority = 'low' | 'normal' | 'high' | 'pinned'

/**
 * Attachment + kind_data shapes mirror the JSONB columns added in
 * migration 305. Kept loose (`Record<string, unknown>` for kindData) at
 * the hook layer; the composer's `parseKindData` narrows by kind.
 */
export type PostKindData = Record<string, unknown>

export interface PostAttachment {
  id: string
  storage_path: string
  mime_type: string
  file_name: string
  caption?: string
  width?: number
  height?: number
  size_bytes: number
  display_order: number
}

export interface PostRow {
  id: string
  organizationId: string
  scope: PostScope
  workingAreaId: string | null
  workingAreaName: string | null
  branchId: string | null
  branchName: string | null
  title: string
  body: string | null
  severity: PostSeverity
  colorHex: string | null
  imageUrl: string | null
  publishedAt: string
  expiresAt: string | null
  isPinned: boolean
  isPublished: boolean
  priority: PostPriority
  attachments: PostAttachment[]
  kindData: PostKindData
  repromptIntervalMinutes: number | null
  acknowledgedRequired: boolean
  postedBy: string | null
  postedByName: string | null
  ackCount: number
  acknowledgedByCurrentUser: boolean
  createdAt: string
  updatedAt: string
}

export interface CreatePostInput {
  scope: PostScope
  title: string
  body?: string | null
  severity?: PostSeverity
  workingAreaId?: string | null
  branchId?: string | null
  colorHex?: string | null
  imageUrl?: string | null
  publishedAt?: string | null
  expiresAt?: string | null
  isPinned?: boolean
  acknowledgedRequired?: boolean
  isPublished?: boolean
  priority?: PostPriority
  attachments?: PostAttachment[]
  kindData?: PostKindData
  repromptIntervalMinutes?: number | null
}

export interface UpdatePostInput {
  id: string
  patch: Partial<Omit<CreatePostInput, 'scope'>>
}

export interface BoardPostsFilters {
  workingAreaId?: string | null
  branchId?: string | null
}

interface RawAck {
  user_id: string
}

interface RawPost {
  id: string
  organization_id: string
  scope: PostScope
  working_area_id: string | null
  branch_id: string | null
  title: string
  body: string | null
  severity: PostSeverity
  color_hex: string | null
  image_url: string | null
  published_at: string
  expires_at: string | null
  is_pinned: boolean
  is_published: boolean | null
  priority: string | null
  attachments: unknown
  kind_data: unknown
  reprompt_interval_minutes: number | null
  acknowledged_required: boolean
  posted_by: string | null
  created_at: string
  updated_at: string
  working_area: { area_name: string | null } | null
  branch: { name: string | null } | null
  poster: { full_name: string | null } | null
  acks: RawAck[] | null
}

const SELECT_COLS = `
  id, organization_id, scope, working_area_id, branch_id, title, body, severity,
  color_hex, image_url, published_at, expires_at, is_pinned, is_published,
  priority, attachments, kind_data, reprompt_interval_minutes,
  acknowledged_required, posted_by, created_at, updated_at,
  working_area:working_areas!working_area_id ( area_name ),
  branch:branches!branch_id ( name ),
  poster:user_profiles!posted_by ( full_name ),
  acks:production_board_post_acks ( user_id )
`

function parseAttachmentsLoose(raw: unknown): PostAttachment[] {
  if (!Array.isArray(raw)) return []
  const out: PostAttachment[] = []
  raw.forEach((entry, idx) => {
    if (!entry || typeof entry !== 'object') return
    const r = entry as Record<string, unknown>
    const id = typeof r.id === 'string' ? r.id : null
    const storage_path =
      typeof r.storage_path === 'string' ? r.storage_path : null
    const mime_type = typeof r.mime_type === 'string' ? r.mime_type : null
    const file_name = typeof r.file_name === 'string' ? r.file_name : null
    if (!id || !storage_path || !mime_type || !file_name) return
    out.push({
      id,
      storage_path,
      mime_type,
      file_name,
      caption: typeof r.caption === 'string' ? r.caption : undefined,
      width: typeof r.width === 'number' ? r.width : undefined,
      height: typeof r.height === 'number' ? r.height : undefined,
      size_bytes: typeof r.size_bytes === 'number' ? r.size_bytes : 0,
      display_order:
        typeof r.display_order === 'number' ? r.display_order : idx,
    })
  })
  return out.sort((a, b) => a.display_order - b.display_order)
}

function parsePriority(raw: string | null): PostPriority {
  if (raw === 'low' || raw === 'normal' || raw === 'high' || raw === 'pinned') {
    return raw
  }
  return 'normal'
}

function useDocumentVisibility(): boolean {
  const [visible, setVisible] = useState<boolean>(() =>
    typeof document === 'undefined'
      ? true
      : document.visibilityState === 'visible'
  )

  useEffect(() => {
    if (typeof document === 'undefined') return
    const handler = (): void => {
      setVisible(document.visibilityState === 'visible')
    }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [])

  return visible
}

function mapRow(raw: RawPost, currentUserId: string | null): PostRow {
  const acks = raw.acks ?? []
  return {
    id: raw.id,
    organizationId: raw.organization_id,
    scope: raw.scope,
    workingAreaId: raw.working_area_id,
    workingAreaName: raw.working_area?.area_name ?? null,
    branchId: raw.branch_id,
    branchName: raw.branch?.name ?? null,
    title: raw.title,
    body: raw.body,
    severity: raw.severity,
    colorHex: raw.color_hex,
    imageUrl: raw.image_url,
    publishedAt: raw.published_at,
    expiresAt: raw.expires_at,
    isPinned: raw.is_pinned,
    isPublished: raw.is_published ?? true,
    priority: parsePriority(raw.priority),
    attachments: parseAttachmentsLoose(raw.attachments),
    kindData:
      raw.kind_data && typeof raw.kind_data === 'object'
        ? (raw.kind_data as PostKindData)
        : {},
    repromptIntervalMinutes: raw.reprompt_interval_minutes,
    acknowledgedRequired: raw.acknowledged_required,
    postedBy: raw.posted_by,
    postedByName: raw.poster?.full_name ?? null,
    ackCount: acks.length,
    acknowledgedByCurrentUser: currentUserId
      ? acks.some((a) => a.user_id === currentUserId)
      : false,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  }
}

function postsKey(
  scope: PostScope,
  orgId: string,
  filters: BoardPostsFilters | undefined
): readonly unknown[] {
  return [
    'board-posts',
    scope,
    orgId,
    filters?.workingAreaId ?? null,
    filters?.branchId ?? null,
  ] as const
}

interface UseBoardPostsResult {
  posts: PostRow[]
  isLoading: boolean
  isFetching: boolean
  refresh: () => void
  createPost: UseMutationResult<PostRow, Error, CreatePostInput>
  updatePost: UseMutationResult<PostRow, Error, UpdatePostInput>
  deletePost: UseMutationResult<void, Error, string>
  acknowledgePost: UseMutationResult<void, Error, string>
}

export function useBoardPosts(
  scope: PostScope,
  filters?: BoardPostsFilters
): UseBoardPostsResult {
  const { authState } = useUnifiedAuth()
  const organizationId = authState.profile?.organization_id ?? ''
  const userId = authState.user?.id ?? null
  const queryClient = useQueryClient()
  const visible = useDocumentVisibility()

  const queryKey = postsKey(scope, organizationId, filters)

  const query = useQuery<PostRow[]>({
    queryKey,
    enabled: !!organizationId,
    staleTime: 30_000,
    refetchInterval: visible ? 60_000 : false,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      type Builder = {
        select: (cols: string) => Builder
        eq: (c: string, v: unknown) => Builder
        is: (c: string, v: null) => Builder
        order: (c: string, opts: { ascending: boolean }) => Builder
        then: (
          cb: (res: {
            data: RawPost[] | null
            error: { message: string } | null
          }) => unknown
        ) => Promise<{
          data: RawPost[] | null
          error: { message: string } | null
        }>
      }
      let q: Builder = (supabase as unknown as { from: (t: string) => Builder })
        .from('production_board_posts')
        .select(SELECT_COLS)
        .eq('organization_id', organizationId)
        .eq('scope', scope)

      if (filters?.workingAreaId) {
        q = q.eq('working_area_id', filters.workingAreaId)
      }
      if (filters?.branchId !== undefined) {
        q =
          filters.branchId === null
            ? q.is('branch_id', null)
            : q.eq('branch_id', filters.branchId)
      }

      const { data, error } = await q
        .order('is_pinned', { ascending: false })
        .order('published_at', { ascending: false })
      if (error) {
        logger.error('[useBoardPosts] query failed', error)
        throw new Error(error.message)
      }
      return (data ?? []).map((r) => mapRow(r, userId))
    },
  })

  const refresh = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey })
  }, [queryClient, queryKey])

  const createPost = useMutation<PostRow, Error, CreatePostInput>({
    mutationFn: async (input) => {
      const { data, error } = await (
        supabase as unknown as {
          from: (t: string) => {
            insert: (rows: Record<string, unknown>[]) => {
              select: (cols: string) => {
                single: () => Promise<{
                  data: RawPost | null
                  error: { message: string } | null
                }>
              }
            }
          }
        }
      )
        .from('production_board_posts')
        .insert([
          {
            organization_id: organizationId,
            scope: input.scope,
            title: input.title,
            body: input.body ?? null,
            severity: input.severity ?? 'info',
            working_area_id: input.workingAreaId ?? null,
            branch_id: input.branchId ?? null,
            color_hex: input.colorHex ?? null,
            image_url: input.imageUrl ?? null,
            published_at: input.publishedAt ?? undefined,
            expires_at: input.expiresAt ?? null,
            is_pinned:
              input.isPinned ?? (input.priority === 'pinned' ? true : false),
            acknowledged_required: input.acknowledgedRequired ?? false,
            is_published: input.isPublished ?? true,
            priority: input.priority ?? 'normal',
            attachments: input.attachments ?? [],
            kind_data: input.kindData ?? {},
            reprompt_interval_minutes: input.repromptIntervalMinutes ?? null,
            posted_by: userId,
          },
        ])
        .select(SELECT_COLS)
        .single()
      if (error || !data) {
        throw new Error(error?.message ?? 'Failed to publish post')
      }
      return mapRow(data, userId)
    },
    onSuccess: () => {
      refresh()
      toast.success('Post published')
    },
    onError: (err) => toast.error(`Failed to publish: ${err.message}`),
  })

  const updatePost = useMutation<PostRow, Error, UpdatePostInput>({
    mutationFn: async ({ id, patch }) => {
      const update: Record<string, unknown> = {}
      if (patch.title !== undefined) update.title = patch.title
      if (patch.body !== undefined) update.body = patch.body
      if (patch.severity !== undefined) update.severity = patch.severity
      if (patch.workingAreaId !== undefined)
        update.working_area_id = patch.workingAreaId
      if (patch.branchId !== undefined) update.branch_id = patch.branchId
      if (patch.colorHex !== undefined) update.color_hex = patch.colorHex
      if (patch.imageUrl !== undefined) update.image_url = patch.imageUrl
      if (patch.publishedAt !== undefined)
        update.published_at = patch.publishedAt
      if (patch.expiresAt !== undefined) update.expires_at = patch.expiresAt
      if (patch.isPinned !== undefined) update.is_pinned = patch.isPinned
      if (patch.acknowledgedRequired !== undefined)
        update.acknowledged_required = patch.acknowledgedRequired
      if (patch.isPublished !== undefined)
        update.is_published = patch.isPublished
      if (patch.priority !== undefined) {
        update.priority = patch.priority
        // Keep the legacy is_pinned flag in sync with the higher-level
        // priority when the caller sets one but not the other.
        if (patch.isPinned === undefined) {
          update.is_pinned = patch.priority === 'pinned'
        }
      }
      if (patch.attachments !== undefined)
        update.attachments = patch.attachments
      if (patch.kindData !== undefined) update.kind_data = patch.kindData
      if (patch.repromptIntervalMinutes !== undefined)
        update.reprompt_interval_minutes = patch.repromptIntervalMinutes

      const { data, error } = await (
        supabase as unknown as {
          from: (t: string) => {
            update: (vals: Record<string, unknown>) => {
              eq: (
                c: string,
                v: string
              ) => {
                select: (cols: string) => {
                  single: () => Promise<{
                    data: RawPost | null
                    error: { message: string } | null
                  }>
                }
              }
            }
          }
        }
      )
        .from('production_board_posts')
        .update(update)
        .eq('id', id)
        .select(SELECT_COLS)
        .single()
      if (error || !data) {
        throw new Error(error?.message ?? 'Failed to update post')
      }
      return mapRow(data, userId)
    },
    onSuccess: () => {
      refresh()
      toast.success('Post updated')
    },
    onError: (err) => toast.error(`Failed to update: ${err.message}`),
  })

  const deletePost = useMutation<void, Error, string>({
    mutationFn: async (id) => {
      const { error } = await (
        supabase as unknown as {
          from: (t: string) => {
            delete: () => {
              eq: (
                c: string,
                v: string
              ) => Promise<{
                error: { message: string } | null
              }>
            }
          }
        }
      )
        .from('production_board_posts')
        .delete()
        .eq('id', id)
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      refresh()
      toast.success('Post removed')
    },
    onError: (err) => toast.error(`Failed to delete: ${err.message}`),
  })

  const acknowledgePost = useMutation<void, Error, string>({
    mutationFn: async (postId) => {
      if (!userId) throw new Error('Not signed in')
      const { error } = await (
        supabase as unknown as {
          from: (t: string) => {
            insert: (rows: Record<string, unknown>[]) => Promise<{
              error: { message: string; code?: string } | null
            }>
          }
        }
      )
        .from('production_board_post_acks')
        .insert([
          {
            organization_id: organizationId,
            post_id: postId,
            user_id: userId,
          },
        ])
      if (error && error.code !== '23505') {
        // 23505 = unique_violation: user already ack'd. Treat as success.
        throw new Error(error.message)
      }
    },
    onSuccess: () => {
      refresh()
    },
    onError: (err) => toast.error(`Failed to acknowledge: ${err.message}`),
  })

  return {
    posts: query.data ?? [],
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    refresh,
    createPost,
    updatePost,
    deletePost,
    acknowledgePost,
  }
}

// Created and developed by Jai Singh
