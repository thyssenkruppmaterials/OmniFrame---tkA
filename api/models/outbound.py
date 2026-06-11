# Created and developed by Jai Singh
"""
Pydantic models for outbound operations.
Mirrors the existing database schema while adding API-specific validations.
"""

from datetime import datetime, date, time
from typing import Optional, List, Literal
from pydantic import BaseModel, Field, ConfigDict
from decimal import Decimal


class OutboundTODataBase(BaseModel):
    """Base model for outbound TO data with common fields."""
    delivery: Optional[str] = None
    transfer_order_number: Optional[str] = None
    warehouse_number: Optional[str] = None
    material: Optional[str] = None
    material_description: Optional[str] = None
    batch: Optional[str] = None
    source_target_qty: Optional[Decimal] = None
    plant: Optional[str] = None
    storage_location: Optional[str] = None
    source_storage_bin: Optional[str] = None


class OutboundTODataCreate(OutboundTODataBase):
    """Model for creating outbound TO data records."""
    # Required fields for creation
    delivery: str = Field(..., description="Delivery number")
    material: str = Field(..., description="Material number")
    source_target_qty: Decimal = Field(..., gt=0, description="Source target quantity must be positive")


class OutboundTODataResponse(OutboundTODataBase):
    """Model for outbound TO data API responses."""
    model_config = ConfigDict(from_attributes=True)
    
    id: str
    organization_id: str
    created_at: datetime
    updated_at: datetime
    status: Literal["pending", "processing", "completed", "cancelled", "on_hold", "packed", "final_packed", "shipped"]
    
    # Pack tool fields
    packed_by: Optional[str] = None
    packed_at: Optional[datetime] = None
    package_length: Optional[Decimal] = None
    package_width: Optional[Decimal] = None
    package_height: Optional[Decimal] = None
    package_weight: Optional[Decimal] = None
    label_printed_at: Optional[datetime] = None
    
    # Final pack fields
    tracking_number: Optional[str] = None
    requires_8130_3: Optional[bool] = None
    has_8130_3: Optional[bool] = None
    is_8130_3_signed: Optional[bool] = None
    final_packed_by: Optional[str] = None
    final_packed_at: Optional[datetime] = None
    
    # Shipping fields
    shipper_type: Optional[Literal["domestic", "international"]] = None
    shipped_by: Optional[str] = None
    shipped_at: Optional[datetime] = None


class OutboundStatusUpdate(BaseModel):
    """Model for updating outbound status."""
    status: Literal["pending", "processing", "completed", "cancelled", "on_hold", "packed", "final_packed", "shipped"]
    notes: Optional[str] = Field(None, max_length=500, description="Optional status update notes")


class PackingInfo(BaseModel):
    """Model for package information during pack tool operations."""
    package_length: Decimal = Field(..., gt=0, description="Package length in cm")
    package_width: Decimal = Field(..., gt=0, description="Package width in cm") 
    package_height: Decimal = Field(..., gt=0, description="Package height in cm")
    package_weight: Decimal = Field(..., gt=0, description="Package weight in kg")


class FinalPackInfo(BaseModel):
    """Model for final pack tool operations."""
    tracking_number: str = Field(..., min_length=1, description="Tracking number for shipment")
    requires_8130_3: bool = Field(..., description="Does this delivery require 8130-3?")
    has_8130_3: bool = Field(..., description="Is 8130-3 included?")
    is_8130_3_signed: bool = Field(..., description="Is 8130-3 signed by ODA?")


class ShippingInfo(BaseModel):
    """Model for shipping operations."""
    shipper_type: Literal["domestic", "international"] = Field(..., description="Type of shipping")
    tracking_number: Optional[str] = Field(None, description="Additional tracking number if different")


class OutboundAnalytics(BaseModel):
    """Model for outbound analytics data."""
    total_deliveries: int
    pending_count: int
    processing_count: int  
    packed_count: int
    final_packed_count: int
    shipped_count: int
    completed_count: int
    avg_processing_time_hours: Optional[float] = None
    top_materials: List[dict] = Field(default_factory=list)
    daily_throughput: List[dict] = Field(default_factory=list)

# Created and developed by Jai Singh
