// Created and developed by Jai Singh
import { useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  dropOffAreaService,
  type DropOffArea,
  type DropOffAreaAssociateWithUser,
} from '@/lib/supabase/drop-off-area.service'
import {
  inboundPartTransferService,
  type CreateInboundPartTransferInput,
} from '@/lib/supabase/inbound-part-transfer.service'

export const INBOUND_SCANS_PAGINATED_QUERY_KEY = 'inbound-scans-paginated'
export const INBOUND_SCANS_QUERY_KEY = 'inbound-scans'
export const INBOUND_STATISTICS_QUERY_KEY = 'inbound-statistics'

export interface BatchValidationResult {
  ok: boolean
  reason?: 'not_found' | 'empty' | 'error'
  data?: {
    id: string
    tka_batch_number: string | null
    material_number: string | null
    tracking_number: string | null
    so_line_rma_afa: string | null
    quantity: number | null
    hot_truck: boolean | null
    scanned_at: string | null
  } | null
  errorMessage?: string
}

export interface AreaValidationResult {
  ok: boolean
  reason?: 'not_found' | 'empty' | 'error'
  data?: DropOffArea | null
  errorMessage?: string
}

export interface AssociateValidationResult {
  ok: boolean
  reason?: 'empty' | 'unknown_user' | 'not_authorized' | 'error'
  data?: DropOffAreaAssociateWithUser | null
  errorMessage?: string
}

export function useInboundPartTransfer() {
  const queryClient = useQueryClient()

  const validateBatch = useCallback(
    async (tkaBatchNumber: string): Promise<BatchValidationResult> => {
      const normalized = tkaBatchNumber.trim()
      if (!normalized) {
        return { ok: false, reason: 'empty' }
      }

      const { data, error } =
        await inboundPartTransferService.findScanByBatch(normalized)

      if (error) {
        return {
          ok: false,
          reason: 'error',
          errorMessage:
            error instanceof Error ? error.message : 'Lookup failed',
        }
      }

      if (!data) {
        return { ok: false, reason: 'not_found' }
      }

      return { ok: true, data }
    },
    []
  )

  const validateAreaBarcode = useCallback(
    async (barcode: string): Promise<AreaValidationResult> => {
      const normalized = barcode.trim()
      if (!normalized) {
        return { ok: false, reason: 'empty' }
      }

      const { data, error } =
        await dropOffAreaService.findAreaByBarcode(normalized)

      if (error) {
        return {
          ok: false,
          reason: 'error',
          errorMessage:
            error instanceof Error ? error.message : 'Lookup failed',
        }
      }

      if (!data) {
        return { ok: false, reason: 'not_found' }
      }

      return { ok: true, data }
    },
    []
  )

  const validateAssociateEmail = useCallback(
    async (
      areaId: string,
      email: string
    ): Promise<AssociateValidationResult> => {
      const normalized = email.trim()
      if (!normalized) {
        return { ok: false, reason: 'empty' }
      }

      const { data, error, reason } =
        await dropOffAreaService.findAssociateByUserEmail(areaId, normalized)

      if (error) {
        return {
          ok: false,
          reason: 'error',
          errorMessage:
            error instanceof Error ? error.message : 'Lookup failed',
        }
      }

      if (!data) {
        return {
          ok: false,
          reason: reason ?? 'unknown_user',
        }
      }

      return { ok: true, data }
    },
    []
  )

  const submitMutation = useMutation({
    mutationFn: async (input: CreateInboundPartTransferInput) => {
      const { data, error } =
        await inboundPartTransferService.createTransfer(input)
      if (error) {
        throw error instanceof Error
          ? error
          : new Error('Failed to record inbound part transfer')
      }
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [INBOUND_SCANS_PAGINATED_QUERY_KEY],
      })
      queryClient.invalidateQueries({
        queryKey: [INBOUND_SCANS_QUERY_KEY],
      })
      queryClient.invalidateQueries({
        queryKey: [INBOUND_STATISTICS_QUERY_KEY],
      })
    },
  })

  return {
    validateBatch,
    validateAreaBarcode,
    validateAssociateEmail,
    submitTransfer: submitMutation.mutateAsync,
    isSubmitting: submitMutation.isPending,
  }
}

// Created and developed by Jai Singh
