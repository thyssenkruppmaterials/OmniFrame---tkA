-- Add kit_cart_color column to RR_Kitting_DATA
-- Stores a hex color (e.g. '#22c55e') chosen when creating a kit build plan.
-- Maps to the sidebar color on the printed Kit Build Sheet so operators
-- can visually identify which cart configuration a kit belongs to.
ALTER TABLE "RR_Kitting_DATA"
  ADD COLUMN IF NOT EXISTS kit_cart_color TEXT;
