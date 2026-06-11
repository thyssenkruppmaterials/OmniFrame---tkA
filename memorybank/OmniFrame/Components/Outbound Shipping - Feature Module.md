---
tags: [type/component, status/active, domain/frontend]
created: 2026-04-10
---
# Outbound Shipping

## Purpose
Four-tool outbound shipping suite that guides warehouse workers through the complete pack-ship-finalize lifecycle. Each tool is a multi-step stepper form optimized for barcode scanner input with auto-advance, auto-verify, and concurrent operation locks to prevent race conditions.

## Key Components

### Pack Tool (`pack-tool/pack-tool-form.tsx`)
- Multi-step stepper: Scan Delivery → (Scan Transfer Orders) → Scan Parts → Package Info → Print Label
- Auto-verifies delivery ID after 1.5s of inactivity using debounced timer with stale-check refs
- Material scanning with quantity verification per line item (matched by ID, not material number)
- Transfer Order (TO) scanning step conditionally shown when delivery has TOs
- Package dimensions (L×W×H in cm) and weight (lbs) capture
- 4×1 shipping label generation with auto-print via `window.open()`
- Concurrent operation locks via `useRef` to prevent double-verification
- Uses `usePackTool` hook for Supabase operations

### Shippers Tool (`shippers-tool/shippers-tool-form.tsx`)
- Multi-step stepper: Choose Type → Scan Delivery → Checklist/WAWF Options → Complete
- Three shipping types: Domestic, International, WAWF (Wide Area Workflow)
- Domestic checklist: FedEx/UPS label printing, outbound delivery creation, PGI, overcheck rack staging
- International checklist: Paperwork requirements table by customer type (OGMA, Canada, GE Avio)
- WAWF workflow: Ready for NeFab → Staged to NeFab → Complete TKA Process in SAP
- Uses `useShipperTool` hook with standard and WAWF-specific verification

### Final Pack Tool (`final-pack-tool/final-pack-tool-form.tsx`)
- Multi-step stepper: Scan Delivery → Scan Tracking → 8130-3 Questions → Complete
- Verifies delivery is in packed/shipped status for final packing
- Tracking number capture with scanner input
- 8130-3 compliance questions: requires 8130-3, is included, is signed by ODA
- Uses `useFinalPackTool` hook

### Putback Tool (`putback-tool/putback-tool-form.tsx`)
- Multi-step stepper: Scan Delivery → Enter Return Quantity → Generate Putback Ticket
- Material selection via dropdown with source storage bin display
- Flexible quantity entry (can exceed delivery quantity for actual excess returns)
- QR code + barcode putback ticket generation with auto-print
- Uses `usePutbackTool` hook

## Hooks
- `usePackTool` — Pack operations (verify delivery, validate TO, update packing, complete packing)
- `useShipperTool` — Shipping operations (verify, update, complete, WAWF verification/status/completion)
- `useFinalPackTool` — Final pack operations (verify, update, complete)
- `usePutbackTool` — Putback operations (validate delivery, create putback ticket)
- All hooks from `@/hooks/use-outbound-to-data` backed by `OutboundTODataService`

## State Management
- Each tool uses local React state with multi-step form data
- Auto-verification via `useEffect` with debounced timeouts and `useRef` locks
- Stale timer detection using `useRef` to track current values vs captured closure values
- Auth state validation before every Supabase operation via `useUnifiedAuth`
- Stepper context pattern with custom `useStepper` hook for step navigation

## Routes
- Rendered as tabs within the main application outbound section

## Related
- [[Architecture]]
- [[RF Interface - Feature Module]]
