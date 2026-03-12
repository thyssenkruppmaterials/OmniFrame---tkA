//! Role-Based Access Control (RBAC) service
//!
//! Provides permission checking with in-memory caching for high performance.

use sqlx::PgPool;
use std::collections::HashSet;
use std::time::{Duration, Instant};
use dashmap::DashMap;
use tracing::{instrument, debug};
use serde::{Serialize, Deserialize};

/// RBAC service for permission management
pub struct RbacService {
    pool: PgPool,
    /// Permission cache: user_id -> (permissions, cached_at)
    permission_cache: DashMap<String, (HashSet<String>, Instant)>,
    /// Cache TTL
    cache_ttl: Duration,
}

impl RbacService {
    /// Create a new RBAC service
    pub fn new(pool: PgPool) -> Self {
        Self {
            pool,
            permission_cache: DashMap::new(),
            cache_ttl: Duration::from_secs(300), // 5 minutes
        }
    }

    /// Create with custom cache TTL
    pub fn with_cache_ttl(pool: PgPool, cache_ttl: Duration) -> Self {
        Self {
            pool,
            permission_cache: DashMap::new(),
            cache_ttl,
        }
    }

    /// Get all permissions for a user
    #[instrument(skip(self))]
    pub async fn get_user_permissions(
        &self,
        user_id: &str,
    ) -> Result<HashSet<String>, sqlx::Error> {
        // Check cache first
        if let Some(cached) = self.permission_cache.get(user_id) {
            if cached.1.elapsed() < self.cache_ttl {
                metrics::counter!("rbac.cache.hit").increment(1);
                debug!(user_id = %user_id, "Permission cache hit");
                return Ok(cached.0.clone());
            }
        }
        metrics::counter!("rbac.cache.miss").increment(1);

        // Query database for permissions from two sources:
        // 1. Role-based: user_profiles.role_id -> role_permissions -> permissions
        // 2. Direct: user_permissions -> permissions (granted & not expired)
        // Note: There is no user_roles table - role is stored in user_profiles.role_id
        let permissions: Vec<String> = sqlx::query_scalar(
            r#"
            SELECT DISTINCT p.name
            FROM permissions p
            INNER JOIN role_permissions rp ON p.id = rp.permission_id
            INNER JOIN user_profiles up ON up.role_id = rp.role_id
            WHERE up.id = $1::uuid

            UNION

            SELECT p.name
            FROM permissions p
            INNER JOIN user_permissions uper ON p.id = uper.permission_id
            WHERE uper.user_id = $1::uuid
              AND uper.granted = true
              AND (uper.expires_at IS NULL OR uper.expires_at > NOW())
            "#
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?;

        let permission_set: HashSet<String> = permissions.into_iter().collect();

        debug!(
            user_id = %user_id,
            permission_count = permission_set.len(),
            "Loaded permissions from database"
        );

        // Update cache
        self.permission_cache.insert(
            user_id.to_string(),
            (permission_set.clone(), Instant::now())
        );

        Ok(permission_set)
    }

    /// Check if user has a specific permission
    #[instrument(skip(self))]
    pub async fn user_has_permission(
        &self,
        user_id: &str,
        required: &str,
    ) -> Result<bool, sqlx::Error> {
        let permissions = self.get_user_permissions(user_id).await?;
        Ok(self.has_permission(&permissions, required))
    }

    /// Check if a permission set contains a required permission
    pub fn has_permission(&self, permissions: &HashSet<String>, required: &str) -> bool {
        // Check exact match
        if permissions.contains(required) {
            return true;
        }

        // Check for admin/superuser permissions
        if permissions.contains("*") || permissions.contains("admin:*") {
            return true;
        }

        // Check resource wildcards (e.g., "warehouse:*" matches "warehouse:view")
        if let Some((resource, _action)) = required.split_once(':') {
            let wildcard = format!("{}:*", resource);
            if permissions.contains(&wildcard) {
                return true;
            }
        }

        false
    }

    /// Check multiple permissions (returns true if user has ALL)
    pub fn has_all_permissions(&self, permissions: &HashSet<String>, required: &[&str]) -> bool {
        required.iter().all(|p| self.has_permission(permissions, p))
    }

    /// Check multiple permissions (returns true if user has ANY)
    pub fn has_any_permission(&self, permissions: &HashSet<String>, required: &[&str]) -> bool {
        required.iter().any(|p| self.has_permission(permissions, p))
    }

    /// Invalidate cache for a specific user
    pub fn invalidate_cache(&self, user_id: &str) {
        self.permission_cache.remove(user_id);
        metrics::counter!("rbac.cache.invalidate").increment(1);
        debug!(user_id = %user_id, "Permission cache invalidated");
    }

    /// Invalidate all cached permissions
    pub fn invalidate_all(&self) {
        let count = self.permission_cache.len();
        self.permission_cache.clear();
        metrics::counter!("rbac.cache.invalidate_all").increment(1);
        debug!(entries = count, "All permission caches invalidated");
    }

    /// Get cache statistics
    pub fn cache_stats(&self) -> CacheStats {
        CacheStats {
            entries: self.permission_cache.len(),
            ttl_seconds: self.cache_ttl.as_secs(),
        }
    }

    /// Get user's roles (via user_profiles.role_id)
    /// Note: No user_roles table - role is directly on user_profiles
    #[instrument(skip(self))]
    pub async fn get_user_roles(&self, user_id: &str) -> Result<Vec<UserRole>, sqlx::Error> {
        sqlx::query_as::<_, UserRole>(
            r#"
            SELECT 
                r.id as role_id,
                r.name as role_name,
                r.description,
                up.created_at as assigned_at,
                NULL::timestamptz as expires_at
            FROM roles r
            INNER JOIN user_profiles up ON up.role_id = r.id
            WHERE up.id = $1::uuid
            ORDER BY r.name
            "#
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await
    }
}

/// Cache statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CacheStats {
    pub entries: usize,
    pub ttl_seconds: u64,
}

/// User role information
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct UserRole {
    pub role_id: uuid::Uuid,
    pub role_name: String,
    pub description: Option<String>,
    pub assigned_at: Option<chrono::DateTime<chrono::Utc>>,
    pub expires_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// Permission check result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionCheckResult {
    pub user_id: String,
    pub has_permission: bool,
    pub checked_permission: String,
    pub all_permissions: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Create an RbacService for unit tests that only exercise pure permission logic.
    /// Uses `connect_lazy` so no actual database connection is established — the pool
    /// is structurally valid but will only attempt a real connection if a query is executed.
    fn test_service() -> RbacService {
        let pool = sqlx::postgres::PgPoolOptions::new()
            .connect_lazy("postgres://test@localhost/test")
            .expect("connect_lazy should not fail for a valid URL format");
        RbacService {
            pool,
            permission_cache: DashMap::new(),
            cache_ttl: Duration::from_secs(300),
        }
    }

    #[tokio::test]
    async fn test_has_permission_exact() {
        let service = test_service();
        
        let mut perms = HashSet::new();
        perms.insert("warehouse:view".to_string());
        perms.insert("warehouse:edit".to_string());
        
        assert!(service.has_permission(&perms, "warehouse:view"));
        assert!(service.has_permission(&perms, "warehouse:edit"));
        assert!(!service.has_permission(&perms, "warehouse:delete"));
    }

    #[tokio::test]
    async fn test_has_permission_wildcard() {
        let service = test_service();
        
        let mut perms = HashSet::new();
        perms.insert("warehouse:*".to_string());
        
        assert!(service.has_permission(&perms, "warehouse:view"));
        assert!(service.has_permission(&perms, "warehouse:edit"));
        assert!(service.has_permission(&perms, "warehouse:delete"));
        assert!(!service.has_permission(&perms, "admin:view"));
    }

    #[tokio::test]
    async fn test_has_permission_admin() {
        let service = test_service();
        
        let mut perms = HashSet::new();
        perms.insert("*".to_string());
        
        assert!(service.has_permission(&perms, "anything:goes"));
        assert!(service.has_permission(&perms, "admin:super_secret"));
    }
}
