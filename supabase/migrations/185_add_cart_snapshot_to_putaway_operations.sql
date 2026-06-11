-- ============================================================================
-- Migration 185: Add Cart Snapshot Fields to rf_putaway_operations
-- Description: Lightweight snapshot fields populated when RF putaway completion
--              clears a cart assignment. These are read-only after insert; the
--              authoritative cart state lives in inbound_cart_assignments.
-- ============================================================================

-- Add snapshot columns
ALTER TABLE rf_putaway_operations
  ADD COLUMN IF NOT EXISTS cart_stow_assignment_id UUID REFERENCES public.inbound_cart_assignments(id),
  ADD COLUMN IF NOT EXISTS stow_cart_number TEXT,
  ADD COLUMN IF NOT EXISTS stow_cart_cleared_at TIMESTAMPTZ;

-- Indexes for search and join performance
CREATE INDEX IF NOT EXISTS idx_rf_putaway_ops_stow_cart_number
  ON rf_putaway_operations (stow_cart_number)
  WHERE stow_cart_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rf_putaway_ops_cart_stow_assignment
  ON rf_putaway_operations (cart_stow_assignment_id)
  WHERE cart_stow_assignment_id IS NOT NULL;

COMMENT ON COLUMN rf_putaway_operations.cart_stow_assignment_id IS 'FK to the inbound_cart_assignments row that was cleared when this putaway completed';
COMMENT ON COLUMN rf_putaway_operations.stow_cart_number IS 'Snapshot of cart number for display and search (denormalized from assignment)';
COMMENT ON COLUMN rf_putaway_operations.stow_cart_cleared_at IS 'Timestamp when the cart assignment was cleared by this putaway';
