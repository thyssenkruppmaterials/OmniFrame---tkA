"""
Sanitized error response utilities.

Provides helpers that return stable, non-sensitive error messages to API clients
while preserving full exception details in structured server-side logs.
"""

import logging
import uuid

from fastapi import HTTPException

logger = logging.getLogger(__name__)


def sanitized_error(
    status_code: int,
    *,
    public_message: str = "An internal error occurred. Please try again later.",
    exc: Exception | None = None,
    context: str = "",
) -> HTTPException:
    """Return an HTTPException with a safe client message and log the real error.

    Args:
        status_code: HTTP status code for the response.
        public_message: Message returned to the client (must not contain secrets).
        exc: The original exception (logged server-side only).
        context: Optional human-readable context for the log entry.
    """
    correlation_id = uuid.uuid4().hex[:12]

    if exc is not None:
        logger.error(
            "[%s] %s — %s: %s",
            correlation_id,
            context or "unhandled",
            type(exc).__name__,
            exc,
            exc_info=exc,
        )
    else:
        logger.error("[%s] %s", correlation_id, context or public_message)

    return HTTPException(
        status_code=status_code,
        detail={
            "error": public_message,
            "correlation_id": correlation_id,
        },
    )
