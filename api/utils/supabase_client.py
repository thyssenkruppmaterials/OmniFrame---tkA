"""
Supabase utility functions and helpers.
Provides common database operations and query builders.

Also re-exports ``get_supabase_client`` from the canonical
``config.database`` module so that services that import from here
continue to work without a circular-import issue.
"""

from typing import Dict, List, Optional, Any
from supabase import Client
import logging

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Re-export adapter – keeps service imports working against one location.
# ---------------------------------------------------------------------------

async def get_supabase_client() -> Client:
    """Return the default Supabase client.

    Delegates to ``config.database.get_supabase_client`` (the canonical
    implementation) so callers that import from ``utils.supabase_client``
    keep working.
    """
    try:
        from ..config.database import get_supabase_client as _canonical
    except ImportError:
        from config.database import get_supabase_client as _canonical
    return await _canonical()


class SupabaseQueryBuilder:
    """Helper class for building complex Supabase queries."""
    
    def __init__(self, client: Client, table_name: str):
        self.client = client
        self.table_name = table_name
        self.query = None
    
    def select(self, columns: str = "*"):
        """Start a select query."""
        self.query = self.client.table(self.table_name).select(columns)
        return self
    
    def where(self, column: str, operator: str, value: Any):
        """Add a where condition."""
        if not self.query:
            raise ValueError("Must call select() first")
        
        if operator == "eq":
            self.query = self.query.eq(column, value)
        elif operator == "neq":
            self.query = self.query.neq(column, value)
        elif operator == "gt":
            self.query = self.query.gt(column, value)
        elif operator == "gte":
            self.query = self.query.gte(column, value)
        elif operator == "lt":
            self.query = self.query.lt(column, value)
        elif operator == "lte":
            self.query = self.query.lte(column, value)
        elif operator == "like":
            self.query = self.query.like(column, value)
        elif operator == "ilike":
            self.query = self.query.ilike(column, value)
        elif operator == "in":
            self.query = self.query.in_(column, value)
        else:
            raise ValueError(f"Unsupported operator: {operator}")
        
        return self
    
    def order(self, column: str, ascending: bool = True):
        """Add ordering."""
        if not self.query:
            raise ValueError("Must call select() first")
        
        self.query = self.query.order(column, desc=not ascending)
        return self
    
    def limit(self, count: int):
        """Add limit."""
        if not self.query:
            raise ValueError("Must call select() first")
        
        self.query = self.query.limit(count)
        return self
    
    def execute(self):
        """Execute the query."""
        if not self.query:
            raise ValueError("Must build a query first")
        
        try:
            return self.query.execute()
        except Exception as e:
            logger.error(f"Query execution failed: {str(e)}")
            raise


async def get_organization_data(
    client: Client, 
    organization_id: str, 
    table_name: str,
    columns: str = "*",
    filters: Optional[Dict[str, Any]] = None,
    order_by: Optional[str] = None,
    limit: Optional[int] = None
) -> List[Dict[str, Any]]:
    """
    Get organization-specific data with common filtering patterns.
    
    Args:
        client: Supabase client
        organization_id: Organization ID for RLS
        table_name: Table to query
        columns: Columns to select
        filters: Additional filters to apply
        order_by: Column to order by
        limit: Maximum number of records
    
    Returns:
        List of records
    """
    try:
        query = client.table(table_name).select(columns).eq("organization_id", organization_id)
        
        # Apply additional filters
        if filters:
            for column, value in filters.items():
                if isinstance(value, dict) and "operator" in value:
                    operator = value["operator"]
                    filter_value = value["value"]
                    
                    if operator == "eq":
                        query = query.eq(column, filter_value)
                    elif operator == "neq":
                        query = query.neq(column, filter_value)
                    elif operator == "gt":
                        query = query.gt(column, filter_value)
                    elif operator == "gte":
                        query = query.gte(column, filter_value)
                    elif operator == "lt":
                        query = query.lt(column, filter_value)
                    elif operator == "lte":
                        query = query.lte(column, filter_value)
                    elif operator == "like":
                        query = query.like(column, filter_value)
                    elif operator == "ilike":
                        query = query.ilike(column, filter_value)
                    elif operator == "in":
                        query = query.in_(column, filter_value)
                else:
                    # Simple equality filter
                    query = query.eq(column, value)
        
        # Apply ordering
        if order_by:
            if order_by.startswith("-"):
                query = query.order(order_by[1:], desc=True)
            else:
                query = query.order(order_by)
        
        # Apply limit
        if limit:
            query = query.limit(limit)
        
        result = query.execute()
        return result.data or []
        
    except Exception as e:
        logger.error(f"Failed to get organization data: {str(e)}")
        raise


async def execute_rpc_with_fallback(
    client: Client,
    function_name: str,
    parameters: Dict[str, Any],
    fallback_query: Optional[callable] = None
) -> Any:
    """
    Execute an RPC function with optional fallback to regular query.
    
    Args:
        client: Supabase client
        function_name: RPC function name
        parameters: Function parameters
        fallback_query: Function to execute if RPC fails
    
    Returns:
        Query result
    """
    try:
        result = client.rpc(function_name, parameters).execute()
        return result.data
    except Exception as e:
        logger.warning(f"RPC function {function_name} failed: {str(e)}")
        
        if fallback_query:
            try:
                return await fallback_query()
            except Exception as fallback_error:
                logger.error(f"Fallback query also failed: {str(fallback_error)}")
                raise fallback_error
        else:
            raise e


async def batch_insert(
    client: Client,
    table_name: str,
    records: List[Dict[str, Any]],
    batch_size: int = 1000,
    upsert: bool = False
) -> Dict[str, Any]:
    """
    Insert records in batches for better performance.
    
    Args:
        client: Supabase client
        table_name: Target table
        records: List of records to insert
        batch_size: Size of each batch
        upsert: Whether to use upsert (update on conflict)
    
    Returns:
        Summary of the operation
    """
    try:
        total_records = len(records)
        inserted_count = 0
        error_count = 0
        errors = []
        
        # Process in batches
        for i in range(0, total_records, batch_size):
            batch = records[i:i + batch_size]
            
            try:
                if upsert:
                    result = client.table(table_name).upsert(batch).execute()
                else:
                    result = client.table(table_name).insert(batch).execute()
                
                inserted_count += len(batch)
                
            except Exception as batch_error:
                error_count += len(batch)
                errors.append(f"Batch {i//batch_size + 1}: {str(batch_error)}")
                logger.error(f"Batch insert failed for batch {i//batch_size + 1}: {str(batch_error)}")
        
        return {
            "success": error_count == 0,
            "total_records": total_records,
            "inserted_count": inserted_count,
            "error_count": error_count,
            "errors": errors
        }
        
    except Exception as e:
        logger.error(f"Batch insert failed: {str(e)}")
        return {
            "success": False,
            "total_records": len(records),
            "inserted_count": 0,
            "error_count": len(records),
            "errors": [str(e)]
        }


async def get_table_stats(client: Client, table_name: str, organization_id: str) -> Dict[str, Any]:
    """
    Get basic statistics for a table.
    
    Args:
        client: Supabase client
        table_name: Table to analyze
        organization_id: Organization ID for filtering
    
    Returns:
        Dictionary with table statistics
    """
    try:
        # Get total count
        count_result = client.table(table_name).select(
            "id", count="exact"
        ).eq("organization_id", organization_id).execute()
        
        total_count = count_result.count if count_result.count else 0
        
        # Get recent activity (last 24 hours)
        from datetime import datetime, timedelta
        yesterday = (datetime.now() - timedelta(days=1)).isoformat()
        
        recent_result = client.table(table_name).select(
            "id", count="exact"
        ).eq("organization_id", organization_id).gte(
            "created_at", yesterday
        ).execute()
        
        recent_count = recent_result.count if recent_result.count else 0
        
        return {
            "table_name": table_name,
            "total_records": total_count,
            "recent_records_24h": recent_count,
            "organization_id": organization_id,
            "last_checked": datetime.now().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Failed to get table stats: {str(e)}")
        return {
            "table_name": table_name,
            "total_records": 0,
            "recent_records_24h": 0,
            "organization_id": organization_id,
            "error": str(e)
        }

