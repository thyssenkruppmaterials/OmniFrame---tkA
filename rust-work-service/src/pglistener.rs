// Created and developed by Jai Singh
//! Resilient `LISTEN <channel>` consumer with keepalive watchdog.
//!
//! ## Why this exists
//!
//! On 2026-05-07 the auto-confirm putaway pipeline failed because most
//! `sqlx::PgListener` connections silently died between boot and
//! ~30 minutes later. `pg_stat_activity` showed only 3 surviving
//! LISTEN backends from the boot's 11 spawned listeners — `recv()`
//! never returned an error, so the existing reconnect branch never
//! fired. See
//! [`memorybank/OmniFrame/Debug/Fix-Auto-Confirm-Putaways-Trigger-Missing-And-Listener-Wedge.md`].
//!
//! The mechanism is the Railway egress proxy / Supabase pgbouncer
//! idle-killing the dedicated TCP socket between long-tail NOTIFY
//! events. sqlx surfaces this as a hung `recv()` rather than an
//! `Err(...)` because the socket close arrives as a half-shutdown
//! that doesn't prompt the kernel to wake the read.
//!
//! ## Design
//!
//! Each call to [`run`] spawns a long-running task that:
//!
//! 1. Connects a dedicated `PgListener` and `LISTEN`s on the user's
//!    channel AND on the shared [`KEEPALIVE_CHANNEL`].
//! 2. On a 30s cadence, publishes
//!    `pg_notify('rust_work_service_keepalive', '<channel>')` via
//!    the main `PgPool` (a separate connection, NOT the
//!    PgListener's dedicated socket).
//! 3. On EVERY frame received (real or keepalive), refreshes a
//!    "last message" timestamp.
//! 4. If the keepalive tick observes >90s since the last message,
//!    treats the listener as dead and reconnects with exponential
//!    backoff (1s → 2s → 4s → … → 30s, capped at 30s).
//!
//! Because the keepalive is sent via the pool but observed via the
//! dedicated socket, a one-way socket failure (the most common
//! failure mode here) is detected within 2 keepalive intervals.
//!
//! Real notifications are forwarded to the user-supplied callback.
//! Keepalive frames are silently swallowed (only their reception is
//! recorded, via the keepalive_received metric).
//!
//! ## Metrics (per-channel via [`crate::observability::metrics`])
//!
//! - `work_pglistener_status{channel}` — gauge (1=alive, 0=reconnecting)
//! - `work_pglistener_reconnects_total{channel}` — counter
//! - `work_pglistener_last_message_age_seconds{channel}` — gauge
//! - `work_pglistener_keepalive_sent_total{channel}` — counter
//! - `work_pglistener_keepalive_received_total{channel}` — counter

use std::future::Future;
use std::time::{Duration, Instant};

use async_trait::async_trait;
use sqlx::postgres::PgListener;
use sqlx::PgPool;
use tokio::time::interval;
use tracing::{info, warn};

use crate::observability::metrics;

/// Shared NOTIFY channel that every resilient listener subscribes to
/// for proof-of-life keepalives. The payload is the originating
/// listener's channel name (purely for diagnostics — receiving any
/// keepalive on the dedicated socket is sufficient evidence the TCP
/// is alive).
pub const KEEPALIVE_CHANNEL: &str = "rust_work_service_keepalive";

/// Default cadence the keepalive task fires at.
pub const DEFAULT_KEEPALIVE_INTERVAL: Duration = Duration::from_secs(30);

/// Default deadline before a silent socket is considered dead and
/// force-reconnected. Must be > 2 × keepalive interval to absorb
/// one missed tick + jitter.
pub const DEFAULT_WATCHDOG_TIMEOUT: Duration = Duration::from_secs(90);

/// Reconnect backoff cap.
pub const RECONNECT_BACKOFF_MAX: Duration = Duration::from_secs(30);

/// Tunable knobs for [`run_with_config`]. Defaults to
/// production-safe values; tests shrink the deadlines.
#[derive(Debug, Clone, Copy)]
pub struct ListenerConfig {
    pub keepalive_interval: Duration,
    pub watchdog_timeout: Duration,
}

impl Default for ListenerConfig {
    fn default() -> Self {
        Self {
            keepalive_interval: DEFAULT_KEEPALIVE_INTERVAL,
            watchdog_timeout: DEFAULT_WATCHDOG_TIMEOUT,
        }
    }
}

/// Wire shape forwarded to the user callback. We deliberately do not
/// expose `sqlx::postgres::PgNotification` directly so the test
/// harness can construct frames without a live Postgres backend.
#[derive(Debug, Clone)]
pub struct NotifyFrame {
    pub channel: String,
    pub payload: String,
}

/// Spawn a long-running task that consumes `LISTEN <channel>` with
/// the default keepalive + watchdog config. Never returns under
/// normal operation — designed to live in `tokio::spawn`. The
/// `channel` is moved into the task so callers can pass either a
/// literal (`"sap_agent_changed"`) or an owned string built at
/// runtime (e.g. from `channel_for_table()`).
///
/// PREFER [`run_multi`] for new code — a single PgListener can
/// `LISTEN` to many channels over ONE dedicated TCP socket, which is
/// the dominant lever for keeping the Supabase `max_connections`
/// budget within reach. See
/// [[Implementations/Compress-Rust-Work-Listener-Pool-2026-05-20]].
pub async fn run<F, Fut>(pool: PgPool, channel: impl Into<String>, callback: F)
where
    F: FnMut(NotifyFrame) -> Fut + Send + 'static,
    Fut: Future<Output = ()> + Send + 'static,
{
    run_with_config(pool, channel, ListenerConfig::default(), callback).await
}

/// Like [`run`] but accepts a custom [`ListenerConfig`]. Useful for
/// tests (sub-second deadlines) and for low-frequency channels that
/// want a longer keepalive cadence.
pub async fn run_with_config<F, Fut>(
    pool: PgPool,
    channel: impl Into<String>,
    cfg: ListenerConfig,
    callback: F,
) where
    F: FnMut(NotifyFrame) -> Fut + Send + 'static,
    Fut: Future<Output = ()> + Send + 'static,
{
    let channel_str = channel.into();
    run_with_sink(
        PgPoolKeepaliveSink(pool),
        vec![channel_str.clone()],
        channel_str,
        cfg,
        callback,
    )
    .await
}

/// Multi-channel resilient PgListener. One dedicated TCP socket
/// subscribes to EVERY channel in `channels` plus the shared
/// keepalive channel. Every NOTIFY (regardless of which channel it
/// arrived on) is forwarded to `callback`, which dispatches by
/// `frame.channel`.
///
/// This is the connection-budget-conscious entry point. Each call
/// to `run_multi` spawns ONE `PgListener` task = ONE long-lived
/// Postgres backend, regardless of how many channel names are
/// passed. Splitting 13 separate `run(...)` callsites into a
/// handful of `run_multi` callsites is the canonical way to keep
/// the Supabase `pg_stat_activity` footprint within the
/// `max_connections` budget.
///
/// `group_label` is the value that shows up in the
/// `work_pglistener_*` metric label set, so dashboards can still
/// segment by purpose (e.g. `"config"` vs `"domain"`). It is also
/// used in the `tracing::info!` startup line.
///
/// Channel set is captured at call time. Adding or removing
/// channels at runtime requires restarting the service (or, more
/// surgically, dropping the listener task and re-spawning it with
/// the updated set).
pub async fn run_multi<F, Fut>(
    pool: PgPool,
    channels: Vec<String>,
    group_label: impl Into<String>,
    callback: F,
) where
    F: FnMut(NotifyFrame) -> Fut + Send + 'static,
    Fut: Future<Output = ()> + Send + 'static,
{
    run_multi_with_config(pool, channels, group_label, ListenerConfig::default(), callback).await
}

/// Like [`run_multi`] but accepts a custom [`ListenerConfig`].
pub async fn run_multi_with_config<F, Fut>(
    pool: PgPool,
    channels: Vec<String>,
    group_label: impl Into<String>,
    cfg: ListenerConfig,
    callback: F,
) where
    F: FnMut(NotifyFrame) -> Fut + Send + 'static,
    Fut: Future<Output = ()> + Send + 'static,
{
    run_with_sink(PgPoolKeepaliveSink(pool), channels, group_label.into(), cfg, callback).await
}

async fn run_with_sink<S, F, Fut>(
    sink: S,
    channels: Vec<String>,
    group_label: String,
    cfg: ListenerConfig,
    mut callback: F,
) where
    S: KeepaliveSink + Send + Sync + 'static,
    F: FnMut(NotifyFrame) -> Fut + Send + 'static,
    Fut: Future<Output = ()> + Send + 'static,
{
    assert!(
        !channels.is_empty(),
        "run_with_sink: channels must contain at least one entry"
    );
    let chan: &str = &group_label;
    info!(
        group = chan,
        channels = ?channels,
        channel_count = channels.len(),
        keepalive_interval_secs = cfg.keepalive_interval.as_secs(),
        watchdog_timeout_secs = cfg.watchdog_timeout.as_secs(),
        "resilient PgListener starting (multi-channel)"
    );
    metrics::WORK_PGLISTENER_STATUS
        .with_label_values(&[chan])
        .set(0);

    let mut backoff = Duration::from_secs(1);
    let mut reconnect_count: u64 = 0;
    loop {
        match sink.connect_listener_multi(&channels).await {
            Ok(source) => {
                info!(
                    channel = chan,
                    reconnect_count, "resilient PgListener subscribed"
                );
                metrics::WORK_PGLISTENER_STATUS
                    .with_label_values(&[chan])
                    .set(1);
                backoff = Duration::from_secs(1);

                let exit = drive_inner(&sink, source, chan, cfg, &mut callback).await;

                metrics::WORK_PGLISTENER_STATUS
                    .with_label_values(&[chan])
                    .set(0);
                metrics::WORK_PGLISTENER_RECONNECTS_TOTAL
                    .with_label_values(&[chan])
                    .inc();
                reconnect_count = reconnect_count.saturating_add(1);
                warn!(
                    channel = chan,
                    reconnect_count,
                    reason = %exit,
                    "resilient PgListener disconnected; reconnecting"
                );
            }
            Err(e) => {
                metrics::WORK_PGLISTENER_RECONNECTS_TOTAL
                    .with_label_values(&[chan])
                    .inc();
                reconnect_count = reconnect_count.saturating_add(1);
                warn!(
                    ?e,
                    channel = chan,
                    reconnect_count,
                    backoff_secs = backoff.as_secs(),
                    "resilient PgListener: connect/listen failed; sleeping before retry"
                );
            }
        }

        tokio::time::sleep(backoff).await;
        backoff = (backoff * 2).min(RECONNECT_BACKOFF_MAX);
    }
}

/// Outcome that bubbles out of [`drive_inner`] and triggers a reconnect.
#[derive(Debug)]
enum ExitReason {
    RecvError(sqlx::Error),
    WatchdogTimeout(Duration),
    SourceClosed,
}

impl std::fmt::Display for ExitReason {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ExitReason::RecvError(e) => write!(f, "recv error: {e}"),
            ExitReason::WatchdogTimeout(d) => {
                write!(f, "watchdog timeout (last message {}s ago)", d.as_secs())
            }
            ExitReason::SourceClosed => write!(f, "source closed"),
        }
    }
}

async fn drive_inner<S, F, Fut>(
    sink: &S,
    mut source: Box<dyn NotifySource + Send>,
    channel: &str,
    cfg: ListenerConfig,
    callback: &mut F,
) -> ExitReason
where
    S: KeepaliveSink + Send + Sync,
    F: FnMut(NotifyFrame) -> Fut + Send,
    Fut: Future<Output = ()> + Send,
{
    let mut last_message = Instant::now();
    let mut keepalive_tick = interval(cfg.keepalive_interval);
    // Drop the first immediate tick so the first keepalive fires
    // after ONE full interval has elapsed (instead of immediately on
    // boot, which would race a still-warming socket).
    keepalive_tick.tick().await;

    loop {
        metrics::WORK_PGLISTENER_LAST_MESSAGE_AGE
            .with_label_values(&[channel])
            .set(last_message.elapsed().as_secs_f64());

        tokio::select! {
            biased;

            msg = source.next() => {
                match msg {
                    Ok(Some(frame)) => {
                        last_message = Instant::now();
                        metrics::WORK_PGLISTENER_LAST_MESSAGE_AGE
                            .with_label_values(&[channel])
                            .set(0.0);
                        if frame.channel == KEEPALIVE_CHANNEL {
                            metrics::WORK_PGLISTENER_KEEPALIVE_RECEIVED_TOTAL
                                .with_label_values(&[channel])
                                .inc();
                            continue;
                        }
                        callback(frame).await;
                    }
                    Ok(None) => return ExitReason::SourceClosed,
                    Err(e) => return ExitReason::RecvError(e),
                }
            }

            _ = keepalive_tick.tick() => {
                let elapsed = last_message.elapsed();
                if elapsed > cfg.watchdog_timeout {
                    return ExitReason::WatchdogTimeout(elapsed);
                }
                match sink.send_keepalive(channel).await {
                    Ok(()) => {
                        metrics::WORK_PGLISTENER_KEEPALIVE_SENT_TOTAL
                            .with_label_values(&[channel])
                            .inc();
                    }
                    Err(e) => {
                        // Pool starvation / DB hiccup. Don't break the
                        // recv loop — the watchdog will catch a truly
                        // dead socket within 90s.
                        warn!(
                            ?e,
                            channel,
                            "resilient PgListener: keepalive send failed (continuing)"
                        );
                    }
                }
            }
        }
    }
}

// ────────────────────────────────────────────────────────────────────
// Abstractions for testability
// ────────────────────────────────────────────────────────────────────

/// A source of `NotifyFrame`s. Production code uses `PgListener` via
/// [`PgListenerSource`]; tests use a tokio mpsc channel to simulate
/// arbitrary frame timings without a live Postgres backend.
#[async_trait]
trait NotifySource: Send {
    async fn next(&mut self) -> Result<Option<NotifyFrame>, sqlx::Error>;
}

/// A sink that can publish keepalive NOTIFYs and bootstrap a fresh
/// listener. Production code wraps the main `PgPool`; tests use an
/// mpsc-backed mock.
///
/// `connect_listener_multi` is the new entry point — one
/// `PgListener` socket subscribed to ALL channels in the slice plus
/// the shared keepalive channel. The legacy single-channel
/// [`KeepaliveSink::connect_listener_multi`] callers pass a single-
/// element slice (see [`run_with_config`] which forwards through
/// [`run_with_sink`]).
#[async_trait]
trait KeepaliveSink {
    async fn send_keepalive(&self, group_label: &str) -> Result<(), sqlx::Error>;
    async fn connect_listener_multi(
        &self,
        channels: &[String],
    ) -> Result<Box<dyn NotifySource + Send>, sqlx::Error>;
}

/// Production sink: send keepalives via the main pool, build new
/// PgListeners by cloning the pool.
#[derive(Clone)]
struct PgPoolKeepaliveSink(PgPool);

#[async_trait]
impl KeepaliveSink for PgPoolKeepaliveSink {
    async fn send_keepalive(&self, group_label: &str) -> Result<(), sqlx::Error> {
        sqlx::query("SELECT pg_notify($1, $2)")
            .bind(KEEPALIVE_CHANNEL)
            .bind(group_label)
            .execute(&self.0)
            .await
            .map(|_| ())
    }

    async fn connect_listener_multi(
        &self,
        channels: &[String],
    ) -> Result<Box<dyn NotifySource + Send>, sqlx::Error> {
        let mut listener = PgListener::connect_with(&self.0).await?;
        // Subscribe to every user channel in the group. Each
        // `LISTEN` is one round-trip but shares the same dedicated
        // backend connection — this is exactly what keeps the
        // `pg_stat_activity` footprint flat regardless of how many
        // channels we group together.
        for ch in channels {
            listener.listen(ch).await?;
        }
        // The keepalive channel is the watchdog's heartbeat; every
        // listener task subscribes to it so a one-way socket failure
        // is detected within 2 keepalive intervals.
        listener.listen(KEEPALIVE_CHANNEL).await?;
        Ok(Box::new(PgListenerSource(listener)))
    }
}

/// Production source — adapter from `sqlx::postgres::PgListener` to
/// our `NotifySource` trait. Yields `Some(frame)` on each NOTIFY,
/// surfaces `Err(_)` on connection-level failures.
struct PgListenerSource(PgListener);

#[async_trait]
impl NotifySource for PgListenerSource {
    async fn next(&mut self) -> Result<Option<NotifyFrame>, sqlx::Error> {
        let n = self.0.recv().await?;
        Ok(Some(NotifyFrame {
            channel: n.channel().to_string(),
            payload: n.payload().to_string(),
        }))
    }
}

// ────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Arc;
    use tokio::sync::mpsc;
    use tokio::sync::Mutex as AsyncMutex;

    /// Test sink that drops keepalive sends into an atomic counter
    /// and returns successively-injected `NotifySource` instances.
    /// `connect_listener` blocks once `sources` is exhausted so
    /// reconnect-after-watchdog doesn't infinite-loop in tests.
    #[derive(Clone)]
    struct TestSink {
        keepalive_count: Arc<AtomicU64>,
        sources: Arc<AsyncMutex<Vec<MpscSource>>>,
    }

    impl TestSink {
        fn new(sources: Vec<MpscSource>) -> Self {
            Self {
                keepalive_count: Arc::new(AtomicU64::new(0)),
                sources: Arc::new(AsyncMutex::new(sources)),
            }
        }
    }

    #[async_trait]
    impl KeepaliveSink for TestSink {
        async fn send_keepalive(&self, _group_label: &str) -> Result<(), sqlx::Error> {
            self.keepalive_count.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }

        async fn connect_listener_multi(
            &self,
            _channels: &[String],
        ) -> Result<Box<dyn NotifySource + Send>, sqlx::Error> {
            let mut guard = self.sources.lock().await;
            if guard.is_empty() {
                // Block forever — no more sources available means the
                // test wants the `run` loop to stay quiescent.
                tokio::time::sleep(Duration::from_secs(3600)).await;
                unreachable!("test deadline exceeded");
            }
            let next = guard.remove(0);
            Ok(Box::new(next))
        }
    }

    /// `NotifySource` backed by an mpsc channel. Sender drop yields
    /// `Ok(None)` (treated as `SourceClosed` by the drive loop).
    struct MpscSource {
        rx: mpsc::Receiver<Result<NotifyFrame, sqlx::Error>>,
    }

    #[async_trait]
    impl NotifySource for MpscSource {
        async fn next(&mut self) -> Result<Option<NotifyFrame>, sqlx::Error> {
            match self.rx.recv().await {
                Some(Ok(frame)) => Ok(Some(frame)),
                Some(Err(e)) => Err(e),
                None => Ok(None),
            }
        }
    }

    fn frame(channel: &str, payload: &str) -> NotifyFrame {
        NotifyFrame {
            channel: channel.to_string(),
            payload: payload.to_string(),
        }
    }

    #[test]
    fn keepalive_channel_constant_matches_specification() {
        // The Python agent + any future siblings hard-code this name;
        // changing it is a wire-protocol change.
        assert_eq!(KEEPALIVE_CHANNEL, "rust_work_service_keepalive");
    }

    #[test]
    fn default_config_has_safe_production_values() {
        let cfg = ListenerConfig::default();
        assert_eq!(cfg.keepalive_interval, Duration::from_secs(30));
        assert_eq!(cfg.watchdog_timeout, Duration::from_secs(90));
        // Watchdog must be at least 2× keepalive so a single missed
        // tick doesn't trip the reconnect loop.
        assert!(cfg.watchdog_timeout >= cfg.keepalive_interval * 2);
    }

    #[test]
    fn exit_reason_display_includes_diagnostic_detail() {
        let r = ExitReason::WatchdogTimeout(Duration::from_secs(123));
        let s = format!("{r}");
        assert!(s.contains("123"));
        assert!(s.contains("watchdog"));

        let r = ExitReason::SourceClosed;
        assert!(format!("{r}").contains("source closed"));
    }

    #[tokio::test]
    async fn drive_forwards_real_frames_to_callback_and_swallows_keepalives() {
        let (tx, rx) = mpsc::channel::<Result<NotifyFrame, sqlx::Error>>(8);
        let sink = TestSink::new(vec![MpscSource { rx }]);
        let received: Arc<AsyncMutex<Vec<NotifyFrame>>> = Arc::new(AsyncMutex::new(vec![]));
        let received_clone = received.clone();
        let cfg = ListenerConfig {
            keepalive_interval: Duration::from_millis(50),
            watchdog_timeout: Duration::from_secs(10),
        };

        let sink_clone = sink.clone();
        let handle = tokio::spawn(async move {
            run_with_sink(
                sink_clone,
                vec!["test_channel".into()],
                "test_channel".into(),
                cfg,
                move |f| {
                    let received = received_clone.clone();
                    async move {
                        received.lock().await.push(f);
                    }
                },
            )
            .await
        });

        // Push a real frame, a keepalive, and a real frame.
        tx.send(Ok(frame("test_channel", "first"))).await.unwrap();
        tx.send(Ok(frame(KEEPALIVE_CHANNEL, "from_self")))
            .await
            .unwrap();
        tx.send(Ok(frame("test_channel", "second")))
            .await
            .unwrap();

        // Give the drive loop a moment to drain.
        tokio::time::sleep(Duration::from_millis(200)).await;

        let got = received.lock().await.clone();
        assert_eq!(got.len(), 2, "callback received: {got:?}");
        assert_eq!(got[0].payload, "first");
        assert_eq!(got[1].payload, "second");

        // The loop is `loop {}`; abort the test handle to drop it.
        handle.abort();
        let _ = handle.await;
    }

    #[tokio::test]
    async fn drive_fires_watchdog_when_no_messages_arrive() {
        // Leave the source channel empty — drive should never receive
        // anything. With 100ms keepalive + 250ms watchdog, the
        // keepalive at ~300ms sees elapsed ~300ms (> 250ms) and
        // exits → reconnect → second source connects → next
        // watchdog fires after another ~250ms.
        let (_tx_a, rx_a) = mpsc::channel::<Result<NotifyFrame, sqlx::Error>>(1);
        let (_tx_b, rx_b) = mpsc::channel::<Result<NotifyFrame, sqlx::Error>>(1);

        let sink = TestSink::new(vec![MpscSource { rx: rx_a }, MpscSource { rx: rx_b }]);
        let keepalive_count = sink.keepalive_count.clone();

        let cfg = ListenerConfig {
            keepalive_interval: Duration::from_millis(100),
            watchdog_timeout: Duration::from_millis(250),
        };

        let sink_clone = sink.clone();
        let handle = tokio::spawn(async move {
            run_with_sink(
                sink_clone,
                vec!["watchdog_test".into()],
                "watchdog_test".into(),
                cfg,
                |_| async {},
            )
            .await
        });

        // Sleep long enough for: ticks @100ms (200ms elapsed, OK),
        // @200ms (200ms elapsed, OK), @300ms (300ms elapsed, FIRES).
        // Then 1s reconnect backoff, then second source connects and
        // the watchdog fires again.
        tokio::time::sleep(Duration::from_millis(2000)).await;
        handle.abort();
        let _ = handle.await;

        // We expect at least 1 reconnect (watchdog fired) and at
        // least 2 keepalives sent (the ones before the first
        // watchdog fire).
        assert!(
            keepalive_count.load(Ordering::SeqCst) >= 2,
            "expected ≥2 keepalive sends before the watchdog fired, \
             got {}",
            keepalive_count.load(Ordering::SeqCst)
        );
    }

    /// 2026-05-20 — regression test for the multi-channel dispatch
    /// path. A single listener task receives frames on multiple
    /// channel names and the callback observes each `frame.channel`
    /// distinctly. This is the load-bearing invariant for the
    /// listener-pool consolidation
    /// ([[Implementations/Compress-Rust-Work-Listener-Pool-2026-05-20]])
    /// — every NOTIFY must reach the dispatcher with its original
    /// channel name so the per-channel handler routes correctly.
    #[tokio::test]
    async fn run_multi_forwards_frames_with_original_channel_names() {
        let (tx, rx) = mpsc::channel::<Result<NotifyFrame, sqlx::Error>>(16);
        let sink = TestSink::new(vec![MpscSource { rx }]);
        let received: Arc<AsyncMutex<Vec<NotifyFrame>>> = Arc::new(AsyncMutex::new(vec![]));
        let received_clone = received.clone();
        let cfg = ListenerConfig {
            keepalive_interval: Duration::from_millis(50),
            watchdog_timeout: Duration::from_secs(10),
        };

        let sink_clone = sink.clone();
        let handle = tokio::spawn(async move {
            run_with_sink(
                sink_clone,
                vec![
                    "chan_alpha".into(),
                    "chan_bravo".into(),
                    "chan_charlie".into(),
                ],
                "test_group".into(),
                cfg,
                move |f| {
                    let received = received_clone.clone();
                    async move {
                        received.lock().await.push(f);
                    }
                },
            )
            .await
        });

        tx.send(Ok(frame("chan_alpha", "a1"))).await.unwrap();
        tx.send(Ok(frame("chan_bravo", "b1"))).await.unwrap();
        tx.send(Ok(frame(KEEPALIVE_CHANNEL, "kp"))).await.unwrap();
        tx.send(Ok(frame("chan_charlie", "c1"))).await.unwrap();
        tx.send(Ok(frame("chan_alpha", "a2"))).await.unwrap();

        tokio::time::sleep(Duration::from_millis(200)).await;

        let got = received.lock().await.clone();
        // Keepalive is swallowed; the four real frames pass through with
        // their original channel labels intact (this is what the
        // dispatcher in `main.rs` relies on).
        let labels: Vec<&str> = got.iter().map(|f| f.channel.as_str()).collect();
        assert_eq!(
            labels,
            vec!["chan_alpha", "chan_bravo", "chan_charlie", "chan_alpha"]
        );
        let payloads: Vec<&str> = got.iter().map(|f| f.payload.as_str()).collect();
        assert_eq!(payloads, vec!["a1", "b1", "c1", "a2"]);

        handle.abort();
        let _ = handle.await;
    }

    #[tokio::test]
    async fn drive_reconnects_after_recv_error() {
        let (tx_a, rx_a) = mpsc::channel::<Result<NotifyFrame, sqlx::Error>>(2);
        let (_tx_b, rx_b) = mpsc::channel::<Result<NotifyFrame, sqlx::Error>>(2);
        let sink = TestSink::new(vec![MpscSource { rx: rx_a }, MpscSource { rx: rx_b }]);

        let cfg = ListenerConfig {
            keepalive_interval: Duration::from_millis(50),
            watchdog_timeout: Duration::from_secs(10),
        };

        let received: Arc<AsyncMutex<Vec<NotifyFrame>>> = Arc::new(AsyncMutex::new(vec![]));
        let received_clone = received.clone();
        let sink_clone = sink.clone();
        let handle = tokio::spawn(async move {
            run_with_sink(
                sink_clone,
                vec!["recv_err_test".into()],
                "recv_err_test".into(),
                cfg,
                move |f| {
                    let received = received_clone.clone();
                    async move {
                        received.lock().await.push(f);
                    }
                },
            )
            .await
        });

        tx_a.send(Ok(frame("recv_err_test", "before-error")))
            .await
            .unwrap();
        tx_a.send(Err(sqlx::Error::PoolTimedOut)).await.unwrap();

        // Give time for: receive frame, hit error, exit drive, sleep
        // backoff (1s), reconnect to second source.
        tokio::time::sleep(Duration::from_millis(1500)).await;
        handle.abort();
        let _ = handle.await;

        let got = received.lock().await.clone();
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].payload, "before-error");
    }
}

// Created and developed by Jai Singh
