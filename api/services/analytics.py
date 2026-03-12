"""
Analytics service for advanced data processing and metrics.
Provides analytics capabilities that complement the existing TypeScript frontend.
"""

import asyncio
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
from supabase import Client
import pandas as pd
import logging

try:
    from ..models.outbound import OutboundAnalytics
    from ..models.delivery import DeliveryStatusSummary
except ImportError:
    from models.outbound import OutboundAnalytics
    from models.delivery import DeliveryStatusSummary

logger = logging.getLogger(__name__)


class AnalyticsService:
    """Service for generating advanced analytics and insights."""
    
    def __init__(self, supabase_client: Client):
        self.client = supabase_client
    
    async def get_outbound_analytics(
        self, 
        organization_id: str,
        date_from: Optional[datetime] = None,
        date_to: Optional[datetime] = None
    ) -> OutboundAnalytics:
        """Generate comprehensive outbound analytics."""
        try:
            # Default to last 30 days if no dates provided
            if not date_from:
                date_from = datetime.now() - timedelta(days=30)
            if not date_to:
                date_to = datetime.now()
            
            # Build query with date filter
            query = self.client.table("outbound_to_data").select(
                "id, delivery, material, material_description, status, "
                "created_at, packed_at, final_packed_at, shipped_at, "
                "source_target_qty"
            ).eq("organization_id", organization_id)
            
            # Add date filters
            query = query.gte("created_at", date_from.isoformat())
            query = query.lte("created_at", date_to.isoformat())
            
            result = query.execute()
            
            if not result.data:
                return OutboundAnalytics(
                    total_deliveries=0,
                    pending_count=0,
                    processing_count=0,
                    packed_count=0,
                    final_packed_count=0,
                    shipped_count=0,
                    completed_count=0
                )
            
            # Convert to pandas for advanced processing
            df = pd.DataFrame(result.data)
            
            # Calculate status counts
            status_counts = df['status'].value_counts().to_dict()
            
            # Calculate processing times
            processing_times = []
            for _, row in df.iterrows():
                if row['packed_at'] and row['created_at']:
                    created = pd.to_datetime(row['created_at'])
                    packed = pd.to_datetime(row['packed_at'])
                    hours = (packed - created).total_seconds() / 3600
                    processing_times.append(hours)
            
            avg_processing_time = sum(processing_times) / len(processing_times) if processing_times else None
            
            # Top materials analysis
            material_counts = df.groupby(['material', 'material_description']).size().reset_index(name='count')
            top_materials = material_counts.nlargest(10, 'count').to_dict('records')
            
            # Daily throughput
            df['created_date'] = pd.to_datetime(df['created_at']).dt.date
            daily_throughput = df.groupby('created_date').size().reset_index(name='count')
            daily_throughput['date'] = daily_throughput['created_date'].astype(str)
            
            return OutboundAnalytics(
                total_deliveries=len(df),
                pending_count=status_counts.get('pending', 0),
                processing_count=status_counts.get('processing', 0),
                packed_count=status_counts.get('packed', 0),
                final_packed_count=status_counts.get('final_packed', 0),
                shipped_count=status_counts.get('shipped', 0),
                completed_count=status_counts.get('completed', 0),
                avg_processing_time_hours=avg_processing_time,
                top_materials=top_materials,
                daily_throughput=daily_throughput[['date', 'count']].to_dict('records')
            )
            
        except Exception as e:
            logger.error(f"Error generating outbound analytics: {str(e)}")
            raise
    
    async def get_delivery_status_summary(
        self, 
        organization_id: str,
        include_detailed_breakdown: bool = False
    ) -> DeliveryStatusSummary:
        """Generate delivery status summary with advanced metrics."""
        try:
            # Get delivery data with status information
            query = """
                SELECT 
                    d.id,
                    d.delivery,
                    d.delivery_creation_date,
                    d.actual_goods_movement_date,
                    COALESCE(o.status, 'no_status') as status,
                    CASE 
                        WHEN d.actual_goods_movement_date IS NULL 
                        THEN DATE_PART('day', CURRENT_DATE - d.delivery_creation_date)
                        ELSE NULL 
                    END as days_open
                FROM rr_all_deliveries d
                LEFT JOIN outbound_to_data o ON LTRIM(d.delivery, '0') = o.delivery
                WHERE d.organization_id = %s
            """
            
            # Execute raw SQL query (using RPC would be better in production)
            result = self.client.rpc('get_delivery_status_summary', {
                'org_id': organization_id
            }).execute()
            
            if not result.data:
                return DeliveryStatusSummary(
                    total_deliveries=0,
                    status_breakdown={},
                    deliveries_with_movement=0,
                    deliveries_without_movement=0
                )
            
            # Process the results
            df = pd.DataFrame(result.data) if result.data else pd.DataFrame()
            
            if df.empty:
                return DeliveryStatusSummary(
                    total_deliveries=0,
                    status_breakdown={},
                    deliveries_with_movement=0,
                    deliveries_without_movement=0
                )
            
            # Calculate metrics
            total_deliveries = len(df)
            status_breakdown = df['status'].value_counts().to_dict()
            
            # Calculate movement statistics
            deliveries_with_movement = len(df[df['actual_goods_movement_date'].notna()])
            deliveries_without_movement = total_deliveries - deliveries_with_movement
            
            # Calculate average days open (only for deliveries without movement)
            open_deliveries = df[df['days_open'].notna()]
            avg_days_open = open_deliveries['days_open'].mean() if not open_deliveries.empty else None
            
            return DeliveryStatusSummary(
                total_deliveries=total_deliveries,
                status_breakdown=status_breakdown,
                avg_days_open=avg_days_open,
                deliveries_with_movement=deliveries_with_movement,
                deliveries_without_movement=deliveries_without_movement
            )
            
        except Exception as e:
            logger.error(f"Error generating delivery status summary: {str(e)}")
            # Fallback to basic query if RPC fails
            try:
                result = self.client.table("rr_all_deliveries").select(
                    "id, delivery, actual_goods_movement_date"
                ).eq("organization_id", organization_id).execute()
                
                total_deliveries = len(result.data) if result.data else 0
                
                return DeliveryStatusSummary(
                    total_deliveries=total_deliveries,
                    status_breakdown={"unknown": total_deliveries},
                    deliveries_with_movement=0,
                    deliveries_without_movement=total_deliveries
                )
            except:
                raise Exception("Unable to fetch delivery data")
    
    async def get_performance_metrics(
        self, 
        organization_id: str,
        metric_type: str = "throughput"
    ) -> Dict[str, Any]:
        """Get performance metrics for different aspects of the logistics operation."""
        try:
            if metric_type == "throughput":
                return await self._get_throughput_metrics(organization_id)
            elif metric_type == "quality":
                return await self._get_quality_metrics(organization_id)
            elif metric_type == "efficiency":
                return await self._get_efficiency_metrics(organization_id)
            else:
                raise ValueError(f"Unsupported metric type: {metric_type}")
                
        except Exception as e:
            logger.error(f"Error getting performance metrics: {str(e)}")
            raise
    
    async def _get_throughput_metrics(self, organization_id: str) -> Dict[str, Any]:
        """Calculate throughput metrics."""
        # Get data for the last 7 days
        date_from = datetime.now() - timedelta(days=7)
        
        result = self.client.table("outbound_to_data").select(
            "created_at, packed_at, final_packed_at, shipped_at"
        ).eq("organization_id", organization_id).gte(
            "created_at", date_from.isoformat()
        ).execute()
        
        if not result.data:
            return {"daily_throughput": [], "avg_daily_throughput": 0}
        
        df = pd.DataFrame(result.data)
        df['created_date'] = pd.to_datetime(df['created_at']).dt.date
        
        daily_counts = df.groupby('created_date').size().reset_index(name='count')
        avg_throughput = daily_counts['count'].mean()
        
        return {
            "daily_throughput": daily_counts.to_dict('records'),
            "avg_daily_throughput": avg_throughput,
            "total_last_7_days": len(df)
        }
    
    async def _get_quality_metrics(self, organization_id: str) -> Dict[str, Any]:
        """Calculate quality metrics based on 8130-3 compliance and errors."""
        result = self.client.table("outbound_to_data").select(
            "requires_8130_3, has_8130_3, is_8130_3_signed, status"
        ).eq("organization_id", organization_id).execute()
        
        if not result.data:
            return {"compliance_rate": 0, "error_rate": 0}
        
        df = pd.DataFrame(result.data)
        
        # Calculate 8130-3 compliance
        required_8130_3 = df[df['requires_8130_3'] == True]
        if not required_8130_3.empty:
            compliant = required_8130_3[
                (required_8130_3['has_8130_3'] == True) & 
                (required_8130_3['is_8130_3_signed'] == True)
            ]
            compliance_rate = len(compliant) / len(required_8130_3) * 100
        else:
            compliance_rate = 100  # No requirements = 100% compliance
        
        # Error rate (cancelled orders)
        cancelled = len(df[df['status'] == 'cancelled'])
        error_rate = cancelled / len(df) * 100 if len(df) > 0 else 0
        
        return {
            "compliance_rate": compliance_rate,
            "error_rate": error_rate,
            "total_requiring_8130_3": len(required_8130_3) if not required_8130_3.empty else 0
        }
    
    async def _get_efficiency_metrics(self, organization_id: str) -> Dict[str, Any]:
        """Calculate efficiency metrics based on processing times."""
        result = self.client.table("outbound_to_data").select(
            "created_at, packed_at, final_packed_at, shipped_at"
        ).eq("organization_id", organization_id).limit(1000).execute()
        
        if not result.data:
            return {"avg_pack_time_hours": 0, "avg_ship_time_hours": 0}
        
        df = pd.DataFrame(result.data)
        
        # Calculate pack time efficiency
        packed_orders = df[df['packed_at'].notna() & df['created_at'].notna()]
        if not packed_orders.empty:
            packed_orders['pack_time'] = (
                pd.to_datetime(packed_orders['packed_at']) - 
                pd.to_datetime(packed_orders['created_at'])
            ).dt.total_seconds() / 3600
            avg_pack_time = packed_orders['pack_time'].mean()
        else:
            avg_pack_time = 0
        
        # Calculate ship time efficiency  
        shipped_orders = df[df['shipped_at'].notna() & df['final_packed_at'].notna()]
        if not shipped_orders.empty:
            shipped_orders['ship_time'] = (
                pd.to_datetime(shipped_orders['shipped_at']) - 
                pd.to_datetime(shipped_orders['final_packed_at'])
            ).dt.total_seconds() / 3600
            avg_ship_time = shipped_orders['ship_time'].mean()
        else:
            avg_ship_time = 0
        
        return {
            "avg_pack_time_hours": avg_pack_time,
            "avg_ship_time_hours": avg_ship_time,
            "total_analyzed": len(df)
        }

# Developer and Creator: Jai Singh

