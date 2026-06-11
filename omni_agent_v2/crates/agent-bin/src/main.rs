// Created and developed by Jai Singh
//! Headless `agent.exe` entry point.
//!
//! 1. Parse CLI args.
//! 2. Init tracing.
//! 3. Read / write `~/.omniframe/v2/config.json`.
//! 4. Resolve `python` + `sap_helper.py` paths (alongside-EXE first).
//! 5. Spawn `AgentCore` and block on Ctrl-C.

use std::path::PathBuf;

use agent_core::{AgentConfigBuilder, AgentCore};
use agent_types::AGENT_VERSION_STR;
use anyhow::{Context, Result};
use clap::Parser;
use tracing::{info, warn};
use tracing_subscriber::EnvFilter;

#[derive(Debug, Parser)]
#[command(name = "agent", about = "OmniAgent v2 — headless SAP agent shell")]
struct Cli {
    /// Path to config.json. Defaults to `~/.omniframe/v2/config.json`.
    #[arg(long, env = "OMNIFRAME_AGENT_CONFIG")]
    config_path: Option<PathBuf>,
    /// Override the local HTTP port (defaults to 8765).
    #[arg(long, env = "OMNIFRAME_AGENT_PORT")]
    port: Option<u16>,
    /// Override the service-key path (slot 2 of the 3-tier loader).
    #[arg(long, env = "OMNIFRAME_AGENT_SERVICE_KEY_PATH")]
    service_key_path: Option<PathBuf>,
    /// Override the agent id (`<COMPUTERNAME>-<SESSIONNAME>-<USERNAME>`
    /// is the default).
    #[arg(long, env = "OMNIFRAME_AGENT_SELF_ID_OVERRIDE")]
    agent_id: Option<String>,
    /// Override the rust-work-service base URL.
    #[arg(long, env = "OMNIFRAME_WORK_SERVICE_URL")]
    work_service_url: Option<String>,
    /// Print version and exit.
    #[arg(long)]
    version: bool,
}

fn main() -> Result<()> {
    let cli = Cli::parse();

    if cli.version {
        println!("OmniAgent {AGENT_VERSION_STR}");
        return Ok(());
    }

    init_tracing();
    info!("OmniAgent {AGENT_VERSION_STR} starting");

    let config = build_config(&cli).context("build config")?;
    info!(
        port = config.port,
        work_service = %config.work_service_url,
        agent_id_override = ?cli.agent_id,
        "config resolved"
    );

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .context("build tokio runtime")?;

    runtime.block_on(async {
        if let Err(e) = AgentCore::run(config).await {
            warn!(error = %e, "agent.exe exited with error");
            return Err(e);
        }
        Ok(())
    })
}

fn init_tracing() {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,agent_core=info,agent_rpc=info,agent_ws=info"));
    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(true)
        .with_level(true)
        .init();
}

fn build_config(cli: &Cli) -> Result<agent_core::AgentConfig> {
    let mut builder = AgentConfigBuilder::new();

    // Auto-detect helper paths from the install dir.
    let install_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."));
    let bundled_python = install_dir.join("python").join("python.exe");
    let bundled_helper = install_dir.join("python").join("sap_helper.py");

    let python_exe = if bundled_python.exists() {
        bundled_python
    } else {
        PathBuf::from("python")
    };
    let helper_script = if bundled_helper.exists() {
        bundled_helper
    } else {
        install_dir.join("sap_helper.py")
    };

    builder = builder.python_exe(python_exe);
    builder = builder.helper_script(helper_script);

    if let Some(p) = cli.port {
        builder = builder.port(p);
    }
    if let Some(p) = cli.service_key_path.clone() {
        builder = builder.service_key_path(Some(p));
    }
    if let Some(id) = cli.agent_id.clone() {
        builder = builder.agent_id_override(Some(id));
    }
    if let Some(u) = cli.work_service_url.clone() {
        builder = builder.work_service_url(u);
    }

    Ok(builder.build())
}

// Created and developed by Jai Singh
