/**
 * API client for customer ticket operations
 * Integrates with Smartsheet-backed ticketing system
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

// ==================== AUTH HELPER ====================

/**
 * Get headers with Bearer token for authenticated requests.
 * Uses getSession() first, then refreshSession() as fallback for expired tokens.
 */
async function getAuthHeaders(
  includeContentType: boolean = false
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {}
  if (includeContentType) {
    headers['Content-Type'] = 'application/json'
  }
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`
    } else {
      // Session may be expired -- attempt refresh
      const {
        data: { session: refreshed },
      } = await supabase.auth.refreshSession()
      if (refreshed?.access_token) {
        headers['Authorization'] = `Bearer ${refreshed.access_token}`
      }
    }
  } catch {
    // Continue without token -- backend will return 401 if auth is required
  }
  return headers
}

// ==================== TYPES ====================

export enum TicketStatus {
  OPEN = 'Open',
  IN_PROGRESS = 'In Progress',
  WAITING = 'Waiting',
  RESOLVED = 'Resolved',
  CLOSED = 'Closed',
}

export enum TicketPriority {
  LOW = 'Low',
  MEDIUM = 'Medium',
  HIGH = 'High',
  CRITICAL = 'Critical',
}

export enum TicketCategory {
  GENERAL = 'General',
  TECHNICAL = 'Technical',
  BILLING = 'Billing',
  SHIPPING = 'Shipping',
  PRODUCT = 'Product',
  OTHER = 'Other',
}

export interface TicketCreate {
  customer_id: string
  email: string
  subject: string
  description: string
  priority?: TicketPriority
  category?: TicketCategory
}

export interface TicketUpdate {
  status?: TicketStatus
  priority?: TicketPriority
  assigned_to?: string
  notes?: string
}

export interface CommentCreate {
  text: string
  author_name?: string
  author_email?: string
}

export interface Attachment {
  id: number
  name: string
  attachment_type: string
  mime_type?: string
  size_in_kb?: number
  url?: string
  url_expires_in_millis?: number
  created_at?: string
  created_by?: { name?: string; email?: string }
}

export interface Comment {
  id: number
  text: string
  created_at?: string
  created_by?: { name?: string; email?: string }
  modified_at?: string
  attachments?: Attachment[]
}

export interface Discussion {
  id: number
  title?: string
  comment_count: number
  comments: Comment[]
  created_at?: string
  created_by?: { name?: string; email?: string }
  last_commented_at?: string
}

export interface Ticket {
  ticket_id: string
  row_id: number
  customer_id: string
  email: string
  subject: string
  description: string
  status: TicketStatus
  priority: TicketPriority
  category: TicketCategory
  assigned_to?: string
  notes?: string
  created_at?: string
  updated_at?: string
  discussions: Discussion[]
  attachments: Attachment[]
  permalink?: string
}

export interface TicketListResponse {
  tickets: Ticket[]
  total_count: number
}

export interface TicketCreateResponse {
  success: boolean
  message: string
  ticket?: Ticket
}

export interface TicketOperationResponse {
  success: boolean
  message: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: any
}

// ==================== API FUNCTIONS ====================

export async function createTicket(
  ticket: TicketCreate
): Promise<TicketCreateResponse> {
  const response = await fetch(`${API_BASE_URL}/api/customer-tickets`, {
    method: 'POST',
    headers: await getAuthHeaders(true),
    body: JSON.stringify(ticket),
  })

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ detail: 'Failed to create ticket' }))
    throw new Error(error.detail || 'Failed to create ticket')
  }

  return response.json()
}

export async function listAllTickets(
  status?: string,
  limit?: number
): Promise<TicketListResponse> {
  const params = new URLSearchParams()
  if (status) params.append('status', status)
  if (limit) params.append('limit', limit.toString())

  const response = await fetch(
    `${API_BASE_URL}/api/customer-tickets/list?${params}`,
    {
      headers: await getAuthHeaders(),
    }
  )

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ detail: 'Failed to list tickets' }))
    throw new Error(error.detail || 'Failed to list tickets')
  }

  return response.json()
}

export async function searchTickets(
  email?: string,
  customerId?: string
): Promise<TicketListResponse> {
  const params = new URLSearchParams()
  if (email) params.append('email', email)
  if (customerId) params.append('customer_id', customerId)

  const response = await fetch(
    `${API_BASE_URL}/api/customer-tickets/search?${params}`,
    {
      headers: await getAuthHeaders(),
    }
  )

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ detail: 'Failed to search tickets' }))
    throw new Error(error.detail || 'Failed to search tickets')
  }

  return response.json()
}

export async function getTicket(rowId: number): Promise<Ticket> {
  const response = await fetch(
    `${API_BASE_URL}/api/customer-tickets/${rowId}`,
    {
      headers: await getAuthHeaders(),
    }
  )

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ detail: 'Failed to fetch ticket' }))
    throw new Error(error.detail || 'Failed to fetch ticket')
  }

  return response.json()
}

export async function updateTicket(
  rowId: number,
  update: TicketUpdate
): Promise<TicketOperationResponse> {
  const response = await fetch(
    `${API_BASE_URL}/api/customer-tickets/${rowId}`,
    {
      method: 'PUT',
      headers: await getAuthHeaders(true),
      body: JSON.stringify(update),
    }
  )

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ detail: 'Failed to update ticket' }))
    throw new Error(error.detail || 'Failed to update ticket')
  }

  return response.json()
}

export async function updateTicketStatus(
  rowId: number,
  status: TicketStatus
): Promise<TicketOperationResponse> {
  const authHeaders = await getAuthHeaders()
  const response = await fetch(
    `${API_BASE_URL}/api/customer-tickets/${rowId}/status?status=${status}`,
    {
      method: 'PUT',
      headers: authHeaders,
    }
  )

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ detail: 'Failed to update status' }))
    throw new Error(error.detail || 'Failed to update status')
  }

  return response.json()
}

export async function addComment(
  rowId: number,
  comment: CommentCreate
): Promise<TicketOperationResponse> {
  const response = await fetch(
    `${API_BASE_URL}/api/customer-tickets/${rowId}/comments`,
    {
      method: 'POST',
      headers: await getAuthHeaders(true),
      body: JSON.stringify(comment),
    }
  )

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ detail: 'Failed to add comment' }))
    throw new Error(error.detail || 'Failed to add comment')
  }

  return response.json()
}

export async function getAttachments(
  rowId: number
): Promise<TicketOperationResponse> {
  const response = await fetch(
    `${API_BASE_URL}/api/customer-tickets/${rowId}/attachments`,
    {
      headers: await getAuthHeaders(),
    }
  )

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ detail: 'Failed to fetch attachments' }))
    throw new Error(error.detail || 'Failed to fetch attachments')
  }

  return response.json()
}

export async function attachUrl(
  rowId: number,
  url: string,
  name: string
): Promise<TicketOperationResponse> {
  const response = await fetch(
    `${API_BASE_URL}/api/customer-tickets/${rowId}/attachments/url`,
    {
      method: 'POST',
      headers: await getAuthHeaders(true),
      body: JSON.stringify({ url, name }),
    }
  )

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ detail: 'Failed to attach URL' }))
    throw new Error(error.detail || 'Failed to attach URL')
  }

  return response.json()
}

export async function getAttachmentDownloadUrl(
  rowId: number,
  attachmentId: number
): Promise<TicketOperationResponse> {
  const response = await fetch(
    `${API_BASE_URL}/api/customer-tickets/${rowId}/attachments/${attachmentId}/download`,
    {
      headers: await getAuthHeaders(),
    }
  )

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ detail: 'Failed to get download URL' }))
    throw new Error(error.detail || 'Failed to get download URL')
  }

  return response.json()
}

// ==================== REACT QUERY HOOKS ====================

export function useCreateTicket() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createTicket,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] })
    },
  })
}

export function useListAllTickets(
  status?: string,
  limit?: number,
  options?: Omit<UseQueryOptions<TicketListResponse>, 'queryKey' | 'queryFn'>
) {
  return useQuery({
    queryKey: ['tickets', 'list', status, limit],
    queryFn: () => listAllTickets(status, limit),
    staleTime: 30000, // 30 seconds
    ...options,
  })
}

export function useSearchTickets(
  email?: string,
  customerId?: string,
  options?: Omit<UseQueryOptions<TicketListResponse>, 'queryKey' | 'queryFn'>
) {
  return useQuery({
    queryKey: ['tickets', 'search', email, customerId],
    queryFn: () => searchTickets(email, customerId),
    enabled: !!(email || customerId),
    ...options,
  })
}

export function useTicket(
  rowId: number,
  options?: Omit<UseQueryOptions<Ticket>, 'queryKey' | 'queryFn'>
) {
  return useQuery({
    queryKey: ['tickets', rowId],
    queryFn: () => getTicket(rowId),
    enabled: !!rowId,
    ...options,
  })
}

export function useUpdateTicket() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ rowId, update }: { rowId: number; update: TicketUpdate }) =>
      updateTicket(rowId, update),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['tickets', variables.rowId] })
      queryClient.invalidateQueries({ queryKey: ['tickets', 'search'] })
    },
  })
}

export function useUpdateTicketStatus() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ rowId, status }: { rowId: number; status: TicketStatus }) =>
      updateTicketStatus(rowId, status),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['tickets', variables.rowId] })
      queryClient.invalidateQueries({ queryKey: ['tickets', 'search'] })
    },
  })
}

export function useAddComment() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      rowId,
      comment,
    }: {
      rowId: number
      comment: CommentCreate
    }) => addComment(rowId, comment),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['tickets', variables.rowId] })
    },
  })
}

export function useAttachments(rowId: number) {
  return useQuery({
    queryKey: ['tickets', rowId, 'attachments'],
    queryFn: () => getAttachments(rowId),
    enabled: !!rowId,
  })
}

export function useAttachUrl() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      rowId,
      url,
      name,
    }: {
      rowId: number
      url: string
      name: string
    }) => attachUrl(rowId, url, name),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['tickets', variables.rowId, 'attachments'],
      })
      queryClient.invalidateQueries({ queryKey: ['tickets', variables.rowId] })
    },
  })
}
