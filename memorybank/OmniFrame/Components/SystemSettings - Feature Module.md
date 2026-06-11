---
tags: [type/component, status/active, domain/frontend, domain/admin]
created: 2026-04-10
---
# System Settings & Performance Monitor

## Purpose
Admin-only system-wide configuration hub with 10 setting categories, plus a dedicated **Performance Monitor** page for real-time application health monitoring. System Settings controls global application behavior including notifications, email, security, integrations, and API configuration. Performance Monitor provides query cache analytics, memory profiling, and optimization controls.

## Key Components

### System Settings (`admin/system-settings/`)
- **SystemSettingsPage** (`index.tsx`) — Main page with 10-tab layout using `TabMenu` and local `useState` for tab state
- **ToastNotificationSettingsEnhanced** — Global toast notification configuration (position, duration, styling)
- **EmailSettings** — SMTP/email provider configuration
- **SecuritySettings** — System-level security policies (password rules, session timeouts, MFA)
- **SystemMaintenanceSettings** — Maintenance mode, scheduled downtime management
- **IntegrationSettings** — Third-party integration configuration (SAP, Smartsheet, etc.)
- **PerformanceSettings** — Application performance tuning parameters
- **BackupRecoverySettings** — Database backup schedules and recovery procedures
- **UserDefaultsSettings** — Default settings applied to new user accounts
- **LoggingAuditingSettings** — System logging levels and audit trail configuration
- **APIConfigurationSettings** — API rate limits, CORS, versioning settings

### Performance Monitor (`admin/performance-monitor/`)
- **PerformanceMonitorPage** (`index.tsx`) — Single-page dashboard with four metric cards + controls
  - **Query Cache** card — Active vs total React Query cache entries
  - **Real-time Subscriptions** card — Active Supabase subscription count with high-load warning
  - **Memory Usage** card — Estimated KB of cached data
  - **Optimization Score** card — Cache hit ratio score (Excellent/Good/Fair/Poor)
  - **Performance Controls** — Toggle optimizations, auto-refresh metrics
  - **Cache Management** — Clear all caches (React Query + localStorage + sessionStorage), force GC, reload app
  - **Performance Recommendations** — Context-aware suggestions based on metrics

### SAP Testing (`admin/sap-testing/`)
- **SAPTestingPage** (`index.tsx`) — Admin-only SAP RFC integration testing console (subtitle rebranded to **SAP COM Automation Suite** on 2026-04-27)
- Supports both ECC (Classic WM) and S/4 HANA (EWM) systems
- Visible tabs: One Click Ship, Agent Triggers, Inventory Management, TO History
- Hidden (commented out in `SAP_TESTING_TABS`, components/routes still wired): Connection Test, Goods Receipt (MIGO), Create TO, Confirm TO, Open TOs, Warehouse Data
- Default tab: `one-click-ship` (was `connection-test`)
- Uses `auth-fetch.ts` utility for authenticated SAP API calls

## State Management
- **System Settings** — Local `useState` for active tab; each settings panel manages its own form state internally
- **Performance Monitor** — Uses `@tanstack/react-query` `useQueryClient()` to introspect cache:
  - Polls every 2 seconds when auto-refresh is enabled
  - Tracks: query count, cache size, subscription count, memory usage, optimization score
  - Optimization toggle persisted in `localStorage('performance-optimizations-enabled')`
  - Clears: React Query cache, `permission-cache`, `navigation-cache`, sessionStorage
- **SAP Testing** — `useTabSearchParam` for tab state; each tab manages its own API calls

## Architecture Notes
- System Settings uses `showHiddenTabs={true}` on TabMenu since it's admin-only (no RBAC tab filtering)
- Performance Monitor directly inspects `queryClient.getQueryCache()` for real-time metrics
- Both pages use the standard layout pattern: `<Header fixed>` + `<Main>`
- Icons from `@tabler/icons-react` (System Settings) and `lucide-react` (Performance Monitor)

## Related
- [[Architecture]]
- [[PerformanceMonitor - Feature Module]]
- [[DeviceManager - Feature Module]]
- [[RolesPermissions - Feature Module]]