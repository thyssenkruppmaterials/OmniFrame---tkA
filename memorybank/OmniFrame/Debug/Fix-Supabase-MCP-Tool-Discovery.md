---
tags: [type/debug, status/active, domain/infra]
created: 2026-05-01
---
# Fix Supabase MCP Tool Discovery (No tools, prompts, or resources)

## Symptom
The MCP settings panel showed `supabase` server with the message **"No tools, prompts, or resources"** — while the sibling MCP servers (`railway-mcp-server`, `obsidian-mcp`) listed all their tools normally. The server appeared to start (green toggle) but exposed nothing the agent could call.

File-system corroboration: the per-MCP cache folder at
`IDE project cache for this repo (`mcps/` under the IDE project folder) mcps/project-0-OneBoxFullStack-supabase/`
contained only `INSTRUCTIONS.md` + `SERVER_METADATA.json`. The `tools/`, `prompts/`, and `resources/` subfolders that The host populates from a successful `tools/list` (etc.) handshake were missing — the same folders existed and were populated for the other two servers.

## Root Cause

The `docs` feature group in `@supabase/mcp-server-supabase` (≥ v0.7.0, including v0.8.0 latest as of 2026-05-01) is enabled by default. On `tools/list`, the server's `getDocsTools()` factory queries the Supabase Content API at `https://supabase.com/docs/api/graphql` to populate doc-search tool schemas. As of late April 2026 the Content API returns a payload shape that does NOT match the server's discriminated-union zod schema:

- The schema expects either `{ errors: NonOptional<...> }` (error branch) **or** `{ data: undefined, errors: array }` (also error branch).
- The API now returns a success-shaped `{ data: { ... } }` body with no `errors` field.

Neither union branch matches → zod throws → the entire `tools/list` request fails with JSON-RPC error `-32603`:

```
Failed to parse Supabase Content API response: [
  { "code": "invalid_union", "errors": [
    [{ "path": ["errors"], "expected": "nonoptional", "message": "Invalid input: expected nonoptional, received undefined" }],
    [{ "path": ["data"], "expected": "undefined", "message": "Invalid input: expected undefined, received object" },
     { "path": ["errors"], "expected": "array", "message": "Invalid input: expected array, received undefined" }]
  ], "path": [], "message": "Invalid input" }
]
```

Because `tools/list` itself errors, The host never receives ANY tool definition for the server — not just the docs ones. The whole feature surface goes dark, hence the "No tools, prompts, or resources" UI label. The `initialize` handshake itself succeeds (the server reports `capabilities: { tools: {} }` and the version banner) — that's why the toggle stays green. The breakage is strictly inside the late-bound `tools()` callback the server registers with `createMcpServer`.

Reproduction confirmed via stdio handshake on both v0.7.0 and v0.8.0 — same error → not a recent regression in the npm package; a server-side Supabase Content API shape change.

Reference: server source at [`packages/mcp-server-supabase/src/server.ts`](https://github.com/supabase-community/supabase-mcp/blob/c5b2b044/packages/mcp-server-supabase/src/server.ts) — `if (enabledFeatures.has('docs')) Object.assign(tools, getDocsTools({ contentApiClient }))` — the docs factory is the only thing that touches the Content API during tool registration. Disabling the `docs` feature bypasses the broken code path entirely.

## Fix

Updated `repo `mcp.json`` for the `supabase` entry: explicitly opt-out of the `docs` feature via `--features=...` (whitelisting every other group), and also pin to the project ref so the agent doesn't have to specify `project_id` on every call:

```json
"supabase": {
  "command": "/opt/homebrew/bin/npx",
  "args": [
    "-y",
    "@supabase/mcp-server-supabase@latest",
    "--project-ref=wncpqxwmbxjgxvrpcake",
    "--features=database,functions,branching,debugging,development,storage"
  ],
  "env": {
    "SUPABASE_ACCESS_TOKEN": "sbp_..."
  },
  "type": "stdio"
}
```

Notes on the chosen flags:
- `--features=database,functions,branching,debugging,development,storage` — matches the server's `DEFAULT_FEATURES` set MINUS `docs` (which is broken) and MINUS `account` (which is gated behind `!projectId` anyway, so adding it would be a no-op when `--project-ref` is set).
- `--project-ref=wncpqxwmbxjgxvrpcake` — narrows the server to the OmniFrame project. Hardcoded everywhere in the vault already (e.g. [[Implementations/Implement-Multi-Agent-Coordination]], [[Debug/Fix-Agent-Fleet-Bloat-And-Token-Rotation]]).
- `--read-only` deliberately NOT set — the workflow in this repo uses `apply_migration` and `execute_sql` heavily (see migrations 247, 250, 251, 224, 228, 230, 231, 232 all applied via Supabase MCP per session logs), so read-only would break it.

## Verification

Manual stdio handshake (`initialize` → `notifications/initialized` → `tools/list`) against the new args returns 22 tools:

```
list_tables, list_extensions, list_migrations, apply_migration, execute_sql,
get_logs, get_advisors, get_project_url, get_publishable_keys,
generate_typescript_types, list_edge_functions, get_edge_function,
deploy_edge_function, create_branch, list_branches, delete_branch,
merge_branch, reset_branch, rebase_branch, list_storage_buckets,
get_storage_config, update_storage_config
```

All the tools the OmniFrame workflow actually uses (`list_tables`, `apply_migration`, `execute_sql`, `get_logs`, `get_advisors`, `get_project_url`) are present. The only missing surface is `search_docs` / `get_doc` from the broken `docs` feature, which has no current call-sites in the vault.

After Restarting the MCP server (toggle off → on, or reload window), the `tools/`, `prompts/`, `resources/` subfolders should populate under the IDE project `mcps/project-0-OneBoxFullStack-supabase/` cache and the settings panel should show "22 tools enabled".

## When to re-enable docs

When upstream fixes either:
1. The Supabase Content API response shape (server-side), OR
2. The `getDocsTools` schema in `@supabase/mcp-server-supabase` to tolerate the new shape (client-side, would need a new npm release).

Verify by removing `--features=...` from the args temporarily and re-running the handshake; if `tools/list` returns ~24 tools (22 + 2 docs tools) without the parse error, it's safe to drop the explicit feature list.

## Related
- [[Components/Omni-Agent - Headless SAP Agent]] — the only major component that depends on Supabase MCP for migrations (`apply_migration`).
- [[Implementations/Implement-Multi-Agent-Coordination]] — references prior `apply_migration` use.
- [[Debug/Fix-Agent-Fleet-Bloat-And-Token-Rotation]] — references `execute_sql` for fleet cleanup.
- [[Sessions/2026-05-01]]
