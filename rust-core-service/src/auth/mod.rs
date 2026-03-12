//! Authentication module for secure JWT validation
//!
//! This module provides:
//! - JWKS-based JWT validation with RS256 support
//! - HS256 validation for service role tokens
//! - RBAC permission checking with caching
//! - Service-to-service API key authentication
//!
//! **CRITICAL SECURITY FIX**: Unlike the previous Python implementation that
//! skipped signature verification, this module performs full cryptographic
//! validation of JWT tokens.
//!
//! ## Service-to-Service Authentication
//! For internal microservice communication, use the `api_keys` module which
//! provides secure API key validation against the database.

pub mod api_keys;
pub mod claims;
pub mod jwks;
pub mod jwt;
pub mod rbac;

// JWT validation exports
pub use jwt::{JwtValidator, JwtError, hash_token, extract_bearer_token, ValidationResult};
pub use claims::SupabaseClaims;
pub use rbac::RbacService;

// Service API key exports
pub use api_keys::{
    ApiKeyValidator, 
    ApiKeyError, 
    ValidatedService, 
    extract_service_key, 
    AllowedServices,
    AllowedService,
    extract_key_parts,
};
