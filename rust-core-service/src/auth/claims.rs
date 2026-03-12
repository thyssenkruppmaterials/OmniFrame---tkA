//! JWT claims structures for Supabase tokens

use serde::{Deserialize, Serialize};

/// Supabase JWT claims
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SupabaseClaims {
    /// Subject - User ID
    pub sub: String,
    /// User email (optional for anonymous users)
    pub email: Option<String>,
    /// Audience - should be "authenticated"
    pub aud: String,
    /// Supabase role
    pub role: String,
    /// Expiration timestamp (Unix epoch)
    pub exp: i64,
    /// Issued at timestamp (Unix epoch)
    pub iat: i64,
    /// Issuer - Supabase project URL
    pub iss: String,
    /// Application metadata
    #[serde(default)]
    pub app_metadata: AppMetadata,
    /// User metadata
    #[serde(default)]
    pub user_metadata: UserMetadata,
}

/// Application metadata from Supabase Auth
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AppMetadata {
    /// Auth provider (email, google, etc.)
    #[serde(default)]
    pub provider: String,
    /// List of providers the user has linked
    #[serde(default)]
    pub providers: Vec<String>,
}

/// User metadata from Supabase Auth
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct UserMetadata {
    /// User's full name
    #[serde(default)]
    pub full_name: Option<String>,
    /// User's avatar URL
    #[serde(default)]
    pub avatar_url: Option<String>,
    /// User's preferred name
    #[serde(default)]
    pub name: Option<String>,
    /// User's picture URL (from OAuth)
    #[serde(default)]
    pub picture: Option<String>,
}

impl SupabaseClaims {
    /// Check if the token is expired
    pub fn is_expired(&self) -> bool {
        let now = chrono::Utc::now().timestamp();
        self.exp < now
    }

    /// Get remaining lifetime in seconds
    pub fn remaining_lifetime(&self) -> i64 {
        let now = chrono::Utc::now().timestamp();
        self.exp - now
    }

    /// Check if the token will expire within the given duration
    pub fn expires_within(&self, duration: std::time::Duration) -> bool {
        let threshold = chrono::Utc::now().timestamp() + duration.as_secs() as i64;
        self.exp < threshold
    }

    /// Get the user's display name
    pub fn display_name(&self) -> Option<&str> {
        self.user_metadata.full_name.as_deref()
            .or(self.user_metadata.name.as_deref())
            .or(self.email.as_deref())
    }

    /// Get the user's avatar URL
    pub fn avatar_url(&self) -> Option<&str> {
        self.user_metadata.avatar_url.as_deref()
            .or(self.user_metadata.picture.as_deref())
    }
}

/// Validated user information extracted from JWT
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidatedUser {
    /// User ID
    pub user_id: String,
    /// User email
    pub email: Option<String>,
    /// User role
    pub role: String,
    /// Token expiration
    pub expires_at: i64,
    /// Whether the user is authenticated (not anonymous)
    pub is_authenticated: bool,
}

impl From<SupabaseClaims> for ValidatedUser {
    fn from(claims: SupabaseClaims) -> Self {
        Self {
            user_id: claims.sub,
            email: claims.email,
            role: claims.role.clone(),
            expires_at: claims.exp,
            is_authenticated: claims.role == "authenticated",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_claims_expiration() {
        let claims = SupabaseClaims {
            sub: "user123".to_string(),
            email: Some("test@example.com".to_string()),
            aud: "authenticated".to_string(),
            role: "authenticated".to_string(),
            exp: chrono::Utc::now().timestamp() + 3600, // 1 hour from now
            iat: chrono::Utc::now().timestamp(),
            iss: "https://example.supabase.co/auth/v1".to_string(),
            app_metadata: AppMetadata::default(),
            user_metadata: UserMetadata::default(),
        };

        assert!(!claims.is_expired());
        assert!(claims.remaining_lifetime() > 3500);
        assert!(claims.expires_within(std::time::Duration::from_secs(7200)));
    }
}
