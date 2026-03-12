"""
Pydantic models for Customer Portal Ticketing System.
Integrates with Smartsheet backend for ticket management.
"""

from datetime import datetime
from typing import Optional, List, Dict, Any
from enum import Enum
from pydantic import BaseModel, Field, EmailStr, field_validator, model_validator, ConfigDict


# ==================== ENUMS ====================

class TicketStatus(str, Enum):
    """Ticket status options."""
    OPEN = "Open"
    IN_PROGRESS = "In Progress"
    WAITING = "Waiting"
    RESOLVED = "Resolved"
    CLOSED = "Closed"


class TicketPriority(str, Enum):
    """Ticket priority levels."""
    LOW = "Low"
    MEDIUM = "Medium"
    HIGH = "High"
    CRITICAL = "Critical"


class TicketCategory(str, Enum):
    """Ticket categories."""
    GENERAL = "General"
    TECHNICAL = "Technical"
    BILLING = "Billing"
    SHIPPING = "Shipping"
    PRODUCT = "Product"
    OTHER = "Other"


# ==================== REQUEST MODELS ====================

class TicketCreate(BaseModel):
    """Request model for creating a new ticket."""
    customer_id: str = Field(..., description="Customer identification number")
    email: EmailStr = Field(..., description="Customer email address")
    subject: str = Field(..., min_length=3, max_length=200, description="Ticket subject")
    description: str = Field(..., min_length=10, description="Detailed description of the issue")
    priority: TicketPriority = Field(default=TicketPriority.MEDIUM, description="Ticket priority")
    category: TicketCategory = Field(default=TicketCategory.GENERAL, description="Ticket category")
    
    @field_validator('subject')
    @classmethod
    def subject_not_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError('Subject cannot be empty')
        return v.strip()
    
    @field_validator('description')
    @classmethod
    def description_not_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError('Description cannot be empty')
        return v.strip()
    
    @field_validator('customer_id')
    @classmethod
    def customer_id_not_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError('Customer ID cannot be empty')
        return v.strip()


class TicketUpdate(BaseModel):
    """Request model for updating an existing ticket."""
    status: Optional[TicketStatus] = None
    priority: Optional[TicketPriority] = None
    assigned_to: Optional[str] = None
    notes: Optional[str] = None
    
    model_config = ConfigDict(use_enum_values=True)


class TicketSearchRequest(BaseModel):
    """Request model for searching tickets."""
    email: Optional[EmailStr] = None
    customer_id: Optional[str] = None
    
    @model_validator(mode='before')
    @classmethod
    def at_least_one_field(cls, data: Any) -> Any:
        if isinstance(data, dict):
            if not any(v for v in data.values() if v is not None):
                raise ValueError('Either email or customer_id must be provided')
        return data


class CommentCreate(BaseModel):
    """Request model for creating a comment."""
    text: str = Field(..., min_length=1, description="Comment text")
    author_name: Optional[str] = Field(None, description="Name of the comment author")
    author_email: Optional[EmailStr] = Field(None, description="Email of the comment author")
    
    @field_validator('text')
    @classmethod
    def text_not_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError('Comment text cannot be empty')
        return v.strip()


class AttachmentUpload(BaseModel):
    """Metadata for attachment upload."""
    file_name: str
    file_size: int
    mime_type: Optional[str] = None


# ==================== RESPONSE MODELS ====================

class AttachmentResponse(BaseModel):
    """Response model for attachment information."""
    id: int
    name: str
    attachment_type: str
    mime_type: Optional[str] = None
    size_in_kb: Optional[int] = None
    url: Optional[str] = None
    url_expires_in_millis: Optional[int] = None
    created_at: Optional[datetime] = None
    created_by: Optional[Dict[str, Any]] = None
    
    model_config = ConfigDict(from_attributes=True)


class CommentResponse(BaseModel):
    """Response model for comment information."""
    id: int
    text: str
    discussion_id: Optional[int] = None
    created_at: Optional[datetime] = None
    created_by: Optional[Dict[str, Any]] = None
    modified_at: Optional[datetime] = None
    attachments: List[AttachmentResponse] = []
    
    model_config = ConfigDict(from_attributes=True)


class DiscussionResponse(BaseModel):
    """Response model for discussion thread."""
    id: int
    title: Optional[str] = None
    comment_count: int = 0
    comments: List[CommentResponse] = []
    created_at: Optional[datetime] = None
    created_by: Optional[Dict[str, Any]] = None
    last_commented_at: Optional[datetime] = None
    
    model_config = ConfigDict(from_attributes=True)


class TicketResponse(BaseModel):
    """Complete response model for ticket details."""
    ticket_id: str = Field(..., description="Unique ticket identifier")
    row_id: int = Field(..., description="Smartsheet row ID")
    customer_id: str
    email: str
    subject: str
    description: str
    status: TicketStatus
    priority: TicketPriority
    category: TicketCategory
    assigned_to: Optional[str] = None
    notes: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    discussions: List[DiscussionResponse] = []
    attachments: List[AttachmentResponse] = []
    permalink: Optional[str] = None
    
    model_config = ConfigDict(from_attributes=True, use_enum_values=True)


class TicketListResponse(BaseModel):
    """Response model for list of tickets."""
    tickets: List[TicketResponse] = []
    total_count: int = 0
    
    model_config = ConfigDict(from_attributes=True)


class TicketCreateResponse(BaseModel):
    """Response model for ticket creation."""
    success: bool = True
    message: str
    ticket: Optional[TicketResponse] = None
    
    model_config = ConfigDict(from_attributes=True)


class TicketOperationResponse(BaseModel):
    """Generic response model for ticket operations."""
    success: bool = True
    message: str
    data: Optional[Dict[str, Any]] = None
    
    model_config = ConfigDict(from_attributes=True)


# ==================== WEBHOOK MODELS ====================

class WebhookEventType(str, Enum):
    """Webhook event types."""
    ROW_CREATED = "row.created"
    ROW_UPDATED = "row.updated"
    ROW_DELETED = "row.deleted"
    DISCUSSION_CREATED = "discussion.created"
    DISCUSSION_UPDATED = "discussion.updated"
    COMMENT_CREATED = "comment.created"
    ATTACHMENT_CREATED = "attachment.created"


class WebhookEvent(BaseModel):
    """Webhook event model."""
    event_id: str
    scope: str
    scope_object_id: int
    event_type: WebhookEventType
    object_type: str
    object_id: int
    user_id: Optional[int] = None
    timestamp: datetime
    additional_details: Optional[Dict[str, Any]] = None
    
    model_config = ConfigDict(from_attributes=True)


class WebhookCallback(BaseModel):
    """Smartsheet webhook callback payload."""
    challenge: Optional[str] = None  # For webhook verification
    webhook_id: Optional[int] = None
    scope: Optional[str] = None
    scope_object_id: Optional[int] = None
    events: List[Dict[str, Any]] = []
    
    model_config = ConfigDict(from_attributes=True)


class TicketEventResponse(BaseModel):
    """Response model for ticket events (for polling)."""
    ticket_id: str
    events: List[WebhookEvent] = []
    last_updated: datetime
    has_more: bool = False
    
    model_config = ConfigDict(from_attributes=True)

