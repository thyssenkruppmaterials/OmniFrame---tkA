#!/usr/bin/env node

/**
 * Bundle Budget Checker
 *
 * Reads the Vite build output and enforces hard size thresholds.
 * Run after `pnpm build` to validate chunk sizes.
 *
 * Usage:
 *   node scripts/check-bundle-budget.mjs
 *   node scripts/check-bundle-budget.mjs --json          # machine-readable output
 *   node scripts/check-bundle-budget.mjs --dist ./dist   # custom dist directory
 *
 * Exit codes:
 *   0 — all budgets pass
 *   1 — one or more budgets exceeded
 */

import { readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';

// ── Configurable thresholds ─────────────────────────────────────────────────
const MAX_CHUNK_SIZE_KB = 500;        // No single first-party JS chunk may exceed this
const MAX_TOTAL_JS_KB   = 7500;       // Total JS budget (all chunks combined, including lazy)
const MAX_CHUNKS_OVER   = 0;          // Number of first-party chunks allowed over limit

// Lazy-loaded vendor chunks that are exempt from per-chunk limit because they
// only download on-demand and don't affect initial/route loads.
const LAZY_VENDOR_EXEMPT = [
  'exceljs',      // ~937 KB, dynamic import() in ExcelViewer
  'vendor-pdfjs', // ~400 KB, lazy-loaded PDF viewer (chunk name from vite.config.ts manualChunks)
  'vendor-three', // ~1 MB three.js engine + pure-JS ecosystem; only loads when the
                  //   3D Location Tab opens (React.lazy in warehouse-location-map).
];

// ── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const jsonOutput = args.includes('--json');
const distIdx = args.indexOf('--dist');
const distDir = distIdx !== -1 && args[distIdx + 1]
  ? args[distIdx + 1]
  : join(process.cwd(), 'dist', 'assets');

// ── Helpers ─────────────────────────────────────────────────────────────────
function formatKB(bytes) {
  return (bytes / 1024).toFixed(2);
}

function isExempt(filename) {
  return LAZY_VENDOR_EXEMPT.some((pattern) => filename.includes(pattern));
}

// ── Main ────────────────────────────────────────────────────────────────────
function run() {
  let files;
  try {
    files = readdirSync(distDir);
  } catch {
    console.error(`\n  ✗ Build output not found at: ${distDir}`);
    console.error('    Run "pnpm build" first.\n');
    process.exit(1);
  }

  const jsFiles = files
    .filter((f) => f.endsWith('.js'))
    .map((f) => {
      const fullPath = join(distDir, f);
      const bytes = statSync(fullPath).size;
      const kb = bytes / 1024;
      const exempt = isExempt(f);
      return { name: f, bytes, kb, exempt };
    })
    .sort((a, b) => b.kb - a.kb);

  if (jsFiles.length === 0) {
    console.error('\n  ✗ No .js files found in build output.\n');
    process.exit(1);
  }

  const totalKB = jsFiles.reduce((sum, f) => sum + f.kb, 0);
  const overBudget = jsFiles.filter((f) => f.kb > MAX_CHUNK_SIZE_KB && !f.exempt);
  const exemptOver = jsFiles.filter((f) => f.kb > MAX_CHUNK_SIZE_KB && f.exempt);

  // ── JSON output mode ────────────────────────────────────────────────────
  if (jsonOutput) {
    const result = {
      pass: overBudget.length <= MAX_CHUNKS_OVER && totalKB <= MAX_TOTAL_JS_KB,
      thresholds: { MAX_CHUNK_SIZE_KB, MAX_TOTAL_JS_KB, MAX_CHUNKS_OVER },
      totalJS_KB: +totalKB.toFixed(2),
      chunkCount: jsFiles.length,
      overBudget: overBudget.map((f) => ({ name: f.name, kb: +f.kb.toFixed(2) })),
      exemptOver: exemptOver.map((f) => ({ name: f.name, kb: +f.kb.toFixed(2) })),
      top10: jsFiles.slice(0, 10).map((f) => ({ name: f.name, kb: +f.kb.toFixed(2), exempt: f.exempt })),
    };
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.pass ? 0 : 1);
  }

  // ── Human-readable output ───────────────────────────────────────────────
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║              Bundle Budget Report                          ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // Summary
  console.log(`  Total JS:     ${formatKB(totalKB * 1024).padStart(10)} KB  (budget: ${MAX_TOTAL_JS_KB} KB)`);
  console.log(`  Chunk count:  ${String(jsFiles.length).padStart(10)}`);
  console.log(`  Over budget:  ${String(overBudget.length).padStart(10)}     (limit: ${MAX_CHUNKS_OVER} allowed)`);
  if (exemptOver.length > 0) {
    console.log(`  Exempt (lazy):${String(exemptOver.length).padStart(10)}     (lazy-loaded vendors, not counted)`);
  }
  console.log();

  // Top 15 largest chunks
  console.log('  ┌────────────────────────────────────────────────────────┬──────────┬────────┐');
  console.log('  │ Chunk                                                  │ Size (KB)│ Status │');
  console.log('  ├────────────────────────────────────────────────────────┼──────────┼────────┤');

  const displayCount = Math.min(jsFiles.length, 15);
  for (let i = 0; i < displayCount; i++) {
    const f = jsFiles[i];
    const sizeStr = formatKB(f.bytes).padStart(8);
    let status;
    if (f.kb > MAX_CHUNK_SIZE_KB && f.exempt) {
      status = ' EXEMPT';
    } else if (f.kb > MAX_CHUNK_SIZE_KB) {
      status = '  FAIL ';
    } else if (f.kb > MAX_CHUNK_SIZE_KB * 0.9) {
      status = '  WARN ';
    } else {
      status = '  pass ';
    }

    const nameStr = f.name.length > 56 ? f.name.slice(0, 53) + '...' : f.name.padEnd(56);
    console.log(`  │ ${nameStr}│${sizeStr} │${status}│`);
  }

  if (jsFiles.length > displayCount) {
    console.log(`  │ ... and ${jsFiles.length - displayCount} more chunks under budget${''.padEnd(21)}│${''.padStart(10)}│${''.padStart(8)}│`);
  }
  console.log('  └────────────────────────────────────────────────────────┴──────────┴────────┘\n');

  // Threshold checks
  const checks = [];
  const chunkPass = overBudget.length <= MAX_CHUNKS_OVER;
  const totalPass = totalKB <= MAX_TOTAL_JS_KB;

  checks.push({
    label: `Per-chunk limit (${MAX_CHUNK_SIZE_KB} KB)`,
    pass: chunkPass,
    detail: chunkPass
      ? 'All first-party chunks within budget'
      : `${overBudget.length} chunk(s) exceed ${MAX_CHUNK_SIZE_KB} KB: ${overBudget.map((f) => f.name).join(', ')}`,
  });

  checks.push({
    label: `Total JS budget (${MAX_TOTAL_JS_KB} KB)`,
    pass: totalPass,
    detail: totalPass
      ? `${formatKB(totalKB * 1024)} KB total`
      : `${formatKB(totalKB * 1024)} KB exceeds ${MAX_TOTAL_JS_KB} KB budget`,
  });

  for (const c of checks) {
    const icon = c.pass ? '✓' : '✗';
    console.log(`  ${icon} ${c.label}: ${c.detail}`);
  }

  if (exemptOver.length > 0) {
    console.log(`\n  ℹ Exempt lazy-loaded chunks (not counted against budget):`);
    for (const f of exemptOver) {
      console.log(`    • ${f.name} — ${formatKB(f.bytes)} KB (dynamic import)`);
    }
  }

  const allPass = chunkPass && totalPass;
  console.log(`\n  ${allPass ? '✓ PASS' : '✗ FAIL'} — Bundle budget ${allPass ? 'within limits' : 'EXCEEDED'}\n`);

  process.exit(allPass ? 0 : 1);
}

run();
