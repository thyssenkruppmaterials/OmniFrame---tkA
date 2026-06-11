---
tags: [type/decision, status/active, domain/agent, domain/backend, domain/frontend, domain/auth]
created: 2026-05-07
---

# ADR — OmniFrame Agent v2.0.0 Release (Architecture-Change Boundary)

## Status

ACCEPTED — shipped 2026-05-07 alongside Phase 11 of the comprehensive [[plans/rust_work_service_full_integration_5b88165d.plan]]. See [[Implement-Rust-Work-Service-Phase11]] for the implementation diff and [[Implement-Rust-Work-Service-Full-Integration-Summary]] for the cross-phase arc.

## Context

The agent's `AGENT_VERSION` lineage from v1.6.4 (2026-04-30, agent-side trigger evaluator) through v1.9.0 (2026-05-06, Phase 4 of the rust-work-service plan) intentionally stayed in the v1.x band per Phase 4 / 7 / 9 / 10 plan directives — each phase shipped its work as opt-in (env-flag-gated) backwards-compatible additions and explicitly deferred the AGENT_VERSION bump to Phase 11. The deferral was deliberate: the cumulative changes amount to a fundamentally different architecture (control plane on rust-work-service vs. direct-Supabase) and warrant a major-version bump to mark the boundary for ops + dashboards + future agent-version-gating UX.

v2.0.0 is THAT bump. It is a marker release — the deletion + tightening Phase 11 covers is the actual code change, but the version bump is the headline so operators can see at a glance which architecture an agent is on.

## Decision

### What v2.0.0 IS

- **An architecture-change marker.** The version bump signals the agent is on the rust-work-service control plane (event subscriptions, queue claim/complete/fail/heartbeat, trigger evaluation, identity).
- **A default-flip release.** Three Phase-4/7/6 env vars (`OMNIFRAME_AGENT_USE_RUST_WS`, `OMNIFRAME_AGENT_CLAIM_VIA_RUST`, `OMNIFRAME_AGENT_CONSOLE_RELAY`) flip from default `"0"` (legacy paths) → default `"1"` (rust-work-service paths). Operators that explicitly set any of them to `"0"` get a single deprecation warning at boot.
- **A legacy-fallback deletion release.** The legacy direct-PostgREST claim/complete/fail/lease-bump bodies that Phase 7 wrapped in `if _CLAIM_VIA_RUST:` branches are DELETED. The `_CLAIM_VIA_RUST=False` branches now return a documented error envelope.
- **A capability advertisement.** New `agent-2.0-architecture` capability id appended to `AGENT_CAPABILITIES` so dashboards can detect v2.0+ agents.
- **A REPLICA IDENTITY cleanup.** Migration 284 flips `rf_putaway_operations` REPLICA IDENTITY FULL → DEFAULT now that Realtime is no longer the agent's row-event source for that table.

### What v2.0.0 IS NOT

- **Not a hard-required upgrade.** `MIN_REQUIRED_AGENT_VERSION` stays at `'1.4.0'`. Already-deployed agents keep working through the legacy fallbacks for the v2.0.x soft-deprecation window. Operators upgrade on their own schedule.
- **Not a breaking change for the auth path.** The Phase 10 service-key identity stays SOFT-FALLBACK in 2.0.x: agents without a service key on disk get a deprecation warning and keep using `state.supabase_token` for rust-work-service calls. New env var `OMNIFRAME_AGENT_REQUIRE_SERVICE_KEY=1` lets operators upgrade the warning to a hard-fail boot once their fleet is fully provisioned. The fallback ITSELF is removed in v2.1.0.
- **Not a breaking change for the user-launch UX.** `/supabase/login` + `/supabase/session` + `/supabase/logout` endpoints stay forever — the admin clicks "Launch Agent" → browser POSTs the user session → agent has org context. What changes is that those endpoints no longer drive rust-work-service authentication once a service key is on disk.

### Breaking-change scope (NONE)

We deliberately chose the soft-fallback path for the auth migration over a hard breaking change. Rationale:

- **Operators with un-provisioned agents shouldn't be locked out.** A hard-fail on missing service key would force every agent box to be touched simultaneously — in a Citrix multi-tenant deploy that's ops hostility. The soft fallback gives admins a per-fleet rollout schedule.
- **Service-key adoption is verifiable.** Once admins have provisioned every agent, they set `OMNIFRAME_AGENT_REQUIRE_SERVICE_KEY=1` on the boxes and the next boot hard-fails if the key's missing — catching any provisioning regression loudly. This is the right tool for the job.
- **The legacy paths are still well-tested.** The Phase 4 + 7 + 9 + 10 telemetry confirmed parity — we have NO hot bug we're trying to outrun by force-migrating users.

The v2.1.0 release IS the breaking-change release. It will:

- Delete the `OMNIFRAME_AGENT_USE_RUST_WS` / `_CLAIM_VIA_RUST` / `_CONSOLE_RELAY` env vars + the legacy Supabase Realtime fallback path entirely.
- Delete the user-JWT fallback for rust-work-service calls (service-key becomes the only path).
- Bump `MIN_REQUIRED_AGENT_VERSION` accordingly.

### Upgrade path for admins (recommended)

1. **Day 0 (v2.0.0 release)**: deploy the new agent EXE. No env-var changes required — the defaults flipped on, legacy code keeps working as fallback. Existing browser sessions, RF terminals, scheduled jobs all keep working.
2. **Day 0-7 (parallel observation)**: monitor agent boot logs for the new v2.0.0 banner; check that `agent-2.0-architecture` capability advertises in `/health.capabilities`.
3. **Day 7-30 (service-key provisioning)**: visit the new "Agent Setup" tab (Phase 10) → register a service key for each agent → save the plaintext to `~/.omniframe/agent_service_key.txt` (POSIX) or `%USERPROFILE%\.omniframe\agent_service_key.txt` (Windows) on each agent box. Restart the agent. Boot banner switches from `[boot] DEPRECATION Agent identity v2: NOT CONFIGURED ...` → `[boot] Agent identity v2: ENABLED ...`.
4. **Day 30+ (hard-fail enforcement)**: once every agent has a service key, set `OMNIFRAME_AGENT_REQUIRE_SERVICE_KEY=1` on each agent box (e.g. via Citrix profile env vars). The next boot hard-fails (exit 78) if the key is missing — catches provisioning regressions loudly.
5. **v2.1.0 release** (TBD): the user-JWT fallback deletes; agents without a service key fail to authenticate against rust-work-service. By this point every agent should be on service-key auth.

## Consequences

### Positive

- **Architecture clarity.** Operators can tell at a glance which architecture an agent is on by checking `AGENT_VERSION`. Pre-v2.0 = direct-Supabase / pre-rust-work-service migration. v2.0+ = rust-work-service control plane.
- **Default-flip backed by parallel-run telemetry.** The Phase 4 / 7 / 9 / 10 parallel-run windows confirmed parity; the v2.0.0 default flip is data-backed.
- **No forced fleet-wide simultaneous upgrade.** Soft-fallback windows let admins migrate at their own schedule.
- **`OMNIFRAME_AGENT_REQUIRE_SERVICE_KEY=1` is the right control surface** for admins to upgrade their fleet's enforcement posture as adoption rolls out.
- **Migration 284 closes the WAL bandwidth loose end** that Phase 4 left open (REPLICA IDENTITY FULL is no longer needed for `rf_putaway_operations`).

### Negative / risks

- **Soft-fallback windows accumulate technical debt.** Carrying the legacy Realtime + user-JWT paths through the v2.0.x line is ~2,000 LOC of deprecation-warning-tagged code. Discipline required to actually delete it in v2.1.0.
- **Operators that ignore the deprecation warnings** keep running on legacy paths until v2.1.0 hard-deletes them. Mitigated by the boot banner being loud (single-line `[boot] DEPRECATION ...` per opted-out flag) + the `agent-2.0-architecture` capability being a clear positive signal to detect.
- **`OMNIFRAME_AGENT_REQUIRE_SERVICE_KEY=1` is opt-in.** Admins who never set it never get the hard-fail enforcement. Documented in the upgrade path; a future iteration could surface a fleet-wide "N agents without service-key adoption" badge in the admin dashboard.
- **Migration 284 is irreversible without downtime.** Flipping REPLICA IDENTITY back to FULL would require a brief lock on the table. The migration body asserts the change and we have no rollback. Mitigated by the change being WAL-bandwidth optimisation only — nothing depends on FULL semantics.

## Quality gates (shipped)

See [[Implement-Rust-Work-Service-Phase11#Quality gates]] for the full list. Headline:

- ✓ Migration 284 applied via Supabase MCP `apply_migration`. Verified `relreplident = 'd'` for `rf_putaway_operations`.
- ✓ `cargo build` clean (only pre-existing warnings on `observability/middleware.rs`).
- ✓ `cargo test --lib`: 146 passed.
- ✓ `cargo clippy --lib --all-targets`: zero new warnings on Phase 11 files.
- ✓ `python3 -c "import ast; ast.parse(open('omni_agent/agent.py').read())"` clean.
- ✓ `pnpm tsc -b --noEmit` clean.
- ✓ `pnpm build` clean (8.91s, 182 PWA precache entries).
- ✓ `grep AGENT_VERSION omni_agent/agent.py` returns `"2.0.0"`.

## Related

- [[Implementations/Implement-Rust-Work-Service-Phase11]] — the implementation that ships this ADR.
- [[Implementations/Implement-Rust-Work-Service-Full-Integration-Summary]] — cross-phase arc.
- [[Decisions/ADR-Agent-Identity-V2-Phase10]] — the soft-fallback service-key model that this ADR locks in for v2.0.x.
- [[Decisions/ADR-Trigger-DSL-Evaluator-Phase9]] — the trigger architecture this release ships as default.
- [[Decisions/ADR-Rust-Work-Service-Availability-SLO]] — rollout SLO that gated the default flip decision.
- [[Components/Omni-Agent - Headless SAP Agent]] — agent component (Recent additions section updated for v2.0.0).
- [[Sessions/2026-05-07]] — session log this release appends to.
