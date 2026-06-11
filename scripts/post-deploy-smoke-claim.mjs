#!/usr/bin/env node
/**
 * M-9 — post-deploy smoke check for rust-work-service.
 *
 * Trip-up this script catches:
 *   - 2026-05-14 AM ("v0.1.40 redeploy succeeded but old container kept
 *     serving") — Railway reported the deploy as healthy because the
 *     OLD container's `/health` still returned 200 while the NEW
 *     container crash-looped on EMAXCONNSESSION. The trap took 90 min
 *     to discover via field operator complaint. With this script wired
 *     into a post-deploy hook it would have failed in <60 s.
 *
 * Strategy:
 *   1. Read the expected Cargo version from `rust-work-service/Cargo.toml`
 *      (or honor `--expected-version` if passed) and the deploy URL from
 *      `--url` or `$WORK_SERVICE_URL`.
 *   2. Poll `${url}/health` until the reported `version` matches
 *      `expected_version` AND the body has `status: "healthy"`. Bounded
 *      retry loop — up to MAX_ATTEMPTS × ATTEMPT_DELAY_MS (default
 *      12 × 5 s = 60 s).
 *   3. If `${url}/health/detailed` is reachable, also assert
 *      `dependencies.database.status === "healthy"` and
 *      `dependencies.redis.status === "healthy"`.
 *   4. Exit 0 on success, 1 on failure (with a descriptive
 *      `::error::` annotation that GitHub Actions surfaces in the job
 *      summary).
 *
 * Usage:
 *   node scripts/post-deploy-smoke-claim.mjs \
 *     --url https://rust-work-service.railway.app \
 *     [--expected-version 0.1.43] \
 *     [--max-attempts 12] \
 *     [--interval-ms 5000]
 *
 * Reference:
 *   memorybank/OmniFrame/Decisions/ADR-Work-Distribution-Pipeline-Architecture-Review-2026-05-18.md (M-9)
 *   memorybank/OmniFrame/Debug/Fix-RF-Cycle-Count-Stuck-Waiting.md (the trap)
 *   docs/runbooks/work-engine/stuck-zone.md (operator-facing runbook)
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
import { exit } from 'node:process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')

function parseArgs(args) {
  const out = {}
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--url') out.url = args[++i]
    else if (a === '--expected-version') out.expectedVersion = args[++i]
    else if (a === '--max-attempts') out.maxAttempts = Number(args[++i])
    else if (a === '--interval-ms') out.intervalMs = Number(args[++i])
    else if (a === '--help' || a === '-h') out.help = true
  }
  return out
}

function readCargoVersion() {
  const path = resolve(REPO_ROOT, 'rust-work-service', 'Cargo.toml')
  const body = readFileSync(path, 'utf8')
  const m = body.match(/^version\s*=\s*"([^"]+)"/m)
  if (!m) {
    throw new Error(`Could not parse version from ${path}`)
  }
  return m[1]
}

function annotate(level, message) {
  // GitHub Actions `::error::` / `::warning::` / `::notice::` prefixes
  // surface in the job summary panel. Falls through to plain output
  // when run outside Actions.
  process.stdout.write(`::${level}::${message}\n`)
}

async function fetchJson(url) {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`)
  }
  return res.json()
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(`Usage: post-deploy-smoke-claim.mjs --url <url> [--expected-version <ver>] [--max-attempts N] [--interval-ms MS]`)
    exit(0)
  }

  const url = (args.url ?? process.env.WORK_SERVICE_URL ?? '').replace(/\/$/, '')
  if (!url) {
    annotate('error', 'Missing --url (or $WORK_SERVICE_URL).')
    exit(1)
  }

  const expectedVersion =
    args.expectedVersion ??
    process.env.WORK_SERVICE_EXPECTED_VERSION ??
    readCargoVersion()
  const maxAttempts = Number.isFinite(args.maxAttempts) ? args.maxAttempts : 12
  const intervalMs = Number.isFinite(args.intervalMs) ? args.intervalMs : 5000

  console.log(`[smoke] target=${url} expected_version=${expectedVersion}`)

  let lastError = ''
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const body = await fetchJson(`${url}/health`)
      console.log(`[smoke] attempt ${attempt}/${maxAttempts} → ${JSON.stringify(body)}`)
      if (body.status !== 'healthy') {
        lastError = `/health reported status=${body.status}`
      } else if (body.version !== expectedVersion) {
        lastError = `/health reported version=${body.version}, expected=${expectedVersion}`
      } else {
        try {
          const detailed = await fetchJson(`${url}/health/detailed`)
          const dbStatus = detailed?.dependencies?.database?.status
          const redisStatus = detailed?.dependencies?.redis?.status
          if (dbStatus !== 'healthy') {
            lastError = `/health/detailed database=${dbStatus}`
          } else if (redisStatus !== 'healthy') {
            lastError = `/health/detailed redis=${redisStatus}`
          } else {
            console.log(
              `[smoke] ✅ deploy verified — version=${body.version}, db=${dbStatus}, redis=${redisStatus}`
            )
            exit(0)
          }
        } catch (e) {
          // /health/detailed is best-effort — if it's not reachable
          // (e.g. behind a different ALB), still treat /health match
          // as success.
          console.log(
            `[smoke] /health/detailed unreachable (${e.message}); accepting /health match as success`
          )
          exit(0)
        }
      }
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e)
    }

    console.warn(`[smoke] attempt ${attempt}/${maxAttempts} not ready (${lastError}); sleeping ${intervalMs}ms...`)
    await sleep(intervalMs)
  }

  annotate(
    'error',
    `Deploy verification failed after ${maxAttempts} attempts (${(maxAttempts * intervalMs) / 1000}s window). Last error: ${lastError}`
  )
  exit(1)
}

await main()
