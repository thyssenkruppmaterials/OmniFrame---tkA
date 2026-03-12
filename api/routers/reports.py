"""
Reports API endpoints for data processing and export.
Provides advanced reporting capabilities that leverage Python's data processing strengths.
"""

import io
import csv
from datetime import datetime, timedelta
from typing import Optional, List, Literal
from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from fastapi.responses import StreamingResponse, JSONResponse
import pandas as pd

try:
    from ..auth.supabase_auth import get_current_user, AuthenticatedUser
    from ..services.analytics import AnalyticsService
    from ..utils.error_responses import sanitized_error
except ImportError:
    from auth.supabase_auth import get_current_user, AuthenticatedUser
    from services.analytics import AnalyticsService
    from api.utils.error_responses import sanitized_error

router = APIRouter()


@router.get("/outbound/export")
async def export_outbound_data(
    current_user: AuthenticatedUser = Depends(get_current_user),
    format: Literal["csv", "excel", "json"] = Query("csv", description="Export format"),
    date_from: Optional[datetime] = Query(None, description="Start date for export"),
    date_to: Optional[datetime] = Query(None, description="End date for export"),
    status_filter: Optional[str] = Query(None, description="Filter by status"),
    include_analytics: bool = Query(False, description="Include analytics summary")
):
    """
    Export outbound data with advanced filtering and formatting options.
    
    This endpoint demonstrates Python's superior data processing capabilities
    for large dataset exports that would be inefficient in the frontend.
    """
    if not current_user.organization_id:
        raise HTTPException(status_code=403, detail="Organization access required")
    
    try:
        # Build query
        query = current_user.supabase_client.table("outbound_to_data").select(
            "*"
        ).eq("organization_id", current_user.organization_id)
        
        # Apply filters
        if date_from:
            query = query.gte("created_at", date_from.isoformat())
        if date_to:
            query = query.lte("created_at", date_to.isoformat())
        if status_filter:
            query = query.eq("status", status_filter)
        
        result = query.execute()
        
        if not result.data:
            raise HTTPException(status_code=404, detail="No data found for the specified criteria")
        
        # Convert to DataFrame for processing
        df = pd.DataFrame(result.data)
        
        # Clean and format data
        df['created_at'] = pd.to_datetime(df['created_at']).dt.strftime('%Y-%m-%d %H:%M:%S')
        if 'packed_at' in df.columns:
            df['packed_at'] = pd.to_datetime(df['packed_at']).dt.strftime('%Y-%m-%d %H:%M:%S')
        
        # Generate filename
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"outbound_export_{timestamp}"
        
        if format == "csv":
            # CSV Export
            output = io.StringIO()
            df.to_csv(output, index=False)
            output.seek(0)
            
            return StreamingResponse(
                io.BytesIO(output.getvalue().encode()),
                media_type="text/csv",
                headers={"Content-Disposition": f"attachment; filename={filename}.csv"}
            )
            
        elif format == "excel":
            # Excel Export with multiple sheets if analytics included
            output = io.BytesIO()
            
            with pd.ExcelWriter(output, engine='openpyxl') as writer:
                df.to_excel(writer, sheet_name='Outbound Data', index=False)
                
                if include_analytics:
                    analytics_service = AnalyticsService(current_user.supabase_client)
                    analytics = await analytics_service.get_outbound_analytics(
                        organization_id=current_user.organization_id,
                        date_from=date_from,
                        date_to=date_to
                    )
                    
                    # Create analytics summary sheet
                    analytics_data = {
                        'Metric': [
                            'Total Deliveries', 'Pending Count', 'Processing Count',
                            'Packed Count', 'Final Packed Count', 'Shipped Count',
                            'Completed Count', 'Avg Processing Time (hours)'
                        ],
                        'Value': [
                            analytics.total_deliveries, analytics.pending_count,
                            analytics.processing_count, analytics.packed_count,
                            analytics.final_packed_count, analytics.shipped_count,
                            analytics.completed_count, analytics.avg_processing_time_hours or 0
                        ]
                    }
                    
                    analytics_df = pd.DataFrame(analytics_data)
                    analytics_df.to_excel(writer, sheet_name='Analytics', index=False)
            
            output.seek(0)
            return StreamingResponse(
                output,
                media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                headers={"Content-Disposition": f"attachment; filename={filename}.xlsx"}
            )
            
        else:  # JSON format
            return JSONResponse(content={
                "export_info": {
                    "generated_at": datetime.now().isoformat(),
                    "record_count": len(df),
                    "filters_applied": {
                        "date_from": date_from.isoformat() if date_from else None,
                        "date_to": date_to.isoformat() if date_to else None,
                        "status_filter": status_filter
                    }
                },
                "data": result.data
            })
            
    except HTTPException:
        raise
    except Exception as e:
        raise sanitized_error(500, public_message="Export generation failed.", exc=e, context="outbound export")


@router.get("/delivery-status/export")
async def export_delivery_status_data(
    current_user: AuthenticatedUser = Depends(get_current_user),
    format: Literal["csv", "excel"] = Query("csv", description="Export format"),
    include_status_join: bool = Query(True, description="Include outbound status data")
):
    """
    Export comprehensive delivery status data with optional outbound status joining.
    
    This demonstrates advanced data joining and processing capabilities.
    """
    if not current_user.organization_id:
        raise HTTPException(status_code=403, detail="Organization access required")
    
    try:
        # Get delivery data
        delivery_result = current_user.supabase_client.table("rr_all_deliveries").select(
            "*"
        ).eq("organization_id", current_user.organization_id).execute()
        
        if not delivery_result.data:
            raise HTTPException(status_code=404, detail="No delivery data found")
        
        df_deliveries = pd.DataFrame(delivery_result.data)
        
        if include_status_join:
            # Get outbound status data
            outbound_result = current_user.supabase_client.table("outbound_to_data").select(
                "delivery, status, packed_at, final_packed_at, shipped_at"
            ).eq("organization_id", current_user.organization_id).execute()
            
            if outbound_result.data:
                df_outbound = pd.DataFrame(outbound_result.data)
                
                # Perform left join on delivery number (handling leading zeros)
                df_deliveries['delivery_clean'] = df_deliveries['delivery'].str.lstrip('0')
                df_outbound['delivery_clean'] = df_outbound['delivery'].str.lstrip('0')
                
                df_merged = df_deliveries.merge(
                    df_outbound[['delivery_clean', 'status', 'packed_at', 'final_packed_at', 'shipped_at']],
                    on='delivery_clean',
                    how='left'
                )
                
                # Drop the temporary clean delivery column
                df_merged = df_merged.drop('delivery_clean', axis=1)
                df = df_merged
            else:
                df = df_deliveries
        else:
            df = df_deliveries
        
        # Add calculated columns
        df['delivery_creation_date'] = pd.to_datetime(df['delivery_creation_date'])
        df['days_open'] = df.apply(lambda row: 
            (datetime.now().date() - row['delivery_creation_date'].date()).days 
            if pd.notnull(row['delivery_creation_date']) and pd.isnull(row['actual_goods_movement_date'])
            else None, axis=1
        )
        
        # Generate filename
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"delivery_status_export_{timestamp}"
        
        if format == "csv":
            output = io.StringIO()
            df.to_csv(output, index=False)
            output.seek(0)
            
            return StreamingResponse(
                io.BytesIO(output.getvalue().encode()),
                media_type="text/csv",
                headers={"Content-Disposition": f"attachment; filename={filename}.csv"}
            )
        else:  # Excel
            output = io.BytesIO()
            
            with pd.ExcelWriter(output, engine='openpyxl') as writer:
                df.to_excel(writer, sheet_name='Delivery Status', index=False)
                
                # Add summary sheet
                summary_data = {
                    'Metric': ['Total Deliveries', 'With Status', 'Without Status', 'Avg Days Open'],
                    'Value': [
                        len(df),
                        len(df[df['status'].notna()]) if 'status' in df.columns else 0,
                        len(df[df['status'].isna()]) if 'status' in df.columns else len(df),
                        df['days_open'].mean() if df['days_open'].notna().any() else 0
                    ]
                }
                
                summary_df = pd.DataFrame(summary_data)
                summary_df.to_excel(writer, sheet_name='Summary', index=False)
            
            output.seek(0)
            return StreamingResponse(
                output,
                media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                headers={"Content-Disposition": f"attachment; filename={filename}.xlsx"}
            )
            
    except HTTPException:
        raise
    except Exception as e:
        raise sanitized_error(500, public_message="Delivery status export failed.", exc=e, context="delivery status export")


@router.post("/custom-report")
async def generate_custom_report(
    background_tasks: BackgroundTasks,
    current_user: AuthenticatedUser = Depends(get_current_user),
    report_type: Literal["performance", "compliance", "trend_analysis"] = Query(..., description="Type of custom report"),
    date_from: Optional[datetime] = Query(None, description="Start date for report"),
    date_to: Optional[datetime] = Query(None, description="End date for report")
):
    """
    Generate custom reports using background processing.
    
    This endpoint demonstrates FastAPI's background task capabilities
    for generating complex reports without blocking the user interface.
    """
    if not current_user.organization_id:
        raise HTTPException(status_code=403, detail="Organization access required")
    
    # Generate unique report ID
    report_id = f"{report_type}_{current_user.organization_id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    
    async def generate_report_task():
        """Background task for report generation."""
        try:
            analytics_service = AnalyticsService(current_user.supabase_client)
            
            if report_type == "performance":
                # Generate comprehensive performance report
                throughput_metrics = await analytics_service.get_performance_metrics(
                    organization_id=current_user.organization_id,
                    metric_type="throughput"
                )
                quality_metrics = await analytics_service.get_performance_metrics(
                    organization_id=current_user.organization_id,
                    metric_type="quality"
                )
                efficiency_metrics = await analytics_service.get_performance_metrics(
                    organization_id=current_user.organization_id,
                    metric_type="efficiency"
                )
                
                # Store report data (in a real implementation, this would be saved to a file or database)
                report_data = {
                    "report_id": report_id,
                    "type": report_type,
                    "generated_at": datetime.now().isoformat(),
                    "metrics": {
                        "throughput": throughput_metrics,
                        "quality": quality_metrics,
                        "efficiency": efficiency_metrics
                    }
                }
                
                # TODO: Save report_data to storage system
                
            elif report_type == "compliance":
                # Generate compliance report
                quality_metrics = await analytics_service.get_performance_metrics(
                    organization_id=current_user.organization_id,
                    metric_type="quality"
                )
                
                report_data = {
                    "report_id": report_id,
                    "type": report_type,
                    "generated_at": datetime.now().isoformat(),
                    "compliance_data": quality_metrics
                }
                
            else:  # trend_analysis
                # Generate trend analysis report
                analytics = await analytics_service.get_outbound_analytics(
                    organization_id=current_user.organization_id,
                    date_from=date_from,
                    date_to=date_to
                )
                
                report_data = {
                    "report_id": report_id,
                    "type": report_type,
                    "generated_at": datetime.now().isoformat(),
                    "trend_data": analytics.dict()
                }
                
        except Exception as e:
            # TODO: Log error and mark report as failed
            print(f"Report generation failed: {str(e)}")
    
    # Add background task
    background_tasks.add_task(generate_report_task)
    
    return JSONResponse(content={
        "report_id": report_id,
        "status": "queued",
        "message": "Report generation started. Check status using the report ID.",
        "estimated_completion_minutes": 5
    })


@router.get("/status/{report_id}")
async def get_report_status(
    report_id: str,
    current_user: AuthenticatedUser = Depends(get_current_user)
):
    """
    Check the status of a custom report generation.
    
    In a full implementation, this would query a reports database or job queue.
    """
    if not current_user.organization_id:
        raise HTTPException(status_code=403, detail="Organization access required")
    
    # TODO: Implement actual report status checking
    # For now, return a mock response
    return JSONResponse(content={
        "report_id": report_id,
        "status": "completed",
        "generated_at": datetime.now().isoformat(),
        "download_url": f"/api/reports/download/{report_id}",
        "expires_at": (datetime.now() + timedelta(hours=24)).isoformat()
    })


@router.get("/templates")
async def get_report_templates(
    current_user: AuthenticatedUser = Depends(get_current_user)
):
    """
    Get available report templates and their configurations.
    
    This enables dynamic report generation based on predefined templates.
    """
    templates = [
        {
            "id": "executive_summary",
            "name": "Executive Summary",
            "description": "High-level metrics and KPIs for leadership reporting",
            "estimated_time_minutes": 2,
            "output_formats": ["pdf", "excel"],
            "required_permissions": ["analytics:read"]
        },
        {
            "id": "operational_detail",
            "name": "Operational Details",
            "description": "Detailed operational metrics for process improvement",
            "estimated_time_minutes": 5,
            "output_formats": ["excel", "csv"],
            "required_permissions": ["analytics:read", "outbound:read"]
        },
        {
            "id": "compliance_audit",
            "name": "Compliance Audit",
            "description": "8130-3 compliance tracking and audit trail",
            "estimated_time_minutes": 3,
            "output_formats": ["pdf", "excel"],
            "required_permissions": ["analytics:read", "audit:read"]
        }
    ]
    
    return JSONResponse(content={"templates": templates})

# Developer and Creator: Jai Singh

