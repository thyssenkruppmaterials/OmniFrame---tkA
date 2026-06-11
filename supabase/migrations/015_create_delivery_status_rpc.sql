-- Migration: Create Delivery Status RPC Function
-- Date: 2025-01-30
-- Description: Creates the missing get_delivery_status_data RPC function for delivery status management

CREATE OR REPLACE FUNCTION get_delivery_status_data(org_id UUID)
RETURNS TABLE(
  id UUID,
  organization_id UUID,
  delivery TEXT,
  warehouse_number TEXT,
  shipping_point TEXT,
  receiving_point TEXT,
  sales_organization TEXT,
  ship_to_party TEXT,
  customer_name TEXT,
  delivery_priority TEXT,
  delivery_block TEXT,
  delivery_creation_date DATE,
  delivery_create_time TIME,
  delivery_created_by TEXT,
  delivery_created_name TEXT,
  transfer_order_number TEXT,
  transfer_order_create_date DATE,
  transfer_order_create_time TIME,
  transfer_order_confirm_date DATE,
  delivery_change_date DATE,
  delivery_change_by TEXT,
  delivery_changed_by_name TEXT,
  actual_goods_movement_date DATE,
  goods_movement_status TEXT,
  shipment_number TEXT,
  shipment_create_date DATE,
  shipment_create_by TEXT,
  shipment_created_name TEXT,
  external_identification_1 TEXT,
  status outbound_status,
  status_updated_at TIMESTAMPTZ,
  packed_by UUID,
  packed_at TIMESTAMPTZ,
  shipped_by UUID,
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

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION get_delivery_status_data(UUID) TO authenticated;

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_rr_all_deliveries_org_delivery
ON rr_all_deliveries(organization_id, delivery);
