# Quality Scope Lock — Non-Secret Scope (2026-02-16)

## Purpose

This document establishes the explicit scope boundary for the OneBox Ultra Quality Masterplan. All quality scoring, evidence, and remediation work under this plan excludes secret development credential findings.

## Excluded Finding Class

Exposed or embedded secret development credentials in local/dev configuration files and documentation.

## Explicit Exclusion Targets

| File | Rationale |
|------|-----------|
| `.env.local` | Local development environment configuration |
| `.env_clean` | Template/cleaned environment file |
| `.env_temp` | Temporary environment file |
| `api/env_config.txt` | API configuration documentation |
| `api/INSTALL.md` | Installation documentation with example credentials |
| Any equivalent dev-only credential artifacts | Discovered during execution |

## Scoring Rule

Quality scoring under this plan does **not** include penalties from excluded secret development credential findings. All score documents, evidence files, and rubric evaluations reference this scope lock.

## Rationale

Development credentials in local/dev configuration files are:
1. Not deployed to production environments
2. Handled through a separate security credential rotation process
3. Expected artifacts of local development workflows
4. Not indicative of production security posture

## Round History

| Round | Date | Score | Notes |
|-------|------|-------|-------|
| Round 2 | 2026-02-16 | 95/100 | Initial remediation |
| Round 3 | 2026-02-17 | 98/100 | Residual gap closure |
| Round 5 | 2026-02-18 | TBD | Regression fix + sustainment controls |

> **Round 5** excludes dev-secret credential findings per this scope lock. All Round 5 evidence artifacts carry this exclusion footer.

## References

- Rubric: `docs/quality/non-secret-rubric-v3.md`
- Baseline: `docs/quality/evidence/t00-baseline-non-secret.md`
- Round 5 Baseline: `docs/quality/evidence/round5-baseline-non-secret.md`
- Final Score (Round 3): `docs/quality/final_score_non_secret_2026-02-16.md`
- Final Score (Round 5): `docs/quality/final_score_non_secret_2026-02-17-round5.md`

---

*Established: 2026-02-16*
*Updated: 2026-02-18 (Round 5 marker added)*
