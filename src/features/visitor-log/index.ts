/**
 * Visitor Log Feature
 *
 * Smartsheet-integrated visitor tracking and approval system.
 * Connects to the RR Visitation Log (Sheet ID: 1260552974192516)
 * via the Rust Core Smartsheet service.
 */

// Main component
export { VisitorLogPanel } from './components/VisitorLogPanel'

// Hooks
export {
  useVisitorLog,
  useUpdateApprovalStatus,
  useUpdateVisitorField,
  VISITOR_LOG_SHEET_ID,
} from './hooks/useVisitorLog'

// Types
export type {
  VisitorRecord,
  VisitorColumnMapping,
  VisitorFilterStatus,
  VisitorStats,
} from './hooks/useVisitorLog'

export { ApprovalStatus } from './hooks/useVisitorLog'
