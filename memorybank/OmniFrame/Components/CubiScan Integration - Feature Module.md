---
tags: [type/component, status/active, domain/frontend]
created: 2026-04-10
---
# CubiScan Integration

## Purpose
Enterprise dimensioning and weighing system integration for warehouse operations. CubiScan devices measure package dimensions (length, width, height) and weight, feeding data into the system for storage bin optimization, shipping label generation, and SAP master data reconciliation. Provides a real-time operations console with live device monitoring, measurement queue, and reconciliation workflows.

## Key Components
- **CubiScanWorkspace** (`cubiscan-workspace.tsx`) — Main operations console with Live-Ops Strip (device status, scan rates, review/failed counts), MetricPill indicators, and split layout with queue table and inspector.
- **CubiScanQueueTable** (`cubiscan-queue-table.tsx`) — Dense data table for measurement queue and history.
- **CubiScanToolbar** (`cubiscan-toolbar.tsx`) — Toolbar with refresh, filter, and action controls.
- **CubiScanInspector** (`cubiscan-inspector.tsx`) — Right-side detail panel for selected measurement with dimensions, weight, and reconciliation actions.

## Hooks
- `useCubiScan` — Core hook from `@/hooks/use-cubiscan` providing statistics, reconciliation, and real-time subscriptions.

## State Management
- Local state for selected measurement with toggle selection
- `useCubiScan` hook manages all data fetching and mutations
- Real-time Supabase subscriptions for live device monitoring

## Types (from `@/lib/cubiscan/types`)
- `CubiScanMeasurement` — Individual measurement record
- `ReconciliationActionType` — Action types for reconciliation

## Routes
- Rendered as a component within the main application CubiScan section

## Related
- [[Architecture]]
- [[Warehouse Map - Feature Module]]
