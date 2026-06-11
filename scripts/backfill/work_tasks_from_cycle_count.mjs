#!/usr/bin/env node
/**
 * Chunked, resumable, drift-aware backfill of `rr_cyclecount_data` →
 * `work_tasks` (Phase 1.2).
 *
 * Why a script and not a single bulk INSERT:
 *   - For orgs with >1M historical cycle-count rows a bulk INSERT holds locks
 *     long enough to block live writes.
 *   - This driver paginates by (created_at, id) cursor, sleeps between
 *     chunks, persists progress to `work_engine_backfill_progress`, and
 *     aborts if drift count from work_engine_drift rises during the run.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... \
 *     node scripts/backfill/work_tasks_from_cycle_count.mjs \
 *       --org <uuid> [--chunk-size 5000] [--chunk-pause-ms 50]
 *
 * Idempotent — rerun resumes from `last_cursor_ts`/`last_cursor_id`.
 */

import { createClient } from '@supabase/supabase-js'

const args = process.argv.slice(2)
function arg(name, dflt) {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : dflt
}

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY required')
  process.exit(1)
}

const ORG = arg('org')
const CHUNK_SIZE = Number(arg('chunk-size', '5000'))
const CHUNK_PAUSE_MS = Number(arg('chunk-pause-ms', '50'))
if (!ORG) {
  console.error('--org <uuid> required')
  process.exit(1)
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
})

async function loadCursor(orgId) {
  const { data } = await sb
    .from('work_engine_backfill_progress')
    .select('last_cursor_ts, last_cursor_id, rows_inserted')
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!data) {
    await sb.from('work_engine_backfill_progress').insert({ organization_id: orgId })
    return { ts: null, id: null, total: 0 }
  }
  return { ts: data.last_cursor_ts, id: data.last_cursor_id, total: data.rows_inserted ?? 0 }
}

async function saveCursor(orgId, ts, id, total, finished = false) {
  await sb
    .from('work_engine_backfill_progress')
    .update({
      last_cursor_ts: ts,
      last_cursor_id: id,
      rows_inserted: total,
      finished_at: finished ? new Date().toISOString() : null,
    })
    .eq('organization_id', orgId)
}

async function snapshotDrift(orgId) {
  const { data } = await sb
    .from('work_engine_drift')
    .select('*')
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!data) return 0
  return (
    (data.missing_in_shadow ?? 0) +
    (data.assignee_drift ?? 0) +
    (data.priority_drift ?? 0) +
    (data.status_drift ?? 0)
  )
}

async function runChunk(orgId, cursor) {
  // We use an RPC if defined, but for portability just SELECT + INSERT here.
  let q = sb.from('rr_cyclecount_data').select('id, created_at')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: true })
    .order('id',         { ascending: true })
    .limit(CHUNK_SIZE)
  if (cursor.ts) {
    q = q.gt('created_at', cursor.ts)
  }
  const { data, error } = await q
  if (error) throw error
  if (!data || data.length === 0) return null

  // The actual projection uses the trigger, so we just bump
  // `updated_at = updated_at` to fire the trigger for any pre-existing
  // rows that pre-date trigger install. The trigger checks the shadow flag
  // before doing anything.
  const ids = data.map((r) => r.id)
  const { error: upErr } = await sb
    .from('rr_cyclecount_data')
    .update({ updated_at: new Date().toISOString() })
    .in('id', ids)
  if (upErr) throw upErr

  const last = data[data.length - 1]
  return { lastTs: last.created_at, lastId: last.id, count: data.length }
}

async function main() {
  const start = Date.now()
  const baseDrift = await snapshotDrift(ORG)
  console.log(`[backfill] org=${ORG} baseline drift=${baseDrift}`)

  const cursor = await loadCursor(ORG)
  let total = cursor.total
  let cur = { ts: cursor.ts, id: cursor.id }

  for (;;) {
    const r = await runChunk(ORG, { ts: cur.ts, id: cur.id })
    if (!r) break
    total += r.count
    cur = { ts: r.lastTs, id: r.lastId }
    await saveCursor(ORG, cur.ts, cur.id, total, false)

    const drift = await snapshotDrift(ORG)
    if (drift > baseDrift * 1.2 && drift > baseDrift + 50) {
      console.error(`[backfill] drift rose from ${baseDrift} to ${drift} — aborting`)
      process.exit(2)
    }

    await new Promise((res) => setTimeout(res, CHUNK_PAUSE_MS))
    if (process.env.BACKFILL_VERBOSE) {
      console.log(`[backfill] chunk done · total=${total} · drift=${drift}`)
    }
  }

  await saveCursor(ORG, cur.ts, cur.id, total, true)
  console.log(`[backfill] done · org=${ORG} · rows=${total} · ${(Date.now() - start) / 1000}s`)

  await sb.from('work_engine_backfill_report').insert({
    organization_id: ORG,
    legacy_count: total,
    work_count: null,
    drift_count: await snapshotDrift(ORG),
    payload: { chunk_size: CHUNK_SIZE, chunk_pause_ms: CHUNK_PAUSE_MS },
  })
}

main().catch((e) => { console.error(e); process.exit(1) })
