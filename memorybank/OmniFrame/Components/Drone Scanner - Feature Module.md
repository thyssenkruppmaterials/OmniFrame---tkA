---
tags: [type/component, status/active, domain/frontend]
created: 2026-04-10
---
# Drone Scanner

## Purpose
Drone-based warehouse scanning feature that provides Vision-analyzed inventory scans. Drones capture photos of warehouse racks and aisles, which are then analyzed by the vision pipeline to detect items, verify inventory positions, and identify discrepancies. The feature provides a searchable dashboard for viewing scan results with zone/aisle filtering.

## Key Components
- **DroneScannerPage** (`drone-scans-page.tsx`) — Main page component with statistics cards (Total Scans, Analyzed, Items Detected, Zones Covered), search bar, zone/aisle filters, and results grid. Includes navigation to Drone Control via RF Interface.
- **ScanResultsGrid** (`components/scan-results-grid.tsx`) — Grid display of drone scan records with loading states and scan click handlers. Exports `DroneScan` type.
- **ScanSearchBar** (`components/scan-search-bar.tsx`) — Search input component with searching state indicator.
- **ScanDetailModal** (`components/scan-detail-modal.tsx`) — Modal dialog displaying detailed scan information including vision analysis results.

## Hooks
- `useDroneScans` — Custom hook from `@/hooks/use-drone-scans` providing scans, statistics, search, refresh, and zone list.

## State Management
- Local React state for search query, warehouse zone filter, aisle filter, and selected scan
- `useDroneScans` hook manages data fetching with zone/aisle parameters
- Callback-based search and filter change handlers with memoization via `useCallback`

## Routes
- Accessible from the main navigation
- Links to `/rf-interface` for Drone Control access via RF terminal

## Related
- [[Architecture]]
- [[RF Interface - Feature Module]]
