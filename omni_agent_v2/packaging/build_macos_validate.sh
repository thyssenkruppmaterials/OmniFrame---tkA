#!/usr/bin/env bash
# OmniAgent v2 -- macOS validation harness.
#
# Runs every check Workers A/B/C documented before declaring the v2 build
# ready to hand off to Parallels. Designed to:
#
#   * Work on macOS (the dev host) and on a Linux CI runner without
#     modification -- we only test Windows-target *syntax*, never linking.
#   * Be resilient to partial workspaces: if Worker B has not landed the
#     python helper yet, the Python steps log a warning and continue
#     rather than failing the whole run. The script exits non-zero only
#     when something that DID land is broken.
#   * Be idempotent and re-runnable. No state files; all temp output is
#     under /tmp/omni_agent_v2_validate.$$.
#
# Usage:
#     bash packaging/build_macos_validate.sh                  # full run
#     bash packaging/build_macos_validate.sh --quick          # skip slow steps
#     bash packaging/build_macos_validate.sh --no-clippy      # skip clippy
#     bash packaging/build_macos_validate.sh --no-windows     # skip Windows-target check

set -euo pipefail

cd "$(dirname "$0")/.."
REPO_ROOT="$(pwd)"
TMP_ROOT="$(mktemp -d "/tmp/omni_agent_v2_validate.XXXXXX")"
trap 'rm -rf "$TMP_ROOT"' EXIT

# ---------------------------------------------------------------------------
# Flags
# ---------------------------------------------------------------------------

QUICK=0
DO_CLIPPY=1
DO_WINDOWS=1
DO_TESTS=1
DO_FRONTEND=1

while [[ $# -gt 0 ]]; do
    case "$1" in
        --quick)      QUICK=1; DO_CLIPPY=0; DO_WINDOWS=0; DO_TESTS=0; DO_FRONTEND=0 ;;
        --no-clippy)  DO_CLIPPY=0 ;;
        --no-windows) DO_WINDOWS=0 ;;
        --no-tests)   DO_TESTS=0 ;;
        --no-frontend)DO_FRONTEND=0 ;;
        -h|--help)
            grep '^#' "$0" | sed 's/^# \{0,1\}//' | head -30
            exit 0
            ;;
        *)
            echo "Unknown flag: $1" >&2
            exit 2
            ;;
    esac
    shift
done

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

PASS_COUNT=0
WARN_COUNT=0
FAIL_COUNT=0
FAILED_STEPS=()

banner() {
    printf "\n${CYAN}=========================================================${NC}\n"
    printf "${CYAN}  %s${NC}\n" "$1"
    printf "${CYAN}=========================================================${NC}\n"
}

pass() {
    printf "${GREEN}  PASS${NC}  %s\n" "$1"
    PASS_COUNT=$((PASS_COUNT + 1))
}

warn() {
    printf "${YELLOW}  WARN${NC}  %s\n" "$1"
    WARN_COUNT=$((WARN_COUNT + 1))
}

fail() {
    printf "${RED}  FAIL${NC}  %s\n" "$1"
    FAIL_COUNT=$((FAIL_COUNT + 1))
    FAILED_STEPS+=("$1")
}

# Run a command, tee its output to a temp log, summarise pass/warn/fail.
#   $1 -- short label
#   $2 -- command (run via bash -c)
#   $3 -- required (1 = fail on non-zero, 0 = warn only)
#
# We force `pipefail` inside the spawned shell so commands piped to
# `tail` propagate their real exit code instead of always exiting 0.
# This catches the otherwise-silent failure mode where the underlying
# tool errors but the trailing `tail` mask hides it.
run_step() {
    local label="$1"
    local cmd="$2"
    local required="${3:-1}"
    local log="$TMP_ROOT/$(echo "$label" | tr ' /' '__').log"
    echo "    > $cmd"
    if bash -c "set -o pipefail; $cmd" >"$log" 2>&1; then
        pass "$label"
        tail -5 "$log" | sed 's/^/    | /'
    else
        local code=$?
        if [[ "$required" == "1" ]]; then
            fail "$label (exit $code)"
        else
            warn "$label (exit $code, non-blocking)"
        fi
        echo "    --- last 30 lines of $log ---"
        tail -30 "$log" | sed 's/^/    | /'
        echo "    --- end log ---"
    fi
}

# ---------------------------------------------------------------------------
# 1. Repo shape
# ---------------------------------------------------------------------------

banner "1. Repo shape"

for f in Cargo.toml rust-toolchain.toml README.md .gitignore packaging/build.ps1 packaging/ARCHITECTURE.md; do
    if [[ -f "$REPO_ROOT/$f" ]]; then
        pass "exists: $f"
    else
        fail "missing: $f"
    fi
done

for d in crates packaging .cargo; do
    if [[ -d "$REPO_ROOT/$d" ]]; then
        pass "exists: $d/"
    else
        fail "missing: $d/"
    fi
done

for c in agent-types agent-rpc agent-ws agent-core agent-bin agent-gui; do
    if [[ -d "$REPO_ROOT/crates/$c" ]]; then
        pass "crate dir: crates/$c"
    else
        fail "missing crate dir: crates/$c"
    fi
done

# ---------------------------------------------------------------------------
# 2. Rust workspace check (host target)
# ---------------------------------------------------------------------------

banner "2. Rust workspace check (host target)"

# agent-gui has a `build.rs` that calls `tauri_build::build()`. On a
# macOS dev host without the Tauri toolchain pre-installed, that fails
# at the build-script step regardless of feature flags. We exclude
# agent-gui from the cross-workspace check and run it separately under
# the `gui` feature only when the developer asks (see step 2b).
if command -v cargo >/dev/null 2>&1; then
    run_step "cargo check --workspace (excl. agent-gui)" \
        "cargo check --workspace --exclude agent-gui 2>&1 | tail -60"

    # agent-gui requires the Tauri toolchain. Try it as a soft step so
    # we surface the result without failing the harness on hosts that
    # don't have tauri-cli + WebView2 installed.
    run_step "cargo check -p agent-gui (soft)" \
        "cargo check -p agent-gui 2>&1 | tail -40" 0
else
    fail "cargo not on PATH"
fi

# ---------------------------------------------------------------------------
# 3. Rust workspace check (Windows MSVC target -- syntax only)
# ---------------------------------------------------------------------------

if [[ "$DO_WINDOWS" == "1" ]]; then
    banner "3. Rust workspace check (Windows MSVC target -- syntax only)"
    # The MSVC linker is not available on macOS / Linux, so a full build
    # against this target fails at link time. We only run `cargo check`
    # which stops before linking. If the target is not installed yet,
    # rustup will refuse -- that's a warning, not a failure.
    if rustup target list --installed 2>/dev/null | grep -q x86_64-pc-windows-msvc; then
        run_step "cargo check (windows-msvc)" "cargo check --workspace --target x86_64-pc-windows-msvc 2>&1 | tail -60" 0
    else
        warn "rustup target x86_64-pc-windows-msvc not installed; skipping (run 'rustup target add x86_64-pc-windows-msvc' to enable)"
    fi
fi

# ---------------------------------------------------------------------------
# 4. Clippy
# ---------------------------------------------------------------------------

if [[ "$DO_CLIPPY" == "1" ]]; then
    banner "4. Clippy (-D warnings)"
    run_step "cargo clippy --workspace" \
        "cargo clippy --workspace --exclude agent-gui --no-deps -- -D warnings 2>&1 | tail -60"
fi

# ---------------------------------------------------------------------------
# 5. Rust tests
# ---------------------------------------------------------------------------

if [[ "$DO_TESTS" == "1" ]]; then
    banner "5. cargo test --workspace"
    run_step "cargo test --workspace" \
        "cargo test --workspace --exclude agent-gui --no-fail-fast 2>&1 | tail -60"
fi

# ---------------------------------------------------------------------------
# 6. cargo fmt --check
# ---------------------------------------------------------------------------

banner "6. cargo fmt --check"
run_step "cargo fmt --check" "cargo fmt --all -- --check 2>&1 | tail -40"

# ---------------------------------------------------------------------------
# 7. Python AST parse
# ---------------------------------------------------------------------------

banner "7. Python AST parse"
if [[ -d "$REPO_ROOT/python" ]]; then
    if command -v python3 >/dev/null 2>&1; then
        # py_compile every .py file. compileall keeps going on errors.
        run_step "python3 -m compileall python/" "python3 -m compileall -q python 2>&1 | tail -20"
    else
        warn "python3 not on PATH"
    fi
else
    warn "python/ not present yet (Worker B not landed)"
fi

# ---------------------------------------------------------------------------
# 8. Python unit tests
# ---------------------------------------------------------------------------

if [[ "$DO_TESTS" == "1" ]]; then
    banner "8. Python pytest"
    if [[ -d "$REPO_ROOT/python/tests" ]]; then
        if python3 -c "import pytest" >/dev/null 2>&1; then
            run_step "pytest python/tests" "cd python && python3 -m pytest tests/ -v 2>&1 | tail -40"
        else
            warn "pytest not installed; skipping. Install with: pip install pytest"
        fi
    else
        warn "python/tests/ not present yet (Worker B not landed)"
    fi
fi

# ---------------------------------------------------------------------------
# 9. Frontend install + typecheck + build
# ---------------------------------------------------------------------------

if [[ "$DO_FRONTEND" == "1" ]]; then
    banner "9. Frontend (gui/) install + typecheck + build"
    if [[ -f "$REPO_ROOT/gui/package.json" ]]; then
        if command -v npm >/dev/null 2>&1; then
            run_step "npm ci (gui/)"        "cd gui && npm ci 2>&1 | tail -10"
            # Typecheck script may not exist on a minimal scaffold; ignore failure of npx tsc itself.
            if grep -q '"typecheck"' "$REPO_ROOT/gui/package.json"; then
                run_step "npm run typecheck (gui/)" "cd gui && npm run typecheck 2>&1 | tail -30"
            else
                run_step "npx tsc --noEmit (gui/)" "cd gui && npx --yes tsc --noEmit 2>&1 | tail -30" 0
            fi
            run_step "npm run build (gui/)"     "cd gui && npm run build 2>&1 | tail -30"
        else
            warn "npm not on PATH"
        fi
    else
        warn "gui/package.json not present yet (Worker C not landed)"
    fi
fi

# ---------------------------------------------------------------------------
# 10. JSON-RPC contract cross-check
# ---------------------------------------------------------------------------

banner "10. JSON-RPC contract cross-check"
if [[ -f "$REPO_ROOT/packaging/check_rpc_contract.py" ]]; then
    run_step "check_rpc_contract.py" "python3 packaging/check_rpc_contract.py 2>&1 | tail -40"
else
    fail "packaging/check_rpc_contract.py is missing"
fi

# ---------------------------------------------------------------------------
# 11. PowerShell build script syntax (best-effort)
# ---------------------------------------------------------------------------

banner "11. packaging/build.ps1 syntax (best-effort)"
if command -v pwsh >/dev/null 2>&1; then
    # `pwsh -NoProfile -Command "..."` cannot parse a script without
    # executing it on every platform, so we use the AST parser directly.
    run_step "pwsh AST parse" "pwsh -NoProfile -NonInteractive -Command \"\\\$ErrorActionPreference='Stop'; [System.Management.Automation.Language.Parser]::ParseFile('$REPO_ROOT/packaging/build.ps1', [ref]\\\$null, [ref]\\\$null) | Out-Null; 'OK'\"" 0
else
    warn "pwsh not on PATH; can't syntax-check build.ps1 on this host (it will run on Parallels)"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

banner "Summary"
printf "  ${GREEN}PASS:${NC}  %d\n" "$PASS_COUNT"
printf "  ${YELLOW}WARN:${NC}  %d\n" "$WARN_COUNT"
printf "  ${RED}FAIL:${NC}  %d\n" "$FAIL_COUNT"

if [[ "$FAIL_COUNT" -gt 0 ]]; then
    echo ""
    echo "Failed steps:"
    for s in "${FAILED_STEPS[@]}"; do
        printf "  ${RED}-${NC} %s\n" "$s"
    done
    echo ""
    echo "Validation FAILED. See per-step logs in $TMP_ROOT (kept until process exits)."
    exit 1
fi

echo ""
printf "${GREEN}All validation checks passed.${NC}\n"
echo ""
echo "Next step: hand off to Parallels and run"
echo "    pwsh ./packaging/build.ps1"
echo "to produce the Windows distribution."
