-- Migration: Add Dispositions to Delivery Status
-- Created: October 31, 2025
-- Description: Adds dispositions column to rr_all_deliveries and creates table for managing disposition options

-- Create table for disposition options
CREATE TABLE IF NOT EXISTS delivery_dispositions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  color VARCHAR(50) DEFAULT 'gray',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organization_id, name)
);

-- Add RLS policies for delivery_dispositions
ALTER TABLE delivery_dispositions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view dispositions in their organization"
  ON delivery_dispositions
  FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM user_profiles WHERE id = auth.uid()
  ));

CREATE POLICY "Users can insert dispositions in their organization"
  ON delivery_dispositions
  FOR INSERT
  WITH CHECK (organization_id IN (
    SELECT organization_id FROM user_profiles WHERE id = auth.uid()
  ));

CREATE POLICY "Users can update dispositions in their organization"
  ON delivery_dispositions
  FOR UPDATE
  USING (organization_id IN (
    SELECT organization_id FROM user_profiles WHERE id = auth.uid()
  ));

CREATE POLICY "Users can delete dispositions in their organization"
  ON delivery_dispositions
  FOR DELETE
  USING (organization_id IN (
    SELECT organization_id FROM user_profiles WHERE id = auth.uid()
  ));

-- Add dispositions column to rr_all_deliveries
ALTER TABLE rr_all_deliveries 
ADD COLUMN IF NOT EXISTS dispositions UUID REFERENCES delivery_dispositions(id) ON DELETE SET NULL;

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_rr_all_deliveries_dispositions
  ON rr_all_deliveries(dispositions);

CREATE INDEX IF NOT EXISTS idx_delivery_dispositions_org
  ON delivery_dispositions(organization_id);

-- Add updated_at trigger for delivery_dispositions
CREATE TRIGGER set_delivery_dispositions_updated_at
  BEFORE UPDATE ON delivery_dispositions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Grant permissions to authenticated users
GRANT SELECT, INSERT, UPDATE, DELETE ON delivery_dispositions TO authenticated;

-- Drop existing function first
DROP FUNCTION IF EXISTS get_delivery_status_data(UUID);

-- Update the get_delivery_status_data function to include dispositions
CREATE OR REPLACE FUNCTION get_delivery_status_data(org_id UUID)
RETURNS TABLE (
  id UUID,
  organization_id UUID,
  delivery VARCHAR(10),
  warehouse_number VARCHAR(4),
  shipping_point VARCHAR(4),
  receiving_point VARCHAR(10),
  sales_organization VARCHAR(4),
  ship_to_party VARCHAR(10),
  customer_name VARCHAR(255),
  delivery_priority VARCHAR(2),
  delivery_block VARCHAR(2),
  delivery_creation_date DATE,
  delivery_create_time TIME,
  delivery_created_by VARCHAR(12),
  delivery_created_name VARCHAR(255),
  transfer_order_number VARCHAR(20),
  transfer_order_create_date DATE,
  transfer_order_create_time TIME,
  transfer_order_confirm_date DATE,
  delivery_change_date DATE,
  delivery_change_by VARCHAR(12),
  delivery_changed_by_name VARCHAR(255),
  actual_goods_movement_date DATE,
  goods_movement_status VARCHAR(1),
  shipment_number VARCHAR(10),
  shipment_create_date DATE,
  shipment_create_by VARCHAR(12),
  shipment_created_name VARCHAR(255),
  external_identification_1 VARCHAR(20),
  dispositions UUID,
  -- Fields from outbound_to_data join
  status VARCHAR(50),
  status_updated_at TIMESTAMPTZ,
  packed_by VARCHAR(255),
  packed_at TIMESTAMPTZ,
  shipped_by VARCHAR(255),
  shipped_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    d.id,
    d.organization_id,
    d.delivery,
    d.warehouse_number,
    d.shipping_point,
    d.receiving_point,
    d.sales_organization,
    d.ship_to_party,
    d.customer_name,
    d.delivery_priority,
    d.delivery_block,
    d.delivery_creation_date,
    d.delivery_create_time,
    d.delivery_created_by,
    d.delivery_created_name,
    d.transfer_order_number,
    d.transfer_order_create_date,
    d.transfer_order_create_time,
    d.transfer_order_confirm_date,
    d.delivery_change_date,
    d.delivery_change_by,
    d.delivery_changed_by_name,
    d.actual_goods_movement_date,
    d.goods_movement_status,
    d.shipment_number,
    d.shipment_create_date,
    d.shipment_create_by,
    d.shipment_created_name,
    d.external_identification_1,
    d.dispositions,
    -- Join with outbound_to_data for status information
    COALESCE(o.status, 'pending') as status,
    o.updated_at as status_updated_at,
    o.packed_by,
    o.packed_at,
    o.shipped_by,
    o.shipped_at,
    d.created_at,
    d.updated_at
  FROM rr_all_deliveries d
  LEFT JOIN outbound_to_data o ON o.delivery = d.delivery
    AND o.organization_id = d.organization_id
  WHERE d.organization_id = org_id
  ORDER BY d.delivery_creation_date DESC, d.delivery ASC;
END;
$$;

-- Comment on the new column and table
COMMENT ON COLUMN rr_all_deliveries.dispositions IS 'Secondary status/disposition for deliveries';
COMMENT ON TABLE delivery_dispositions IS 'Stores available disposition options for delivery status';

