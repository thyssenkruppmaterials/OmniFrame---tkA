// Created and developed by Jai Singh
//! Authentication-related database models

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

/// User profile record
/// Actual schema: id, organization_id, email, username, first_name, last_name, full_name,
/// avatar_url, phone_number, role, status, preferences, metadata, last_seen,
/// email_verified, two_factor_enabled, created_at, updated_at, role_id
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct UserProfile {
    pub id: Uuid,
    pub created_at: Option<DateTime<Utc>>,
    pub updated_at: Option<DateTime<Utc>>,
    pub email: Option<String>,
    pub full_name: Option<String>,
    pub avatar_url: Option<String>,
    pub organization_id: Option<Uuid>,
    pub last_seen: Option<DateTime<Utc>>,
    pub status: Option<String>,
    /// The user's role enum cast to text
    pub role_text: Option<String>,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub username: Option<String>,
    pub phone_number: Option<String>,
    
    // Virtual fields for backward compatibility with existing code
    #[sqlx(skip)]
    pub department: Option<String>,
    #[sqlx(skip)]
    pub job_title: Option<String>,
}

/// Role record
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Role {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub created_at: Option<DateTime<Utc>>,
    pub updated_at: Option<DateTime<Utc>>,
    pub organization_id: Option<Uuid>,
    pub is_system: Option<bool>,
}

/// Permission record
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Permission {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub resource: Option<String>,
    pub action: Option<String>,
    pub created_at: Option<DateTime<Utc>>,
}

/// User role assignment
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct UserRole {
    pub id: Uuid,
    pub user_id: Uuid,
    pub role_id: Uuid,
    pub assigned_at: DateTime<Utc>,
    pub assigned_by: Option<Uuid>,
    pub expires_at: Option<DateTime<Utc>>,
}

/// Role permission assignment
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct RolePermission {
    pub id: Uuid,
    pub role_id: Uuid,
    pub permission_id: Uuid,
    pub granted: bool,
    pub created_at: Option<DateTime<Utc>>,
}

/// Organization record
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Organization {
    pub id: Uuid,
    pub name: String,
    pub slug: Option<String>,
    pub created_at: Option<DateTime<Utc>>,
    pub updated_at: Option<DateTime<Utc>>,
    pub settings: Option<serde_json::Value>,
    pub status: Option<String>,
}

// Created and developed by Jai Singh
