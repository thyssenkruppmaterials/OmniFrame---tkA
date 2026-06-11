// Created and developed by Jai Singh
//! axum router assembly. Wires every endpoint + middleware. The
//! 45-endpoint matrix is documented inline so a future grep for any
//! route name lands here.

use std::sync::Arc;

use axum::middleware;
use axum::routing::{delete, get, post};
use axum::Router;
use tower_http::compression::CompressionLayer;
use tower_http::cors::{Any, CorsLayer};

use crate::config::AgentConfig;
use crate::routes;
use crate::routes::AppContext;
use crate::state::AgentState;
use agent_rpc::PythonHelper;
use agent_ws::WorkServiceWs;

pub fn build_router(
    state: Arc<AgentState>,
    helper: PythonHelper,
    ws: WorkServiceWs,
    config: AgentConfig,
) -> Router {
    let ctx = AppContext {
        state: state.clone(),
        helper,
        ws,
        config,
    };

    let cors = CorsLayer::new()
        .allow_methods(Any)
        .allow_headers(Any)
        .allow_origin(Any);

    Router::new()
        // ── Lifecycle / health (Rust-native, no RPC) ────────
        .route("/health", get(routes::lifecycle::health))
        .route("/status", get(routes::lifecycle::status))
        .route("/metrics", get(routes::lifecycle::metrics))
        .route("/shutdown", post(routes::lifecycle::shutdown))
        .route("/realtime/status", get(routes::lifecycle::realtime_status))
        .route(
            "/agent-token/check",
            get(routes::lifecycle::agent_token_check),
        )
        .route(
            "/agent-token/rotate",
            post(routes::lifecycle::agent_token_rotate),
        )
        // ── Auth / Supabase passthrough ─────────────────────
        .route("/supabase/login", post(routes::auth::login))
        .route("/supabase/session", get(routes::auth::session))
        .route("/supabase/logout", post(routes::auth::logout))
        // ── Agents fleet (read-only proxy) ───────────────────
        .route("/agents", get(routes::agents::list))
        .route("/agents/:agent_id", get(routes::agents::get_one))
        // ── Jobs lifecycle ───────────────────────────────────
        .route("/jobs/claim", post(routes::jobs::claim))
        .route("/jobs/:job_id/complete", post(routes::jobs::complete))
        .route("/jobs/:job_id/fail", post(routes::jobs::fail))
        .route("/jobs/:job_id/heartbeat", post(routes::jobs::heartbeat))
        // ── SAP routes (forward to PythonHelper) ────────────
        .route("/sap/connect", post(routes::sap::connect))
        .route("/sap/disconnect", post(routes::sap::disconnect))
        .route("/sap/sessions", get(routes::sap::list_sessions))
        .route("/sap/session", post(routes::sap::session_info))
        .route("/sap/select-session", post(routes::sap::select_session))
        .route("/sap/unpin-session", post(routes::sap::unpin_session))
        .route(
            "/sap/shipment-progress",
            get(routes::sap::shipment_progress),
        )
        .route("/sap/confirm-to", post(routes::sap::confirm_to))
        .route(
            "/sap/transfer-inventory",
            post(routes::sap::transfer_inventory),
        )
        .route("/sap/bin-blocks", post(routes::sap::bin_blocks))
        .route(
            "/sap/material-master-bin",
            post(routes::sap::material_master_bin),
        )
        .route(
            "/sap/material-master-storage-types",
            post(routes::sap::material_master_storage_types),
        )
        .route(
            "/sap/create-storage-bin",
            post(routes::sap::create_storage_bin),
        )
        .route(
            "/sap/material-master-read-bin",
            post(routes::sap::material_master_read_bin),
        )
        .route(
            "/sap/material-master-read-storage-types",
            post(routes::sap::material_master_read_storage_types),
        )
        .route("/sap/query", post(routes::sap::query))
        .route("/sap/query-handlers", get(routes::sap::list_query_handlers))
        .route("/sap/process-shipment", post(routes::sap::process_shipment))
        .route("/sap/import-lt22", post(routes::sap::import_lt22))
        .route("/sap/zmm60/lookup", post(routes::sap::zmm60_lookup))
        .route(
            "/sap/lx25/inventory-completion",
            post(routes::sap::lx25_completion),
        )
        // Pure-fn — answered locally without a helper round-trip.
        .route(
            "/sap/reversal/compute-inverse",
            post(routes::sap::reversal_compute_inverse),
        )
        // ── SAP recording ───────────────────────────────────
        .route("/sap/recording/start", post(routes::recording::start))
        .route("/sap/recording/stop", post(routes::recording::stop))
        .route("/sap/recording/status", get(routes::recording::status))
        .route("/sap/recording/list", get(routes::recording::list))
        .route("/sap/recording/:rec_id", get(routes::recording::get_one))
        .route(
            "/sap/recording/:rec_id",
            delete(routes::recording::delete_one),
        )
        .route(
            "/sap/recording/:rec_id/translate",
            post(routes::recording::translate),
        )
        .route(
            "/sap/recording/:rec_id/replay",
            post(routes::recording::replay),
        )
        // ── NEW v2 routes — multi-session pool ──────────────
        .route("/sap/v2/sessions", get(routes::session_v2::list))
        .route(
            "/sap/v2/sessions/:slot_id/connect",
            post(routes::session_v2::connect),
        )
        .route(
            "/sap/v2/sessions/:slot_id/disconnect",
            post(routes::session_v2::disconnect),
        )
        .route(
            "/sap/v2/sessions/:slot_id/pin",
            post(routes::session_v2::pin),
        )
        .route(
            "/sap/v2/sessions/:slot_id/release",
            post(routes::session_v2::release),
        )
        .with_state(ctx)
        .layer(middleware::from_fn_with_state(
            state.clone(),
            crate::middleware::token_guard,
        ))
        .layer(middleware::from_fn(
            crate::middleware::private_network_access,
        ))
        .layer(CompressionLayer::new())
        .layer(cors)
}

// Created and developed by Jai Singh
