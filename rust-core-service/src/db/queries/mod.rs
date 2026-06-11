// Created and developed by Jai Singh
//! Database query implementations
//!
//! High-performance compiled queries using sqlx.

pub mod warehouse;
pub mod auth;
pub mod productivity;
pub mod lx03;

pub use warehouse::WarehouseQueries;
pub use auth::AuthQueries;
pub use productivity::ProductivityQueries;
pub use lx03::LX03Queries;

// Created and developed by Jai Singh
