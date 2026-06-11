---
tags: [type/component, status/active, domain/backend]
created: 2026-04-10
---
# RF Picking Service

## Purpose
Handles outbound delivery picking operations via the RF Terminal. Manages the workflow of scanning deliveries, validating pick locations and quantities, and completing individual item picks with granular status tracking.

## Key Functions

### RFPickingService (singleton class)
- `getDeliveryItems(deliveryNumber)` → queries `outbound_to_data` for delivery items in `processing` status, scoped by user's `organization_id` from `user_profiles`; returns items sorted by transfer order, bin, material. Also checks for un-waved deliveries in `pending` status and provides user guidance.
- `validatePickedQuantity(expectedQty, pickedQty)` → epsilon-based floating point comparison (tolerance 0.001); classifies picks as perfect, short, over, zero (not in location), or negative (rejected).
- `completePick(itemId, pickedQty, pickStatus, exceptionReason?)` → updates a single item in `outbound_to_data` with granular status: `picked`, `picked_short`, `picked_bulk`, `not_in_location`. Stores proper UTC timestamps for timezone-correct display.
- `getPickingStats()` → returns picking statistics (currently mock data, designed for future RPC implementation).

### Exported Validation Functions
- `validateDeliveryNumber(deliveryNumber)` → validates 8-12 char alphanumeric format
- `validateLocation(location, expectedLocation)` → case-insensitive location match validation

## Database Tables
- `outbound_to_data` — outbound transfer order data with delivery, material, bin, status, pick/pack/ship tracking columns. Statuses: `pending` → `processing` → `picked` / `picked_short` / `picked_bulk` / `not_in_location` → `packed` → `final_packed` → `shipped`
- `user_profiles` — joined for organization_id and user display info

## Key Interfaces
- `RFPickingOperation` — completed pick record with picker info and status
- `RFPickingDelivery` — delivery with items array, total quantities, unique locations
- `RFPickingItem` — individual item to pick with bin, quantity, batch, transfer order
- `RFPickingValidation` — validation result with short/over pick detection
- `RFPickingStats` — aggregate picking statistics

## Design Notes
- Uses epsilon (0.001) for quantity comparisons to handle database decimal string precision
- Updates only the specific item ID (not entire delivery) to prevent concurrent pick conflicts
- Timestamps are stored as proper UTC ISO strings for correct timezone handling
- Delivery must be in `processing` status (waved) before picking is allowed

## Related
- [[Architecture]]
- [[KittingServices - Supabase Service]]
- [[ProductivityAndSettings - Supabase Service]]
- [[TeamPerformance - Supabase Service]]