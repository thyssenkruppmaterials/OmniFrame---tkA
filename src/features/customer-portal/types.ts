/**
 * Customer Portal Types
 *
 * Types specific to the portal dashboard and filter logic.
 * Core ticket types are defined in hooks/useTickets.ts
 */

// Re-export from hooks for convenience
export type {
  Ticket,
  TicketWithDetails,
  Discussion,
  Comment,
  Attachment,
} from './hooks/useTickets'
export {
  TicketStatus,
  TicketPriority,
  TicketCategory,
  // Status grouping helpers
  OPEN_STATUSES,
  ACTIVE_STATUSES,
  RESOLVED_STATUSES,
  isOpenStatus,
  isActiveStatus,
  isResolvedStatus,
} from './hooks/useTickets'

// Filter status (includes 'all' for UI purposes)
export type TicketFilterStatus =
  | 'all'
  | 'open'
  | 'in_progress'
  | 'waiting'
  | 'resolved'
  | 'closed'

// Dashboard statistics
export interface TicketStats {
  total: number
  open: number
  inProgress: number
  waiting: number
  resolved: number
  closed: number
  resolvedToday: number
  avgResponseTime: string
}
