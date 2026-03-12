"""
FastAPI router for proxying external file downloads.
Bypasses CORS restrictions when fetching attachments from Smartsheet/S3.
"""

import logging
from typing import Optional
from urllib.parse import urlparse, unquote
import httpx
from fastapi import APIRouter, HTTPException, Query, Path, Depends
from fastapi.responses import StreamingResponse

try:
    from ..config.settings import settings
    from ..auth.supabase_auth import get_current_user, AuthenticatedUser
    from ..utils.error_responses import sanitized_error
except ImportError:
    from config.settings import settings
    from api.utils.error_responses import sanitized_error
    try:
        from auth.supabase_auth import get_current_user, AuthenticatedUser
    except ImportError:
        from api.auth.supabase_auth import get_current_user, AuthenticatedUser

logger = logging.getLogger(__name__)

# Smartsheet API configuration
SMARTSHEET_API_BASE = "https://api.smartsheet.com/2.0"

# Create router
router = APIRouter(
    prefix="/proxy",
    tags=["Proxy"],
    responses={404: {"description": "Not found"}}
)

# Allowed domains for proxying (S3 buckets used by Smartsheet)
ALLOWED_DOMAINS = [
    "smartsheetb1.s3.amazonaws.com",
    "smartsheetb2.s3.amazonaws.com",
    "s3.amazonaws.com",
    # Add other trusted Smartsheet S3 domains as needed
]

# File type to content-type mapping
CONTENT_TYPE_MAP = {
    '.pdf': 'application/pdf',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xls': 'application/vnd.ms-excel',
    '.csv': 'text/csv',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.txt': 'text/plain',
    '.json': 'application/json',
}


def is_allowed_url(url: str) -> bool:
    """Check if the URL is from an allowed domain."""
    try:
        parsed = urlparse(url)
        hostname = parsed.hostname or ""
        
        # Check exact domain match or subdomain match
        for allowed in ALLOWED_DOMAINS:
            if hostname == allowed or hostname.endswith(f".{allowed}"):
                return True
        
        # Also allow amazonaws.com S3 URLs in general
        if "s3" in hostname and "amazonaws.com" in hostname:
            return True
            
        return False
    except Exception:
        return False


def get_content_type(url: str, response_headers: dict) -> str:
    """Determine content type from URL or response headers."""
    # First try to get from response headers
    content_type = response_headers.get('content-type', '')
    if content_type and 'octet-stream' not in content_type:
        return content_type
    
    # Fall back to extension-based detection
    parsed = urlparse(url)
    path = unquote(parsed.path).lower()
    
    for ext, mime_type in CONTENT_TYPE_MAP.items():
        if path.endswith(ext):
            return mime_type
    
    # Default to binary stream
    return 'application/octet-stream'


@router.get("/attachment")
async def proxy_attachment(
    url: str = Query(..., description="The URL of the attachment to proxy"),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """
    Proxy an attachment download from Smartsheet/S3 to bypass CORS restrictions.
    
    This endpoint fetches the file server-side and streams it to the client
    with appropriate headers for inline viewing in the browser.
    
    Security: Only URLs from allowed S3 domains are permitted.
    """
    # FastAPI/Starlette already decodes query parameters once
    # Only decode again if the URL still contains encoded characters (double-encoded)
    # Check if URL looks double-encoded (contains %25 which is encoded %)
    if '%25' in url:
        decoded_url = unquote(url)
    else:
        decoded_url = url
    
    # Validate URL is from allowed domain
    if not is_allowed_url(decoded_url):
        logger.warning(f"Proxy request blocked for unauthorized URL: {decoded_url[:100]}...")
        raise HTTPException(
            status_code=403, 
            detail="URL domain not allowed. Only Smartsheet S3 URLs are permitted."
        )
    
    try:
        logger.info(f"Proxying attachment from: {decoded_url[:200]}...")
        logger.debug(f"Original URL param: {url[:200]}...")
        logger.debug(f"Decoded URL: {decoded_url[:200]}...")
        
        # Use async HTTP client to fetch the file
        # Add headers to mimic a browser request (some S3 buckets check these)
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': '*/*',
            'Accept-Language': 'en-US,en;q=0.9',
        }
        async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
            response = await client.get(decoded_url, headers=headers)
            
            if response.status_code != 200:
                logger.error(f"Upstream returned status {response.status_code}")
                raise HTTPException(
                    status_code=response.status_code,
                    detail=f"Failed to fetch attachment: upstream returned {response.status_code}"
                )
            
            # Get content type
            content_type = get_content_type(decoded_url, dict(response.headers))
            
            # Get content length if available
            content_length = response.headers.get('content-length')
            
            # Build response headers
            headers = {
                'Content-Type': content_type,
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'private, max-age=3600',  # Cache for 1 hour
            }
            
            if content_length:
                headers['Content-Length'] = content_length
            
            logger.info(f"Successfully proxied attachment, content-type: {content_type}")
            
            # Stream the response content
            async def stream_content():
                yield response.content
            
            return StreamingResponse(
                stream_content(),
                media_type=content_type,
                headers=headers
            )
            
    except httpx.TimeoutException:
        logger.error("Timeout while fetching attachment")
        raise HTTPException(
            status_code=504,
            detail="Timeout while fetching attachment from upstream server"
        )
    except httpx.RequestError as e:
        logger.error(f"Request error while fetching attachment: {str(e)}")
        raise sanitized_error(502, public_message="Failed to fetch attachment.", exc=e, context="proxy attachment request")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error proxying attachment: {str(e)}", exc_info=True)
        raise sanitized_error(500, public_message="Internal error while proxying attachment.", exc=e, context="proxy attachment")


@router.get("/smartsheet/{sheet_id}/attachment/{attachment_id}")
async def proxy_smartsheet_attachment(
    sheet_id: int = Path(..., description="Smartsheet sheet ID"),
    attachment_id: int = Path(..., description="Attachment ID"),
    current_user: AuthenticatedUser = Depends(get_current_user),
):
    """
    Proxy a Smartsheet attachment by fetching a fresh download URL and streaming the content.
    
    This endpoint:
    1. Calls Smartsheet API to get a fresh download URL for the attachment
    2. Immediately fetches the file from that URL
    3. Streams the content to the client
    
    This avoids URL encoding issues with pre-signed S3 URLs.
    """
    smartsheet_token = settings.smartsheet_access_token
    if not smartsheet_token:
        logger.error("Smartsheet access token not configured in settings")
        raise HTTPException(
            status_code=500,
            detail="Smartsheet API token not configured"
        )
    
    try:
        logger.info(f"Fetching attachment {attachment_id} from sheet {sheet_id}")
        
        # Step 1: Get attachment metadata and download URL from Smartsheet
        smartsheet_url = f"{SMARTSHEET_API_BASE}/sheets/{sheet_id}/attachments/{attachment_id}"
        headers = {
            "Authorization": f"Bearer {smartsheet_token}",
            "Content-Type": "application/json"
        }
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            # Get attachment info
            attachment_response = await client.get(smartsheet_url, headers=headers)
            
            if attachment_response.status_code != 200:
                logger.error(f"Smartsheet API returned {attachment_response.status_code}: {attachment_response.text}")
                raise HTTPException(
                    status_code=attachment_response.status_code,
                    detail=f"Failed to get attachment info from Smartsheet"
                )
            
            attachment_data = attachment_response.json()
            download_url = attachment_data.get("url")
            file_name = attachment_data.get("name", "attachment")
            mime_type = attachment_data.get("mimeType", "application/octet-stream")
            
            if not download_url:
                raise HTTPException(
                    status_code=404,
                    detail="No download URL returned from Smartsheet"
                )
            
            logger.info(f"Got download URL for {file_name}, fetching content...")
            
            # Step 2: Fetch the actual file content from S3
            # Use browser-like headers
            fetch_headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': '*/*',
            }
            
            file_response = await client.get(download_url, headers=fetch_headers, follow_redirects=True)
            
            if file_response.status_code != 200:
                logger.error(f"S3 returned {file_response.status_code}")
                raise HTTPException(
                    status_code=file_response.status_code,
                    detail=f"Failed to fetch file content: upstream returned {file_response.status_code}"
                )
            
            # Get content type from response or use Smartsheet's mime type
            content_type = file_response.headers.get('content-type', mime_type)
            content_length = file_response.headers.get('content-length')
            
            # Build response headers
            response_headers = {
                'Content-Type': content_type,
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'private, max-age=300',  # Cache for 5 minutes
                'Content-Disposition': f'inline; filename="{file_name}"',
            }
            
            if content_length:
                response_headers['Content-Length'] = content_length
            
            logger.info(f"Successfully fetched {file_name}, streaming {content_type}")
            
            # Stream the response
            async def stream_content():
                yield file_response.content
            
            return StreamingResponse(
                stream_content(),
                media_type=content_type,
                headers=response_headers
            )
            
    except HTTPException:
        raise
    except httpx.TimeoutException:
        logger.error("Timeout while fetching attachment")
        raise HTTPException(status_code=504, detail="Timeout fetching attachment")
    except Exception as e:
        logger.error(f"Error proxying Smartsheet attachment: {str(e)}", exc_info=True)
        raise sanitized_error(500, public_message="Proxy request failed.", exc=e, context="proxy Smartsheet attachment")


@router.head("/attachment")
async def proxy_attachment_head(
    url: str = Query(..., description="The URL of the attachment to check")
):
    """
    HEAD request for attachment proxy - useful for checking file availability.
    """
    # Only decode if double-encoded
    if '%25' in url:
        decoded_url = unquote(url)
    else:
        decoded_url = url
    
    if not is_allowed_url(decoded_url):
        raise HTTPException(status_code=403, detail="URL domain not allowed")
    
    try:
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            response = await client.head(decoded_url)
            
            content_type = get_content_type(decoded_url, dict(response.headers))
            content_length = response.headers.get('content-length', '0')
            
            return StreamingResponse(
                iter([]),
                media_type=content_type,
                headers={
                    'Content-Type': content_type,
                    'Content-Length': content_length,
                    'Access-Control-Allow-Origin': '*',
                }
            )
    except Exception as e:
        logger.error(f"HEAD request failed: {str(e)}")
        raise sanitized_error(502, public_message="HEAD request failed.", exc=e, context="proxy attachment HEAD")

# Developer and Creator: Jai Singh
