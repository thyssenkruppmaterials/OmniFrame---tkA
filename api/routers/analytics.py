# Created and developed by Jai Singh
"""
Analytics API endpoints providing advanced data insights.
Complements the existing frontend with Python-powered analytics.
"""

from datetime import datetime, timedelta
from typing import Optional, Literal
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse

try:
    from ..auth.supabase_auth import get_current_user, AuthenticatedUser
    from ..services.analytics import AnalyticsService
    from ..models.outbound import OutboundAnalytics
    from ..models.delivery import DeliveryStatusSummary
    from ..utils.error_responses import sanitized_error
    from ..config.database import db as _db
except ImportError:
    from auth.supabase_auth import get_current_user, AuthenticatedUser
    from services.analytics import AnalyticsService
    from models.outbound import OutboundAnalytics
    from models.delivery import DeliveryStatusSummary
    from utils.error_responses import sanitized_error
    from config.database import db as _db

router = APIRouter()


@router.get("/outbound/summary", response_model=OutboundAnalytics)
async def get_outbound_analytics_summary(
    current_user: AuthenticatedUser = Depends(get_current_user),
    date_from: Optional[datetime] = Query(None, description="Start date for analytics period"),
    date_to: Optional[datetime] = Query(None, description="End date for analytics period")
):
    """
    Get comprehensive outbound operations analytics.
    
    Provides advanced metrics including:
    - Status distribution and counts
    - Average processing times  
    - Top materials by volume
    - Daily throughput trends
    
    This complements the existing frontend data tables with actionable insights.
    """
    if not current_user.organization_id:
        raise HTTPException(status_code=403, detail="Organization access required")
    
    try:
        analytics_service = AnalyticsService(current_user.supabase_client, read_client=_db.read_client)
        analytics = await analytics_service.get_outbound_analytics(
            organization_id=current_user.organization_id,
            date_from=date_from,
            date_to=date_to
        )
        return analytics
        
    except Exception as e:
        raise sanitized_error(500, public_message="Analytics generation failed.", exc=e, context="outbound analytics")


@router.get("/delivery-status/summary", response_model=DeliveryStatusSummary)
async def get_delivery_status_summary(
    current_user: AuthenticatedUser = Depends(get_current_user),
    include_details: bool = Query(False, description="Include detailed breakdown")
):
    """
    Get delivery status summary with advanced metrics.
    
    Provides insights into:
    - Total deliveries and status distribution
    - Average days open for pending deliveries
    - Movement tracking statistics
    
    Enhances the delivery status manager with executive-level insights.
    """
    if not current_user.organization_id:
        raise HTTPException(status_code=403, detail="Organization access required")
    
    try:
        analytics_service = AnalyticsService(current_user.supabase_client, read_client=_db.read_client)
        summary = await analytics_service.get_delivery_status_summary(
            organization_id=current_user.organization_id,
            include_detailed_breakdown=include_details
        )
        return summary
        
    except Exception as e:
        raise sanitized_error(500, public_message="Summary generation failed.", exc=e, context="delivery status summary")


@router.get("/performance/{metric_type}")
async def get_performance_metrics(
    metric_type: Literal["throughput", "quality", "efficiency"],
    current_user: AuthenticatedUser = Depends(get_current_user)
):
    """
    Get performance metrics for specific operational areas.
    
    Metric Types:
    - throughput: Daily processing volumes and trends
    - quality: Compliance rates and error tracking  
    - efficiency: Processing time analysis and bottlenecks
    
    These metrics provide actionable insights for operational improvement.
    """
    if not current_user.organization_id:
        raise HTTPException(status_code=403, detail="Organization access required")
    
    try:
        analytics_service = AnalyticsService(current_user.supabase_client, read_client=_db.read_client)
        metrics = await analytics_service.get_performance_metrics(
            organization_id=current_user.organization_id,
            metric_type=metric_type
        )
        
        return JSONResponse(content={
            "metric_type": metric_type,
            "organization_id": current_user.organization_id,
            "generated_at": datetime.now().isoformat(),
            "metrics": metrics
        })
        
    except ValueError as e:
        raise sanitized_error(400, public_message="Invalid metric type or parameters.", exc=e, context="performance metrics")
    except Exception as e:
        raise sanitized_error(500, public_message="Metrics calculation failed.", exc=e, context="performance metrics")


@router.get("/trends/daily")
async def get_daily_trends(
    current_user: AuthenticatedUser = Depends(get_current_user),
    days: int = Query(30, ge=7, le=365, description="Number of days to analyze"),
    metric: Literal["orders", "completions", "efficiency"] = Query("orders", description="Trend metric to calculate")
):
    """
    Get daily trend analysis for operational metrics.
    
    Provides time-series data for visualization and trend analysis.
    Perfect for dashboards and executive reporting.
    """
    if not current_user.organization_id:
        raise HTTPException(status_code=403, detail="Organization access required")
    
    try:
        analytics_service = AnalyticsService(current_user.supabase_client, read_client=_db.read_client) 
        
        # Calculate date range
        date_to = datetime.now()
        date_from = date_to - timedelta(days=days)
        
        if metric == "orders":
            # Get order creation trends
            analytics = await analytics_service.get_outbound_analytics(
                organization_id=current_user.organization_id,
                date_from=date_from,
                date_to=date_to
            )
            trend_data = analytics.daily_throughput
        else:
            # For other metrics, get performance data
            metrics = await analytics_service.get_performance_metrics(
                organization_id=current_user.organization_id,
                metric_type="throughput"  # Default to throughput for trends
            )
            trend_data = metrics.get("daily_throughput", [])
        
        return JSONResponse(content={
            "metric": metric,
            "period_days": days,
            "date_from": date_from.isoformat(),
            "date_to": date_to.isoformat(),
            "trend_data": trend_data,
            "generated_at": datetime.now().isoformat()
        })
        
    except Exception as e:
        raise sanitized_error(500, public_message="Trend analysis failed.", exc=e, context="daily trends")


@router.get("/comparative")
async def get_comparative_analysis(
    current_user: AuthenticatedUser = Depends(get_current_user),
    period_1_days: int = Query(7, ge=1, le=90, description="First period length in days"),
    period_2_days: int = Query(7, ge=1, le=90, description="Second period length in days"),
    offset_days: int = Query(0, ge=0, le=365, description="Days to offset second period")
):
    """
    Compare performance between two time periods.
    
    Useful for:
    - Week-over-week comparisons
    - Before/after analysis of process changes
    - Seasonal trend analysis
    
    Returns percentage changes and key performance indicators.
    """
    if not current_user.organization_id:
        raise HTTPException(status_code=403, detail="Organization access required")
    
    try:
        analytics_service = AnalyticsService(current_user.supabase_client, read_client=_db.read_client)
        
        # Calculate periods
        now = datetime.now()
        
        # Period 1 (recent)
        period_1_end = now
        period_1_start = period_1_end - timedelta(days=period_1_days)
        
        # Period 2 (comparison, offset by offset_days)
        period_2_end = now - timedelta(days=offset_days)
        period_2_start = period_2_end - timedelta(days=period_2_days)
        
        # Get analytics for both periods
        period_1_analytics = await analytics_service.get_outbound_analytics(
            organization_id=current_user.organization_id,
            date_from=period_1_start,
            date_to=period_1_end
        )
        
        period_2_analytics = await analytics_service.get_outbound_analytics(
            organization_id=current_user.organization_id,
            date_from=period_2_start,
            date_to=period_2_end
        )
        
        # Calculate changes
        def calculate_change(current, previous):
            if previous == 0:
                return 100.0 if current > 0 else 0.0
            return ((current - previous) / previous) * 100
        
        comparison = {
            "total_deliveries_change": calculate_change(
                period_1_analytics.total_deliveries, 
                period_2_analytics.total_deliveries
            ),
            "completed_count_change": calculate_change(
                period_1_analytics.completed_count,
                period_2_analytics.completed_count
            ),
            "avg_processing_time_change": None,
            "period_1": {
                "start_date": period_1_start.isoformat(),
                "end_date": period_1_end.isoformat(),
                "total_deliveries": period_1_analytics.total_deliveries,
                "completed_count": period_1_analytics.completed_count,
                "avg_processing_time_hours": period_1_analytics.avg_processing_time_hours
            },
            "period_2": {
                "start_date": period_2_start.isoformat(),
                "end_date": period_2_end.isoformat(),
                "total_deliveries": period_2_analytics.total_deliveries,
                "completed_count": period_2_analytics.completed_count,
                "avg_processing_time_hours": period_2_analytics.avg_processing_time_hours
            }
        }
        
        # Calculate processing time change if both periods have data
        if (period_1_analytics.avg_processing_time_hours and 
            period_2_analytics.avg_processing_time_hours):
            comparison["avg_processing_time_change"] = calculate_change(
                period_1_analytics.avg_processing_time_hours,
                period_2_analytics.avg_processing_time_hours
            )
        
        return JSONResponse(content=comparison)
        
    except Exception as e:
        raise sanitized_error(500, public_message="Comparative analysis failed.", exc=e, context="comparative analysis")

# Created and developed by Jai Singh
