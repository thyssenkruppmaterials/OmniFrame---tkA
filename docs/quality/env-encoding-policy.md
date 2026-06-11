# Environment File Encoding Policy

## Standard

All `.env` files in this project MUST be encoded as **UTF-8 without BOM** (Byte Order Mark).

## Rationale

- Pydantic `BaseSettings` uses `env_file_encoding="utf-8"` which fails on UTF-16 or UTF-8-BOM files.
- Windows tools (notably Notepad in older versions) may save as UTF-16 LE or UTF-8 with BOM by default.
- CI environments expect plain UTF-8.

## Test Environment

- `.env.test` is the canonical test environment file (safe to commit, no secrets).
- When `TESTING=true` or `PYTEST_CURRENT_TEST` is set, `settings.py` prefers `.env.test` over `.env`.
- CI creates `.env.test` explicitly before running pytest.

## Troubleshooting

If you see `UnicodeDecodeError` when importing `api.config.settings`:

1. Check your `.env` file encoding: `file .env` (should show "UTF-8 Unicode text")
2. Re-save as UTF-8 without BOM
3. Or set `TESTING=true` to use `.env.test` instead
