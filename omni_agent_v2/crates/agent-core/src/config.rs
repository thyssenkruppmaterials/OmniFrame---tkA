// Created and developed by Jai Singh
//! Boot config for the agent. Read from `~/.omniframe/v2/config.json`
//! (or env-var overrides). Mirrors the v1.x `AgentState` defaults so an
//! operator dropping a v2 binary into the same install dir picks up
//! the existing configuration.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use agent_types::AGENT_PORT;

/// One-stop config blob. Cheaply cloned so background tasks can carry
/// their own copies without sharing a lock.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct AgentConfig {
    /// TCP port the HTTP server binds to. Defaults to 8765.
    #[serde(default = "default_port")]
    pub port: u16,

    /// Path to the Python interpreter the helper subprocess uses.
    #[serde(default = "default_python_exe")]
    pub python_exe: PathBuf,

    /// Path to the Python helper script (`sap_helper.py`).
    #[serde(default = "default_helper_script")]
    pub helper_script: PathBuf,

    /// Base URL of the rust-work-service control plane. Defaults to
    /// the production Railway URL; override via env var for local dev.
    #[serde(default = "default_work_service_url")]
    pub work_service_url: String,

    /// Supabase project URL — needed for the `/supabase/login`
    /// passthrough.
    #[serde(default = "default_supabase_url")]
    pub supabase_url: String,

    /// Path to the canonical service-key file (slot 2 of the 3-tier
    /// loader). Defaults to `~/.omniframe/agent_service_key.txt`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub service_key_path: Option<PathBuf>,

    /// Where the agent persists its rotating config + token cache.
    #[serde(default = "default_config_dir")]
    pub config_dir: PathBuf,

    /// Per-host installation directory (used for the alongside-EXE
    /// service-key fallback + the GUI's "Open install folder" link).
    #[serde(default = "default_install_dir")]
    pub install_dir: PathBuf,

    /// Stable agent id override. Defaults to the v1.x convention
    /// (`<COMPUTERNAME>-<SESSIONNAME>-<USERNAME>`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_id_override: Option<String>,
}

fn default_port() -> u16 {
    AGENT_PORT
}
fn default_python_exe() -> PathBuf {
    PathBuf::from("python")
}
fn default_helper_script() -> PathBuf {
    PathBuf::from("sap_helper.py")
}
fn default_work_service_url() -> String {
    "https://rust-work-service-production.up.railway.app".to_string()
}
fn default_supabase_url() -> String {
    String::new()
}
fn default_config_dir() -> PathBuf {
    dirs::home_dir()
        .map(|h| h.join(".omniframe").join("v2"))
        .unwrap_or_else(|| PathBuf::from(".omniframe-v2"))
}
fn default_install_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."))
}

impl Default for AgentConfig {
    fn default() -> Self {
        Self {
            port: default_port(),
            python_exe: default_python_exe(),
            helper_script: default_helper_script(),
            work_service_url: default_work_service_url(),
            supabase_url: default_supabase_url(),
            service_key_path: None,
            config_dir: default_config_dir(),
            install_dir: default_install_dir(),
            agent_id_override: None,
        }
    }
}

/// Builder pattern for ergonomic CLI override on top of the defaults.
#[derive(Debug, Clone, Default)]
pub struct AgentConfigBuilder {
    inner: AgentConfig,
}

impl AgentConfigBuilder {
    pub fn new() -> Self {
        Self {
            inner: AgentConfig::default(),
        }
    }
    pub fn port(mut self, p: u16) -> Self {
        self.inner.port = p;
        self
    }
    pub fn python_exe(mut self, p: PathBuf) -> Self {
        self.inner.python_exe = p;
        self
    }
    pub fn helper_script(mut self, p: PathBuf) -> Self {
        self.inner.helper_script = p;
        self
    }
    pub fn work_service_url(mut self, u: String) -> Self {
        self.inner.work_service_url = u;
        self
    }
    pub fn supabase_url(mut self, u: String) -> Self {
        self.inner.supabase_url = u;
        self
    }
    pub fn service_key_path(mut self, p: Option<PathBuf>) -> Self {
        self.inner.service_key_path = p;
        self
    }
    pub fn agent_id_override(mut self, id: Option<String>) -> Self {
        self.inner.agent_id_override = id;
        self
    }
    pub fn build(self) -> AgentConfig {
        self.inner
    }
}

// Created and developed by Jai Singh
