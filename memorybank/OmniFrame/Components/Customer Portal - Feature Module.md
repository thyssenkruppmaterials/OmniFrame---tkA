---
tags: [type/component, status/active, domain/frontend]
created: 2026-04-10
---
# Customer Portal

## Purpose
Support ticket management dashboard for customer-facing operations. Provides ticket creation, status tracking, chat-based communication threads, and file attachment management. Backed by a Rust Core Smartsheet service for data persistence, following the same architecture as the Smartsheet Integrations Sheet Manager.

## Key Components
- **PortalDashboard** (`components/PortalDashboard.tsx`) — Main dashboard container with ticket statistics, filter controls, and list/detail split view.
- **TicketListPanel** (`components/TicketListPanel.tsx`) — Scrollable ticket list with status badges, priority indicators, and selection handling.
- **TicketDetailPanel** (`components/TicketDetailPanel.tsx`) — Detailed ticket view with metadata, status updates, and action buttons.
- **TicketChatThread** (`components/TicketChatThread.tsx`) — Threaded conversation interface for ticket discussions with comment posting.
- **TicketStatusFilter** (`components/TicketStatusFilter.tsx`) — Filter controls for ticket status (all, open, in_progress, waiting, resolved, closed).
- **CreateTicketDialog** (`components/CreateTicketDialog.tsx`) — Dialog form for creating new support tickets.
- **TicketAttachmentsPanel** (`components/TicketAttachmentsPanel.tsx`) — File attachment management with upload and preview.
- **AttachmentPreviewDialog** (`components/AttachmentPreviewDialog.tsx`) — Full preview dialog for attached files.
- **ExcelViewer** (`components/ExcelViewer.tsx`) — Inline Excel file viewer for spreadsheet attachments.
- **PDFViewer** (`components/PDFViewer.tsx`) — Inline PDF document viewer for PDF attachments.

## Hooks
- `useTickets` — Paginated ticket list with `TICKET_SHEET_ID`, `DEFAULT_PAGE_SIZE` (25), `INITIAL_LOAD_SIZE` (50)
- `useTicketDetails` — Single ticket detail with discussions and attachments
- `useCreateTicket` — Ticket creation mutation
- `useUpdateTicketStatus` — Status change mutation
- `useAddTicketComment` — Comment addition to ticket thread
- `useAttachTicketUrl` — URL attachment to ticket
- `useUploadTicketFile` — File upload to ticket
- `useTicketUpdates` (`hooks/useTicketUpdates.ts`) — Real-time ticket update subscriptions

## State Management
- React Query for ticket data with pagination (initial load + page size)
- Rust Core Smartsheet service as data backend
- Filter state: `TicketFilterStatus` (all, open, in_progress, waiting, resolved, closed)
- Dashboard stats: `TicketStats` (total, open, inProgress, waiting, resolved, closed, resolvedToday, avgResponseTime)

## Types
- `Ticket` / `TicketWithDetails` — Core ticket entities
- `Discussion` / `Comment` — Threaded conversation types
- `Attachment` — File attachment metadata
- `TicketStatus` — Enum: open, in_progress, waiting, resolved, closed
- `TicketPriority` — Priority levels
- `TicketCategory` — Ticket categorization
- Status grouping helpers: `OPEN_STATUSES`, `ACTIVE_STATUSES`, `RESOLVED_STATUSES`, `isOpenStatus()`, `isActiveStatus()`, `isResolvedStatus()`

## Routes
- Rendered within the customer portal section of the application

## Related
- [[Architecture]]
