---
tags: [type/debug, status/active, domain/database, domain/backend, domain/analytics]
created: 2026-06-04
---
# Retrospective — Cycle-Count Two-Fix Journey (broken → resolve-fix → claim-fix)

Read-only analysis of how cycle counting evolved 2026-05-19 → 2026-06-04 (EST)
across BOTH fixes, for org `c9d89a74-7179-4033-93ea-56267cf42a17`. No code/deploy
changes. Companion canvas:
`canvases/cycle-count-final-retrospective-2026-06-04.canvas.tsx`.

## Deploy boundary — VERIFIED (the second intervention)

The claim-race fix did NOT go live on the day it was written (May 29) by accident —
it was deployed the same evening:

- **Migration 332** (`enable_cycle_count_sticky_zone`, `sticky_zone=true`) applied at
  schema-migration version **20260529184716 = 18:47 UTC (14:47 EDT) May 29**.
- **rust-work-service** Railway deploy history (CLI; MCP token was stale this session):
  the first redeploy AFTER the fix landed **19:46 UTC May 29** (15:46 EDT), several
  iterations May 30–31, and the **current running deployment** (digest `51d029…`,
  reason redeploy) since **2026-06-01 00:55 UTC**.
- The data corroborates the boundary independently: every claim-race metric flips
  between **May 29 (still broken) and May 30 (clean)** — exactly at the deploy.

So: resolve-fix boundary = May 20 ~21:18 EDT (migration 323); claim-fix boundary =
May 29 ~15:46 EDT; first FULL clean day = May 30.

## Headline journey (weighted, org-wide)

| Metric | Broken (May 20) | Resolve-fix only (May 21–29) | Both fixes (May 30–Jun 4) |
|---|---|---|---|
| Same-aisle linearity | 79.0% | 80% (bimodal: 86–89% light, 74–78% busy) | **92–93%** |
| Near-simul (≤3s) aisle-switch | 56% | ~52% | **0–4.5%** |
| Isolated-claim aisle-switch | 12% | ~9% | ~0.6% |
| Coin-flip swap rate (near pairs) | 38% | 46% | **0%** |
| Median gap between counts | 54s | ~34s | **~22s** |
| Rack switches / 100 counts | 13.7 | 6–18 | **0.3–1.0** |
| Rule-resolved | 99% | 100% | 100% |

## The claim-race fix worked — unambiguous proof

The hero metric for the recent fix. **Near-simultaneous aisle-switch rate** by day:

- Pre-fix (May 19–29): near-simul **37–64%** vs isolated **4–15%** → the **4.3–8×**
  gap that defined the bug.
- **Post-fix (May 30 → Jun 4): near-simul 0%, 0%, 2.5%, 3.0%, 4.5%** — collapsed onto
  the isolated baseline (~0.2–1.4%). Simultaneity no longer predicts a jump.

**Coin-flip swap signature** (A:X→Y while B:Y→X, the unserialized-race fingerprint):

- Pre-fix: 25–67% of near-simul pairs were clean swaps (May 27 10/15, May 28 14/37,
  May 29 15/28).
- **Post-fix: 0 clean swaps every single day** (May 30 0/52, Jun 2 0/20, Jun 4 0/31) —
  near-simul pairs now BOTH stay linear (~96–100%) instead of trading aisles. The
  advisory-lock serialization removed the race entirely.

## The nuance: resolve-fix was necessary but not sufficient

The era table looks odd at first — resolve-fix-only linearity (80%) is no better than
the broken baseline (79%). That's real and important: migration 323 restored the
**queue ordering**, but the **Phase-2 claim race** dragged linearity back down on busy
days. Light 2–3 counter days hit 86–89%; but as the crew scaled to 4–5 (May 27–29) the
simultaneous-claim thrash pulled it to **73–78%**. Linearity only became durable —
92–93% regardless of headcount — once BOTH fixes were live. The per-day line in the
canvas shows this clearly (a dip on May 27–29, then a step-up on May 30).

## Per-counter proof (same person, same Shelves zone)

- **David Simmons**: May 29 → May 30 linearity **70.4% → 93.0%**, rack switches
  **36 → 3**, counts **200 → 716** (3.6× throughput on the cleaner route).
- **William Brewer**: **75.6% → 92.9%**, rack switches **50 → 2**.
- **Nikki Mason**: **63.6% → 92.1%**.

The canvas overlays each one's May 29 (gray, zig-zag across 6–7 racks) vs May 30
(accent, clean single-rack sweeps) on a rack×aisle path map.

## Methodology

- `rr_cyclecount_data`, `status IN ('completed','variance_review','approved')`,
  `counter_name IS NOT NULL`, EST-date filtered, 8,436 rows.
- Location parsed `^([A-Z]+)-(\d+)-([A-Z])-(\d+)$` → rack / aisle / bay / slot
  (0.06% unparsed — RS/RP variants — excluded gracefully).
- Linearity = weighted same-rack+aisle transitions (Σ same / Σ transitions).
- Median gap excludes gaps > 15 min. Claim-race KPI uses `assigned_at` +
  `resolved_aisle`, replicating the 2026-05-29 diagnosis method.
- Intermediates in repo `.tmp/` (`cc_retro_analyze.py`, `cc_analysis.json`).

## Residual friction (none affecting routing correctness)

- The Phase-2 candidate scan still logs a ~1.0s `slow statement` warning per claim
  (correctness now fine under the lock; future perf/index pass).
- Unrelated `trigger_evaluator: bad NOTIFY … missing field row_id` ERROR stream on the
  SAP `sap_agent_jobs` pipeline persists — its own ticket.
- Counts/hr swings 77–146 on small-crew days (expected); long >15 min break gaps are
  inherent.

## Related

- [[Investigate-Cycle-Count-Simultaneous-Claim-Aisle-Thrash-2026-05-29]] — the claim-race
  diagnosis + fix this retrospective validates (advisory lock, occupancy rewrite,
  sticky ranking, migration 332).
- [[Fix-Cycle-Count-Resolve-FOUND-Check-2026-05-20]] — migration 323, the first fix.
- [[Investigate-Cycle-Count-Paths-2026-05-20]] — original walking-path analysis +
  methodology this reuses.
- Canvas: `canvases/cycle-count-final-retrospective-2026-06-04.canvas.tsx`.
- Migrations: 323 (resolver `IF FOUND` + backfill), 332 (`sticky_zone=true`).
- Code: `rust-work-service/src/db/queries.rs` (`claim_next_cycle_count`).
