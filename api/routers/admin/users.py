# Created and developed by Jai Singh
"""User management endpoints (CRUD, status changes, password resets, onboarding)."""

import logging
import secrets
import string
from datetime import datetime
from typing import List, Optional, Dict, Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from supabase import create_client

from ._helpers import (
    RequireAdmin,
    get_supabase_admin,
    log_admin_action,
    sanitized_error,
    settings,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["admin"])


# ---- Pydantic models --------------------------------------------------------

class CreateUserAdminRequest(BaseModel):
    """Request model for admin user creation"""
    email: str
    password: Optional[str] = None
    username: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    phone_number: Optional[str] = None
    role: str
    send_invite: bool = False


class InviteUserRequest(BaseModel):
    """Request model for inviting a user"""
    email: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    role: str


class ResetPasswordRequest(BaseModel):
    """Request model for password reset"""
    new_password: str
    send_email: Optional[bool] = False


# ---- Onboarding models ------------------------------------------------------

class OnboardingPersonalInfo(BaseModel):
    """Personal information for onboarding"""
    first_name: str
    last_name: str
    email: str
    phone_number: Optional[str] = None
    emergency_contact_name: Optional[str] = None
    emergency_contact_phone: Optional[str] = None
    employee_id: Optional[str] = None
    start_date: str
    department: Optional[str] = None
    avatar_url: Optional[str] = None


class OnboardingAuthSetup(BaseModel):
    """Authentication setup for onboarding"""
    password: Optional[str] = None
    auto_generate_password: bool = True
    generated_password: Optional[str] = None
    auto_activate: bool = True
    send_welcome_email: bool = False


class OnboardingRoleAssignment(BaseModel):
    """Role assignment for onboarding"""
    role_id: str
    role_name: Optional[str] = None
    customize_permissions: bool = False
    custom_permissions: Optional[List[str]] = None


class OnboardingPositionAssignment(BaseModel):
    """Position assignment for onboarding"""
    position_id: str
    position_title: Optional[str] = None
    supervisor_id: str
    supervisor_name: Optional[str] = None
    team_lead_id: Optional[str] = None
    team_lead_name: Optional[str] = None
    is_primary_position: bool = True
    assignment_type: str = "permanent"


class OnboardingShiftSchedule(BaseModel):
    """Shift schedule for onboarding"""
    shift_pattern: str = "fixed"
    shift_start_time: str = "08:00"
    shift_end_time: str = "17:00"
    working_days: List[int] = [1, 2, 3, 4, 5]
    shift_schedule_id: Optional[str] = None
    productivity_target: Optional[float] = None
    quality_target: Optional[float] = None


class OnboardingWorkingArea(BaseModel):
    """Working area assignment for onboarding"""
    primary_area_id: str
    primary_area_name: Optional[str] = None
    secondary_areas: Optional[List[Dict[str, str]]] = None


class OnboardingCertification(BaseModel):
    """Certification for onboarding"""
    certification_name: str
    certification_type: str = "general"
    issuing_authority: Optional[str] = None
    certification_number: Optional[str] = None
    issue_date: Optional[str] = None
    expiration_date: Optional[str] = None
    document_url: Optional[str] = None
    is_required: bool = False
    notes: Optional[str] = None


class OnboardingDevice(BaseModel):
    """Device for onboarding"""
    device_type: str
    device_name: Optional[str] = None
    device_id: Optional[str] = None
    serial_number: Optional[str] = None
    asset_tag: Optional[str] = None
    manufacturer: Optional[str] = None
    model: Optional[str] = None
    condition: str = "good"
    notes: Optional[str] = None


class OnboardingSubmitRequest(BaseModel):
    """Complete onboarding submission request"""
    session_id: str
    organization_id: str
    personal_info: OnboardingPersonalInfo
    authentication_setup: OnboardingAuthSetup
    role_assignment: OnboardingRoleAssignment
    position_assignment: OnboardingPositionAssignment
    shift_schedule: OnboardingShiftSchedule
    working_area: OnboardingWorkingArea
    certifications: Optional[List[OnboardingCertification]] = []
    devices: Optional[List[OnboardingDevice]] = []


class OnboardingDraftRequest(BaseModel):
    """Save onboarding draft request"""
    session_id: Optional[str] = None
    organization_id: str
    current_step: int = 1
    personal_info: Optional[Dict[str, Any]] = None
    authentication_setup: Optional[Dict[str, Any]] = None
    role_assignment: Optional[Dict[str, Any]] = None
    position_assignment: Optional[Dict[str, Any]] = None
    shift_schedule: Optional[Dict[str, Any]] = None
    working_area: Optional[Dict[str, Any]] = None
    certifications: Optional[List[Dict[str, Any]]] = []
    devices: Optional[List[Dict[str, Any]]] = []


# ---- User CRUD endpoints ----------------------------------------------------

@router.post("/users/create")
async def create_user_admin(
    user_data: CreateUserAdminRequest,
    current_user: RequireAdmin,
):
    """Create a new user using admin privileges.

    Handles the full user creation flow:
    1. Creates the auth user in Supabase Auth
    2. Gets the role_id from the role name
    3. Creates the user profile in user_profiles table
    4. Sends invitation email if requested
    """
    try:
        supabase_admin = get_supabase_admin()

        logger.info(f"Creating user {user_data.email} with role {user_data.role}")

        password = user_data.password
        if not password:
            alphabet = string.ascii_letters + string.digits + "!@#$%^&*"
            password = ''.join(secrets.choice(alphabet) for _ in range(16))
            logger.info(f"Generated random password for user {user_data.email}")

        auth_result = supabase_admin.auth.admin.create_user({
            "email": user_data.email,
            "password": password,
            "email_confirm": not user_data.send_invite,
            "user_metadata": {
                "first_name": user_data.first_name,
                "last_name": user_data.last_name,
                "username": user_data.username,
                "phone_number": user_data.phone_number,
                "role": user_data.role
            }
        })

        if not auth_result.user:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to create auth user"
            )

        user_id = auth_result.user.id

        try:
            role_result = supabase_admin.table("roles").select("id").eq("name", user_data.role).single().execute()
            role_id = role_result.data.get("id") if role_result.data else None

            if not role_id:
                logger.warning(f"Role not found: {user_data.role}, creating user without role_id")

            profile_data = {
                "id": user_id,
                "email": user_data.email,
                "username": user_data.username,
                "first_name": user_data.first_name,
                "last_name": user_data.last_name,
                "phone_number": user_data.phone_number,
                "role": user_data.role,
                "status": "invited" if user_data.send_invite else "active",
                "email_verified": not user_data.send_invite
            }

            if role_id:
                profile_data["role_id"] = role_id

            profile_result = supabase_admin.table("user_profiles").insert(profile_data).execute()

            if not profile_result.data:
                raise Exception("Failed to create user profile")

            profile = profile_result.data[0] if isinstance(profile_result.data, list) else profile_result.data

            if user_data.send_invite:
                try:
                    supabase_admin.auth.admin.invite_user_by_email(user_data.email)
                    logger.info(f"Invitation email sent to {user_data.email}")
                except Exception as invite_error:
                    logger.warning(f"Failed to send invitation email: {str(invite_error)}")

            await log_admin_action(
                action="create_user",
                user=current_user,
                target_resource=user_data.email,
                details={
                    "user_id": user_id,
                    "role": user_data.role,
                    "send_invite": user_data.send_invite
                }
            )

            logger.info(f"User {user_data.email} created successfully with ID {user_id}")

            return {
                "success": True,
                "user": {
                    "id": profile.get("id"),
                    "email": profile.get("email"),
                    "username": profile.get("username"),
                    "first_name": profile.get("first_name"),
                    "last_name": profile.get("last_name"),
                    "phone_number": profile.get("phone_number"),
                    "role": profile.get("role"),
                    "status": profile.get("status"),
                    "email_verified": profile.get("email_verified"),
                    "created_at": profile.get("created_at"),
                    "preferences": profile.get("preferences") or {},
                    "metadata": profile.get("metadata") or {},
                    "two_factor_enabled": profile.get("two_factor_enabled") or False
                }
            }

        except Exception as profile_error:
            logger.error(f"Profile creation failed, cleaning up auth user: {str(profile_error)}")
            try:
                supabase_admin.auth.admin.delete_user(user_id)
            except Exception as cleanup_error:
                logger.error(f"Failed to cleanup auth user: {str(cleanup_error)}")
            raise profile_error

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to create user: {str(e)}")
        raise sanitized_error(500, public_message="Failed to create user.", exc=e, context="create_user_admin")


@router.post("/users/invite")
async def invite_user_admin(
    invite_data: InviteUserRequest,
    current_user: RequireAdmin,
):
    """Invite a user via email.

    Creates an auth user with invite and a pending user profile.
    """
    try:
        supabase_admin = get_supabase_admin()

        logger.info(f"Inviting user {invite_data.email} with role {invite_data.role}")

        auth_result = supabase_admin.auth.admin.invite_user_by_email(
            invite_data.email,
            {
                "data": {
                    "first_name": invite_data.first_name,
                    "last_name": invite_data.last_name,
                    "role": invite_data.role
                }
            }
        )

        if not auth_result.user:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to invite user"
            )

        user_id = auth_result.user.id

        try:
            role_result = supabase_admin.table("roles").select("id").eq("name", invite_data.role).single().execute()
            role_id = role_result.data.get("id") if role_result.data else None

            profile_data = {
                "id": user_id,
                "email": invite_data.email,
                "first_name": invite_data.first_name,
                "last_name": invite_data.last_name,
                "role": invite_data.role,
                "status": "invited",
                "email_verified": False
            }

            if role_id:
                profile_data["role_id"] = role_id

            supabase_admin.table("user_profiles").insert(profile_data).execute()

            await log_admin_action(
                action="invite_user",
                user=current_user,
                target_resource=invite_data.email,
                details={"role": invite_data.role}
            )

            logger.info(f"User {invite_data.email} invited successfully")

            return {"success": True, "user_id": user_id, "email": invite_data.email}

        except Exception as profile_error:
            try:
                supabase_admin.auth.admin.delete_user(user_id)
            except:
                pass
            raise profile_error

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to invite user: {str(e)}")
        raise sanitized_error(500, public_message="Failed to invite user.", exc=e, context="invite_user_admin")


@router.post("/users/{user_id}/resend-invitation")
async def resend_invitation_admin(
    user_id: str,
    current_user: RequireAdmin,
):
    """Resend invitation email to a user.

    Only works for users in 'invited' status.
    """
    try:
        supabase_admin = get_supabase_admin()

        user_result = supabase_admin.table("user_profiles").select("email, status").eq("id", user_id).single().execute()

        if not user_result.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found"
            )

        user = user_result.data

        if user.get("status") != "invited":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="User is not in invited status"
            )

        supabase_admin.auth.admin.invite_user_by_email(user.get("email"))

        await log_admin_action(
            action="resend_invitation",
            user=current_user,
            target_resource=user_id,
            details={"email": user.get("email")}
        )

        logger.info(f"Invitation resent to {user.get('email')}")

        return {"success": True, "email": user.get("email")}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to resend invitation: {str(e)}")
        raise sanitized_error(500, public_message="Failed to resend invitation.", exc=e, context="resend_invitation_admin")


@router.post("/users/{user_id}/suspend")
async def suspend_user(
    user_id: str,
    current_user: RequireAdmin,
):
    """Suspend a user account."""
    try:
        supabase_admin = get_supabase_admin()

        result = supabase_admin.table("user_profiles") \
            .update({"status": "suspended", "suspended_at": datetime.utcnow().isoformat()}) \
            .eq("id", user_id) \
            .execute()

        await log_admin_action(
            action="suspend_user",
            user=current_user,
            target_resource=user_id,
            details={"status": "suspended"}
        )

        return {"success": True, "message": "User suspended successfully"}
    except Exception as e:
        logger.error(f"Failed to suspend user: {str(e)}")
        raise sanitized_error(500, public_message="Failed to suspend user.", exc=e, context="suspend_user")


@router.post("/users/{user_id}/reset-password")
async def reset_user_password(
    user_id: str,
    reset_data: ResetPasswordRequest,
    current_user: RequireAdmin,
):
    """Reset a user's password using admin privileges."""
    try:
        logger.info(f"Admin {current_user.email} resetting password for user {user_id}")

        supabase_admin = get_supabase_admin()

        auth_result = supabase_admin.auth.admin.update_user_by_id(
            user_id,
            {"password": reset_data.new_password}
        )

        if hasattr(auth_result, 'error') and auth_result.error:
            logger.error(f"Auth error resetting password: {auth_result.error}")
            raise sanitized_error(500, public_message="Failed to reset password.", exc=Exception(str(auth_result.error)), context="reset_user_password")

        if reset_data.send_email:
            try:
                user_profile = supabase_admin.table("user_profiles") \
                    .select("email") \
                    .eq("id", user_id) \
                    .single() \
                    .execute()

                if user_profile.data and user_profile.data.get("email"):
                    redirect_to = f"{settings.frontend_url.rstrip('/')}/auth/reset-password"
                    regular_client = create_client(settings.supabase_url, settings.supabase_anon_key)
                    regular_client.auth.reset_password_email(
                        user_profile.data["email"],
                        options={"redirect_to": redirect_to},
                    )
                    logger.info(f"Password reset email sent to {user_profile.data['email']} with redirect to {redirect_to}")
            except Exception as email_error:
                logger.warning(f"Failed to send password reset email: {str(email_error)}")

        logger.info(f"Password reset successful for user {user_id}")
        return {
            "success": True,
            "message": "Password reset successfully",
            "email_sent": reset_data.send_email
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to reset password: {str(e)}")
        raise sanitized_error(500, public_message="Failed to reset password.", exc=e, context="reset_user_password")


# ---- Onboarding endpoints ---------------------------------------------------

@router.post("/onboarding/submit")
async def submit_onboarding(
    request: OnboardingSubmitRequest,
    current_user: RequireAdmin,
):
    """Complete employee onboarding submission.

    Creates auth user, user profile, shift assignment, and related records.
    """
    if request.organization_id and current_user.organization_id:
        if request.organization_id != current_user.organization_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Cannot create users in a different organization"
            )

    try:
        logger.info(f"Onboarding submission by {current_user.email} for {request.personal_info.email}")

        supabase_admin = get_supabase_admin()

        if request.authentication_setup.auto_generate_password or not request.authentication_setup.password:
            alphabet = string.ascii_letters + string.digits + "!@#$%^&*"
            password = ''.join(secrets.choice(alphabet) for _ in range(12))
        else:
            password = request.authentication_setup.password

        auth_result = supabase_admin.auth.admin.create_user({
            "email": request.personal_info.email,
            "password": password,
            "email_confirm": True,
            "user_metadata": {
                "first_name": request.personal_info.first_name,
                "last_name": request.personal_info.last_name,
                "role": request.role_assignment.role_name,
            }
        })

        if not auth_result.user:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to create auth user"
            )

        user_id = auth_result.user.id

        try:
            badge_result = supabase_admin.rpc('generate_badge_number', {
                'p_organization_id': request.organization_id
            }).execute()
            badge_number = badge_result.data if badge_result.data else f"EMP{datetime.utcnow().strftime('%y%m%d%H%M')}"

            profile_result = supabase_admin.table("user_profiles").upsert({
                "id": user_id,
                "email": request.personal_info.email,
                "first_name": request.personal_info.first_name,
                "last_name": request.personal_info.last_name,
                "phone_number": request.personal_info.phone_number,
                "avatar_url": request.personal_info.avatar_url,
                "role": request.role_assignment.role_name,
                "role_id": request.role_assignment.role_id,
                "organization_id": request.organization_id,
                "status": "active",
                "email_verified": True,
            }, on_conflict="id").execute()

            assignment_result = supabase_admin.table("shift_assignments").insert({
                "organization_id": request.organization_id,
                "user_id": user_id,
                "position_id": request.position_assignment.position_id,
                "working_area_id": request.working_area.primary_area_id,
                "assignment_type": request.position_assignment.assignment_type,
                "shift_pattern": request.shift_schedule.shift_pattern,
                "shift_schedule": {
                    "days": request.shift_schedule.working_days,
                    "start_time": request.shift_schedule.shift_start_time,
                    "end_time": request.shift_schedule.shift_end_time,
                },
                "direct_supervisor_id": request.position_assignment.supervisor_id,
                "team_lead_id": request.position_assignment.team_lead_id,
                "status": "active",
                "start_date": request.personal_info.start_date,
                "is_primary_position": request.position_assignment.is_primary_position,
                "productivity_target": request.shift_schedule.productivity_target,
                "quality_target": request.shift_schedule.quality_target,
                "badge_number": badge_number,
                "emergency_contact_name": request.personal_info.emergency_contact_name,
                "emergency_contact_phone": request.personal_info.emergency_contact_phone,
                "onboarding_session_id": request.session_id,
                "onboarding_completed_at": datetime.utcnow().isoformat(),
            }).execute()

            try:
                supabase_admin.table("worker_profiles").insert({
                    "user_id": user_id,
                    "organization_id": request.organization_id,
                    "is_available": True,
                    "max_concurrent_tasks": 3,
                    "current_zone": request.working_area.primary_area_id,
                }).execute()
            except Exception as worker_error:
                logger.warning(f"Failed to create worker profile: {str(worker_error)}")

            if request.position_assignment.supervisor_id:
                try:
                    supabase_admin.table("organizational_hierarchy").insert({
                        "organization_id": request.organization_id,
                        "subordinate_id": user_id,
                        "supervisor_id": request.position_assignment.supervisor_id,
                        "relationship_type": "direct",
                        "is_active": True,
                    }).execute()
                except Exception as hierarchy_error:
                    logger.warning(f"Failed to create hierarchy: {str(hierarchy_error)}")

            if request.certifications:
                for cert in request.certifications:
                    try:
                        supabase_admin.table("employee_certifications").insert({
                            "organization_id": request.organization_id,
                            "user_id": user_id,
                            "certification_name": cert.certification_name,
                            "certification_type": cert.certification_type,
                            "issuing_authority": cert.issuing_authority,
                            "certification_number": cert.certification_number,
                            "issue_date": cert.issue_date,
                            "expiration_date": cert.expiration_date,
                            "is_required": cert.is_required,
                            "document_url": cert.document_url,
                            "notes": cert.notes,
                            "status": "active",
                        }).execute()
                    except Exception as cert_error:
                        logger.warning(f"Failed to add certification: {str(cert_error)}")

            if request.devices:
                for device in request.devices:
                    try:
                        supabase_admin.table("employee_devices").insert({
                            "organization_id": request.organization_id,
                            "user_id": user_id,
                            "device_type": device.device_type,
                            "device_name": device.device_name,
                            "device_id": device.device_id,
                            "serial_number": device.serial_number,
                            "asset_tag": device.asset_tag,
                            "manufacturer": device.manufacturer,
                            "model": device.model,
                            "condition": device.condition,
                            "notes": device.notes,
                            "assignment_status": "assigned",
                        }).execute()
                    except Exception as device_error:
                        logger.warning(f"Failed to register device: {str(device_error)}")

            try:
                supabase_admin.rpc('create_default_onboarding_checklist', {
                    'p_organization_id': request.organization_id,
                    'p_user_id': user_id,
                    'p_onboarding_session_id': request.session_id,
                }).execute()
            except Exception as checklist_error:
                logger.warning(f"Failed to create checklist: {str(checklist_error)}")

            supabase_admin.table("onboarding_sessions").update({
                "session_status": "completed",
                "created_user_id": user_id,
                "completed_at": datetime.utcnow().isoformat(),
            }).eq("id", request.session_id).execute()

            logger.info(f"Onboarding completed successfully for {request.personal_info.email}")

            return {
                "success": True,
                "user_id": user_id,
                "profile_id": user_id,
                "credentials": {
                    "user_id": user_id,
                    "email": request.personal_info.email,
                    "password": password,
                    "badge_number": badge_number,
                },
            }

        except Exception as inner_error:
            try:
                supabase_admin.auth.admin.delete_user(user_id)
            except:
                pass
            raise inner_error

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Onboarding submission failed: {str(e)}")
        raise sanitized_error(500, public_message="Onboarding failed.", exc=e, context="submit_onboarding")


@router.post("/onboarding/draft")
async def save_onboarding_draft(
    request: OnboardingDraftRequest,
    current_user: RequireAdmin,
):
    """Save onboarding wizard draft progress."""
    if request.organization_id and current_user.organization_id:
        if request.organization_id != current_user.organization_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Cannot create users in a different organization"
            )

    try:
        supabase_admin = get_supabase_admin()

        if request.session_id:
            result = supabase_admin.table("onboarding_sessions").update({
                "current_step": request.current_step,
                "session_status": "in_progress",
                "personal_info": request.personal_info,
                "authentication_setup": request.authentication_setup,
                "role_assignment": request.role_assignment,
                "position_assignment": request.position_assignment,
                "shift_schedule": request.shift_schedule,
                "working_area": request.working_area,
                "certifications": request.certifications,
                "device_registration": request.devices,
                "updated_at": datetime.utcnow().isoformat(),
            }).eq("id", request.session_id).execute()

            return {
                "success": True,
                "session_id": request.session_id,
                "message": "Draft updated successfully"
            }
        else:
            result = supabase_admin.table("onboarding_sessions").insert({
                "organization_id": request.organization_id,
                "created_by": current_user.id,
                "session_status": "draft",
                "current_step": request.current_step,
                "personal_info": request.personal_info or {},
                "authentication_setup": request.authentication_setup or {},
                "role_assignment": request.role_assignment or {},
                "position_assignment": request.position_assignment or {},
                "shift_schedule": request.shift_schedule or {},
                "working_area": request.working_area or {},
                "certifications": request.certifications or [],
                "device_registration": request.devices or [],
            }).execute()

            session_id = result.data[0]["id"] if result.data else None

            return {
                "success": True,
                "session_id": session_id,
                "message": "Draft created successfully"
            }

    except Exception as e:
        logger.error(f"Failed to save onboarding draft: {str(e)}")
        raise sanitized_error(500, public_message="Failed to save draft.", exc=e, context="save_onboarding_draft")


@router.get("/onboarding/draft/{session_id}")
async def get_onboarding_draft(
    session_id: str,
    current_user: RequireAdmin,
):
    """Load an onboarding draft session."""
    try:
        supabase_admin = get_supabase_admin()

        result = supabase_admin.table("onboarding_sessions") \
            .select("*") \
            .eq("id", session_id) \
            .single() \
            .execute()

        if not result.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Draft session not found"
            )

        return {
            "success": True,
            "session": result.data
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to load onboarding draft: {str(e)}")
        raise sanitized_error(500, public_message="Failed to load draft.", exc=e, context="get_onboarding_draft")


@router.get("/onboarding/drafts")
async def list_onboarding_drafts(
    organization_id: str,
    current_user: RequireAdmin,
):
    """List all draft onboarding sessions for an organization."""
    try:
        supabase_admin = get_supabase_admin()

        result = supabase_admin.table("onboarding_sessions") \
            .select("id, session_status, current_step, personal_info, created_at, updated_at") \
            .eq("organization_id", organization_id) \
            .in_("session_status", ["draft", "in_progress"]) \
            .order("updated_at", desc=True) \
            .execute()

        return {
            "success": True,
            "drafts": result.data or []
        }

    except Exception as e:
        logger.error(f"Failed to list onboarding drafts: {str(e)}")
        raise sanitized_error(500, public_message="Failed to list drafts.", exc=e, context="list_onboarding_drafts")


@router.delete("/onboarding/draft/{session_id}")
async def delete_onboarding_draft(
    session_id: str,
    current_user: RequireAdmin,
):
    """Delete an onboarding draft session."""
    try:
        supabase_admin = get_supabase_admin()

        result = supabase_admin.table("onboarding_sessions") \
            .delete() \
            .eq("id", session_id) \
            .execute()

        return {
            "success": True,
            "message": "Draft deleted successfully"
        }

    except Exception as e:
        logger.error(f"Failed to delete onboarding draft: {str(e)}")
        raise sanitized_error(500, public_message="Failed to delete draft.", exc=e, context="delete_onboarding_draft")


@router.get("/onboarding/statistics/{organization_id}")
async def get_onboarding_statistics(
    organization_id: str,
    current_user: RequireAdmin,
):
    """Get onboarding statistics for dashboard."""
    try:
        supabase_admin = get_supabase_admin()

        result = supabase_admin.rpc('get_onboarding_statistics', {
            'p_organization_id': organization_id
        }).execute()

        return {
            "success": True,
            "statistics": result.data
        }

    except Exception as e:
        logger.error(f"Failed to get onboarding statistics: {str(e)}")
        raise sanitized_error(500, public_message="Failed to get statistics.", exc=e, context="get_onboarding_statistics")

# Created and developed by Jai Singh
