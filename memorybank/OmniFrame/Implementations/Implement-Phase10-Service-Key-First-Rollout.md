---
tags: [type/implementation, status/active, domain/auth, domain/agent, domain/frontend]
created: 2026-05-07
---

# Phase 10 Service-Key Rollout — First-Agent Runbook

Operational runbook for moving the on-prem agent fleet from the **legacy user-JWT** authentication path onto **Phase 10 service-key identity** (`omni_sk_*` plaintext key → 15-minute `kind: "agent"` JWT). Companion to [[Implement-Rust-Work-Service-Phase10]] (the *implementation* — what landed) and [[ADR-Agent-Identity-V2-Phase10]] (the *architecture* — why this shape). This note is the *rollout* — what an admin actually does, in what order, on which machine.

## Purpose / Context

Phase 10 shipped end-to-end in 2026-05-07 (admin UI + Rust routes + agent JWT-exchange path), but `agent_service_keys` has been sitting at zero rows in production. Every agent in the fleet is still running the legacy `_supabase_request()` user-JWT path. Until at least one agent actually registers and runs through the boot-time exchange, the Phase 11+ deletion arc (drop `_supabase_request`, drop `/supabase/login`, drop the user-token refresh thread, hard-fail on missing service key) cannot begin — the planned v2.1.0 release is gated on this rollout.

The migration is fully backward-compatible: the agent prefers the service-key JWT when one is configured, and silently falls back to the user-JWT path otherwise. There is no flag flip required to *start* registering agents — the only forcing function (`OMNIFRAME_AGENT_REQUIRE_SERVICE_KEY=1`) is for the **end** of the rollout, when we want every new boot to hard-fail unless a key is present.

This runbook is the recipe for the FIRST agent. Subsequent agents repeat steps 1–4.

## Pre-flight checklist

- [ ] You have an admin (`role IN ('admin', 'superadmin')`) account in OmniFrame.
- [ ] The target Citrix box is healthy: agent is running, `GET /health` returns 200, the SAP Testing → Agent Triggers → "Online Agents" tile shows it as online.
- [ ] You can reach the box's filesystem (RDP, Citrix console, or the local user can run a one-line `Set-Content` for you).
- [ ] You know the box's stable agent ID. The agent prints it once at boot:
  - Look for the line `[boot] agent self-id: <HOST>-<SESSION>-<USER>` in the agent's stdout.
  - Or compute it: `_agent_self_id()` is `f"{COMPUTERNAME}-{SESSIONNAME or 'Console'}-{USERNAME}"`. Example: `INDPDC1-Console-aclark`.
  - The `agent_id` you register in step 2 must match the box's `_agent_self_id()` exactly — the agent only reads `~/.omniframe/agent_service_key.txt` when its self-id matches the registration.

## Step 1 — Open the Agent Setup admin tab

1. Navigate to **SAP Testing → Agent Setup** (`?tab=agent-setup`).
2. The header strip should render with `0 active` / `0 revoked` badges and a `Register new agent` button. Empty-state card shows `No service keys yet`.
3. If the table is broken (loader spins forever, error card shows `No active session`), reload the page; the FE checks `supabase.auth.getSession()` synchronously before each call.

Component: [`agent-identity-tab.tsx`](../../../src/features/admin/sap-testing/components/agent-identity-tab.tsx) (~644 LOC, three sub-dialogs: `RegisterDialog`, `RevealKeyDialog`, `RevokeDialog`).
REST client: [`agent-identity-client.ts`](../../../src/lib/work-service/agent-identity-client.ts).

## Step 2 — Register the agent

1. Click **Register new agent**. The `RegisterDialog` opens.
2. **Agent ID** (required): paste the exact `_agent_self_id()` from the boot banner, e.g. `INDPDC1-Console-aclark`. Free-text but case-sensitive.
3. **Label** (optional): human-readable description, e.g. `Citrix OmniBox 01 — Aaron Clark`.
4. Click **Generate key**. The dialog calls `POST /api/v1/agent-identity/register`; on 201 the response carries the plaintext key.
5. The `RevealKeyDialog` opens with the **`omni_sk_<43 chars>` plaintext** in a copy-to-clipboard frame. **This is the ONE time the plaintext is ever shown.** If you close the dialog without saving, you must revoke the key and register again.

Failure modes worth knowing:
- `409 Conflict — agent already registered`: a non-revoked key exists for the same `(org, agent_id)`. Revoke the old one first, then re-register.
- `403 Forbidden — admin role required`: your user isn't `admin` / `superadmin`. Have a workspace admin do it.

## Step 3 — Save the key on the agent box

The agent reads its key from a single, well-known location. **Windows Citrix box (production fleet):**

```powershell
# In a PowerShell session running as the agent's Windows user:
$dir = Join-Path $env:USERPROFILE ".omniframe"
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
$key = "omni_sk_<paste_full_plaintext_here>"
Set-Content -Path (Join-Path $dir "agent_service_key.txt") -Value $key -NoNewline -Encoding ASCII

# Lock down the file so other Windows users on the box can't read it:
icacls (Join-Path $dir "agent_service_key.txt") /inheritance:r /grant:r ("$env:USERNAME" + ":(R,W)")
```

Result: `%USERPROFILE%\.omniframe\agent_service_key.txt` contains exactly the plaintext, no trailing newline.

If you opened the registration dialog on a different machine than the agent runs on, the plaintext has to traverse a secure channel (RDP clipboard, copy-paste into a session you initiated yourself, etc.) — **never email or chat the key**. If a leak is suspected, revoke immediately on the Setup tab; Rust's middleware revocation cache trips in ≤60 s.

For non-Windows test boxes (rare — most agents are Citrix), the equivalent path is `~/.omniframe/agent_service_key.txt` (POSIX) with `chmod 600`.

## Step 4 — Restart the agent

The agent reads `agent_service_key.txt` ONCE at boot from `_load_service_key()` (called from `_start_work_service_jwt_refresh_thread()`). Restart the agent so the read happens.

On Windows: kill the agent process (Task Manager, or `Stop-Process -Name agent`), then re-launch from the existing scheduled task / startup shortcut.

On a dev mac: `pkill -f omni_agent/agent.py` and re-launch from `start.py` or the agent's startup script.

## Step 5 — Verify boot banner posture

Once the agent reattaches, scan its stdout for the agent identity v2 boot banner. The two posture lines:

- **Success:**
  ```
  [agent-identity] v2: ENABLED — service key loaded from %USERPROFILE%\.omniframe\agent_service_key.txt (prefix=omni_sk_<8>…)
  [agent-identity] v2: exchanging key for 15-minute JWT…
  [agent-identity] v2: JWT acquired (kind=agent, expires_in=900s, organization_id=<…>)
  ```

- **Fallback (still on legacy path — something is wrong):**
  ```
  [agent-identity] v2: NOT CONFIGURED — agent_service_key.txt missing or unreadable. Falling back to legacy user-JWT path.
  ```

Common failure modes in step 5:

- *NOT CONFIGURED*: file path wrong, file empty, or the agent's Windows user can't read it (re-check the `icacls` grant from step 3).
- *exchange failed: 401 invalid_credentials*: the plaintext was mis-pasted (truncated, extra whitespace). Revoke and start over.
- *exchange failed: 403 unknown_agent*: the `agent_id` registered in step 2 doesn't match `_agent_self_id()`. Fix in the admin UI (revoke + re-register with the correct id) or — rarer — adjust the box's `COMPUTERNAME` / `SESSIONNAME` to match the registration.
- *exchange failed: 429*: the per-agent rate limit (5 failed exchanges/hour) tripped because earlier attempts thrashed. Wait an hour or revoke + re-register a fresh key (the new `key_id` resets the bucket).

## Step 6 — Verify backend state

In Supabase SQL (or the MCP `execute_sql`), confirm the row reflects use:

```sql
SELECT
  agent_id,
  key_prefix,
  label,
  created_at,
  last_used_at,
  revoked_at
FROM public.agent_service_keys
WHERE agent_id = 'INDPDC1-Console-aclark'
ORDER BY created_at DESC;
```

After 1–2 minutes of agent uptime:

- `last_used_at` should be within the last 60s (the JWT refresh thread re-exchanges ~60s before each 15-minute expiry, hitting `/exchange` and bumping `last_used_at`).
- The Agent Setup table's "Last used" column re-renders the same value as `<seconds>s ago`.

If `last_used_at` stays NULL > 5 min after a successful boot banner, something downstream is using the legacy path despite the v2 token (rare; check `[agent-identity] v2: JWT refresh failed` lines in the agent log).

## Rollout milestones

This runbook executes once per agent. The fleet-wide rollout is sequenced in three checkpoints:

### Checkpoint A — first agent live (now)

- One row in `agent_service_keys` with `last_used_at` ticking.
- One agent's stdout shows `v2: ENABLED` posture line.
- Outcome: validates the end-to-end path on real production traffic.

### Checkpoint B — 50% of fleet registered

- After half the boxes have been through steps 1–6, set the new "soft hard-fail" env var on **new agent installs only**:

  ```
  OMNIFRAME_AGENT_REQUIRE_SERVICE_KEY=1
  ```

- Effect: any agent boot that doesn't find `agent_service_key.txt` exits with code 78 instead of falling back to the legacy path. This catches "I forgot step 3" before the box silently runs on a stale user JWT for hours.
- Existing already-running agents keep their current behaviour (the env var is read at boot only).
- Set this on the box's environment / scheduled task **before** dropping the user JWT path itself.

### Checkpoint C — 100% of fleet registered

- Every active box appears in `agent_service_keys` with a recent `last_used_at`.
- Cross-check via `sap_agents` (the heartbeat registry): every agent there should have a service-key row.
- Verify no agent has logged `[agent-identity] v2: NOT CONFIGURED` in the last 24h (Datadog / log aggregator query — paste the literal posture line).
- **Schedule v2.1.0 for the next quarterly release** — the actual deletion of the legacy direct-Supabase auth surface (`/supabase/login` route, `_supabase_request()` token-bearing helper, the `state.supabase_token` refresh thread, the `OMNIFRAME_AGENT_REQUIRE_SERVICE_KEY` warning-vs-hard-fail toggle, the agent's user-profile bootstrap query). See [[Implement-Rust-Work-Service-Phase11]] §"Surviving direct-Supabase surface" for the full inventory of what stays and what goes.

## Failure recovery

| Symptom | Likely cause | Recovery |
|---|---|---|
| `RevealKeyDialog` plaintext was lost (page closed without saving) | Admin clicked outside before copying | Revoke the new (now unknown-plaintext) key on the Setup tab, re-register. Wastes one row but no security impact (plaintext was never persisted server-side). |
| Agent boot shows `v2: NOT CONFIGURED` despite step 3 looking right | Wrong Windows user owns the file, BOM-prefixed file, or the agent runs as `SYSTEM` while file lives under a human user's `USERPROFILE` | Ensure `agent_service_key.txt` is at the path the agent's process can resolve — the agent uses `os.path.expanduser('~/.omniframe/agent_service_key.txt')` against its own process token. Re-save without BOM (`-Encoding ASCII -NoNewline` in PowerShell). |
| Multiple agents with the same `agent_id` race | Two boxes share `_agent_self_id()` (rare — usually means two Citrix sessions with the same `SESSIONNAME=Console`) | The unique constraint blocks the second registration. Either differentiate the boxes (rename one) or revoke the first key, register, save on box A; then revoke + re-register for box B. |
| Admin lost their session mid-rollout | The plaintext modal needed a fresh JWT for the `/register` POST | Re-auth in another tab, the plaintext key from the prior dialog is gone but the row is in `agent_service_keys` (revoked-but-existing); revoke it formally and start over. |
| Phase 11 hard-fail (`require_service_key=1`) tripped in production despite key presence | File is corrupted / path drift after a Windows profile reset | Boot will exit 78 with `[agent-identity] v2: NOT CONFIGURED but OMNIFRAME_AGENT_REQUIRE_SERVICE_KEY=1`. Re-run step 3, restart. |

## Related

- [[Implement-Rust-Work-Service-Phase10]] — implementation (schema + routes + middleware + agent client).
- [[Implement-Rust-Work-Service-Phase11]] — release boundary that introduced the `OMNIFRAME_AGENT_REQUIRE_SERVICE_KEY` env var.
- [[ADR-Agent-Identity-V2-Phase10]] — architecture decision (Argon2id parameters, `omni_sk_` shape, 15-minute JWT, revocation cache TTL).
- [[Components/Omni-Agent - Headless SAP Agent]] — agent overview (boot ordering, surviving direct-Supabase surface).
- [[Components/Rust-Work-Service]] — service overview (the `/api/v1/agent-identity/*` route group).
- [[Sessions/2026-05-07]] — EOD cleanup (Workstream A) entry that authored this runbook.


## Persistence across rebuilds

The v2.0.0 hot-fix release (2026-05-07) added a three-tier service-key search to `_load_agent_service_key()` so a fresh `.exe` ship on top of a previously-registered Citrix box does NOT require re-registering the agent. The loader now consults, in priority order:

| Slot | Source | When to use |
|---|---|---|
| 1 | `OMNIFRAME_AGENT_SERVICE_KEY` env var (literal value) | Ephemeral testing, systemd-style secret injection. Highest precedence — wins over both on-disk slots when set. |
| 2 | `_AGENT_SERVICE_KEY_PATH` (canonical, default `%USERPROFILE%\.omniframe\agent_service_key.txt` / `~/.omniframe/agent_service_key.txt`) | The runbook's primary location (step 3 above). Survives every `.exe` rebuild because nothing in `build_exe.bat` writes under `%USERPROFILE%\.omniframe\`. |
| 3 | `<exe-or-script-directory>/agent_service_key.txt` | Convenience for portable installs, dev builds, and the `build_exe.bat` deploy hand-off (the build folder retains `agent_service_key.txt` across robocopy syncs because the workspace whitelist intentionally omits it). |

**Auto-promotion**: when slot #3 hits and slot #2 is empty, the loader copies the alongside-exe file to the canonical path (creating `~/.omniframe/` with `0o700` and the file with `0o600` on POSIX), then logs:

```
[boot] Service key found alongside .exe at <path>
[boot] Promoted to canonical location <canonical> (mode 0o600)
[boot] Future agent updates can replace the .exe without re-registration; the key now persists at the canonical path.
```

From that point on slot #2 wins on every subsequent boot — slot #3 is silently ignored to prevent a stale build-folder copy from clobbering the durable canonical credential. If an admin rotates the key (revoke + re-register), they MUST overwrite the canonical file directly; a freshly-deployed alongside-exe copy will NOT take precedence.

**Build-folder hand-off** (`build_exe.bat` v2.0.0+): the build script's post-build step copies `agent_service_key.txt` from the build folder to `dist\agent_service_key.txt` so the freshly-built `.exe` ships next to the slot-#3 file an operator already pasted. The script prints a yellow warning (`[key] WARNING: do NOT distribute dist\OmniFrame_Agent.exe + agent_service_key.txt as a pair`) because each Citrix box gets its OWN per-agent key — sharing a key across boxes shorts out the per-agent audit trail (`agent_service_keys.last_used_at`, the `agent_service_key.exchanged` tracing event).

**The `.exe` itself never carries the key**: `OmniFrame_Agent.spec` passes `agent.py` only, and we deliberately do NOT add a `--add-data` clause for the key. The plaintext lives only on the operator's chosen filesystem path and never inside the PyInstaller bundle.

**401-on-exchange handling**: when a stale on-disk key is rejected by `/api/v1/agent-identity/exchange` (HTTP 401 invalid_credentials or 403 unknown_agent), the agent now logs a slot-aware warning naming the concrete file path the operator must DELETE before re-registering, e.g.:

```
[agent-identity] exchange REJECTED (HTTP 401): {…}. The on-disk service key was loaded from C:\Users\<user>\.omniframe\agent_service_key.txt — DELETE this file (it is now stale), register a fresh key in Settings → Agents, and save the new plaintext to C:\Users\<user>\.omniframe\agent_service_key.txt. The agent will fall back to the legacy user-JWT path until a fresh key is configured.
```

Auto-deletion is INTENTIONALLY not done — a transient server-side bug returning a spurious 401 must not cost the operator their key. The runbook's failure-recovery matrix (above) covers the manual delete + re-register flow.

## Repository hygiene

`agent_service_key.txt` and the surrounding `.omniframe/` directory are plaintext credentials and must NEVER be committed. The workspace `.gitignore` carries (since v2.0.0):

```
# Phase 10 — Agent service keys. Plaintext credentials. NEVER commit.
agent_service_key.txt
*.agent_service_key.txt
omni_sk_*.txt
.omniframe/
```

The `*.agent_service_key.txt` glob also catches the `agent_id`-prefixed naming convention some runbooks suggest (e.g. `INDPDC1-Console-aclark.agent_service_key.txt`). The `omni_sk_*.txt` glob catches the rare case where an admin saved the plaintext to a debug file matching the key prefix.

**Distribution**: NEVER ship `dist\OmniFrame_Agent.exe` and `dist\agent_service_key.txt` together to a shared download location (Supabase Storage, network share, email, Slack, etc.). The build-folder hand-off pattern above is for THIS Citrix box only. Each new box gets its own admin-UI registration, its own plaintext reveal, its own one-time copy onto its own filesystem.

**Audit**: every successful `/exchange` ticks `agent_service_keys.last_used_at` and emits a `tracing::info!(kind="agent_service_key.exchanged", …)` event. A shared key would make every agent's traffic appear to come from one box, defeating the per-agent timeline.
