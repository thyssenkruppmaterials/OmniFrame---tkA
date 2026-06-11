# Created and developed by Jai Singh
"""
Nefab PFC Trace API Service with Redis caching.

Provides integration with Nefab's PFC Trace API for kit cart tracking.
Implements singleton pattern, caching, and error handling.

Author: OneBox AI Team
Date: December 17, 2025
Version: 1.0.0
"""

import logging
import asyncio
import json
import httpx
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone
from cachetools import TTLCache

try:
    from ..config.settings import settings
    from ..models.nefab_models import (
        NefabItem, NefabApiResponse, NefabItemsResponse,
        NefabStatisticsResponse, NefabServiceResponse,
        NEFAB_ITEM_TYPES, KIT_CART_ITEM_TYPE_IDS
    )
except ImportError:
    from config.settings import settings
    from models.nefab_models import (
        NefabItem, NefabApiResponse, NefabItemsResponse,
        NefabStatisticsResponse, NefabServiceResponse,
        NEFAB_ITEM_TYPES, KIT_CART_ITEM_TYPE_IDS
    )

logger = logging.getLogger(__name__)


class NefabServiceError(Exception):
    """Base exception for Nefab service errors."""
    pass


class NefabAuthenticationError(NefabServiceError):
    """Exception for authentication errors."""
    pass


class NefabRateLimitError(NefabServiceError):
    """Exception for rate limit errors."""
    pass


class NefabService:
    """
    Nefab PFC Trace API service with singleton pattern.
    Provides API integration, caching, and error handling.
    """
    
    _instance: Optional['NefabService'] = None
    _lock = asyncio.Lock()
    
    def __init__(self):
        """Initialize Nefab service with configuration."""
        if NefabService._instance is not None:
            raise RuntimeError("Use NefabService.get_instance() instead")
        
        self._http_client: Optional[httpx.AsyncClient] = None
        
        # Caching configuration
        self._response_cache = TTLCache(
            maxsize=100,
            ttl=settings.nefab_cache_ttl
        )
        self._cache_timestamps: Dict[str, datetime] = {}
        
        # API configuration
        self._api_url = settings.nefab_api_url
        self._api_key = settings.nefab_api_key
        
        # Rate limiting
        self._rate_limit_window: List[float] = []
        self._rate_limit_lock = asyncio.Lock()
        
        logger.info("NefabService initialized")
    
    @classmethod
    async def get_instance(cls) -> 'NefabService':
        """Get singleton instance with thread safety."""
        if cls._instance is None:
            async with cls._lock:
                if cls._instance is None:
                    cls._instance = cls()
                    await cls._instance._initialize()
        return cls._instance
    
    async def _initialize(self):
        """Initialize HTTP client."""
        self._http_client = httpx.AsyncClient(
            timeout=httpx.Timeout(30.0, connect=10.0),
            limits=httpx.Limits(max_keepalive_connections=5, max_connections=10)
        )
        logger.info("Nefab HTTP client initialized")
    
    async def close(self):
        """Close HTTP client."""
        if self._http_client:
            await self._http_client.aclose()
            self._http_client = None
            logger.info("Nefab HTTP client closed")
    
    def _get_cache_key(self, item_type_id: Optional[int] = None) -> str:
        """Generate cache key for request."""
        if item_type_id:
            return f"nefab_items_{item_type_id}"
        return "nefab_items_all"
    
    def _get_cached_response(self, cache_key: str) -> Optional[Dict[str, Any]]:
        """Get cached response if available."""
        if cache_key in self._response_cache:
            cached = self._response_cache[cache_key]
            cache_time = self._cache_timestamps.get(cache_key)
            if cache_time:
                age_seconds = (datetime.now(timezone.utc) - cache_time).total_seconds()
                return {
                    "data": cached,
                    "cached": True,
                    "cache_age_seconds": int(age_seconds)
                }
        return None
    
    def _set_cached_response(self, cache_key: str, data: Any):
        """Cache response data."""
        self._response_cache[cache_key] = data
        self._cache_timestamps[cache_key] = datetime.now(timezone.utc)
    
    async def _make_api_request(
        self,
        endpoint: str,
        method: str = "POST",
        body: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Make authenticated API request to Nefab.
        
        Args:
            endpoint: API endpoint path
            method: HTTP method
            body: Request body (JSON)
        
        Returns:
            API response data
        
        Raises:
            NefabServiceError: On API errors
        """
        if not self._http_client:
            await self._initialize()
        
        url = f"{self._api_url}/{endpoint}"
        headers = {
            "x-api-key": self._api_key,
            "Content-Type": "application/json",
            "Accept": "application/json"
        }
        
        try:
            logger.debug(f"Nefab API request: {method} {url}")
            
            if method.upper() == "POST":
                response = await self._http_client.post(
                    url,
                    headers=headers,
                    json=body or {}
                )
            else:
                response = await self._http_client.get(url, headers=headers)
            
            # Handle response encoding (Nefab API returns UTF-8 with BOM)
            content = response.content
            if content.startswith(b'\xef\xbb\xbf'):
                content = content[3:]  # Remove BOM
            
            response_text = content.decode('utf-8')
            
            if response.status_code == 401:
                raise NefabAuthenticationError("Invalid API key")
            elif response.status_code == 429:
                raise NefabRateLimitError("Rate limit exceeded")
            elif response.status_code >= 400:
                raise NefabServiceError(f"API error: {response.status_code} - {response_text[:200]}")
            
            return json.loads(response_text)
            
        except httpx.TimeoutException as e:
            logger.error(f"Nefab API timeout: {e}")
            raise NefabServiceError(f"API request timed out: {str(e)}")
        except httpx.RequestError as e:
            logger.error(f"Nefab API request error: {e}")
            raise NefabServiceError(f"API request failed: {str(e)}")
        except json.JSONDecodeError as e:
            logger.error(f"Nefab API JSON decode error: {e}")
            raise NefabServiceError(f"Invalid JSON response: {str(e)}")
    
    async def get_all_items(
        self,
        item_type_id: Optional[int] = None,
        use_cache: bool = True
    ) -> NefabItemsResponse:
        """
        Get all items from Nefab PFC Trace API.
        
        Args:
            item_type_id: Optional filter by item type ID
            use_cache: Whether to use cached data if available
        
        Returns:
            NefabItemsResponse with items list
        """
        cache_key = self._get_cache_key(item_type_id)
        
        # Check cache first
        if use_cache:
            cached = self._get_cached_response(cache_key)
            if cached:
                logger.debug(f"Nefab cache hit for {cache_key}")
                return NefabItemsResponse(
                    success=True,
                    message="Data retrieved from cache",
                    items=cached["data"],
                    total_count=len(cached["data"]),
                    item_type_filter=item_type_id,
                    cached=True,
                    cache_age_seconds=cached["cache_age_seconds"],
                    last_updated=datetime.now(timezone.utc).isoformat()
                )
        
        try:
            # Build request body
            body = {}
            if item_type_id:
                body["ItemTypeId"] = item_type_id
            
            # Make API request
            response_data = await self._make_api_request(
                "Items/GetAllStatus",
                method="POST",
                body=body if body else None
            )
            
            # Parse response
            items_data = response_data.get("Data", [])
            items = [NefabItem(**item) for item in items_data]
            
            # Cache the response
            self._set_cached_response(cache_key, items)
            
            logger.info(f"Nefab API: Retrieved {len(items)} items" + 
                       (f" for type {item_type_id}" if item_type_id else ""))
            
            return NefabItemsResponse(
                success=True,
                message=f"Retrieved {len(items)} items",
                items=items,
                total_count=len(items),
                item_type_filter=item_type_id,
                cached=False,
                cache_age_seconds=0,
                last_updated=datetime.now(timezone.utc).isoformat()
            )
            
        except NefabServiceError as e:
            logger.error(f"Nefab service error: {e}")
            return NefabItemsResponse(
                success=False,
                message=str(e),
                items=[],
                total_count=0,
                item_type_filter=item_type_id
            )
        except Exception as e:
            logger.error(f"Unexpected error in get_all_items: {e}")
            return NefabItemsResponse(
                success=False,
                message=f"Unexpected error: {str(e)}",
                items=[],
                total_count=0,
                item_type_filter=item_type_id
            )
    
    async def get_kit_carts(self, use_cache: bool = True) -> NefabItemsResponse:
        """
        Get all kit cart items (filtered to kit cart types only).
        
        Args:
            use_cache: Whether to use cached data
        
        Returns:
            NefabItemsResponse with kit cart items
        """
        # Get all items first
        all_items_response = await self.get_all_items(use_cache=use_cache)
        
        if not all_items_response.success:
            return all_items_response
        
        # Filter to kit cart types (only items with ItemType defined)
        kit_cart_items = [
            item for item in all_items_response.items
            if item.ItemType and item.ItemType.Id in KIT_CART_ITEM_TYPE_IDS
        ]
        
        return NefabItemsResponse(
            success=True,
            message=f"Retrieved {len(kit_cart_items)} kit cart items",
            items=kit_cart_items,
            total_count=len(kit_cart_items),
            cached=all_items_response.cached,
            cache_age_seconds=all_items_response.cache_age_seconds,
            last_updated=all_items_response.last_updated
        )
    
    async def get_statistics(self, use_cache: bool = True) -> NefabStatisticsResponse:
        """
        Get statistics about all items.
        
        Returns:
            NefabStatisticsResponse with aggregated statistics
        """
        all_items_response = await self.get_all_items(use_cache=use_cache)
        
        if not all_items_response.success:
            return NefabStatisticsResponse(
                success=False,
                message=all_items_response.message
            )
        
        items = all_items_response.items
        
        # Aggregate by item type
        by_item_type: Dict[str, int] = {}
        for item in items:
            type_name = item.ItemType.Name if item.ItemType else "Unknown"
            by_item_type[type_name] = by_item_type.get(type_name, 0) + 1
        
        # Aggregate by status
        by_status: Dict[str, int] = {}
        for item in items:
            status = item.StatusName or "Unknown"
            by_status[status] = by_status.get(status, 0) + 1
        
        # Aggregate by warehouse
        by_warehouse: Dict[str, int] = {}
        for item in items:
            warehouse = item.StatusWarehouse.Name if item.StatusWarehouse else "Unknown"
            by_warehouse[warehouse] = by_warehouse.get(warehouse, 0) + 1
        
        return NefabStatisticsResponse(
            success=True,
            message="Statistics calculated",
            total_items=len(items),
            by_item_type=by_item_type,
            by_status=by_status,
            by_warehouse=by_warehouse,
            cached=all_items_response.cached
        )
    
    def clear_cache(self):
        """Clear all cached data."""
        self._response_cache.clear()
        self._cache_timestamps.clear()
        logger.info("Nefab cache cleared")
    
    async def test_connection(self) -> NefabServiceResponse:
        """
        Test API connection.
        
        Returns:
            NefabServiceResponse with connection status
        """
        try:
            # Make a minimal request
            response = await self.get_all_items(use_cache=False)
            
            if response.success:
                return NefabServiceResponse(
                    success=True,
                    message=f"Connected successfully. {response.total_count} items available.",
                    data={"total_items": response.total_count}
                )
            else:
                return NefabServiceResponse(
                    success=False,
                    message="Connection failed",
                    error=response.message
                )
        except Exception as e:
            return NefabServiceResponse(
                success=False,
                message="Connection test failed",
                error=str(e)
            )


# ==================== SERVICE FACTORY ====================

async def get_nefab_service() -> NefabService:
    """Get Nefab service instance."""
    return await NefabService.get_instance()

# Created and developed by Jai Singh
