---
tags: [type/debug, status/active, domain/backend]
created: 2026-04-12
---
# Fix: Cycle Count Complete Endpoint - Variance Percentage Overflow

## Issue
500 Database error when completing cycle counts via POST /api/v1/work/tasks/:id/complete.

## Root Cause
complete_cycle_count in rust-work-service/src/db/queries.rs redundantly computed variance_percentage in SET clause without LEAST cap. Column is NUMERIC(5,2) max 999.99. PostgreSQL evaluates SET expressions and enforces column constraints BEFORE any BEFORE trigger fires, so the trigger's LEAST cap never got to apply.

## Solution
Removed variance_quantity and variance_percentage from UPDATE SET clause. The auto_calculate_cycle_count_variance trigger handles all variance logic with overflow protection.

## Related
- [[Rust Work Service - Task Operations]]