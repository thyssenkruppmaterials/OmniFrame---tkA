# Created and developed by Jai Singh
"""Pydantic models, response types, and custom exceptions for the Smartsheet service."""

from typing import Optional, Dict, List, Any

from pydantic import BaseModel


# ---- Response / data models --------------------------------------------------

class SmartsheetResponse(BaseModel):
    """Base response model for Smartsheet operations."""
    success: bool = True
    data: Optional[Any] = None
    message: Optional[str] = None
    error: Optional[str] = None
    result_code: Optional[int] = None


class SheetSummary(BaseModel):
    """Sheet summary information."""
    id: int
    name: str
    access_level: str
    created_at: Optional[str] = None
    modified_at: Optional[str] = None
    permalink: Optional[str] = None
    version: Optional[int] = None
    total_row_count: Optional[int] = None


class CellData(BaseModel):
    """Cell data structure."""
    column_id: int
    value: Optional[Any] = None
    display_value: Optional[str] = None
    hyperlink: Optional[Dict[str, str]] = None
    link_in_from_cell: Optional[Dict[str, Any]] = None


class RowData(BaseModel):
    """Row data structure."""
    id: Optional[int] = None
    row_number: Optional[int] = None
    parent_id: Optional[int] = None
    sibling_id: Optional[int] = None
    cells: List[CellData] = []
    created_at: Optional[str] = None
    created_by: Optional[Dict[str, str]] = None
    modified_at: Optional[str] = None
    modified_by: Optional[Dict[str, str]] = None


class ColumnData(BaseModel):
    """Column data structure."""
    id: Optional[int] = None
    index: Optional[int] = None
    title: str
    type: str = "TEXT_NUMBER"
    primary: bool = False
    validation: bool = False
    width: Optional[int] = None
    locked: bool = False
    locked_for_user: bool = False


# ---- Custom exceptions -------------------------------------------------------

class SmartsheetServiceError(Exception):
    """Base exception for Smartsheet service errors."""
    pass


class SmartsheetConnectionError(SmartsheetServiceError):
    """Exception for connection-related errors."""
    pass


class SmartsheetRateLimitError(SmartsheetServiceError):
    """Exception for rate limit errors."""
    pass


class SmartsheetAuthenticationError(SmartsheetServiceError):
    """Exception for authentication errors."""
    pass

# Created and developed by Jai Singh
