// Created and developed by Jai Singh
import { logger } from '@/lib/utils/logger'
import { supabase } from './client'

export interface InboundStowCart {
  id: string
  organization_id: string
  cart_number: string
  warehouse: string | null
  warehouse_zone: string | null
  max_capacity: number
  status: 'Empty' | 'Loading' | 'Full' | 'InPutaway' | 'Cleared'
  is_active: boolean
  notes: string | null
  created_by: string
  updated_by: string | null
  created_at: string
  updated_at: string
}

export interface InboundCartAssignment {
  id: string
  organization_id: string
  cart_id: string
  raw_to_number: string
  to_number: string
  material_number: string
  to_location: string | null
  warehouse: string | null
  status: 'on_cart' | 'cleared' | 'reassigned' | 'removed' | 'cancelled'
  stowed_by: string
  stowed_at: string
  cleared_by: string | null
  cleared_at: string | null
  clear_reason: string | null
  cleared_putaway_operation_id: string | null
  created_at: string
  updated_at: string
  stowed_by_user?: { id: string; full_name: string; email: string } | null
  cleared_by_user?: { id: string; full_name: string; email: string } | null
}

export interface CartWithOccupancy extends InboundStowCart {
  active_count: number
  created_by_user?: { id: string; full_name: string; email: string } | null
}

export interface CartSummaryStats {
  total: number
  empty: number
  loading: number
  full: number
  inPutaway: number
  cleared: number
}

class InboundCartService {
  private static instance: InboundCartService

  static getInstance(): InboundCartService {
    if (!InboundCartService.instance) {
      InboundCartService.instance = new InboundCartService()
    }
    return InboundCartService.instance
  }

  async fetchCarts(filters?: {
    status?: string
    zone?: string
    search?: string
    activeOnly?: boolean
  }): Promise<{ data: CartWithOccupancy[]; error: string | null }> {
    try {
      let query = (supabase as any)
        .from('inbound_stow_carts')
        .select(
          `
          *,
          created_by_user:user_profiles!created_by(id, full_name, email)
        `
        )
        .order('created_at', { ascending: false })

      if (filters?.activeOnly !== false) {
        query = query.eq('is_active', true)
      }
      if (filters?.status) {
        query = query.eq('status', filters.status)
      }
      if (filters?.zone) {
        query = query.eq('warehouse_zone', filters.zone)
      }
      if (filters?.search) {
        query = query.ilike('cart_number', `%${filters.search}%`)
      }

      const { data: carts, error } = await query

      if (error) {
        logger.error('Failed to fetch carts:', error)
        return { data: [], error: error.message }
      }

      const cartsWithOccupancy: CartWithOccupancy[] = await Promise.all(
        (carts || []).map(async (cart: any) => {
          const { count } = await (supabase as any)
            .from('inbound_cart_assignments')
            .select('*', { count: 'exact', head: true })
            .eq('cart_id', cart.id)
            .eq('status', 'on_cart')

          return { ...cart, active_count: count || 0 }
        })
      )

      return { data: cartsWithOccupancy, error: null }
    } catch (err) {
      logger.error('Error fetching carts:', err)
      return { data: [], error: String(err) }
    }
  }

  async createCart(data: {
    cart_number: string
    max_capacity: number
    warehouse?: string
    warehouse_zone?: string
    notes?: string
  }): Promise<{ data: InboundStowCart | null; error: string | null }> {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return { data: null, error: 'Not authenticated' }

      const { data: profile } = await (supabase as any)
        .from('user_profiles')
        .select('organization_id')
        .eq('id', user.id)
        .single()

      if (!profile) return { data: null, error: 'User profile not found' }

      const { data: cart, error } = await (supabase as any)
        .from('inbound_stow_carts')
        .insert({
          organization_id: profile.organization_id,
          cart_number: data.cart_number.trim().toUpperCase(),
          max_capacity: data.max_capacity,
          warehouse: data.warehouse || null,
          warehouse_zone: data.warehouse_zone || null,
          notes: data.notes || null,
          created_by: user.id,
          status: 'Empty',
          is_active: true,
        })
        .select()
        .single()

      if (error) {
        if (error.code === '23505') {
          return { data: null, error: 'A cart with this number already exists' }
        }
        return { data: null, error: error.message }
      }

      return { data: cart, error: null }
    } catch (err) {
      logger.error('Error creating cart:', err)
      return { data: null, error: String(err) }
    }
  }

  async updateCart(
    id: string,
    updates: Partial<
      Pick<
        InboundStowCart,
        | 'cart_number'
        | 'max_capacity'
        | 'warehouse'
        | 'warehouse_zone'
        | 'notes'
        | 'status'
      >
    >
  ): Promise<{ data: InboundStowCart | null; error: string | null }> {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return { data: null, error: 'Not authenticated' }

      const { data: cart, error } = await (supabase as any)
        .from('inbound_stow_carts')
        .update({ ...updates, updated_by: user.id })
        .eq('id', id)
        .select()
        .single()

      if (error) return { data: null, error: error.message }
      return { data: cart, error: null }
    } catch (err) {
      logger.error('Error updating cart:', err)
      return { data: null, error: String(err) }
    }
  }

  async deactivateCart(
    id: string
  ): Promise<{ success: boolean; error: string | null }> {
    try {
      const { count } = await (supabase as any)
        .from('inbound_cart_assignments')
        .select('*', { count: 'exact', head: true })
        .eq('cart_id', id)
        .eq('status', 'on_cart')

      if (count && count > 0) {
        return {
          success: false,
          error: `Cannot deactivate cart with ${count} active T.O.(s). Remove them first.`,
        }
      }

      const {
        data: { user },
      } = await supabase.auth.getUser()

      const { error } = await (supabase as any)
        .from('inbound_stow_carts')
        .update({ is_active: false, updated_by: user?.id })
        .eq('id', id)

      if (error) return { success: false, error: error.message }
      return { success: true, error: null }
    } catch (err) {
      logger.error('Error deactivating cart:', err)
      return { success: false, error: String(err) }
    }
  }

  async reactivateCart(
    id: string
  ): Promise<{ success: boolean; error: string | null }> {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return { success: false, error: 'Not authenticated' }

      const { error } = await (supabase as any)
        .from('inbound_stow_carts')
        .update({ is_active: true, status: 'Empty', updated_by: user.id })
        .eq('id', id)

      if (error) return { success: false, error: error.message }
      return { success: true, error: null }
    } catch (err) {
      logger.error('Error reactivating cart:', err)
      return { success: false, error: String(err) }
    }
  }

  async deleteCart(
    id: string
  ): Promise<{ success: boolean; error: string | null }> {
    try {
      const { count } = await (supabase as any)
        .from('inbound_cart_assignments')
        .select('*', { count: 'exact', head: true })
        .eq('cart_id', id)
        .eq('status', 'on_cart')

      if (count && count > 0) {
        return {
          success: false,
          error: `Cannot delete cart with ${count} active T.O.(s). Remove them first.`,
        }
      }

      const { error: assignError } = await (supabase as any)
        .from('inbound_cart_assignments')
        .delete()
        .eq('cart_id', id)

      if (assignError) {
        return {
          success: false,
          error: `Failed to remove assignment history: ${assignError.message}`,
        }
      }

      const { error } = await (supabase as any)
        .from('inbound_stow_carts')
        .delete()
        .eq('id', id)

      if (error) return { success: false, error: error.message }
      return { success: true, error: null }
    } catch (err) {
      logger.error('Error deleting cart:', err)
      return { success: false, error: String(err) }
    }
  }

  async stowTOToCart(data: {
    rawToNumber: string
    toNumber: string
    materialNumber: string
    toLocation?: string
    warehouse?: string
    cartId: string
  }): Promise<{ data: InboundCartAssignment | null; error: string | null }> {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return { data: null, error: 'Not authenticated' }

      const { data: profile } = await (supabase as any)
        .from('user_profiles')
        .select('organization_id')
        .eq('id', user.id)
        .single()
      if (!profile) return { data: null, error: 'User profile not found' }

      const { data: cart } = await (supabase as any)
        .from('inbound_stow_carts')
        .select('id, max_capacity, status, is_active, cart_number')
        .eq('id', data.cartId)
        .single()

      if (!cart) return { data: null, error: 'Cart not found' }
      if (!cart.is_active) return { data: null, error: 'Cart is deactivated' }

      const { count: activeCount } = await (supabase as any)
        .from('inbound_cart_assignments')
        .select('*', { count: 'exact', head: true })
        .eq('cart_id', data.cartId)
        .eq('status', 'on_cart')

      if ((activeCount || 0) >= cart.max_capacity) {
        return { data: null, error: 'Cart is full' }
      }

      const { data: assignment, error } = await (supabase as any)
        .from('inbound_cart_assignments')
        .insert({
          organization_id: profile.organization_id,
          cart_id: data.cartId,
          raw_to_number: data.rawToNumber.trim(),
          to_number: data.toNumber.trim(),
          material_number: data.materialNumber.trim().toUpperCase(),
          to_location: data.toLocation || null,
          warehouse: data.warehouse || null,
          status: 'on_cart',
          stowed_by: user.id,
          stowed_at: new Date().toISOString(),
        })
        .select()
        .single()

      if (error) {
        if (error.code === '23505') {
          return {
            data: null,
            error: 'This T.O. is already stowed to a cart',
          }
        }
        return { data: null, error: error.message }
      }

      const newCount = (activeCount || 0) + 1
      const newStatus = newCount >= cart.max_capacity ? 'Full' : 'Loading'
      await (supabase as any)
        .from('inbound_stow_carts')
        .update({ status: newStatus, updated_by: user.id })
        .eq('id', data.cartId)

      return { data: assignment, error: null }
    } catch (err) {
      logger.error('Error stowing TO to cart:', err)
      return { data: null, error: String(err) }
    }
  }

  async removeTOFromCart(
    assignmentId: string,
    reason: string = 'manual_removal'
  ): Promise<{ success: boolean; error: string | null }> {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return { success: false, error: 'Not authenticated' }

      const { data: assignment } = await (supabase as any)
        .from('inbound_cart_assignments')
        .select('cart_id, status')
        .eq('id', assignmentId)
        .single()

      if (!assignment) return { success: false, error: 'Assignment not found' }
      if (assignment.status !== 'on_cart') {
        return { success: false, error: 'Assignment is not active' }
      }

      const { error } = await (supabase as any)
        .from('inbound_cart_assignments')
        .update({
          status: 'removed',
          cleared_by: user.id,
          cleared_at: new Date().toISOString(),
          clear_reason: reason,
        })
        .eq('id', assignmentId)

      if (error) return { success: false, error: error.message }

      const { count } = await (supabase as any)
        .from('inbound_cart_assignments')
        .select('*', { count: 'exact', head: true })
        .eq('cart_id', assignment.cart_id)
        .eq('status', 'on_cart')

      const newStatus = count === 0 ? 'Empty' : 'Loading'
      await (supabase as any)
        .from('inbound_stow_carts')
        .update({ status: newStatus, updated_by: user.id })
        .eq('id', assignment.cart_id)

      return { success: true, error: null }
    } catch (err) {
      logger.error('Error removing TO from cart:', err)
      return { success: false, error: String(err) }
    }
  }

  async markCartFull(
    cartId: string
  ): Promise<{ success: boolean; error: string | null }> {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const { error } = await (supabase as any)
        .from('inbound_stow_carts')
        .update({ status: 'Full', updated_by: user?.id })
        .eq('id', cartId)

      if (error) return { success: false, error: error.message }
      return { success: true, error: null }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  }

  async getCartDetails(cartId: string): Promise<{
    cart: CartWithOccupancy | null
    assignments: InboundCartAssignment[]
    error: string | null
  }> {
    try {
      const { data: cart, error: cartError } = await (supabase as any)
        .from('inbound_stow_carts')
        .select(
          `*, created_by_user:user_profiles!created_by(id, full_name, email)`
        )
        .eq('id', cartId)
        .single()

      if (cartError || !cart) {
        return {
          cart: null,
          assignments: [],
          error: cartError?.message || 'Cart not found',
        }
      }

      const { data: assignments, error: assignError } = await (supabase as any)
        .from('inbound_cart_assignments')
        .select(
          `
          *,
          stowed_by_user:user_profiles!stowed_by(id, full_name, email),
          cleared_by_user:user_profiles!cleared_by(id, full_name, email)
        `
        )
        .eq('cart_id', cartId)
        .order('stowed_at', { ascending: false })

      if (assignError) {
        return { cart: null, assignments: [], error: assignError.message }
      }

      const activeCount = (assignments || []).filter(
        (a: InboundCartAssignment) => a.status === 'on_cart'
      ).length

      return {
        cart: { ...cart, active_count: activeCount },
        assignments: assignments || [],
        error: null,
      }
    } catch (err) {
      logger.error('Error getting cart details:', err)
      return { cart: null, assignments: [], error: String(err) }
    }
  }

  async getCartSummaryStats(): Promise<{
    data: CartSummaryStats
    error: string | null
  }> {
    try {
      const { data: carts, error } = await (supabase as any)
        .from('inbound_stow_carts')
        .select('status')
        .eq('is_active', true)

      if (error) {
        return {
          data: {
            total: 0,
            empty: 0,
            loading: 0,
            full: 0,
            inPutaway: 0,
            cleared: 0,
          },
          error: error.message,
        }
      }

      const stats: CartSummaryStats = {
        total: carts?.length || 0,
        empty: carts?.filter((c: any) => c.status === 'Empty').length || 0,
        loading: carts?.filter((c: any) => c.status === 'Loading').length || 0,
        full: carts?.filter((c: any) => c.status === 'Full').length || 0,
        inPutaway:
          carts?.filter((c: any) => c.status === 'InPutaway').length || 0,
        cleared: carts?.filter((c: any) => c.status === 'Cleared').length || 0,
      }

      return { data: stats, error: null }
    } catch (err) {
      return {
        data: {
          total: 0,
          empty: 0,
          loading: 0,
          full: 0,
          inPutaway: 0,
          cleared: 0,
        },
        error: String(err),
      }
    }
  }
}

export const inboundCartService = InboundCartService.getInstance()

// Created and developed by Jai Singh
