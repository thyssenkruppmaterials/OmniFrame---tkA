// Created and developed by Jai Singh
//! [`PythonHelper`] — public handle to the supervised subprocess.

use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;

use agent_types::{RpcError, RpcMethod, RpcNotification, RpcRequest, RpcResponse};
use dashmap::DashMap;
use parking_lot::Mutex;
use serde::{de::DeserializeOwned, Serialize};
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::{broadcast, mpsc, oneshot};
use tokio::task::JoinHandle;
use tracing::{debug, error, info, warn};

use crate::supervisor::{EnvelopePeek, HelperConfig};
use crate::types::{HelperCallError, HelperStatus};

/// Notification broadcast capacity. We size this so a slow consumer
/// (e.g. the GUI console drawer when nothing is opened) can lag by 1000
/// notifications before the broadcast channel starts dropping.
const NOTIFICATION_BROADCAST_CAPACITY: usize = 1000;

/// Channel between the public `call()` surface and the writer task.
const REQUEST_CHANNEL_CAPACITY: usize = 256;

/// Internal envelope routed by id to the awaiting `call()`.
type ResponseSender = oneshot::Sender<Result<Value, RpcError>>;

/// Long-lived JSON-RPC client. Drop-safe: dropping the only handle
/// shuts down the supervisor, terminates the child, and waits for the
/// reader/writer tasks to drain.
#[derive(Clone)]
pub struct PythonHelper {
    inner: Arc<HelperInner>,
}

struct HelperInner {
    config: HelperConfig,
    next_id: AtomicU64,
    pending: Arc<DashMap<u64, ResponseSender>>,
    requests_tx: mpsc::Sender<OutgoingRequest>,
    notifications_tx: broadcast::Sender<RpcNotification>,
    alive: AtomicBool,
    restart_count: AtomicU64,
    current_pid: AtomicU32,
    shutdown_tx: Mutex<Option<oneshot::Sender<()>>>,
    supervisor_task: Mutex<Option<JoinHandle<()>>>,
}

/// Items the writer task sees on the requests channel.
struct OutgoingRequest {
    line: String,
    /// If the writer task fails to flush this line (broken pipe),
    /// it has to notify whoever owns the matching pending entry. We
    /// stash a `Result<(), io::Error>` back through here.
    written: oneshot::Sender<Result<(), String>>,
    /// Pending id — kept for log breadcrumbs even though the writer
    /// itself doesn't route by id (the routing is done by id in the
    /// reader loop, against `pending`).
    #[allow(dead_code)]
    id: u64,
}

impl PythonHelper {
    /// Spawn the helper with default config. Returns a clonable handle
    /// that supervises the child for the rest of the process lifetime.
    pub async fn spawn(python_exe: PathBuf, helper_script: PathBuf) -> anyhow::Result<Self> {
        Self::spawn_with(HelperConfig {
            python_exe,
            helper_script,
            ..HelperConfig::default()
        })
        .await
    }

    /// Spawn the helper with explicit config. Used by tests to point
    /// at the mock helper without touching env vars.
    pub async fn spawn_with(config: HelperConfig) -> anyhow::Result<Self> {
        let (requests_tx, requests_rx) = mpsc::channel::<OutgoingRequest>(REQUEST_CHANNEL_CAPACITY);
        let (notifications_tx, _) =
            broadcast::channel::<RpcNotification>(NOTIFICATION_BROADCAST_CAPACITY);
        let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

        let pending = Arc::new(DashMap::<u64, ResponseSender>::new());
        let inner = Arc::new(HelperInner {
            config: config.clone(),
            next_id: AtomicU64::new(1),
            pending: pending.clone(),
            requests_tx,
            notifications_tx: notifications_tx.clone(),
            alive: AtomicBool::new(false),
            restart_count: AtomicU64::new(0),
            current_pid: AtomicU32::new(0),
            shutdown_tx: Mutex::new(Some(shutdown_tx)),
            supervisor_task: Mutex::new(None),
        });

        let supervisor_inner = inner.clone();
        let task = tokio::spawn(async move {
            supervisor_loop(supervisor_inner, requests_rx, shutdown_rx).await;
        });
        *inner.supervisor_task.lock() = Some(task);

        Ok(Self { inner })
    }

    /// Snapshot of supervisor state. Cheap; reads atomic ints.
    pub fn status(&self) -> HelperStatus {
        let pid = self.inner.current_pid.load(Ordering::Relaxed);
        HelperStatus {
            ever_started: self.inner.alive.load(Ordering::Relaxed)
                || self.inner.restart_count.load(Ordering::Relaxed) > 0,
            restart_count: self.inner.restart_count.load(Ordering::Relaxed),
            pid: if pid == 0 { None } else { Some(pid) },
        }
    }

    /// Is the child currently alive?
    pub fn is_alive(&self) -> bool {
        self.inner.alive.load(Ordering::Relaxed)
    }

    /// Subscribe to one-way notifications (log lines, slot state flips).
    /// Returns a fresh receiver; existing receivers are unaffected.
    pub fn subscribe_notifications(&self) -> broadcast::Receiver<RpcNotification> {
        self.inner.notifications_tx.subscribe()
    }

    /// Strongly-typed call.
    pub async fn call<P, R>(&self, method: RpcMethod, params: P) -> Result<R, HelperCallError>
    where
        P: Serialize,
        R: DeserializeOwned,
    {
        let id = self.inner.next_id.fetch_add(1, Ordering::Relaxed);
        let req = RpcRequest::new(id, method, params);
        let mut line = serde_json::to_string(&req).map_err(HelperCallError::Serialize)?;
        line.push('\n');

        let (resp_tx, resp_rx) = oneshot::channel();
        self.inner.pending.insert(id, resp_tx);

        let (write_ack_tx, write_ack_rx) = oneshot::channel();
        let outgoing = OutgoingRequest {
            line,
            written: write_ack_tx,
            id,
        };

        if self.inner.requests_tx.send(outgoing).await.is_err() {
            self.inner.pending.remove(&id);
            return Err(HelperCallError::ChannelClosed(
                "supervisor request channel closed".to_string(),
            ));
        }

        // Wait for the writer to confirm the line hit the pipe. If it
        // fails we drop the pending entry and surface the error.
        match write_ack_rx.await {
            Ok(Ok(())) => {}
            Ok(Err(msg)) => {
                self.inner.pending.remove(&id);
                return Err(HelperCallError::ChannelClosed(format!(
                    "write to helper failed: {msg}"
                )));
            }
            Err(_) => {
                self.inner.pending.remove(&id);
                return Err(HelperCallError::ChannelClosed(
                    "writer task dropped before ack".to_string(),
                ));
            }
        }

        let started = Instant::now();
        let timeout = self.inner.config.call_timeout;

        let response = match tokio::time::timeout(timeout, resp_rx).await {
            Ok(Ok(Ok(value))) => value,
            Ok(Ok(Err(err))) => return Err(HelperCallError::Rpc(err)),
            Ok(Err(_)) => {
                self.inner.pending.remove(&id);
                return Err(HelperCallError::ChannelClosed(
                    "pending response dropped (helper crashed during call)".to_string(),
                ));
            }
            Err(_) => {
                self.inner.pending.remove(&id);
                let elapsed_ms = started.elapsed().as_millis() as u64;
                return Err(HelperCallError::Timeout { elapsed_ms });
            }
        };

        serde_json::from_value::<R>(response).map_err(HelperCallError::Deserialize)
    }

    /// Graceful shutdown — sends the stop signal to the supervisor,
    /// then awaits the supervisor task.
    pub async fn shutdown(&self) -> anyhow::Result<()> {
        if let Some(tx) = self.inner.shutdown_tx.lock().take() {
            let _ = tx.send(());
        }
        let handle = self.inner.supervisor_task.lock().take();
        if let Some(h) = handle {
            let _ = h.await;
        }
        Ok(())
    }
}

impl Drop for HelperInner {
    fn drop(&mut self) {
        // Best-effort: prompt the supervisor to stop. We can't await
        // anything in Drop, but the supervisor task is `tokio::spawn`ed
        // so it'll drain on its own once the runtime sees the channels
        // close.
        if let Some(tx) = self.shutdown_tx.lock().take() {
            let _ = tx.send(());
        }
    }
}

/// Top-level supervisor loop: spawn child → run reader/writer →
/// observe exit → backoff → spawn again.
async fn supervisor_loop(
    inner: Arc<HelperInner>,
    mut requests_rx: mpsc::Receiver<OutgoingRequest>,
    mut shutdown_rx: oneshot::Receiver<()>,
) {
    let mut backoff = inner.config.restart_backoff_initial;

    loop {
        // ── Check for shutdown before spawning a new child ────────
        if let Ok(_) | Err(oneshot::error::TryRecvError::Closed) = shutdown_rx.try_recv() {
            debug!("helper supervisor: shutdown signal received");
            break;
        }

        let spawn_started = Instant::now();
        let mut child = match spawn_child(&inner.config) {
            Ok(c) => c,
            Err(e) => {
                error!("helper spawn failed: {e:?}; backing off {backoff:?}");
                tokio::time::sleep(backoff).await;
                backoff = (backoff * 2).min(inner.config.restart_backoff_max);
                continue;
            }
        };

        if let Some(pid) = child.id() {
            inner.current_pid.store(pid, Ordering::Relaxed);
        }
        inner.alive.store(true, Ordering::Relaxed);
        info!(pid = child.id().unwrap_or(0), "helper spawned");

        let stdin = child.stdin.take().expect("stdin piped");
        let stdout = child.stdout.take().expect("stdout piped");
        let stderr = child.stderr.take();

        // Stderr → tracing at WARN.
        if let Some(stderr) = stderr {
            tokio::spawn(async move {
                let mut reader = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = reader.next_line().await {
                    warn!(target: "helper.stderr", "{line}");
                }
            });
        }

        // Reader task — routes responses + notifications.
        let pending = inner.pending.clone();
        let notifications_tx = inner.notifications_tx.clone();
        let reader_handle = tokio::spawn(async move {
            reader_loop(stdout, pending, notifications_tx).await;
        });

        // Writer task — drains `requests_rx` until either:
        //   (a) it gets a `writer_stop` signal from the supervisor, OR
        //   (b) the request channel closes (the public handle dropped),
        //       OR
        //   (c) write to stdin fails (broken pipe — child died).
        // It returns ownership of the channel via the `done` oneshot so
        // the next supervisor iteration can keep draining queued
        // requests onto the freshly-spawned child.
        let (writer_done_tx, writer_done_rx) = oneshot::channel();
        let (writer_stop_tx, writer_stop_rx) = oneshot::channel();
        let writer_handle = tokio::spawn(writer_loop(
            stdin,
            requests_rx,
            writer_done_tx,
            writer_stop_rx,
        ));

        // Observe the child + the reader + the writer in parallel.
        // First one to terminate decides the next loop iteration.
        let exit_status = tokio::select! {
            biased;

            _ = &mut shutdown_rx => {
                debug!("supervisor: shutdown signal — terminating child");
                // Tell writer to stop FIRST so it releases the channel.
                let _ = writer_stop_tx.send(());
                let _ = child.kill().await;
                let _ = child.wait().await;
                let _ = reader_handle.await;
                let _ = writer_handle.await;
                let _ = writer_done_rx.await;
                inner.alive.store(false, Ordering::Relaxed);
                inner.current_pid.store(0, Ordering::Relaxed);
                fail_pending(&inner.pending, "supervisor shutting down");
                break;
            }

            status = child.wait() => {
                status
            }
        };

        // Child exited. Tell the writer to release the channel.
        let _ = writer_stop_tx.send(());
        // Reader will exit on its own when stdout closes.
        let _ = reader_handle.await;
        let _ = writer_handle.await;
        let recovered = writer_done_rx.await.ok().flatten();
        if let Some(rx) = recovered {
            requests_rx = rx;
        } else {
            // The writer should always return the channel; if it
            // didn't (channel dropped mid-flight) we synthesise a
            // dead one so the outer loop can keep going.
            let (_t, r) = mpsc::channel::<OutgoingRequest>(1);
            requests_rx = r;
        }

        inner.alive.store(false, Ordering::Relaxed);
        inner.current_pid.store(0, Ordering::Relaxed);

        match exit_status {
            Ok(status) => warn!(?status, "helper exited"),
            Err(e) => warn!("helper wait failed: {e:?}"),
        }

        fail_pending(&inner.pending, "helper exited mid-call");

        let alive_for = spawn_started.elapsed();
        if alive_for >= inner.config.stable_threshold {
            backoff = inner.config.restart_backoff_initial;
        } else {
            inner.restart_count.fetch_add(1, Ordering::Relaxed);
            warn!(?alive_for, ?backoff, "helper unhealthy — backing off");
            tokio::time::sleep(backoff).await;
            backoff = (backoff * 2).min(inner.config.restart_backoff_max);
        }
    }
}

fn spawn_child(config: &HelperConfig) -> std::io::Result<Child> {
    Command::new(&config.python_exe)
        .arg(&config.helper_script)
        .args(&config.extra_args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
}

async fn writer_loop(
    mut stdin: ChildStdin,
    mut requests_rx: mpsc::Receiver<OutgoingRequest>,
    done: oneshot::Sender<Option<mpsc::Receiver<OutgoingRequest>>>,
    mut writer_stop_rx: oneshot::Receiver<()>,
) {
    loop {
        tokio::select! {
            biased;

            // Supervisor told us to stop because the child died (or we
            // are shutting down). Return ownership of the channel so
            // the next iteration can keep using it.
            _ = &mut writer_stop_rx => {
                break;
            }

            maybe_req = requests_rx.recv() => {
                let Some(req) = maybe_req else { break };
                let OutgoingRequest { line, written, id: _ } = req;
                match stdin.write_all(line.as_bytes()).await {
                    Ok(()) => {
                        if let Err(e) = stdin.flush().await {
                            let _ = written.send(Err(e.to_string()));
                            break;
                        }
                        let _ = written.send(Ok(()));
                    }
                    Err(e) => {
                        let _ = written.send(Err(e.to_string()));
                        break;
                    }
                }
            }
        }
    }
    let _ = done.send(Some(requests_rx));
}

async fn reader_loop(
    stdout: ChildStdout,
    pending: Arc<DashMap<u64, ResponseSender>>,
    notifications_tx: broadcast::Sender<RpcNotification>,
) {
    let mut reader = BufReader::new(stdout).lines();
    loop {
        match reader.next_line().await {
            Ok(Some(line)) => {
                if line.trim().is_empty() {
                    continue;
                }
                // Cheap probe — is this a response (has id) or a
                // notification (has method, no id)?
                let peek: EnvelopePeek = match serde_json::from_str(&line) {
                    Ok(p) => p,
                    Err(e) => {
                        warn!(error = %e, line = %line, "helper produced unparseable line");
                        continue;
                    }
                };

                match (peek.id, peek.method.as_deref()) {
                    (Some(id), _) => {
                        // Response. Parse as `RpcResponse<Value>` so
                        // any result shape passes through; the typed
                        // decode happens at the call site.
                        match serde_json::from_str::<RpcResponse<Value>>(&line) {
                            Ok(resp) => {
                                if let Some((_, tx)) = pending.remove(&id) {
                                    let value = if let Some(err) = resp.error {
                                        Err(err)
                                    } else {
                                        Ok(resp.result.unwrap_or(Value::Null))
                                    };
                                    let _ = tx.send(value);
                                } else {
                                    debug!(id, "helper response for unknown id (likely cancelled)");
                                }
                            }
                            Err(e) => {
                                warn!(error = %e, "malformed RpcResponse from helper");
                            }
                        }
                    }
                    (None, Some(_)) => match serde_json::from_str::<RpcNotification>(&line) {
                        Ok(n) => {
                            let _ = notifications_tx.send(n);
                        }
                        Err(e) => {
                            warn!(error = %e, "malformed RpcNotification from helper");
                        }
                    },
                    _ => {
                        debug!(line = %line, "helper emitted neither response nor notification");
                    }
                }
            }
            Ok(None) => {
                debug!("helper stdout closed");
                break;
            }
            Err(e) => {
                warn!(error = %e, "helper stdout read failed");
                break;
            }
        }
    }
}

fn fail_pending(pending: &DashMap<u64, ResponseSender>, reason: &str) {
    let keys: Vec<u64> = pending.iter().map(|kv| *kv.key()).collect();
    for id in keys {
        if let Some((_, tx)) = pending.remove(&id) {
            let _ = tx.send(Err(RpcError::channel_closed(reason)));
        }
    }
}

// Created and developed by Jai Singh
