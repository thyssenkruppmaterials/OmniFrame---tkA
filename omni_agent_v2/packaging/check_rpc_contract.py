#!/usr/bin/env python3
# Created and developed by Jai Singh
"""JSON-RPC contract cross-check for OmniAgent v2.

The wire contract between the Rust shell (agent-types) and the Python
helper (sap_helper.py) is duplicated across three places because each
side speaks a different language:

    1. crates/agent-types/src/rpc.rs    -> Rust:    enum RpcMethod
    2. python/sap_helper.py + handlers/ -> Python:  dispatcher.register(...)
    3. gui/src/lib/types.ts             -> TS:      (none yet - GUI doesn't
                                                     call methods by name)

This script is the single guard that keeps the sides in sync. It runs in
the macOS validation harness and exits 0 when the populated sides agree,
1 when they diverge in a way that would cause a JSON-RPC 404 at runtime.

Semantic (intentionally pragmatic):

    * Soft-pass when no side declares any methods yet (early scaffold).
    * Soft-pass when only one side declares methods (can't cross-check).
    * Hard fail when two or more sides declare methods AND their sets
      differ. The diff is printed both directions:
        - methods Rust knows that Python doesn't  -> dead code in Rust
        - methods Python knows that Rust doesn't  -> uncallable in Rust

    * The TS side does not currently carry RPC method names — only the
      data shapes (SessionPool, AgentMetrics, etc.). We report on it for
      visibility but do not include it in the diff comparison. If a
      future GUI feature dispatches methods by name, add a top-level
      `RpcMethod` string literal type in `gui/src/lib/types.ts` and the
      extractor below will start including it automatically.
"""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

RUST_RPC_FILE = REPO_ROOT / "crates" / "agent-types" / "src" / "rpc.rs"
PY_HELPER_FILE = REPO_ROOT / "python" / "sap_helper.py"
PY_HANDLERS_DIR = REPO_ROOT / "python" / "handlers"
TS_TYPES_FILE = REPO_ROOT / "gui" / "src" / "lib" / "types.ts"


@dataclass
class SideReport:
    """Result of extracting method names from one language's source."""

    name: str
    paths: list[Path]
    found: set[str] = field(default_factory=set)
    present: bool = False
    note: str | None = None


def _read_text(path: Path) -> str | None:
    if not path.exists():
        return None
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        print(f"  ! could not read {path}: {exc}", file=sys.stderr)
        return None


def extract_rust(path: Path) -> SideReport:
    """Pull every dotted method name out of `rpc.rs`.

    Strategy: look at the `impl std::fmt::Display for RpcMethod` block
    (and the `FromStr` block, for symmetry). The string literal on the
    right of each `=>` arm IS the wire method name. This is the source
    of truth because serde uses `Display` to encode the method.
    """
    report = SideReport(name="Rust (RpcMethod)", paths=[path])
    text = _read_text(path)
    if text is None:
        report.note = "file missing — Worker A scaffold pending"
        return report
    report.present = True

    # Capture every string of the form "namespace.method..." inside the
    # `Display` and `FromStr` match arms. The pattern is deliberately
    # narrow (must contain at least one dot) to avoid catching error
    # messages or log strings.
    for match in re.finditer(r'"([a-z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)+)"', text):
        # Skip anything that's clearly not an RPC method namespace.
        method = match.group(1)
        if method.startswith("sap.") or method.startswith("helper.") \
                or method.startswith("recording.") or method.startswith("slot.") \
                or method.startswith("health.") or method.startswith("version."):
            report.found.add(method)

    if not report.found:
        report.note = "no RpcMethod variants extracted — module may be a stub"
    return report


def extract_python(helper_path: Path, handlers_dir: Path) -> SideReport:
    """Pull every `dispatcher.register("...")` call out of the helper.

    Worker B's design: each handler module exposes a `register(dispatcher)`
    function that calls `dispatcher.register("sap.foo", handle_foo)` one
    or more times. We grep across the helper file AND every handler
    module to find the canonical set of methods the helper will answer
    to at runtime.
    """
    paths: list[Path] = []
    if helper_path.exists():
        paths.append(helper_path)
    if handlers_dir.exists():
        paths.extend(sorted(handlers_dir.glob("*.py")))

    report = SideReport(name="Python (sap_helper + handlers/)", paths=paths)
    if not paths:
        report.note = "sap_helper.py and handlers/ both missing — Worker B scaffold pending"
        return report
    report.present = True

    for path in paths:
        text = _read_text(path)
        if text is None:
            continue
        for match in re.finditer(
            r'dispatcher\.register\s*\(\s*["\']([a-z][a-zA-Z0-9_.]+)["\']',
            text,
        ):
            report.found.add(match.group(1))
        # Also pick up `@method("...")` / `@rpc_method("...")` style if
        # the implementation switches to decorators later.
        for match in re.finditer(
            r'@(?:method|rpc_method|register|handler)\s*\(\s*["\']([a-z][a-zA-Z0-9_.]+)["\']',
            text,
        ):
            report.found.add(match.group(1))

    if not report.found:
        report.note = "no dispatcher.register() calls extracted"
    return report


def extract_typescript(path: Path) -> SideReport:
    """Pull RpcMethod literals out of the TS types file.

    Two patterns supported:
      1. `export type RpcMethod = "sap.connect" | "sap.confirmTo" | ...`
      2. `export const RPC_METHODS = { Connect: "sap.connect", ... }`
    """
    report = SideReport(name="TypeScript (gui/src/lib/types.ts)", paths=[path])
    text = _read_text(path)
    if text is None:
        report.note = "file missing — Worker C scaffold pending"
        return report
    report.present = True

    type_alias = re.search(r"type\s+RpcMethod\s*=\s*([^;]+);", text, flags=re.DOTALL)
    if type_alias:
        for match in re.finditer(r'["\']([a-z][a-zA-Z0-9_.]+)["\']', type_alias.group(1)):
            report.found.add(match.group(1))

    const_dict = re.search(r"RPC_METHODS\s*=\s*\{([^}]+)\}", text, flags=re.DOTALL)
    if const_dict:
        for match in re.finditer(r'["\']([a-z][a-zA-Z0-9_]+\.[a-zA-Z][a-zA-Z0-9_]+)["\']', const_dict.group(1)):
            report.found.add(match.group(1))

    if not report.found:
        report.note = "no RpcMethod literals declared (TS side is informational only)"
    return report


def _format_report(report: SideReport) -> str:
    head = f"  {report.name}"
    if not report.present:
        return f"{head}\n    (skipped — {report.note})"
    body = [f"{head}  ({len(report.found)} method(s))"]
    if report.note:
        body.append(f"    note: {report.note}")
    for m in sorted(report.found):
        body.append(f"      - {m}")
    return "\n".join(body)


def main() -> int:
    rust = extract_rust(RUST_RPC_FILE)
    python = extract_python(PY_HELPER_FILE, PY_HANDLERS_DIR)
    ts = extract_typescript(TS_TYPES_FILE)

    print("JSON-RPC contract cross-check")
    print("=" * 60)
    print(_format_report(rust))
    print(_format_report(python))
    print(_format_report(ts))
    print()

    # The TS side is informational only — Worker C uses Tauri commands
    # rather than naming RPC methods directly. We exclude it from the
    # comparison and only cross-check Rust vs Python.
    populated = []
    if rust.found:
        populated.append(("Rust", rust.found))
    if python.found:
        populated.append(("Python", python.found))

    if len(populated) == 0:
        print("  ! Neither Rust nor Python declares any RPC methods yet.")
        print("  ! Skipping cross-check (early scaffold phase).")
        return 0
    if len(populated) == 1:
        side_name, side_set = populated[0]
        print(f"  ! Only {side_name} declares methods so far ({len(side_set)}).")
        print("  ! Skipping cross-check until the other side lands.")
        return 0

    # Both Rust and Python have methods. Compare.
    rust_set = rust.found
    py_set = python.found

    only_rust = rust_set - py_set
    only_python = py_set - rust_set
    common = rust_set & py_set

    print(f"Comparison: Rust vs Python")
    print(f"  Rust declares:   {len(rust_set)}")
    print(f"  Python declares: {len(py_set)}")
    print(f"  In both sides:   {len(common)}")
    print(f"  Only in Rust:    {len(only_rust)}")
    print(f"  Only in Python:  {len(only_python)}")
    print()

    if only_rust:
        print(f"  Rust-only methods ({len(only_rust)} - dead code, would 404 at runtime):")
        for m in sorted(only_rust):
            print(f"    - {m}")
        print()

    if only_python:
        print(f"  Python-only methods ({len(only_python)} - uncallable from Rust side):")
        for m in sorted(only_python):
            print(f"    - {m}")
        print()

    if only_rust or only_python:
        print("FAIL — Rust and Python RPC method sets diverge.")
        print()
        print("To fix:")
        print("  * Either align both sides on the same set, OR")
        print("  * Add the missing variant to the Rust enum (crates/agent-types/src/rpc.rs)")
        print("    and run `cargo check -p agent-types`, OR")
        print("  * Add the missing dispatcher.register(...) call in the matching")
        print("    handler module under python/handlers/.")
        return 1

    print("PASS — Rust and Python agree on the JSON-RPC method set.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

# Created and developed by Jai Singh
