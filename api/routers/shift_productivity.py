"""
Shift Productivity API endpoints.
Provides backend API layer for shift productivity data, replacing direct Supabase calls from frontend.

Created: January 28, 2026
Author: Jai Singh

This router exposes the same RPC functions used by the frontend service but through
authenticated API endpoints, ensuring consistent architecture and security.
"""

from fastapi import APIRouter, Depends, HTTPException, status, Query
from typing import Optional, List, Dict, Any
from datetime import date, datetime
from pydantic import BaseModel
import logging

import sys
import os

# Add the parent directory to sys.path to ensure imports work
current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)
if parent_dir not in sys.path:
    sys.path.insert(0, parent_dir)

try:
    from ..auth.supabase_auth import (
        get_current_user,
        AuthenticatedUser,
    )
    from ..config.settings import settings
    from ..utils.error_responses import sanitized_error
except ImportError:
    try:
        from auth.supabase_auth import (
            get_current_user,
            AuthenticatedUser,
        )
        from config.settings import settings
        from utils.error_responses import sanitized_error
    except ImportError:
        from api.auth.supabase_auth import (
            get_current_user,
            AuthenticatedUser,
        )
        from api.config.settings import settings
        from api.utils.error_responses import sanitized_error

from supabase import create_client, Client

logger = logging.getLogger(__name__)
logger.info("Shift Productivity router module loaded successfully")

router = APIRouter(tags=["shift-productivity"])


# ==============================================================================
# SUPABASE CLIENT
# ==============================================================================

def get_supabase_client() -> Client:
    """Get Supabase client with service role key for RPC calls."""
    if not settings.supabase_url:
        logger.error("SUPABASE_URL not configured")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Supabase URL not configured"
        )
    
    if not settings.supabase_service_role_key:
        logger.error("SUPABASE_SERVICE_ROLE_KEY not configured")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Supabase service role key not configured"
        )
    
    try:
        client = create_client(
            settings.supabase_url,
            settings.supabase_service_role_key
        )
        return client
    except Exception as e:
        logger.error(f"Failed to create Supabase client: {str(e)}")
        raise sanitized_error(
            500,
            public_message="Failed to initialize Supabase client.",
            exc=e,
            context="Supabase client creation"
        )


# ==============================================================================
# PYDANTIC MODELS - Request/Response
# ==============================================================================

class ProductivityCounts(BaseModel):
    """Productivity counts for a single user."""
    user_id: str
    inbound_scans: int = 0
    put_aways: int = 0
    picking: int = 0
    packed: int = 0
    shipped: int = 0
    final_packed: int = 0
    putbacks: int = 0
    cycle_counts: int = 0
    total_tasks: int = 0


class ActivityEvent(BaseModel):
    """Activity event for timeline visualization."""
    user_id: str
    event_type: str
    event_timestamp: str
    area: Optional[str] = None
    activity_label: Optional[str] = None
    display_color: Optional[str] = None
    activity_category: Optional[str] = None


class ShiftAssignmentDetail(BaseModel):
    """Detailed shift assignment with user and position info."""
    assignment_id: str
    user_id: str
    user_full_name: Optional[str] = None
    user_email: Optional[str] = None
    user_avatar_url: Optional[str] = None
    user_status: Optional[str] = None
    user_phone_number: Optional[str] = None
    user_created_at: Optional[str] = None
    position_id: Optional[str] = None
    position_title: Optional[str] = None
    position_type: Optional[str] = None
    position_level: Optional[int] = None
    is_supervisory: Optional[bool] = None
    department: Optional[str] = None
    working_area_id: Optional[str] = None
    area_name: Optional[str] = None
    area_code: Optional[str] = None
    area_type: Optional[str] = None
    shift_schedule_id: Optional[str] = None
    schedule_name: Optional[str] = None
    shift_start_time: Optional[str] = None
    shift_end_time: Optional[str] = None
    break_start_time: Optional[str] = None
    break_duration_minutes: Optional[int] = None
    breaks: Optional[List[Dict[str, Any]]] = None
    supervisor_id: Optional[str] = None
    supervisor_name: Optional[str] = None
    supervisor_avatar: Optional[str] = None
    team_lead_id: Optional[str] = None
    team_lead_name: Optional[str] = None
    team_lead_avatar: Optional[str] = None
    assignment_type: Optional[str] = None
    shift_pattern: Optional[str] = None
    productivity_target: Optional[float] = None
    inline_shift_schedule: Optional[Dict[str, Any]] = None


class WeeklySummaryDay(BaseModel):
    """Weekly summary data for a single day."""
    day_date: str
    day_name: str
    total_tasks: int = 0
    total_associates: int = 0
    active_associates: int = 0
    inbound_scans: int = 0
    put_aways: int = 0
    picking: int = 0
    packed: int = 0
    shipped: int = 0
    final_packed: int = 0
    putbacks: int = 0
    cycle_counts: int = 0


class TeamProductivityResponse(BaseModel):
    """Response model for team productivity endpoint."""
    date: str
    productivity_counts: List[ProductivityCounts]
    total_tasks: int
    active_associates: int


class UserProductivityResponse(BaseModel):
    """Response model for individual user productivity."""
    user_id: str
    date: str
    productivity: ProductivityCounts
    events: List[ActivityEvent]


class WeeklyTrendResponse(BaseModel):
    """Response model for weekly productivity trend."""
    end_date: str
    days: List[WeeklySummaryDay]
    total_tasks: int
    average_daily_tasks: float


class ActivityEventsResponse(BaseModel):
    """Response model for activity events."""
    date: str
    events: List[ActivityEvent]
    total_events: int


class ShiftAssignmentsResponse(BaseModel):
    """Response model for shift assignments."""
    organization_id: str
    assignments: List[ShiftAssignmentDetail]
    total_assignments: int


# ==============================================================================
# UTILITY FUNCTIONS
# ==============================================================================

def get_utc_boundaries_for_date(date_string: str, timezone: str = "America/New_York") -> tuple[str, str]:
    """
    Convert date boundaries in a timezone to UTC for database queries.
    
    Args:
        date_string: Date in YYYY-MM-DD format
        timezone: IANA timezone identifier (default: America/New_York)
    
    Returns:
        Tuple of (start_utc, end_utc) ISO strings
    """
    from datetime import datetime, timedelta
    import pytz
    
    try:
        tz = pytz.timezone(timezone)
    except Exception:
        tz = pytz.timezone("America/New_York")
    
    # Parse the date
    target_date = datetime.strptime(date_string, "%Y-%m-%d")
    
    # Create start of day in the target timezone
    local_start = tz.localize(target_date.replace(hour=0, minute=0, second=0, microsecond=0))
    local_end = tz.localize(target_date.replace(hour=23, minute=59, second=59, microsecond=999999))
    
    # Convert to UTC
    utc_start = local_start.astimezone(pytz.UTC)
    utc_end = local_end.astimezone(pytz.UTC)
    
    return utc_start.isoformat(), utc_end.isoformat()


# ==============================================================================
# ENDPOINTS
# ==============================================================================

@router.get("/health")
async def shift_productivity_health_check():
    """Health check for shift productivity endpoints."""
    try:
        supabase = get_supabase_client()
        return {
            "status": "healthy",
            "service": "shift-productivity",
            "supabase": "connected",
            "timestamp": datetime.utcnow().isoformat()
        }
    except Exception as e:
        logger.error(f"Shift productivity health check failed: {str(e)}")
        return {
            "status": "unhealthy",
            "service": "shift-productivity",
            "error": str(e),
            "timestamp": datetime.utcnow().isoformat()
        }


@router.get("/team", response_model=TeamProductivityResponse)
async def get_team_productivity(
    target_date: Optional[date] = Query(None, description="Target date for productivity data (YYYY-MM-DD)"),
    timezone: str = Query("America/New_York", description="IANA timezone identifier"),
    current_user: AuthenticatedUser = Depends(get_current_user)
):
    """
    Get team productivity counts for a specific date.
    
    Returns aggregated productivity counts for all team members in the user's organization.
    Uses the get_team_productivity_counts RPC function for optimized batch querying.
    """
    try:
        if not current_user.organization_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="User does not have an organization assigned"
            )
        
        # Default to today if no date provided
        if target_date is None:
            target_date = date.today()
        
        date_string = target_date.isoformat()
        start_utc, end_utc = get_utc_boundaries_for_date(date_string, timezone)
        
        logger.info(f"Fetching team productivity for org {current_user.organization_id} on {date_string}")
        
        supabase = get_supabase_client()
        
        # Call the RPC function
        result = supabase.rpc('get_team_productivity_counts', {
            'p_organization_id': current_user.organization_id,
            'p_start_date': start_utc,
            'p_end_date': end_utc,
        }).execute()
        
        if result.data is None:
            result_data = []
        else:
            result_data = result.data
        
        # Transform to response model
        productivity_counts = []
        total_tasks = 0
        users_with_tasks = set()
        
        for row in result_data:
            count = ProductivityCounts(
                user_id=row.get('user_id', ''),
                inbound_scans=row.get('inbound_scans', 0),
                put_aways=row.get('put_aways', 0),
                picking=row.get('picking', 0),
                packed=row.get('packed', 0),
                shipped=row.get('shipped', 0),
                final_packed=row.get('final_packed', 0),
                putbacks=row.get('putbacks', 0),
                cycle_counts=row.get('cycle_counts', 0),
                total_tasks=row.get('total_tasks', 0),
            )
            productivity_counts.append(count)
            total_tasks += count.total_tasks
            if count.total_tasks > 0:
                users_with_tasks.add(count.user_id)
        
        logger.info(f"Retrieved productivity for {len(productivity_counts)} associates, {total_tasks} total tasks")
        
        return TeamProductivityResponse(
            date=date_string,
            productivity_counts=productivity_counts,
            total_tasks=total_tasks,
            active_associates=len(users_with_tasks)
        )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get team productivity: {str(e)}")
        raise sanitized_error(
            500,
            public_message="Failed to fetch team productivity.",
            exc=e,
            context="team productivity"
        )


@router.get("/user/{user_id}", response_model=UserProductivityResponse)
async def get_user_productivity(
    user_id: str,
    target_date: Optional[date] = Query(None, description="Target date for productivity data (YYYY-MM-DD)"),
    timezone: str = Query("America/New_York", description="IANA timezone identifier"),
    current_user: AuthenticatedUser = Depends(get_current_user)
):
    """
    Get productivity data for a specific user.
    
    Returns productivity counts and activity events for a single user.
    """
    try:
        if not current_user.organization_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="User does not have an organization assigned"
            )
        
        # Default to today if no date provided
        if target_date is None:
            target_date = date.today()
        
        date_string = target_date.isoformat()
        start_utc, end_utc = get_utc_boundaries_for_date(date_string, timezone)
        
        logger.info(f"Fetching productivity for user {user_id} on {date_string}")
        
        supabase = get_supabase_client()
        
        # Get productivity counts
        counts_result = supabase.rpc('get_team_productivity_counts', {
            'p_organization_id': current_user.organization_id,
            'p_start_date': start_utc,
            'p_end_date': end_utc,
        }).execute()
        
        # Find the user's counts
        user_counts = None
        for row in (counts_result.data or []):
            if row.get('user_id') == user_id:
                user_counts = row
                break
        
        if user_counts is None:
            user_counts = {
                'user_id': user_id,
                'inbound_scans': 0,
                'put_aways': 0,
                'picking': 0,
                'packed': 0,
                'shipped': 0,
                'final_packed': 0,
                'putbacks': 0,
                'cycle_counts': 0,
                'total_tasks': 0,
            }
        
        # Get activity events
        events_result = supabase.rpc('get_team_activity_events', {
            'p_organization_id': current_user.organization_id,
            'p_start_date': start_utc,
            'p_end_date': end_utc,
        }).execute()
        
        # Filter events for this user
        user_events = []
        for row in (events_result.data or []):
            if row.get('user_id') == user_id:
                user_events.append(ActivityEvent(
                    user_id=row.get('user_id', ''),
                    event_type=row.get('event_type', ''),
                    event_timestamp=row.get('event_timestamp', ''),
                    area=row.get('area'),
                    activity_label=row.get('activity_label'),
                    display_color=row.get('display_color'),
                    activity_category=row.get('activity_category'),
                ))
        
        # Sort events by timestamp
        user_events.sort(key=lambda e: e.event_timestamp)
        
        return UserProductivityResponse(
            user_id=user_id,
            date=date_string,
            productivity=ProductivityCounts(
                user_id=user_counts.get('user_id', user_id),
                inbound_scans=user_counts.get('inbound_scans', 0),
                put_aways=user_counts.get('put_aways', 0),
                picking=user_counts.get('picking', 0),
                packed=user_counts.get('packed', 0),
                shipped=user_counts.get('shipped', 0),
                final_packed=user_counts.get('final_packed', 0),
                putbacks=user_counts.get('putbacks', 0),
                cycle_counts=user_counts.get('cycle_counts', 0),
                total_tasks=user_counts.get('total_tasks', 0),
            ),
            events=user_events
        )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get user productivity: {str(e)}")
        raise sanitized_error(
            500,
            public_message="Failed to fetch user productivity.",
            exc=e,
            context="user productivity"
        )


@router.get("/weekly-trend", response_model=WeeklyTrendResponse)
async def get_weekly_trend(
    end_date: Optional[date] = Query(None, description="End date for weekly trend (YYYY-MM-DD)"),
    timezone: str = Query("America/New_York", description="IANA timezone identifier"),
    current_user: AuthenticatedUser = Depends(get_current_user)
):
    """
    Get weekly productivity trend.
    
    Returns 7 days of productivity summary data ending on the specified date.
    Uses the get_weekly_productivity_summary RPC function for optimized querying.
    """
    try:
        if not current_user.organization_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="User does not have an organization assigned"
            )
        
        # Default to today if no date provided
        if end_date is None:
            end_date = date.today()
        
        date_string = end_date.isoformat()
        
        logger.info(f"Fetching weekly trend for org {current_user.organization_id} ending {date_string}")
        
        supabase = get_supabase_client()
        
        # Call the RPC function
        result = supabase.rpc('get_weekly_productivity_summary', {
            'p_organization_id': current_user.organization_id,
            'p_end_date': date_string,
        }).execute()
        
        if result.data is None:
            result_data = []
        else:
            result_data = result.data
        
        # Transform to response model
        days = []
        total_tasks = 0
        
        for row in result_data:
            day = WeeklySummaryDay(
                day_date=row.get('day_date', ''),
                day_name=row.get('day_name', ''),
                total_tasks=int(row.get('total_tasks', 0)),
                total_associates=int(row.get('total_associates', 0)),
                active_associates=int(row.get('active_associates', 0)),
                inbound_scans=int(row.get('inbound_scans', 0)),
                put_aways=int(row.get('put_aways', 0)),
                picking=int(row.get('picking', 0)),
                packed=int(row.get('packed', 0)),
                shipped=int(row.get('shipped', 0)),
                final_packed=int(row.get('final_packed', 0)),
                putbacks=int(row.get('putbacks', 0)),
                cycle_counts=int(row.get('cycle_counts', 0)),
            )
            days.append(day)
            total_tasks += day.total_tasks
        
        average_daily = total_tasks / len(days) if days else 0
        
        logger.info(f"Retrieved weekly trend: {len(days)} days, {total_tasks} total tasks")
        
        return WeeklyTrendResponse(
            end_date=date_string,
            days=days,
            total_tasks=total_tasks,
            average_daily_tasks=round(average_daily, 2)
        )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get weekly trend: {str(e)}")
        raise sanitized_error(
            500,
            public_message="Failed to fetch weekly trend.",
            exc=e,
            context="weekly trend"
        )


@router.get("/activity-events", response_model=ActivityEventsResponse)
async def get_activity_events(
    target_date: date = Query(..., description="Target date for activity events (YYYY-MM-DD)"),
    timezone: str = Query("America/New_York", description="IANA timezone identifier"),
    current_user: AuthenticatedUser = Depends(get_current_user)
):
    """
    Get activity events for timeline visualization.
    
    Returns all activity events for the team on the specified date.
    Uses the get_team_activity_events RPC function.
    """
    try:
        if not current_user.organization_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="User does not have an organization assigned"
            )
        
        date_string = target_date.isoformat()
        start_utc, end_utc = get_utc_boundaries_for_date(date_string, timezone)
        
        logger.info(f"Fetching activity events for org {current_user.organization_id} on {date_string}")
        
        supabase = get_supabase_client()
        
        # Call the RPC function
        result = supabase.rpc('get_team_activity_events', {
            'p_organization_id': current_user.organization_id,
            'p_start_date': start_utc,
            'p_end_date': end_utc,
        }).execute()
        
        if result.data is None:
            result_data = []
        else:
            result_data = result.data
        
        # Transform to response model
        events = []
        for row in result_data:
            events.append(ActivityEvent(
                user_id=row.get('user_id', ''),
                event_type=row.get('event_type', ''),
                event_timestamp=row.get('event_timestamp', ''),
                area=row.get('area'),
                activity_label=row.get('activity_label'),
                display_color=row.get('display_color'),
                activity_category=row.get('activity_category'),
            ))
        
        # Sort by timestamp
        events.sort(key=lambda e: e.event_timestamp)
        
        logger.info(f"Retrieved {len(events)} activity events")
        
        return ActivityEventsResponse(
            date=date_string,
            events=events,
            total_events=len(events)
        )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get activity events: {str(e)}")
        raise sanitized_error(
            500,
            public_message="Failed to fetch activity events.",
            exc=e,
            context="activity events"
        )


@router.get("/shift-assignments", response_model=ShiftAssignmentsResponse)
async def get_shift_assignments(
    current_user: AuthenticatedUser = Depends(get_current_user)
):
    """
    Get shift assignments with full details.
    
    Returns all active shift assignments for the organization with user, position,
    and schedule details. Uses the get_shift_assignments_with_details RPC function.
    """
    try:
        if not current_user.organization_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="User does not have an organization assigned"
            )
        
        logger.info(f"Fetching shift assignments for org {current_user.organization_id}")
        
        supabase = get_supabase_client()
        
        # Call the RPC function
        result = supabase.rpc('get_shift_assignments_with_details', {
            'p_organization_id': current_user.organization_id,
        }).execute()
        
        if result.data is None:
            result_data = []
        else:
            result_data = result.data
        
        # Transform to response model
        assignments = []
        for row in result_data:
            assignments.append(ShiftAssignmentDetail(
                assignment_id=row.get('assignment_id', ''),
                user_id=row.get('user_id', ''),
                user_full_name=row.get('user_full_name'),
                user_email=row.get('user_email'),
                user_avatar_url=row.get('user_avatar_url'),
                user_status=row.get('user_status'),
                user_phone_number=row.get('user_phone_number'),
                user_created_at=row.get('user_created_at'),
                position_id=row.get('position_id'),
                position_title=row.get('position_title'),
                position_type=row.get('position_type'),
                position_level=row.get('position_level'),
                is_supervisory=row.get('is_supervisory'),
                department=row.get('department'),
                working_area_id=row.get('working_area_id'),
                area_name=row.get('area_name'),
                area_code=row.get('area_code'),
                area_type=row.get('area_type'),
                shift_schedule_id=row.get('shift_schedule_id'),
                schedule_name=row.get('schedule_name'),
                shift_start_time=row.get('shift_start_time'),
                shift_end_time=row.get('shift_end_time'),
                break_start_time=row.get('break_start_time'),
                break_duration_minutes=row.get('break_duration_minutes'),
                breaks=row.get('breaks'),
                supervisor_id=row.get('supervisor_id'),
                supervisor_name=row.get('supervisor_name'),
                supervisor_avatar=row.get('supervisor_avatar'),
                team_lead_id=row.get('team_lead_id'),
                team_lead_name=row.get('team_lead_name'),
                team_lead_avatar=row.get('team_lead_avatar'),
                assignment_type=row.get('assignment_type'),
                shift_pattern=row.get('shift_pattern'),
                productivity_target=row.get('productivity_target'),
                inline_shift_schedule=row.get('inline_shift_schedule'),
            ))
        
        logger.info(f"Retrieved {len(assignments)} shift assignments")
        
        return ShiftAssignmentsResponse(
            organization_id=current_user.organization_id,
            assignments=assignments,
            total_assignments=len(assignments)
        )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get shift assignments: {str(e)}")
        raise sanitized_error(
            500,
            public_message="Failed to fetch shift assignments.",
            exc=e,
            context="shift assignments"
        )


@router.get("/labor-standards")
async def get_labor_standards(
    current_user: AuthenticatedUser = Depends(get_current_user)
) -> Dict[str, Any]:
    """
    Get active labor standards for the organization.
    
    Returns all active labor standards used for efficiency calculations.
    """
    try:
        if not current_user.organization_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="User does not have an organization assigned"
            )
        
        logger.info(f"Fetching labor standards for org {current_user.organization_id}")
        
        supabase = get_supabase_client()
        
        result = supabase.table('labor_standards') \
            .select('*') \
            .eq('organization_id', current_user.organization_id) \
            .eq('is_active', True) \
            .execute()
        
        standards = result.data or []
        
        logger.info(f"Retrieved {len(standards)} labor standards")
        
        return {
            "organization_id": current_user.organization_id,
            "standards": standards,
            "total_standards": len(standards)
        }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get labor standards: {str(e)}")
        raise sanitized_error(
            500,
            public_message="Failed to fetch labor standards.",
            exc=e,
            context="labor standards"
        )


@router.get("/working-areas")
async def get_working_areas(
    current_user: AuthenticatedUser = Depends(get_current_user)
) -> Dict[str, Any]:
    """
    Get active working areas for the organization.
    
    Returns all active working areas for filtering and display.
    """
    try:
        if not current_user.organization_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="User does not have an organization assigned"
            )
        
        logger.info(f"Fetching working areas for org {current_user.organization_id}")
        
        supabase = get_supabase_client()
        
        result = supabase.table('working_areas') \
            .select('*') \
            .eq('organization_id', current_user.organization_id) \
            .eq('is_active', True) \
            .execute()
        
        areas = result.data or []
        
        logger.info(f"Retrieved {len(areas)} working areas")
        
        return {
            "organization_id": current_user.organization_id,
            "working_areas": areas,
            "total_areas": len(areas)
        }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get working areas: {str(e)}")
        raise sanitized_error(
            500,
            public_message="Failed to fetch working areas.",
            exc=e,
            context="working areas"
        )


@router.get("/departments")
async def get_departments(
    current_user: AuthenticatedUser = Depends(get_current_user)
) -> Dict[str, Any]:
    """
    Get distinct departments for the organization.
    
    Returns all unique departments from shift positions.
    """
    try:
        if not current_user.organization_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="User does not have an organization assigned"
            )
        
        logger.info(f"Fetching departments for org {current_user.organization_id}")
        
        supabase = get_supabase_client()
        
        result = supabase.table('shift_positions') \
            .select('department') \
            .eq('organization_id', current_user.organization_id) \
            .eq('is_active', True) \
            .not_.is_('department', 'null') \
            .execute()
        
        # Extract unique departments
        departments = set()
        for row in (result.data or []):
            if row.get('department'):
                departments.add(row['department'])
        
        departments_list = sorted(list(departments))
        
        logger.info(f"Retrieved {len(departments_list)} departments")
        
        return {
            "organization_id": current_user.organization_id,
            "departments": departments_list,
            "total_departments": len(departments_list)
        }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get departments: {str(e)}")
        raise sanitized_error(
            500,
            public_message="Failed to fetch departments.",
            exc=e,
            context="departments"
        )

# Developer and Creator: Jai Singh
