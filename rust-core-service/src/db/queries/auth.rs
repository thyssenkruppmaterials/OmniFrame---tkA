//! Authentication-related database queries

use super::super::models::auth::*;
use sqlx::{PgPool, Row};
use uuid::Uuid;
use tracing::instrument;

/// Authentication query service
pub struct AuthQueries {
    pool: PgPool,
}

impl AuthQueries {
    /// Create a new auth queries instance
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Get user profile by ID
    /// Schema: id, organization_id, email, username, first_name, last_name, full_name,
    /// avatar_url, phone_number, role, status, preferences, metadata, last_seen,
    /// email_verified, two_factor_enabled, created_at, updated_at, role_id
    #[instrument(skip(self))]
    pub async fn get_user_profile(&self, user_id: Uuid) -> Result<Option<UserProfile>, sqlx::Error> {
        sqlx::query_as::<_, UserProfile>(
            r#"
            SELECT 
                up.id, up.created_at, up.updated_at, up.email, up.full_name,
                up.avatar_url, up.organization_id, up.last_seen, 
                up.status::text as status,
                COALESCE(r.name, up.role::text) as role_text,
                up.first_name, up.last_name, up.username, up.phone_number
            FROM user_profiles up
            LEFT JOIN roles r ON r.id = up.role_id
            WHERE up.id = $1
            "#,
        )
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await
    }

    /// Get user profile by email
    #[instrument(skip(self))]
    pub async fn get_user_by_email(&self, email: &str) -> Result<Option<UserProfile>, sqlx::Error> {
        sqlx::query_as::<_, UserProfile>(
            r#"
            SELECT 
                up.id, up.created_at, up.updated_at, up.email, up.full_name,
                up.avatar_url, up.organization_id, up.last_seen, 
                up.status::text as status,
                COALESCE(r.name, up.role::text) as role_text,
                up.first_name, up.last_name, up.username, up.phone_number
            FROM user_profiles up
            LEFT JOIN roles r ON r.id = up.role_id
            WHERE up.email = $1
            "#,
        )
        .bind(email)
        .fetch_optional(&self.pool)
        .await
    }

    /// Get user's roles (via role_id on user_profiles)
    /// Note: user_profiles has role_id column that references roles table
    #[instrument(skip(self))]
    pub async fn get_user_roles(&self, user_id: Uuid) -> Result<Vec<Role>, sqlx::Error> {
        sqlx::query_as::<_, Role>(
            r#"
            SELECT 
                r.id, r.name, r.description, r.created_at,
                r.updated_at, r.organization_id, r.is_system
            FROM roles r
            INNER JOIN user_profiles up ON up.role_id = r.id
            WHERE up.id = $1
            ORDER BY r.name
            "#,
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await
    }

    /// Get user's permissions (via role_id -> role_permissions)
    #[instrument(skip(self))]
    pub async fn get_user_permissions(&self, user_id: Uuid) -> Result<Vec<String>, sqlx::Error> {
        let rows = sqlx::query(
            r#"
            SELECT DISTINCT p.name
            FROM permissions p
            INNER JOIN role_permissions rp ON p.id = rp.permission_id
            INNER JOIN user_profiles up ON up.role_id = rp.role_id
            WHERE up.id = $1
            "#,
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows.iter().filter_map(|r| r.get::<Option<String>, _>("name")).collect())
    }

    /// Check if user has a specific permission
    #[instrument(skip(self))]
    pub async fn user_has_permission(
        &self,
        user_id: Uuid,
        permission: &str,
    ) -> Result<bool, sqlx::Error> {
        let row = sqlx::query(
            r#"
            SELECT EXISTS(
                SELECT 1
                FROM permissions p
                INNER JOIN role_permissions rp ON p.id = rp.permission_id
                INNER JOIN user_profiles up ON up.role_id = rp.role_id
                WHERE up.id = $1
                  AND p.name = $2
            ) as exists
            "#,
        )
        .bind(user_id)
        .bind(permission)
        .fetch_one(&self.pool)
        .await?;

        Ok(row.get::<bool, _>("exists"))
    }

    /// Update user's last seen timestamp
    #[instrument(skip(self))]
    pub async fn update_last_seen(&self, user_id: Uuid) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            UPDATE user_profiles
            SET last_seen = NOW()
            WHERE id = $1
            "#,
        )
        .bind(user_id)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Get organization by ID
    #[instrument(skip(self))]
    pub async fn get_organization(&self, org_id: Uuid) -> Result<Option<Organization>, sqlx::Error> {
        sqlx::query_as::<_, Organization>(
            r#"
            SELECT id, name, slug, created_at, updated_at, settings, status
            FROM organizations
            WHERE id = $1
            "#,
        )
        .bind(org_id)
        .fetch_optional(&self.pool)
        .await
    }

    /// Get all roles for an organization
    #[instrument(skip(self))]
    pub async fn get_organization_roles(&self, org_id: Uuid) -> Result<Vec<Role>, sqlx::Error> {
        sqlx::query_as::<_, Role>(
            r#"
            SELECT id, name, description, created_at, updated_at, organization_id, is_system
            FROM roles
            WHERE organization_id = $1 OR is_system = true
            ORDER BY is_system DESC, name
            "#,
        )
        .bind(org_id)
        .fetch_all(&self.pool)
        .await
    }

    /// Get all permissions for a role
    #[instrument(skip(self))]
    pub async fn get_role_permissions(&self, role_id: Uuid) -> Result<Vec<Permission>, sqlx::Error> {
        sqlx::query_as::<_, Permission>(
            r#"
            SELECT p.id, p.name, p.description, p.resource, p.action, p.created_at
            FROM permissions p
            INNER JOIN role_permissions rp ON p.id = rp.permission_id
            WHERE rp.role_id = $1 AND rp.granted = true
            ORDER BY p.resource, p.action
            "#,
        )
        .bind(role_id)
        .fetch_all(&self.pool)
        .await
    }
}
