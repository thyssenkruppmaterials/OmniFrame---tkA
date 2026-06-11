---
tags: [type/implementation, status/active, domain/agent, domain/frontend, domain/infra]
created: 2026-05-21
---

# Implement — Service Key Strict Toggle

## Purpose / Context

Phase 10 shipped strict service-key boot (`OMNIFRAME_AGENT_REQUIRE_SERVICE_KEY=1`) as the default for all master-spawned workers. Operators sometimes need to bring the fleet online before every worker identity is provisioned in the web admin. This toggle exposes `master.require_service_keys` so strict mode remains the default while allowing a controlled soft fallback.

Motivation aligns with [[Plan-Multi-Session-Agent-Master]] Section 11 Q6 (strict default) and operator feedback during [[Implement-Phase-E-Setup-Wizard]] / [[Implement-Phase-F-Persistence-Orphan-Adoption]] rollout.

## Behavior

| `require_service_keys` | Wizard Step 4 | Supervisor spawn env | Worker auth |
|---|---|---|---|
| `true` (default) | Blocks [Next] until all workers registered | Sets `OMNIFRAME_AGENT_REQUIRE_SERVICE_KEY=1` | Service key required at boot |
| `false` | [Next] enabled via "Skip registration for now" checkbox | Omits env var entirely | Phase A loader soft-falls back to operator Supabase JWT (deprecation warning at boot) |

## Surfaces

1. **Setup Wizard Step 4** — checkbox "Skip registration for now (use user session fallback)" at top of panel; inverted binding (`skip_var=True` → `require_service_keys=False`). Hint label visible when checked.
2. **Settings → Master globals** — `CTkCheckBox` "Require service keys for spawned workers (recommended)" adjacent to `fix_admin_confirm_required`.

## Persistence

- YAML: `master.require_service_keys` in `master_config.yaml` via `config_to_yaml_dict` / `_coerce_master` (missing key → `True`).
- Wizard resume: `wizard_state.json` field `require_service_keys` (missing → `True`).
- `build_config_from_state` propagates wizard choice into persisted config.
- `is_wizard_required` skips key-file check when config has `require_service_keys: false`.

## Restart classification

`master.require_service_keys` is in `RESTART_REQUIRED_FIELDS` — changing it affects spawn-time env only; existing workers keep prior env until respawn.

## Security caveat

Soft mode re-introduces auth split-brain risk (browser SPA JWT vs worker identity mismatch) documented in the 2026-05-20 stuck-confirms incident. Strict mode remains recommended for production; soft mode is for bootstrap / lab only.

## Related

- [[Plan-Multi-Session-Agent-Master]]
- [[Implement-Phase-E-Setup-Wizard]]
- [[Implement-Phase-F-Persistence-Orphan-Adoption]]
- [[Implement-Phase10-Service-Key-First-Rollout]]
