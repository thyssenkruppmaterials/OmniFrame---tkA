// Created and developed by Jai Singh
//! End-to-end integration: spawn the mock helper, call a few methods,
//! verify happy path + restart-on-crash. Skips cleanly if Python isn't
//! installed (so the macOS dev-host CI step never spuriously fails).

use std::path::PathBuf;
use std::time::Duration;

use agent_rpc::{HelperConfig, PythonHelper};
use agent_types::RpcMethod;
use serde_json::json;

fn mock_helper_path() -> PathBuf {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest.join("tests").join("mock_helper.py")
}

fn python_exe() -> Option<PathBuf> {
    if which("python3").is_some() {
        Some(PathBuf::from("python3"))
    } else if which("python").is_some() {
        Some(PathBuf::from("python"))
    } else {
        None
    }
}

fn which(cmd: &str) -> Option<PathBuf> {
    std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths).find_map(|dir| {
            let p = dir.join(cmd);
            if p.is_file() {
                Some(p)
            } else {
                None
            }
        })
    })
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn happy_path() {
    let Some(py) = python_exe() else {
        eprintln!("python not on PATH — skipping");
        return;
    };
    let helper = PythonHelper::spawn_with(HelperConfig {
        python_exe: py,
        helper_script: mock_helper_path(),
        call_timeout: Duration::from_secs(5),
        ..HelperConfig::default()
    })
    .await
    .expect("spawn helper");

    // Give the supervisor a beat to attach the reader/writer.
    let mut tries = 0;
    while !helper.is_alive() && tries < 100 {
        tokio::time::sleep(Duration::from_millis(20)).await;
        tries += 1;
    }
    assert!(helper.is_alive(), "helper should be alive after spawn");

    let resp: serde_json::Value = helper
        .call(RpcMethod::SapConnect, json!({"slot_id": 3}))
        .await
        .expect("sap.connect");
    assert_eq!(resp["ok"], serde_json::Value::Bool(true));
    assert_eq!(resp["slot_id"], serde_json::json!(3));

    let resp: serde_json::Value = helper
        .call(RpcMethod::SapConfirmTo, json!({"to_number": "8801"}))
        .await
        .expect("sap.confirmTo");
    assert_eq!(resp["to_number"], serde_json::json!("8801"));

    // Method-not-found is surfaced as a structured error, not a panic.
    // We send a real RpcMethod variant the mock helper does NOT register
    // (the mock only knows `sap.connect` + `sap.confirmTo`); using
    // `RpcMethod::SapQuery` here guarantees the helper replies with a
    // METHOD_NOT_FOUND envelope.
    let err = helper
        .call::<_, serde_json::Value>(RpcMethod::SapQuery, json!({}))
        .await
        .expect_err("expected method-not-found");
    let s = format!("{err}");
    assert!(s.contains("method not found"), "unexpected err: {s}");

    helper.shutdown().await.expect("shutdown clean");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn supervisor_restarts_after_crash() {
    let Some(py) = python_exe() else {
        eprintln!("python not on PATH — skipping");
        return;
    };
    let helper = PythonHelper::spawn_with(HelperConfig {
        python_exe: py,
        helper_script: mock_helper_path(),
        call_timeout: Duration::from_secs(2),
        restart_backoff_initial: Duration::from_millis(50),
        restart_backoff_max: Duration::from_millis(200),
        // Make the threshold high enough that the child being killed in
        // <500ms always counts as "unhealthy" → restart_count++.
        stable_threshold: Duration::from_secs(5),
        ..HelperConfig::default()
    })
    .await
    .expect("spawn helper");

    let mut tries = 0;
    while !helper.is_alive() && tries < 100 {
        tokio::time::sleep(Duration::from_millis(20)).await;
        tries += 1;
    }
    assert!(helper.is_alive(), "helper should be alive after spawn");

    let pid = helper.status().pid.expect("pid present");
    #[cfg(unix)]
    unsafe {
        libc_kill(pid as i32, 9);
    }
    #[cfg(not(unix))]
    {
        let _ = pid;
        eprintln!("non-unix host — skipping kill");
        helper.shutdown().await.unwrap();
        return;
    }

    // Supervisor should respawn within a few hundred ms.
    let mut respawn_seen = false;
    for _ in 0..200 {
        if helper.status().restart_count > 0 {
            respawn_seen = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert!(respawn_seen, "supervisor should have respawned helper");

    helper.shutdown().await.unwrap();
}

#[cfg(unix)]
extern "C" {
    fn kill(pid: i32, sig: i32) -> i32;
}

#[cfg(unix)]
unsafe fn libc_kill(pid: i32, sig: i32) {
    unsafe { kill(pid, sig) };
}

// Created and developed by Jai Singh
