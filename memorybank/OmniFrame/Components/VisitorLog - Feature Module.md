---
tags: [type/component, status/active, domain/frontend, domain/backend]
created: 2026-04-10
---
# Visitor Log

## Purpose
Smartsheet-integrated visitor tracking and approval system connected to the RR Visitation Log (Sheet ID: `1260552974192516`). Provides visitor record management with approval workflows (Approve/Deny), check-in/check-out tracking, US person/citizen verification, and real-time statistics. Data flows through the Rust Core Smartsheet service for reading and writing Smartsheet cell data.

## Key Components
- **VisitorLogPanel** (`components/VisitorLogPanel.tsx`) — Main panel component with visitor table, filter controls, stats summary, and approval action buttons
- **useVisitorLog** hook — Primary data hook providing:
  - Visitor records parsed from Smartsheet rows
  - Column mapping (Smartsheet column IDs → typed fields)
  - Paginated display with `loadMore` / `resetPagination` (default 50 records, lazy-loads more)
  - Stats computation: total, pending, approved, denied, today's visitors, this week, checked-in
  - Filter support: all, this_week, today, pending, approved, denied
- **useUpdateApprovalStatus** hook — Mutation for approving/denying visitors with optional response text
- **useUpdateVisitorField** hook — Generic field update mutation for any visitor record column

## State Management
- **Data Source**: Smartsheet via Rust-based backend — uses `useSmartsheetSheet(VISITOR_LOG_SHEET_ID)` from `@/hooks/useSmartsheet`
- **React Query**: `SMARTSHEET_QUERY_KEYS.sheet(sheetId)` for cache management with invalidation on mutations
- **Column Mapping**: Dynamic mapping built from Smartsheet column metadata at runtime — handles column title variations (e.g., `time_inout` / `time_in_out`)
- **Pagination**: Client-side virtual pagination via `displayedCount` state (initial 50, loads 50 more per batch)
- **Cell Updates**: `useUpdateCells` mutation from `@/hooks/useSmartsheet` for writing back to Smartsheet
- **Toast Notifications**: `sonner` for approval/denial success feedback

## Data Model
### VisitorRecord
| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Visitor full name |
| `visitor_email` | string | Contact email |
| `company` | string | Visitor's company |
| `department` | string | Host department |
| `arrival_date` | string | Scheduled arrival |
| `check_in` / `check_out` | string | Actual timestamps |
| `reason_scope` | string | Visit purpose / scope of work |
| `ilc_poc` / `backup_poc` | string | ILC point of contact + backup |
| `approval_status` | enum | Pending / Approved / Not Approved / Blank |
| `us_person` / `us_citizen` | boolean | Citizenship verification checkboxes |
| `within_24_hours` | boolean | Short-notice visit flag |
| `tooling_equipment` | string | Equipment/materials brought |

### ApprovalStatus Enum
- `PENDING` = "Pending"
- `APPROVED` = "Approved"
- `DENIED` = "Not Approved"
- `BLANK` = "" (no status set, treated as pending)

## Architecture Notes
- Date parsing handles both `YYYY-MM-DD` and `MM/DD/YYYY` formats with local timezone awareness to avoid UTC day-shift issues
- Current week range computed as Monday-Sunday for "this week" filter
- Smartsheet integration uses Rust Core backend (not direct Smartsheet API) via `@/lib/rust-core/smartsheet.service`
- Cell value extraction handles `display_value` with fallback to `value`
- Checkbox columns parsed as boolean from multiple formats (boolean, string, number)
- Empty rows (blank name) filtered out during parsing

## Related
- [[Architecture]]
- [[HRTimeTracking - Feature Module]]
- [[UserManagement - Feature Module]]