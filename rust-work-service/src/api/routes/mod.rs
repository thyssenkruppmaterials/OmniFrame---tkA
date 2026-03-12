//! API route modules for rust-work-service

pub mod health;
pub mod work;
pub mod workers;

// Re-export route handlers for convenience
pub use health::{health_check, health_check_detailed};
pub use work::work_routes;
pub use workers::workers_routes;

// Note: WebSocket handler is exported directly from crate::websocket module
// and used in main.rs for the /ws route
