"""Smartsheet service package -- composes the full SmartsheetService class.

Usage (new-style)::

    from api.services.smartsheet import SmartsheetService, get_smartsheet_service

The legacy import path via ``api.services.smartsheet_service`` is preserved by
a thin re-export shim in that module.
"""

from typing import Optional

from .client import _SmartsheetBase
from .attachments import _AttachmentsMixin
from .discussions import _DiscussionsMixin
from .imports import _ImportsMixin

from .mappers import (                          # noqa: F401  -- re-exports
    SmartsheetResponse,
    SheetSummary,
    CellData,
    RowData,
    ColumnData,
    SmartsheetServiceError,
    SmartsheetConnectionError,
    SmartsheetRateLimitError,
    SmartsheetAuthenticationError,
)


class SmartsheetService(
    _AttachmentsMixin,
    _DiscussionsMixin,
    _ImportsMixin,
    _SmartsheetBase,
):
    """Comprehensive Smartsheet service with singleton pattern.

    Provides full CRUD operations, caching, error handling, and rate limiting.
    Composed from domain-specific mixins.
    """
    pass


# ---- global singleton accessor -----------------------------------------------

_smartsheet_service: Optional[SmartsheetService] = None


async def get_smartsheet_service() -> SmartsheetService:
    """Get the global Smartsheet service instance."""
    global _smartsheet_service
    if _smartsheet_service is None:
        _smartsheet_service = await SmartsheetService.get_instance()
    return _smartsheet_service
