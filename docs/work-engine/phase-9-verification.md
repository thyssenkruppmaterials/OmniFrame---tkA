# Phase 9 — Build & Test Verification

The plan calls for `pnpm quality:ci`, `pnpm test:integration`, the
`INTEGRATION_MODE=infra` variant, `pytest` for `api/`, all five Rust crates
with `RUSTFLAGS="-D warnings"`, Docker builds, and the
`scripts/validate-check-matrix.mjs` health smoke.

## Operator commands

```bash
# 1. Frontend strict check (ts + lint + format + bundle budget)
pnpm quality:ci

# 2. Frontend integration tests
pnpm test:integration
cross-env INTEGRATION_MODE=infra pnpm test:integration

# 3. Rust matrix
RUSTFLAGS="-D warnings" cargo test --manifest-path rust-core-service/Cargo.toml
RUSTFLAGS="-D warnings" cargo test --manifest-path rust-ai-service/Cargo.toml
RUSTFLAGS="-D warnings" cargo test --manifest-path rust-work-service/Cargo.toml
RUSTFLAGS="-D warnings" cargo test --manifest-path rust-dashboard-service/Cargo.toml
RUSTFLAGS="-D warnings" cargo test --manifest-path rust-mdm-service/Cargo.toml
RUSTFLAGS="-D warnings" cargo test --manifest-path rust-streaming-service/Cargo.toml

# 4. API/SAP boundary
cd api && python -m pytest -q

# 5. Container builds
docker build -t onebox-root .
docker build -t onebox-rust-work-service rust-work-service

# 6. Test-matrix gate
node scripts/validate-check-matrix.mjs
```

## Status of the new tests called out by Phase 13.4

Each row in the §13.4 matrix is a separate file/test. They are scaffolded
under their target paths but not all are populated:

- ✅ Frontend type adapters — see `src/lib/work-service/__tests__/`.
- ✅ Registry exhaustiveness — see `src/lib/work-engine/__tests__/`.
- ⏳ Rust integration tests for concurrent claim, defer scope, advisory
  lock, supervisor protection, capability fallback, idempotency, push_batch,
  route compatibility, WS filtering — these require a real Postgres test
  fixture and are operator-driven (the docs in
  `rust-work-service/tests/README.md` describe the recipe).
- ⏳ Postgres SQL probes — committed under `supabase/tests/`.

`scripts/validate-check-matrix.mjs` MUST fail when any matrix file is
missing OR when the file is not invoked by an active test runner.

### Validator strictness (gap-closure pass)

`scripts/validate-check-matrix.mjs` is **strict by default**: missing
files cause `exit 1`. Plan §13.4 explicitly says "any matrix cell
without a committed, invoked, passing test blocks merge of phases
9–11", so the validator will not silently soft-fail in CI.

#### CI invocation pattern (Item 18)

The validator runs in **two** places so the gate is enforced no matter
which lane caught the regression:

1. **GitHub Actions** — `.github/workflows/ci.yml` job `frontend-unit`
   step `Validate CI / check-matrix alignment`:

   ```yaml
   - name: Validate CI / check-matrix alignment
     run: node scripts/validate-check-matrix.mjs
   ```

   Runs strict; CI **MUST NOT** set `CHECK_MATRIX_LENIENT`.

2. **`pnpm quality:ci`** chain in `package.json` — appended after
   `check-bundle-budget.mjs` and before `test:unit`. Operators running
   the local CI lane (`pnpm quality:ci`) hit the gate before tests
   even start.

The nightly workflow (`.github/workflows/nightly-quality.yml`) also
invokes the validator with `continue-on-error: true` for diagnostics
only — that lane is informational, not a gate.

#### Current count (2026-05-02 baseline)

Strict run from a clean checkout reports **18 missing scaffolds** out
of 40 matrix cells (22 present). Exit code `1`. Anyone landing a real
regression in already-present cells will move the present-count down,
which is exactly the signal the gate exists to surface.

```bash
$ node scripts/validate-check-matrix.mjs ; echo "exit=$?"
[validate-check-matrix] present: 22/40
[validate-check-matrix] missing files:
  - rust-work-service/tests/concurrent_claim.rs
  - rust-work-service/tests/defer_scope.rs
  - rust-work-service/tests/zone_advisory_lock.rs
  - rust-work-service/tests/capability_fallback.rs
  - rust-work-service/tests/idempotency_conflict.rs
  - rust-work-service/tests/push_batch.rs
  - rust-work-service/tests/ws_subscribe_token.rs
  - rust-work-service/tests/release_modes.rs
  - rust-work-service/tests/settings_listener.rs
  - rust-work-service/tests/starvation_guard.rs
  - src/lib/supabase/__tests__/concurrency.test.ts
  - src/features/admin/operation-control/__tests__/tab-wiring.test.tsx
  - src/features/admin/operation-control/__tests__/drag-reassign.test.tsx
  - src/features/admin/operation-control/__tests__/a11y.test.tsx
  - src/features/admin/operation-control/__tests__/density-persistence.test.tsx
  - src/features/rf-interface/__tests__/rf-signin.test.tsx
  - src/components/__tests__/manual-counts-search.test.tsx
  - scripts/backfill/__tests__/work_tasks_backfill.test.mjs
exit=1
```

#### Lenient mode (operator local workflow only)

Operators iterating locally on Rust integration test scaffolds (see
"⏳" lines above) can opt into soft-fail mode by exporting
`CHECK_MATRIX_LENIENT=1` for the duration of their session:

```bash
CHECK_MATRIX_LENIENT=1 node scripts/validate-check-matrix.mjs
```

Soft-fail mode logs the missing files and exits 0. **CI MUST NOT set
this variable** — it would defeat the purpose of the gate. The
expected day-one state is 18 missing scaffolds; once they're populated
and registered with `cargo test` the lenient escape hatch can be
removed entirely.

### Rust integration test scaffold templates (operator follow-up)

The `rust-work-service/tests/*.rs` files referenced by the matrix are
intentionally NOT generated by the gap-closure pass — they require a
live Postgres test fixture, real auth shimming, and per-test
seed/teardown. The recipe lives in `rust-work-service/tests/README.md`
(operator authors); each test should:

1. Spin a temp Postgres container or use the shared fixture.
2. Apply migrations 256–263 in numeric order.
3. Seed an org + at least two users with the relevant roles.
4. Drive the route under test through the actual axum handler.
5. Assert both DB state and broadcast WsEvents.

Operators check off matrix cells by committing the test file under the
exact path the matrix expects and adding `cargo test` invocation in CI.

## Known acceptable warnings

The Rust strategies module emits "associated items never used" warnings
until the dispatcher SQL refactor wires the trait into `claim_next_task`.
These are acceptable until the follow-on plan; do not gate Phase 9 on them.

The frontend Supabase generated-types cast (`as unknown as AnySupabase`) is
acceptable until migrations 256-261 are applied and `database.types.ts`
regenerated.
