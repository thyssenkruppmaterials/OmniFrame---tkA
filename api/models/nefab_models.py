# Created and developed by Jai Singh
"""
Pydantic models for Nefab PFC Trace API integration.

Author: OneBox AI Team
Date: December 17, 2025
Version: 1.0.0
"""

from typing import Optional, List, Any
from pydantic import BaseModel, Field, ConfigDict
from datetime import datetime


# ==================== REQUEST MODELS ====================

class NefabGetAllStatusRequest(BaseModel):
    """Request model for GetAllStatus endpoint."""
    ItemTypeId: Optional[int] = Field(None, description="Filter by specific Item Type ID")


# ==================== RESPONSE MODELS - NESTED STRUCTURES ====================

class NefabItemType(BaseModel):
    """Item type information."""
    Id: int
    Name: str


class NefabTracker(BaseModel):
    """Tracker/GPS device information."""
    Id: int
    ExternalId: Optional[str] = None
    LastUpdate: Optional[str] = None
    Battery: Optional[int] = None
    LocationTime: Optional[str] = None
    Lat: Optional[float] = None
    Lng: Optional[float] = None
    Radius: Optional[int] = None
    LocationSourceId: Optional[int] = None
    LocationSourceName: Optional[str] = None


class NefabWarehouse(BaseModel):
    """Warehouse information."""
    Id: int
    Name: str
    TypeId: Optional[int] = None
    TypeName: Optional[str] = None


class NefabLocation(BaseModel):
    """Location/zone information."""
    Id: Optional[int] = None
    Name: Optional[str] = None


# ==================== MAIN ITEM MODEL ====================

class NefabItem(BaseModel):
    """Individual item from Nefab PFC Trace API."""
    Id: int
    Name: str
    Description: Optional[str] = None
    ItemType: Optional[NefabItemType] = None  # Made optional - some items may not have ItemType
    LastUpdate: Optional[str] = None
    Trackers: Optional[List[NefabTracker]] = []
    StatusId: Optional[int] = None
    StatusName: Optional[str] = None
    StatusWarehouse: Optional[NefabWarehouse] = None
    Cycles: Optional[int] = None
    Trips: Optional[int] = None
    Location: Optional[NefabLocation] = None
    FreeField1Name: Optional[str] = None
    FreeField2Name: Optional[str] = None
    
    model_config = ConfigDict(extra="allow")


# ==================== API RESPONSE MODELS ====================

class NefabApiResponse(BaseModel):
    """Raw API response from Nefab."""
    Data: List[NefabItem] = []


class NefabItemTypeDefinition(BaseModel):
    """Item type definition with ID and name."""
    Id: int
    Name: str


# ==================== SERVICE RESPONSE MODELS ====================

class NefabServiceResponse(BaseModel):
    """Standard service response wrapper."""
    success: bool
    message: Optional[str] = None
    error: Optional[str] = None
    data: Optional[Any] = None
    cached: bool = False
    cache_age_seconds: Optional[int] = None


class NefabItemsResponse(BaseModel):
    """Response model for items list endpoint."""
    success: bool
    message: Optional[str] = None
    items: List[NefabItem] = []
    total_count: int = 0
    item_type_filter: Optional[int] = None
    cached: bool = False
    cache_age_seconds: Optional[int] = None
    last_updated: Optional[str] = None


class NefabItemTypesResponse(BaseModel):
    """Response model for item types endpoint."""
    success: bool
    message: Optional[str] = None
    item_types: List[NefabItemTypeDefinition] = []


class NefabStatisticsResponse(BaseModel):
    """Response model for statistics endpoint."""
    success: bool
    message: Optional[str] = None
    total_items: int = 0
    by_item_type: dict = {}
    by_status: dict = {}
    by_warehouse: dict = {}
    cached: bool = False


# ==================== AVAILABLE ITEM TYPES ====================

# Static list of available item types from Nefab
NEFAB_ITEM_TYPES: List[NefabItemTypeDefinition] = [
    NefabItemTypeDefinition(Id=320, Name="Banded Stators"),
    NefabItemTypeDefinition(Id=376, Name="Excellence Material Movement"),
    NefabItemTypeDefinition(Id=403, Name="Finished Goods Container"),
    NefabItemTypeDefinition(Id=307, Name="Gateways"),
    NefabItemTypeDefinition(Id=312, Name="Kit Cart 1107 Flow"),
    NefabItemTypeDefinition(Id=311, Name="Kit Cart 2100 Flow"),
    NefabItemTypeDefinition(Id=313, Name="Kit Cart 3007 Flow"),
    NefabItemTypeDefinition(Id=305, Name="Kit Cart AE Common"),
    NefabItemTypeDefinition(Id=319, Name="Kit Cart Industrial"),
    NefabItemTypeDefinition(Id=310, Name="Kit Cart LiftFan"),
    NefabItemTypeDefinition(Id=316, Name="Kit Cart RR300"),
    NefabItemTypeDefinition(Id=314, Name="Kit Cart Series II"),
    NefabItemTypeDefinition(Id=315, Name="Kit Cart Series IV"),
    NefabItemTypeDefinition(Id=324, Name="LiftSystem Flight Case"),
    NefabItemTypeDefinition(Id=322, Name="LiftSystem Tote"),
    NefabItemTypeDefinition(Id=348, Name="MRB"),
    NefabItemTypeDefinition(Id=332, Name="Pelican Case"),
    NefabItemTypeDefinition(Id=331, Name="Plastic Pallet 32 x 38"),
    NefabItemTypeDefinition(Id=390, Name="Plastic Pallet 40x48"),
    NefabItemTypeDefinition(Id=347, Name="PQHC"),
    NefabItemTypeDefinition(Id=370, Name="Production Part"),
    NefabItemTypeDefinition(Id=308, Name="Raw Material Container"),
    NefabItemTypeDefinition(Id=309, Name="Reference tag"),
    NefabItemTypeDefinition(Id=318, Name="RR300"),
    NefabItemTypeDefinition(Id=351, Name="SPARE PART TOTE"),
    NefabItemTypeDefinition(Id=317, Name="Vendor Returnables"),
    NefabItemTypeDefinition(Id=350, Name="Victory Material Movement"),
]

# Kit Cart specific item types (for filtering in Kit Cart Viewer)
KIT_CART_ITEM_TYPE_IDS = [305, 310, 311, 312, 313, 314, 315, 316, 319]

# Created and developed by Jai Singh
