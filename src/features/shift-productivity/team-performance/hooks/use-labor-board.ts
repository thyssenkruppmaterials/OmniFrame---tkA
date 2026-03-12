/**
 * Labor Board Hook
 * Manages column derivation, optimistic mutations, Supabase Realtime sync, and drag state
 * Created: February 7, 2026
 */
import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  PointerSensor,
  KeyboardSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type DragOverEvent,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { supabase } from '@/lib/supabase/client'
import LaborManagementService from '@/lib/supabase/labor-management.service'
import type {
  AssociateProductivity,
  TeamPerformanceData,
  LaborBoardColumn,
  ReassignmentResult,
} from '../types/team-performance.types'

interface UseLaborBoardOptions {
  data: TeamPerformanceData | undefined
  isToday: boolean
  organizationId: string
}

interface PendingReassignment {
  associate: AssociateProductivity
  fromColumn: LaborBoardColumn
  toColumn: LaborBoardColumn
}

export function useLaborBoard({
  data,
  isToday,
  organizationId,
}: UseLaborBoardOptions) {
  const { authState } = useUnifiedAuth()
  const currentUserId = authState.profile?.id || ''
  const queryClient = useQueryClient()

  // === Drag State ===
  const [activeDragId, setActiveDragId] = useState<string | null>(null)
  const [activeAssociate, setActiveAssociate] =
    useState<AssociateProductivity | null>(null)

  // === Confirmation Dialog State ===
  const [pendingReassignment, setPendingReassignment] =
    useState<PendingReassignment | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  // === Read-only mode (historical dates or no permission) ===
  const hasEditPermission =
    authState.profile?.role === 'admin' ||
    authState.profile?.role === 'manager' ||
    authState.profile?.role === 'supervisor' ||
    authState.profile?.role === 'superadmin'
  const readOnly = !isToday || !hasEditPermission

  // === Sensors ===
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 5 },
    })
  )

  // === Derive Columns from Data ===
  const columns = useMemo<LaborBoardColumn[]>(() => {
    if (!data) return []

    const areaColumns: LaborBoardColumn[] = data.byArea.map((area) => ({
      id: area.area_id,
      type: 'area' as const,
      area_name: area.area_name,
      area_code: area.area_code,
      area_type: area.area_type,
      capacity: area.capacity,
      color: area.color,
      associates: area.associates,
      totalAssociates: area.totalAssociates,
      activeAssociates: area.activeAssociates,
      efficiency: area.efficiency,
      isOverCapacity: area.capacity
        ? area.totalAssociates > area.capacity
        : false,
    }))

    // Build unassigned column - associates with no working_area_id
    const assignedIds = new Set(
      data.byArea.flatMap((area) => area.associates.map((a) => a.user_id))
    )
    const unassignedAssociates = data.associates.filter(
      (a) => !assignedIds.has(a.user_id)
    )

    const unassignedColumn: LaborBoardColumn = {
      id: 'unassigned',
      type: 'unassigned',
      area_name: 'Unassigned',
      color: 'var(--muted-foreground)',
      associates: unassignedAssociates,
      totalAssociates: unassignedAssociates.length,
      activeAssociates: unassignedAssociates.filter(
        (a) => a.status === 'active'
      ).length,
      efficiency:
        unassignedAssociates.length > 0
          ? Math.round(
              unassignedAssociates.reduce((sum, a) => sum + a.efficiency, 0) /
                unassignedAssociates.length
            )
          : 0,
      isOverCapacity: false,
    }

    return [unassignedColumn, ...areaColumns]
  }, [data])

  // === Find associate and column helpers ===
  const findAssociate = useCallback(
    (userId: string): AssociateProductivity | undefined => {
      for (const col of columns) {
        const found = col.associates.find((a) => a.user_id === userId)
        if (found) return found
      }
      return undefined
    },
    [columns]
  )

  const findColumn = useCallback(
    (columnId: string): LaborBoardColumn | undefined => {
      return columns.find((col) => col.id === columnId)
    },
    [columns]
  )

  const findColumnForAssociate = useCallback(
    (userId: string): LaborBoardColumn | undefined => {
      return columns.find((col) =>
        col.associates.some((a) => a.user_id === userId)
      )
    },
    [columns]
  )

  // === Reassignment Mutation ===
  const reassignMutation = useMutation({
    mutationFn: async (params: {
      userId: string
      newAreaId: string | null
      reason?: string
    }) => {
      const result = await LaborManagementService.reassignAssociateToArea(
        params.userId,
        organizationId,
        params.newAreaId,
        null, // skip optimistic locking for now (Realtime handles sync)
        currentUserId,
        params.reason
      )
      return result as ReassignmentResult
    },

    onMutate: async (params) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({
        queryKey: ['team-performance', organizationId],
      })

      // Snapshot previous data for rollback
      const previousData = queryClient.getQueryData<TeamPerformanceData>([
        'team-performance',
        organizationId,
      ])

      // Optimistically move the associate in the cache
      if (previousData) {
        const updatedData = { ...previousData }
        const associate = updatedData.associates.find(
          (a) => a.user_id === params.userId
        )
        if (associate) {
          // Update the associate's area
          const newAreaData = params.newAreaId
            ? updatedData.byArea.find((a) => a.area_id === params.newAreaId)
            : null

          // Update the flat associates list
          updatedData.associates = updatedData.associates.map((a) =>
            a.user_id === params.userId
              ? {
                  ...a,
                  working_area_id: params.newAreaId || undefined,
                  working_area_name: newAreaData?.area_name || undefined,
                }
              : a
          )

          // Update byArea: remove from old area, add to new area
          updatedData.byArea = updatedData.byArea.map((area) => {
            const hadAssociate = area.associates.some(
              (a) => a.user_id === params.userId
            )
            const isTarget = area.area_id === params.newAreaId

            if (hadAssociate && !isTarget) {
              // Remove from old area
              const filtered = area.associates.filter(
                (a) => a.user_id !== params.userId
              )
              return {
                ...area,
                associates: filtered,
                totalAssociates: filtered.length,
                activeAssociates: filtered.filter((a) => a.status === 'active')
                  .length,
              }
            } else if (isTarget && !hadAssociate) {
              // Add to new area
              const updatedAssociate = {
                ...associate,
                working_area_id: params.newAreaId || undefined,
                working_area_name: area.area_name,
              }
              const newAssociates = [...area.associates, updatedAssociate]
              return {
                ...area,
                associates: newAssociates,
                totalAssociates: newAssociates.length,
                activeAssociates: newAssociates.filter(
                  (a) => a.status === 'active'
                ).length,
              }
            }
            return area
          })

          queryClient.setQueryData(
            ['team-performance', organizationId],
            updatedData
          )
        }
      }

      return { previousData }
    },

    onError: (error: Error, _variables, context) => {
      // Rollback on error
      if (context?.previousData) {
        queryClient.setQueryData(
          ['team-performance', organizationId],
          context.previousData
        )
      }

      const errorMsg = error.message || 'Unknown error'
      if (errorMsg.includes('CONCURRENT_MODIFICATION')) {
        toast.error(
          'This associate was already moved by another user. Refreshing...'
        )
      } else if (errorMsg.includes('AREA_AT_CAPACITY')) {
        toast.error('Target area is at full capacity')
      } else if (errorMsg.includes('ASSIGNMENT_NOT_FOUND')) {
        toast.error('No active assignment found for this associate')
      } else {
        toast.error(`Failed to reassign: ${errorMsg}`)
      }
    },

    onSuccess: (result, variables, context) => {
      if (result.success && !result.noop) {
        // Show toast with Undo action
        toast.success('Associate reassigned successfully', {
          action: {
            label: 'Undo',
            onClick: () => {
              // Reverse the reassignment
              const previousAreaId = context?.previousData
                ? (
                    context.previousData as TeamPerformanceData
                  )?.associates.find((a) => a.user_id === variables.userId)
                    ?.working_area_id || null
                : null
              reassignMutation.mutate({
                userId: variables.userId,
                newAreaId: previousAreaId,
                reason: 'Undo previous reassignment',
              })
            },
          },
        })
      } else if (!result.success) {
        // Rollback optimistic update on business logic error
        if (context?.previousData) {
          queryClient.setQueryData(
            ['team-performance', organizationId],
            context.previousData
          )
        }
        if (result.error === 'AREA_AT_CAPACITY') {
          toast.warning(
            `Area is at capacity (${result.current}/${result.capacity})`
          )
        } else if (result.error === 'CONCURRENT_MODIFICATION') {
          toast.error(
            'Another user already moved this associate. Refreshing...'
          )
        } else if (result.error) {
          toast.error(`Reassignment failed: ${result.error}`)
        }
      }
    },

    onSettled: () => {
      // Always refetch to ensure consistency
      queryClient.invalidateQueries({
        queryKey: ['team-performance', organizationId],
      })
      queryClient.invalidateQueries({
        queryKey: ['shift-assignments', organizationId],
      })
    },
  })

  // === Drag Handlers ===
  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const { active } = event
      const associateId = active.id as string
      const associate = findAssociate(associateId)

      setActiveDragId(associateId)
      setActiveAssociate(associate || null)
    },
    [findAssociate]
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event

      setActiveDragId(null)
      setActiveAssociate(null)

      if (!over || !active) return

      const associateId = active.id as string
      const targetColumnId = over.id as string

      // Find the source column
      const sourceColumn = findColumnForAssociate(associateId)
      if (!sourceColumn) return

      // Same column drop = no-op
      if (sourceColumn.id === targetColumnId) return

      // Find target column
      const targetColumn = findColumn(targetColumnId)
      if (!targetColumn) return

      // Find the associate
      const associate = findAssociate(associateId)
      if (!associate) return

      // Show confirmation dialog
      setPendingReassignment({
        associate,
        fromColumn: sourceColumn,
        toColumn: targetColumn,
      })
      setConfirmOpen(true)
    },
    [findAssociate, findColumn, findColumnForAssociate]
  )

  const handleDragCancel = useCallback(() => {
    setActiveDragId(null)
    setActiveAssociate(null)
  }, [])

  const { mutate: reassignMutate } = reassignMutation

  // === Confirmation Handlers ===
  const handleConfirmReassign = useCallback(
    (reason?: string) => {
      if (!pendingReassignment) return

      const { associate, toColumn } = pendingReassignment
      const newAreaId = toColumn.type === 'unassigned' ? null : toColumn.id

      reassignMutate({
        userId: associate.user_id,
        newAreaId,
        reason,
      })

      setConfirmOpen(false)
      setPendingReassignment(null)
    },
    [pendingReassignment, reassignMutate]
  )

  const handleCancelReassign = useCallback(() => {
    setConfirmOpen(false)
    setPendingReassignment(null)
  }, [])

  // === Move To Area (non-DnD fallback) ===
  const handleMoveToArea = useCallback(
    (associateId: string, targetAreaId: string | null) => {
      const associate = findAssociate(associateId)
      if (!associate) return

      const sourceColumn = findColumnForAssociate(associateId)
      if (!sourceColumn) return

      const targetColumnId = targetAreaId || 'unassigned'
      if (sourceColumn.id === targetColumnId) return

      const targetColumn = findColumn(targetColumnId)
      if (!targetColumn) return

      setPendingReassignment({
        associate,
        fromColumn: sourceColumn,
        toColumn: targetColumn,
      })
      setConfirmOpen(true)
    },
    [findAssociate, findColumn, findColumnForAssociate]
  )

  // === Supabase Realtime Subscription ===
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!organizationId || !isToday) return

    const channel = supabase
      .channel(`labor-board-${organizationId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'shift_assignments',
          filter: `organization_id=eq.${organizationId}`,
        },
        () => {
          // Debounce invalidation to prevent rapid cascades
          if (debounceRef.current) clearTimeout(debounceRef.current)
          debounceRef.current = setTimeout(() => {
            queryClient.invalidateQueries({
              queryKey: ['team-performance', organizationId],
            })
          }, 300)
        }
      )
      .subscribe()

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      supabase.removeChannel(channel)
    }
  }, [organizationId, isToday, queryClient])

  // === Accessibility Announcements ===
  const announcements = useMemo(
    () => ({
      onDragStart({ active }: DragStartEvent) {
        const associate = data?.associates.find((a) => a.user_id === active.id)
        return `Picked up ${associate?.user_name || 'associate'} from ${associate?.working_area_name || 'Unassigned'}`
      },
      onDragOver({ over }: DragOverEvent) {
        if (!over) return
        const col = columns.find((c) => c.id === over.id)
        if (col) {
          const capacityInfo = col.capacity
            ? `, ${col.totalAssociates} of ${col.capacity} capacity`
            : ''
          return `Over ${col.area_name}${capacityInfo}`
        }
        return undefined
      },
      onDragEnd({ over }: DragEndEvent) {
        if (!over) return `Cancelled moving associate`
        const col = columns.find((c) => c.id === over.id)
        return `Requesting to move to ${col?.area_name || 'unknown area'}`
      },
      onDragCancel() {
        return 'Drag cancelled'
      },
    }),
    [data, columns]
  )

  return {
    // Columns
    columns,

    // Drag state
    activeDragId,
    activeAssociate,
    sensors,
    announcements,

    // Drag handlers
    handleDragStart,
    handleDragEnd,
    handleDragCancel,

    // Non-DnD move
    handleMoveToArea,

    // Confirmation dialog
    confirmOpen,
    pendingReassignment,
    handleConfirmReassign,
    handleCancelReassign,

    // State
    readOnly,
    isReassigning: reassignMutation.isPending,
  }
}
