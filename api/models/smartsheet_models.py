"""
Pydantic models for Smartsheet API integration.
Provides complete type definitions for requests and responses.
"""

from datetime import datetime
from typing import Optional, List, Dict, Any, Union
from enum import Enum
from pydantic import BaseModel, Field, field_validator, ConfigDict

# ==================== ENUMS ====================

class AccessLevel(str, Enum):
    """Sheet access levels."""
    OWNER = "OWNER"
    ADMIN = "ADMIN"
    EDITOR = "EDITOR"
    EDITOR_SHARE = "EDITOR_SHARE"
    VIEWER = "VIEWER"
    COMMENTER = "COMMENTER"

class ColumnType(str, Enum):
    """Column data types."""
    TEXT_NUMBER = "TEXT_NUMBER"
    DATE = "DATE"
    DATETIME = "DATETIME"
    CONTACT_LIST = "CONTACT_LIST"
    CHECKBOX = "CHECKBOX"
    PICKLIST = "PICKLIST"
    DURATION = "DURATION"
    PREDECESSOR = "PREDECESSOR"
    ABSTRACT_DATETIME = "ABSTRACT_DATETIME"
    MULTI_CONTACT_LIST = "MULTI_CONTACT_LIST"
    MULTI_PICKLIST = "MULTI_PICKLIST"

class AttachmentType(str, Enum):
    """Attachment types."""
    FILE = "FILE"
    GOOGLE_DRIVE = "GOOGLE_DRIVE"
    LINK = "LINK"
    BOX_COM = "BOX_COM"
    DROPBOX = "DROPBOX"
    EVERNOTE = "EVERNOTE"
    EGNYTE = "EGNYTE"
    ONEDRIVE = "ONEDRIVE"

class EventAction(str, Enum):
    """Event actions for webhooks."""
    CREATE = "CREATE"
    UPDATE = "UPDATE"
    DELETE = "DELETE"
    LOAD = "LOAD"

class ObjectType(str, Enum):
    """Object types for events."""
    SHEET = "SHEET"
    ROW = "ROW"
    CELL = "CELL"
    COLUMN = "COLUMN"
    DISCUSSION = "DISCUSSION"
    ATTACHMENT = "ATTACHMENT"

class ShareScope(str, Enum):
    """Sharing scope options."""
    ITEM = "ITEM"
    WORKSPACE = "WORKSPACE"

# ==================== BASE MODELS ====================

class TimestampModel(BaseModel):
    """Base model with timestamp fields."""
    created_at: Optional[datetime] = None
    modified_at: Optional[datetime] = None
    
    model_config = ConfigDict(from_attributes=True)

class UserReference(BaseModel):
    """User reference model."""
    id: Optional[int] = None
    name: Optional[str] = None
    email: Optional[str] = None
    
    model_config = ConfigDict(from_attributes=True)

# ==================== HYPERLINK MODELS ====================

class Hyperlink(BaseModel):
    """Hyperlink model."""
    url: Optional[str] = None
    sheet_id: Optional[int] = None
    row_id: Optional[int] = None
    column_id: Optional[int] = None
    report_id: Optional[int] = None
    
    model_config = ConfigDict(from_attributes=True)

# ==================== CELL MODELS ====================

class CellLink(BaseModel):
    """Cell link model."""
    sheet_id: int
    row_id: Optional[int] = None
    column_id: Optional[int] = None
    sheet_name: Optional[str] = None
    status: Optional[str] = None
    
    model_config = ConfigDict(from_attributes=True)

class Cell(BaseModel):
    """Cell model with comprehensive data."""
    column_id: int
    value: Optional[Union[str, int, float, bool]] = None
    display_value: Optional[str] = None
    formula: Optional[str] = None
    hyperlink: Optional[Hyperlink] = None
    link_in_from_cell: Optional[CellLink] = None
    conditional_format: Optional[str] = None
    format: Optional[str] = None
    object_value: Optional[Dict[str, Any]] = None
    
    model_config = ConfigDict(from_attributes=True)

# ==================== ROW MODELS ====================

class RowLocation(BaseModel):
    """Row location specification."""
    parent_id: Optional[int] = None
    sibling_id: Optional[int] = None
    above: Optional[bool] = None
    indent: Optional[int] = None
    outdent: Optional[int] = None
    
    model_config = ConfigDict(from_attributes=True)

class Row(TimestampModel):
    """Row model with cells and metadata."""
    id: Optional[int] = None
    row_number: Optional[int] = None
    parent_id: Optional[int] = None
    sibling_id: Optional[int] = None
    expanded: Optional[bool] = None
    access_level: Optional[AccessLevel] = None
    cells: List[Cell] = []
    columns: Optional[List[Dict[str, Any]]] = None
    discussions: Optional[List[Dict[str, Any]]] = None
    attachments: Optional[List[Dict[str, Any]]] = None
    permalink: Optional[str] = None
    locked: Optional[bool] = None
    locked_for_user: Optional[bool] = None
    created_by: Optional[UserReference] = None
    modified_by: Optional[UserReference] = None
    version: Optional[int] = None
    
    model_config = ConfigDict(from_attributes=True)

# ==================== COLUMN MODELS ====================

class ColumnValidation(BaseModel):
    """Column validation rules."""
    type: Optional[str] = None
    values: Optional[List[str]] = None
    formula: Optional[str] = None
    strict: Optional[bool] = None
    
    model_config = ConfigDict(from_attributes=True)

class Column(BaseModel):
    """Column model with comprehensive properties."""
    id: Optional[int] = None
    version: Optional[int] = None
    index: Optional[int] = None
    title: str
    type: ColumnType = ColumnType.TEXT_NUMBER
    primary: Optional[bool] = False
    validation: Optional[bool] = False
    width: Optional[int] = None
    auto_number_format: Optional[Dict[str, Any]] = None
    contact_options: Optional[List[Dict[str, Any]]] = None
    format: Optional[str] = None
    formula: Optional[str] = None
    hidden: Optional[bool] = None
    locked: Optional[bool] = False
    locked_for_user: Optional[bool] = False
    options: Optional[List[str]] = None
    symbol: Optional[str] = None
    system_column_type: Optional[str] = None
    tags: Optional[List[str]] = None
    validation_rule: Optional[ColumnValidation] = None
    
    model_config = ConfigDict(from_attributes=True)

# ==================== SHEET MODELS ====================

class WorkspaceReference(BaseModel):
    """Workspace reference model."""
    id: Optional[int] = None
    name: Optional[str] = None
    
    model_config = ConfigDict(from_attributes=True)

class ProjectSettings(BaseModel):
    """Project settings model."""
    working_days: Optional[List[str]] = None
    non_working_days: Optional[List[str]] = None
    length_of_day: Optional[float] = None
    
    model_config = ConfigDict(from_attributes=True)

class Sheet(TimestampModel):
    """Comprehensive sheet model."""
    id: Optional[int] = None
    name: str
    version: Optional[int] = None
    total_row_count: Optional[int] = None
    access_level: Optional[AccessLevel] = None
    effective_attachment_options: Optional[List[str]] = None
    gantt_enabled: Optional[bool] = None
    dependencies_enabled: Optional[bool] = None
    resource_management_enabled: Optional[bool] = None
    cell_image_upload_enabled: Optional[bool] = None
    user_settings: Optional[Dict[str, Any]] = None
    user_permissions: Optional[Dict[str, Any]] = None
    workspace: Optional[WorkspaceReference] = None
    project_settings: Optional[ProjectSettings] = None
    columns: List[Column] = []
    rows: List[Row] = []
    discussions: Optional[List[Dict[str, Any]]] = None
    attachments: Optional[List[Dict[str, Any]]] = None
    permalink: Optional[str] = None
    created_by: Optional[UserReference] = None
    modified_by: Optional[UserReference] = None
    owner: Optional[str] = None
    owner_id: Optional[int] = None
    
    model_config = ConfigDict(from_attributes=True)

# ==================== ATTACHMENT MODELS ====================

class Attachment(TimestampModel):
    """Attachment model."""
    id: Optional[int] = None
    parent_id: Optional[int] = None
    attachment_type: AttachmentType
    attachment_sub_type: Optional[str] = None
    mime_type: Optional[str] = None
    name: Optional[str] = None
    size_in_kb: Optional[int] = None
    parent_type: Optional[str] = None
    url: Optional[str] = None
    url_expires_in_millis: Optional[int] = None
    created_by: Optional[UserReference] = None
    description: Optional[str] = None
    
    model_config = ConfigDict(from_attributes=True)

# ==================== DISCUSSION MODELS ====================

class Comment(TimestampModel):
    """Comment model."""
    id: Optional[int] = None
    text: str
    created_by: Optional[UserReference] = None
    modified_by: Optional[UserReference] = None
    discussion_id: Optional[int] = None
    attachments: Optional[List[Attachment]] = None
    
    model_config = ConfigDict(from_attributes=True)

class Discussion(TimestampModel):
    """Discussion model."""
    id: Optional[int] = None
    title: Optional[str] = None
    comments: List[Comment] = []
    comment_count: Optional[int] = None
    comment_attachments: Optional[List[Attachment]] = None
    created_by: Optional[UserReference] = None
    last_commented_at: Optional[datetime] = None
    last_commented_user: Optional[UserReference] = None
    parent_id: Optional[int] = None
    parent_type: Optional[str] = None
    read_only: Optional[bool] = None
    
    model_config = ConfigDict(from_attributes=True)

# ==================== WORKSPACE MODELS ====================

class Workspace(TimestampModel):
    """Workspace model."""
    id: Optional[int] = None
    name: str
    description: Optional[str] = None
    access_level: Optional[AccessLevel] = None
    permalink: Optional[str] = None
    
    model_config = ConfigDict(from_attributes=True)

class Folder(TimestampModel):
    """Folder model."""
    id: Optional[int] = None
    name: str
    permalink: Optional[str] = None
    
    model_config = ConfigDict(from_attributes=True)

# ==================== SHARING MODELS ====================

class Share(TimestampModel):
    """Share model."""
    id: Optional[str] = None
    type: Optional[str] = None
    user_id: Optional[int] = None
    group_id: Optional[int] = None
    email: Optional[str] = None
    name: Optional[str] = None
    access_level: AccessLevel
    scope: Optional[ShareScope] = None
    cc_me: Optional[bool] = None
    include_cc_in_send_to_email: Optional[bool] = None
    message: Optional[str] = None
    subject: Optional[str] = None
    
    model_config = ConfigDict(from_attributes=True)

# ==================== EVENT MODELS ====================

class Event(BaseModel):
    """Event model for webhooks."""
    event_id: str
    object_type: ObjectType
    action: EventAction
    object_id: int
    user_id: Optional[int] = None
    request_user_id: Optional[int] = None
    timestamp: datetime
    additional_details: Optional[Dict[str, Any]] = None
    
    model_config = ConfigDict(from_attributes=True)

class Webhook(TimestampModel):
    """Webhook model."""
    id: Optional[int] = None
    name: Optional[str] = None
    callback_url: str
    scope: Optional[str] = None
    scope_object_id: Optional[int] = None
    events: List[str] = []
    version: Optional[int] = None
    status: Optional[str] = None
    shared_secret: Optional[str] = None
    stats: Optional[Dict[str, Any]] = None
    
    model_config = ConfigDict(from_attributes=True)

# ==================== REQUEST MODELS ====================

class CreateSheetRequest(BaseModel):
    """Request model for creating a sheet."""
    name: str
    columns: List[Dict[str, Any]]
    workspace_id: Optional[int] = None
    folder_id: Optional[int] = None
    
    @field_validator('name')
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError('Sheet name cannot be empty')
        return v.strip()
    
    @field_validator('columns')
    @classmethod
    def columns_not_empty(cls, v: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        if not v:
            raise ValueError('At least one column is required')
        return v

class UpdateSheetRequest(BaseModel):
    """Request model for updating a sheet."""
    name: Optional[str] = None
    user_settings: Optional[Dict[str, Any]] = None
    project_settings: Optional[ProjectSettings] = None

class AddRowsRequest(BaseModel):
    """Request model for adding rows."""
    to_top: Optional[bool] = None
    to_bottom: Optional[bool] = None
    parent_id: Optional[int] = None
    sibling_id: Optional[int] = None
    above: Optional[bool] = None
    rows: List[Dict[str, Any]]
    
    @field_validator('rows')
    @classmethod
    def rows_not_empty(cls, v: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        if not v:
            raise ValueError('At least one row is required')
        return v

class UpdateRowsRequest(BaseModel):
    """Request model for updating rows."""
    rows: List[Dict[str, Any]]
    
    @field_validator('rows')
    @classmethod
    def rows_not_empty(cls, v: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        if not v:
            raise ValueError('At least one row is required')
        return v

class DeleteRowsRequest(BaseModel):
    """Request model for deleting rows."""
    row_ids: List[int]
    ignore_rows_not_found: Optional[bool] = False
    
    @field_validator('row_ids')
    @classmethod
    def row_ids_not_empty(cls, v: List[int]) -> List[int]:
        if not v:
            raise ValueError('At least one row ID is required')
        return v

class AddColumnsRequest(BaseModel):
    """Request model for adding columns."""
    columns: List[Dict[str, Any]]
    
    @field_validator('columns')
    @classmethod
    def columns_not_empty(cls, v: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        if not v:
            raise ValueError('At least one column is required')
        return v

class ShareSheetRequest(BaseModel):
    """Request model for sharing a sheet."""
    email: str
    access_level: AccessLevel
    subject: Optional[str] = None
    message: Optional[str] = None
    cc_me: Optional[bool] = False
    send_email: Optional[bool] = True
    
    @field_validator('email')
    @classmethod
    def valid_email(cls, v: str) -> str:
        if '@' not in v:
            raise ValueError('Invalid email address')
        return v

class CreateWebhookRequest(BaseModel):
    """Request model for creating a webhook."""
    name: str
    callback_url: str
    scope: str = "sheet"
    scope_object_id: int
    events: List[str] = ["*.*"]
    version: int = 1
    
    @field_validator('callback_url')
    @classmethod
    def valid_url(cls, v: str) -> str:
        if not v.startswith(('http://', 'https://')):
            raise ValueError('Callback URL must start with http:// or https://')
        return v

class SearchSheetsRequest(BaseModel):
    """Request model for searching sheets."""
    query: str
    scope: Optional[str] = "workspace"
    location: Optional[str] = None
    
    @field_validator('query')
    @classmethod
    def query_not_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError('Search query cannot be empty')
        return v.strip()

# ==================== RESPONSE MODELS ====================

class SmartsheetBaseResponse(BaseModel):
    """Base response model."""
    success: bool = True
    message: Optional[str] = None
    result_code: Optional[int] = None
    
    model_config = ConfigDict(from_attributes=True)

class PaginatedResponse(SmartsheetBaseResponse):
    """Paginated response model."""
    page_number: Optional[int] = None
    page_size: Optional[int] = None
    total_pages: Optional[int] = None
    total_count: Optional[int] = None

class SheetListResponse(PaginatedResponse):
    """Response model for sheet list."""
    sheets: List[Dict[str, Any]] = []

class SheetResponse(SmartsheetBaseResponse):
    """Response model for sheet details."""
    sheet: Optional[Dict[str, Any]] = None

class RowsResponse(PaginatedResponse):
    """Response model for rows."""
    rows: List[Dict[str, Any]] = []

class StatisticsResponse(SmartsheetBaseResponse):
    """Response model for statistics."""
    statistics: Optional[Dict[str, Any]] = None

class SearchResponse(SmartsheetBaseResponse):
    """Response model for search results."""
    results: List[Dict[str, Any]] = []
    query: Optional[str] = None
    total_count: Optional[int] = None

class ErrorResponse(BaseModel):
    """Error response model."""
    success: bool = False
    error: str
    error_code: Optional[str] = None
    details: Optional[Dict[str, Any]] = None
    
    model_config = ConfigDict(from_attributes=True)

# ==================== BATCH OPERATION MODELS ====================

class BatchRequest(BaseModel):
    """Batch request model."""
    requests: List[Dict[str, Any]]
    
    @field_validator('requests')
    @classmethod
    def requests_not_empty(cls, v: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        if not v:
            raise ValueError('At least one request is required')
        if len(v) > 100:
            raise ValueError('Maximum 100 requests per batch')
        return v

class BatchResponse(SmartsheetBaseResponse):
    """Batch response model."""
    responses: List[Dict[str, Any]] = []
    failed_count: int = 0
    success_count: int = 0

# ==================== IMPORT/EXPORT MODELS ====================

class ImportRequest(BaseModel):
    """Import request model."""
    file_path: Optional[str] = None
    file_data: Optional[bytes] = None
    sheet_name: Optional[str] = None
    header_row_index: int = 0
    primary_column_index: int = 0
    column_map: Optional[Dict[str, str]] = None

class ExportRequest(BaseModel):
    """Export request model."""
    format: str = "xlsx"
    paper_size: Optional[str] = None
    
    @field_validator('format')
    @classmethod
    def valid_format(cls, v: str) -> str:
        if v not in ['xlsx', 'pdf', 'csv']:
            raise ValueError('Format must be one of: xlsx, pdf, csv')
        return v

class ExportResponse(SmartsheetBaseResponse):
    """Export response model."""
    download_url: Optional[str] = None
    file_name: Optional[str] = None
    expires_at: Optional[datetime] = None
