// Created and developed by Jai Singh
//! Helper supervisor — owns the `tokio::process::Child` and the
//! reader/writer tasks. Restart policy: bounded exponential backoff
//! 1s→30s, reset to 1s after the helper has been alive for
//! `STABLE_THRESHOLD_SEC`.

use std::path::PathBuf;
use std::time::Duration;

use serde::Deserialize;

/// Tunables for [`crate::PythonHelper::spawn`]. Most callers want
/// `HelperConfig::default()` and then `with_*` overrides.
#[derive(Debug, Clone)]
pub struct HelperConfig {
    /// Path to the Python interpreter — typically `<exe-dir>/python/python.exe`
    /// on a packaged install, or `python` from `PATH` for local dev.
    pub python_exe: PathBuf,
    /// Path to the helper script the interpreter executes.
    pub helper_script: PathBuf,
    /// Extra args passed to the helper after the script path.
    pub extra_args: Vec<String>,
    /// Per-call timeout. 600s matches the longest SAP recording-replay
    /// the v1.x Python agent supports.
    pub call_timeout: Duration,
    /// Initial restart backoff. Doubles up to `restart_backoff_max`.
    pub restart_backoff_initial: Duration,
    pub restart_backoff_max: Duration,
    /// How long the helper has to stay alive before the supervisor
    /// resets its backoff to the initial value.
    pub stable_threshold: Duration,
    /// If true, the supervisor exits the process when the helper has
    /// crashed `max_crash_loops` times within `crash_loop_window`. Used
    /// by `agent.exe` as a fail-fast for "the helper is fundamentally
    /// broken on this box". Defaults to disabled — the agent prefers
    /// to keep its HTTP surface alive even if SAP isn't reachable.
    pub fail_fast_after: Option<(u32, Duration)>,
}

impl Default for HelperConfig {
    fn default() -> Self {
        Self {
            python_exe: PathBuf::from("python"),
            helper_script: PathBuf::from("sap_helper.py"),
            extra_args: vec![],
            call_timeout: Duration::from_secs(600),
            restart_backoff_initial: Duration::from_secs(1),
            restart_backoff_max: Duration::from_secs(30),
            stable_threshold: Duration::from_secs(60),
            fail_fast_after: None,
        }
    }
}

impl HelperConfig {
    pub fn with_call_timeout(mut self, d: Duration) -> Self {
        self.call_timeout = d;
        self
    }
}

/// One line read from the helper's stdout. Parsed by the reader task
/// before being routed.
#[derive(Debug, Deserialize)]
pub(crate) struct EnvelopePeek {
    #[serde(default)]
    pub id: Option<u64>,
    #[serde(default)]
    pub method: Option<String>,
}

// Created and developed by Jai Singh
