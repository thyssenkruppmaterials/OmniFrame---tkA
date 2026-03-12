import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase/client'
import {
  inboundCartService,
  type CartSummaryStats,
} from '@/lib/supabase/inbound-cart.service'

const CARTS_QUERY_KEY = ['inbound-carts']
const CART_STATS_QUERY_KEY = ['inbound-cart-stats']
const cartDetailKey = (id: string) => ['inbound-cart-detail', id]

export function useInboundCarts(filters?: {
  status?: string
  zone?: string
  search?: string
  activeOnly?: boolean
}) {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: [...CARTS_QUERY_KEY, filters],
    queryFn: async () => {
      const { data, error } = await inboundCartService.fetchCarts(filters)
      if (error) throw new Error(error)
      return data
    },
    staleTime: 30_000,
  })

  useEffect(() => {
    const channel = supabase
      .channel('inbound-carts-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'inbound_stow_carts' },
        () => {
          queryClient.invalidateQueries({ queryKey: CARTS_QUERY_KEY })
          queryClient.invalidateQueries({ queryKey: CART_STATS_QUERY_KEY })
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'inbound_cart_assignments' },
        () => {
          queryClient.invalidateQueries({ queryKey: CARTS_QUERY_KEY })
          queryClient.invalidateQueries({ queryKey: CART_STATS_QUERY_KEY })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [queryClient])

  return query
}

export function useInboundCartDetails(cartId: string | null) {
  return useQuery({
    queryKey: cartDetailKey(cartId || ''),
    queryFn: async () => {
      if (!cartId) return null
      const result = await inboundCartService.getCartDetails(cartId)
      if (result.error) throw new Error(result.error)
      return result
    },
    enabled: !!cartId,
    staleTime: 15_000,
  })
}

export function useCartSummaryStats() {
  return useQuery<CartSummaryStats>({
    queryKey: CART_STATS_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await inboundCartService.getCartSummaryStats()
      if (error) throw new Error(error)
      return data
    },
    staleTime: 30_000,
  })
}

export function useCreateCart() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: {
      cart_number: string
      max_capacity: number
      warehouse?: string
      warehouse_zone?: string
      notes?: string
    }) => inboundCartService.createCart(data),
    onSuccess: (result) => {
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(`Cart ${result.data?.cart_number} created`)
      queryClient.invalidateQueries({ queryKey: CARTS_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: CART_STATS_QUERY_KEY })
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useUpdateCart() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      id,
      updates,
    }: {
      id: string
      updates: Parameters<typeof inboundCartService.updateCart>[1]
    }) => inboundCartService.updateCart(id, updates),
    onSuccess: (result) => {
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Cart updated')
      queryClient.invalidateQueries({ queryKey: CARTS_QUERY_KEY })
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useDeactivateCart() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => inboundCartService.deactivateCart(id),
    onSuccess: (result) => {
      if (!result.success) {
        toast.error(result.error || 'Failed to deactivate')
        return
      }
      toast.success('Cart deactivated')
      queryClient.invalidateQueries({ queryKey: CARTS_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: CART_STATS_QUERY_KEY })
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useReactivateCart() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => inboundCartService.reactivateCart(id),
    onSuccess: (result) => {
      if (!result.success) {
        toast.error(result.error || 'Failed to reactivate')
        return
      }
      toast.success('Cart reactivated')
      queryClient.invalidateQueries({ queryKey: CARTS_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: CART_STATS_QUERY_KEY })
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useDeleteCart() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => inboundCartService.deleteCart(id),
    onSuccess: (result) => {
      if (!result.success) {
        toast.error(result.error || 'Failed to delete')
        return
      }
      toast.success('Cart permanently deleted')
      queryClient.invalidateQueries({ queryKey: CARTS_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: CART_STATS_QUERY_KEY })
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useStowToCart() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: Parameters<typeof inboundCartService.stowTOToCart>[0]) =>
      inboundCartService.stowTOToCart(data),
    onSuccess: (result) => {
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(`T.O. ${result.data?.to_number} stowed to cart`)
      queryClient.invalidateQueries({ queryKey: CARTS_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: CART_STATS_QUERY_KEY })
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useRemoveTOFromCart() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      assignmentId,
      reason,
    }: {
      assignmentId: string
      reason?: string
    }) => inboundCartService.removeTOFromCart(assignmentId, reason),
    onSuccess: (result) => {
      if (!result.success) {
        toast.error(result.error || 'Failed to remove')
        return
      }
      toast.success('T.O. removed from cart')
      queryClient.invalidateQueries({ queryKey: CARTS_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: CART_STATS_QUERY_KEY })
    },
    onError: (err: Error) => toast.error(err.message),
  })
}

export function useMarkCartFull() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (cartId: string) => inboundCartService.markCartFull(cartId),
    onSuccess: (result) => {
      if (!result.success) {
        toast.error(result.error || 'Failed to mark full')
        return
      }
      toast.success('Cart marked as full')
      queryClient.invalidateQueries({ queryKey: CARTS_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: CART_STATS_QUERY_KEY })
    },
    onError: (err: Error) => toast.error(err.message),
  })
}
