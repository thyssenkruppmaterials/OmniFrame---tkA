/**
 * Customer Portal Feature
 *
 * Support ticket management dashboard using Rust Core Smartsheet service.
 * Matches the same architecture as Smartsheet Integrations Sheet Manager.
 */

// Components
export { PortalDashboard } from './components/PortalDashboard'
export { TicketListPanel } from './components/TicketListPanel'
export { TicketDetailPanel } from './components/TicketDetailPanel'
export { TicketChatThread } from './components/TicketChatThread'
export { TicketStatusFilter } from './components/TicketStatusFilter'
export { CreateTicketDialog } from './components/CreateTicketDialog'
export { TicketAttachmentsPanel } from './components/TicketAttachmentsPanel'

// Hooks (Rust Core Smartsheet based)
export {
  useTickets,
  useTicketDetails,
  useCreateTicket,
  useUpdateTicketStatus,
  useAddTicketComment,
  useAttachTicketUrl,
  useUploadTicketFile,
  TICKET_SHEET_ID,
  DEFAULT_PAGE_SIZE,
  INITIAL_LOAD_SIZE,
} from './hooks/useTickets'

// Types
export * from './types'
