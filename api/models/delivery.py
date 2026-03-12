"""
Pydantic models for delivery status operations.
Mirrors the rr_all_deliveries table schema.
"""

from datetime import datetime, date, time
from typing import Optional, List
from pydantic import BaseModel, Field, ConfigDict
from decimal import Decimal


class DeliveryBase(BaseModel):
    """Base model for delivery data."""
    delivery: str = Field(..., description="Delivery number")
    warehouse_number: Optional[str] = None
    shipping_point: Optional[str] = None
    receiving_point: Optional[str] = None
    sales_organization: Optional[str] = None
    ship_to_party: Optional[str] = None
    customer_name: Optional[str] = None
    delivery_priority: Optional[str] = None
    delivery_block: Optional[str] = None
    external_identification_1: Optional[str] = None


class DeliveryCreate(DeliveryBase):
    """Model for creating delivery records."""
    delivery_creation_date: Optional[date] = None
    delivery_create_time: Optional[time] = None
    delivery_created_by: Optional[str] = None
    delivery_created_name: Optional[str] = None


class DeliveryResponse(DeliveryBase):
    """Model for delivery API responses."""
    model_config = ConfigDict(from_attributes=True)
    
    id: str
    organization_id: str
    created_at: datetime
    updated_at: datetime
    
    # Delivery details
    delivery_creation_date: Optional[date] = None
    delivery_create_time: Optional[time] = None
    delivery_created_by: Optional[str] = None
    delivery_created_name: Optional[str] = None
    
    # Transfer order details
    transfer_order_number: Optional[str] = None
    transfer_order_create_date: Optional[date] = None
    transfer_order_create_time: Optional[time] = None
    transfer_order_confirm_date: Optional[date] = None
    
    # Change tracking
    delivery_change_date: Optional[date] = None
    delivery_change_by: Optional[str] = None
    delivery_changed_by_name: Optional[str] = None
    
    # Goods movement
    actual_goods_movement_date: Optional[date] = None
    goods_movement_status: Optional[str] = None
    
    # Shipment details
    shipment_number: Optional[str] = None
    shipment_create_date: Optional[date] = None
    shipment_create_by: Optional[str] = None
    shipment_created_name: Optional[str] = None


class DeliveryWithStatus(DeliveryResponse):
    """Delivery model enhanced with status from outbound_to_data."""
    status: Optional[str] = Field(None, description="Current delivery status from outbound operations")
    days_open: Optional[int] = Field(None, description="Days since delivery creation when no goods movement")


class DeliveryStatusSummary(BaseModel):
    """Summary statistics for delivery status."""
    total_deliveries: int
    status_breakdown: dict = Field(default_factory=dict)
    avg_days_open: Optional[float] = None
    deliveries_with_movement: int = 0
    deliveries_without_movement: int = 0


class DeliveryFilter(BaseModel):
    """Model for filtering delivery data."""
    delivery: Optional[str] = None
    customer_name: Optional[str] = None
    shipping_point: Optional[str] = None
    delivery_priority: Optional[str] = None
    status: Optional[str] = None
    date_from: Optional[date] = None
    date_to: Optional[date] = None
    has_goods_movement: Optional[bool] = None


class BulkDeliveryImport(BaseModel):
    """Model for bulk importing delivery data."""
    deliveries: List[DeliveryCreate] = Field(..., min_length=1, max_length=10000)
    skip_duplicates: bool = Field(default=True, description="Skip deliveries that already exist")
    update_existing: bool = Field(default=False, description="Update existing deliveries with new data")


class DeliveryImportResult(BaseModel):
    """Result of bulk delivery import operation."""
    success: bool
    total_processed: int
    inserted_count: int
    updated_count: int
    skipped_count: int
    error_count: int
    errors: List[str] = Field(default_factory=list)
    processing_time_seconds: float

