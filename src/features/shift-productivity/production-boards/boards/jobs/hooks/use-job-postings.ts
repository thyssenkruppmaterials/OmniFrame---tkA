// Created and developed by Jai Singh
/**
 * Job postings — `production_board_job_postings`. Distinct table from
 * `production_board_posts` because jobs have a different schema
 * (department, requirements, apply URL/email, internal/external flag,
 * `closes_at` instead of `expires_at`).
 *
 * Polling: 60 s, visibility-gated (matches the rest of the board hooks).
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

export type JobPriority = 'low' | 'normal' | 'high' | 'pinned'

export type JobKindData = Record<string, unknown>

export interface JobAttachment {
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

export interface JobPostingRow {
  id: string
  organizationId: string
  title: string
  department: string | null
  workingAreaId: string | null
  workingAreaName: string | null
  branchId: string | null
  branchName: string | null
  description: string | null
  requirements: string | null
  applyUrl: string | null
  applyEmail: string | null
  isInternal: boolean
  colorHex: string | null
  postedAt: string
  closesAt: string | null
  postedBy: string | null
  postedByName: string | null
  isPublished: boolean
  priority: JobPriority
  attachments: JobAttachment[]
  kindData: JobKindData
  createdAt: string
  updatedAt: string
}

export interface CreateJobInput {
  title: string
  department?: string | null
  workingAreaId?: string | null
  branchId?: string | null
  description?: string | null
  requirements?: string | null
  applyUrl?: string | null
  applyEmail?: string | null
  isInternal?: boolean
  colorHex?: string | null
  postedAt?: string | null
  closesAt?: string | null
  isPublished?: boolean
  priority?: JobPriority
  attachments?: JobAttachment[]
  kindData?: JobKindData
}

export interface UpdateJobInput {
  id: string
  patch: Partial<CreateJobInput>
}

interface RawJob {
  id: string
  organization_id: string
  title: string
  department: string | null
  working_area_id: string | null
  branch_id: string | null
  description: string | null
  requirements: string | null
  apply_url: string | null
  apply_email: string | null
  is_internal: boolean
  color_hex: string | null
  posted_at: string
  closes_at: string | null
  posted_by: string | null
  is_published: boolean | null
  priority: string | null
  attachments: unknown
  kind_data: unknown
  created_at: string
  updated_at: string
  working_area: { area_name: string | null } | null
  branch: { name: string | null } | null
  poster: { full_name: string | null } | null
}

const SELECT_COLS = `
  id, organization_id, title, department, working_area_id, branch_id, description,
  requirements, apply_url, apply_email, is_internal, color_hex, posted_at,
  closes_at, posted_by, is_published, priority, attachments, kind_data,
  created_at, updated_at,
  working_area:working_areas!working_area_id ( area_name ),
  branch:branches!branch_id ( name ),
  poster:user_profiles!posted_by ( full_name )
`

function parseJobAttachments(raw: unknown): JobAttachment[] {
  if (!Array.isArray(raw)) return []
  const out: JobAttachment[] = []
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

function parseJobPriority(raw: string | null): JobPriority {
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

function mapRow(raw: RawJob): JobPostingRow {
  return {
    id: raw.id,
    organizationId: raw.organization_id,
    title: raw.title,
    department: raw.department,
    workingAreaId: raw.working_area_id,
    workingAreaName: raw.working_area?.area_name ?? null,
    branchId: raw.branch_id,
    branchName: raw.branch?.name ?? null,
    description: raw.description,
    requirements: raw.requirements,
    applyUrl: raw.apply_url,
    applyEmail: raw.apply_email,
    isInternal: raw.is_internal,
    colorHex: raw.color_hex,
    postedAt: raw.posted_at,
    closesAt: raw.closes_at,
    postedBy: raw.posted_by,
    postedByName: raw.poster?.full_name ?? null,
    isPublished: raw.is_published ?? true,
    priority: parseJobPriority(raw.priority),
    attachments: parseJobAttachments(raw.attachments),
    kindData:
      raw.kind_data && typeof raw.kind_data === 'object'
        ? (raw.kind_data as JobKindData)
        : {},
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  }
}

function jobsKey(orgId: string): readonly unknown[] {
  return ['production-board-jobs', orgId] as const
}

interface UseJobPostingsResult {
  jobs: JobPostingRow[]
  isLoading: boolean
  isFetching: boolean
  refresh: () => void
  createJob: UseMutationResult<JobPostingRow, Error, CreateJobInput>
  updateJob: UseMutationResult<JobPostingRow, Error, UpdateJobInput>
  deleteJob: UseMutationResult<void, Error, string>
}

export function useJobPostings(): UseJobPostingsResult {
  const { authState } = useUnifiedAuth()
  const organizationId = authState.profile?.organization_id ?? ''
  const userId = authState.user?.id ?? null
  const queryClient = useQueryClient()
  const visible = useDocumentVisibility()

  const query = useQuery<JobPostingRow[]>({
    queryKey: jobsKey(organizationId),
    enabled: !!organizationId,
    staleTime: 30_000,
    refetchInterval: visible ? 60_000 : false,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      const { data, error } = await (
        supabase as unknown as {
          from: (t: string) => {
            select: (cols: string) => {
              eq: (
                c: string,
                v: string
              ) => {
                order: (
                  c: string,
                  opts: { ascending: boolean }
                ) => Promise<{
                  data: RawJob[] | null
                  error: { message: string } | null
                }>
              }
            }
          }
        }
      )
        .from('production_board_job_postings')
        .select(SELECT_COLS)
        .eq('organization_id', organizationId)
        .order('posted_at', { ascending: false })
      if (error) {
        logger.error('[useJobPostings] query failed', error)
        throw new Error(error.message)
      }
      return (data ?? []).map(mapRow)
    },
  })

  const refresh = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: jobsKey(organizationId) })
  }, [queryClient, organizationId])

  const createJob = useMutation<JobPostingRow, Error, CreateJobInput>({
    mutationFn: async (input) => {
      const { data, error } = await (
        supabase as unknown as {
          from: (t: string) => {
            insert: (rows: Record<string, unknown>[]) => {
              select: (cols: string) => {
                single: () => Promise<{
                  data: RawJob | null
                  error: { message: string } | null
                }>
              }
            }
          }
        }
      )
        .from('production_board_job_postings')
        .insert([
          {
            organization_id: organizationId,
            title: input.title,
            department: input.department ?? null,
            working_area_id: input.workingAreaId ?? null,
            branch_id: input.branchId ?? null,
            description: input.description ?? null,
            requirements: input.requirements ?? null,
            apply_url: input.applyUrl ?? null,
            apply_email: input.applyEmail ?? null,
            is_internal: input.isInternal ?? true,
            color_hex: input.colorHex ?? null,
            closes_at: input.closesAt ?? null,
            posted_by: userId,
          },
        ])
        .select(SELECT_COLS)
        .single()
      if (error || !data) {
        throw new Error(error?.message ?? 'Failed to create job')
      }
      return mapRow(data)
    },
    onSuccess: () => {
      refresh()
      toast.success('Job posted')
    },
    onError: (err) => toast.error(`Failed to post job: ${err.message}`),
  })

  const updateJob = useMutation<JobPostingRow, Error, UpdateJobInput>({
    mutationFn: async ({ id, patch }) => {
      const update: Record<string, unknown> = {}
      if (patch.title !== undefined) update.title = patch.title
      if (patch.department !== undefined) update.department = patch.department
      if (patch.workingAreaId !== undefined)
        update.working_area_id = patch.workingAreaId
      if (patch.branchId !== undefined) update.branch_id = patch.branchId
      if (patch.description !== undefined)
        update.description = patch.description
      if (patch.requirements !== undefined)
        update.requirements = patch.requirements
      if (patch.applyUrl !== undefined) update.apply_url = patch.applyUrl
      if (patch.applyEmail !== undefined) update.apply_email = patch.applyEmail
      if (patch.isInternal !== undefined) update.is_internal = patch.isInternal
      if (patch.colorHex !== undefined) update.color_hex = patch.colorHex
      if (patch.closesAt !== undefined) update.closes_at = patch.closesAt

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
                    data: RawJob | null
                    error: { message: string } | null
                  }>
                }
              }
            }
          }
        }
      )
        .from('production_board_job_postings')
        .update(update)
        .eq('id', id)
        .select(SELECT_COLS)
        .single()
      if (error || !data) {
        throw new Error(error?.message ?? 'Failed to update job')
      }
      return mapRow(data)
    },
    onSuccess: () => {
      refresh()
      toast.success('Job updated')
    },
    onError: (err) => toast.error(`Failed to update job: ${err.message}`),
  })

  const deleteJob = useMutation<void, Error, string>({
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
        .from('production_board_job_postings')
        .delete()
        .eq('id', id)
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      refresh()
      toast.success('Job removed')
    },
    onError: (err) => toast.error(`Failed to delete job: ${err.message}`),
  })

  return {
    jobs: query.data ?? [],
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    refresh,
    createJob,
    updateJob,
    deleteJob,
  }
}

// Created and developed by Jai Singh
