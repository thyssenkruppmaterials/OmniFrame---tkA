# Phase 13 — SLOs and Operator-Experience Targets

## 13.1 Engine SLOs

| Metric | Target | Page-on |
| ------ | ------ | ------- |
| Claim p95 duration | < 250ms | > 500ms for 10 min |
| Claim p99 duration | < 1s | > 2s for 5 min |
| `push_batch` p95 (10 tasks) | < 800ms | > 2s for 5 min |
| Cross-tenant leakage incidents | 0 | any non-zero |
| Reservation age p95 | < heartbeat_release_minutes × 1.5 | > 2× threshold for 15 min |
| Drift count (shadow mode) | 0 critical | any critical mismatch |
| Lost-claim rate | 0 | any reproducible occurrence |
| Heartbeat-driven false abandonment | 0 | any case where a heartbeating operator gets soft-released |
| Critical-priority starvation | 0 | any `critical` pending unclaimed > 30s with capable operators online |
| Hot-priority starvation | 0 sustained | `hot` pending unclaimed > 30 min while capable operators online |
| WS auth-token failure rate | < 0.1% of upgrade attempts | sustained > 1% for 10 min |

## 13.2 Operator-Experience SLOs

| Metric | Target |
| ------ | ------ |
| `time_to_first_task` p50 (sign-in → first claim success) | < 5s |
| `time_to_acknowledge` p50 (push received → operator ack) | < 3s |
| Step dwell on `quantity_entry` p95 | < 30s |
| Draft-loss rate | < 0.1% of claims |

## 13.3 Runbooks

Maintained under `docs/runbooks/work-engine/`:

- `stuck-zone.md`
- `cross-tenant-leak.md`
- `lost-claim.md`
- `pin-failure-spike.md`
- `realtime-gap.md`
- `rollback-drill.md`

## 13.4 Test Coverage Matrix

The full matrix lives in `.cursor/plans/work_engine_foundation_e9c4a217.plan.md`
(read-only). The CI gate is `scripts/validate-check-matrix.mjs`, which:

- Verifies every listed test file exists.
- Verifies the file is included in an active test runner (Vitest config,
  Cargo target, or `psql` invocation).
- Verifies the CI workflow contract documented in
  `docs/quality/local-ci-workflow.md` (or equivalent) hasn't drifted from
  the matrix.

## 13.5 Quarterly cadence

- **Quarterly:** rehearse `rollback-drill.md` in staging.
- **Quarterly:** review starvation thresholds against live distribution and
  adjust `work_engine_settings.feature_flags.starvation_thresholds_minutes`
  if labor patterns have shifted.
- **Quarterly:** refresh org-hash mapping if a new tenant joined; ensure
  `org_hash_label()` collision rate is < 0.1%.
