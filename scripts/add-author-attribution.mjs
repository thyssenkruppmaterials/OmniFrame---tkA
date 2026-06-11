#!/usr/bin/env node
/**
 * Adds "Created and developed by Jai Singh" at the top and bottom of source files.
 * Usage: node scripts/add-author-attribution.mjs [--dry-run]
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ATTRIBUTION = 'Created and developed by Jai Singh'
const DRY_RUN = process.argv.includes('--dry-run')

const ROOT = new URL('..', import.meta.url).pathname

const TARGET_ROOTS = [
  'src',
  'api',
  'tests',
  'supabase/functions',
  'omni_bridge',
  'scripts',
  'rust-core-service',
  'rust-work-service',
  'rust-streaming-service',
  'rust-ai-service',
  'rust-mdm-service',
  'rust-dashboard-service',
  'omni_agent',
  'omni_agent_v2/crates',
  'omni_agent_v2/python',
  'omni_agent_v2/gui/src',
  'omni_agent_v2/packaging',
]

const ROOT_FILES = [
  'start.py',
  'vite.config.ts',
  'vitest.config.ts',
  'vitest.integration.config.ts',
  'playwright.config.ts',
  'knip.config.ts',
  'capacitor.config.ts',
  'analysis/capacity-2k-users.canvas.tsx',
  'omni_agent_v2/gui/vite.config.ts',
  'omni_agent_v2/gui/tailwind.config.ts',
]

const EXTENSIONS = new Set(['.ts', '.tsx', '.py', '.rs'])

const SKIP_PATH_PARTS = new Set([
  'node_modules',
  'target',
  'dist',
  '.git',
  '__pycache__',
  '.venv',
  'venv',
])

const SKIP_FILES = new Set(['routeTree.gen.ts'])

const COMMENT_PREFIX = {
  '.ts': '//',
  '.tsx': '//',
  '.py': '#',
  '.rs': '//',
}

function shouldSkipDir(name) {
  return SKIP_PATH_PARTS.has(name) || name.startsWith('.')
}

function walk(dir, files = []) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return files
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (shouldSkipDir(entry.name)) continue
      walk(fullPath, files)
      continue
    }

    if (!entry.isFile()) continue

    const ext = entry.name.slice(entry.name.lastIndexOf('.'))
    if (!EXTENSIONS.has(ext)) continue
    if (SKIP_FILES.has(entry.name)) continue

    files.push(fullPath)
  }

  return files
}

function commentLine(ext) {
  return `${COMMENT_PREFIX[ext]} ${ATTRIBUTION}`
}

function isEncodingCookie(line) {
  return /^#\s*(?:-\*-)?\s*(?:coding|encoding)\s*[:=]/i.test(line.trim())
}

function splitPythonPreamble(lines) {
  let index = 0
  const preamble = []

  if (lines[index]?.startsWith('#!')) {
    preamble.push(lines[index])
    index += 1
  }

  if (lines[index] && isEncodingCookie(lines[index])) {
    preamble.push(lines[index])
    index += 1
  }

  return { preamble, bodyStart: index }
}

function hasAttributionLine(line, ext) {
  if (!line) return false
  const trimmed = line.trim()
  return (
    trimmed === commentLine(ext) ||
    trimmed === `${COMMENT_PREFIX[ext]}${ATTRIBUTION}` ||
    trimmed.includes(ATTRIBUTION)
  )
}

function stripAttribution(lines, ext) {
  let start = 0
  let end = lines.length

  if (ext === '.py') {
    const { preamble, bodyStart } = splitPythonPreamble(lines)
    start = bodyStart
  } else {
    while (start < lines.length && lines[start].trim() === '') start += 1
  }

  while (start < end && hasAttributionLine(lines[start], ext)) start += 1
  while (start < end && lines[start].trim() === '') start += 1

  while (end > start && lines[end - 1].trim() === '') end -= 1
  while (end > start && hasAttributionLine(lines[end - 1], ext)) end -= 1
  while (end > start && lines[end - 1].trim() === '') end -= 1

  return lines.slice(start, end)
}

function transform(content, ext) {
  const normalized = content.replace(/\r\n/g, '\n')
  const hadTrailingNewline = normalized.endsWith('\n')
  const rawLines = normalized.split('\n')
  const lines =
    rawLines.length === 1 && rawLines[0] === '' ? [] : [...rawLines]
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()

  let preamble = []
  let bodyLines = lines

  if (ext === '.py') {
    const split = splitPythonPreamble(lines)
    preamble = lines.slice(0, split.bodyStart)
    bodyLines = stripAttribution(lines.slice(split.bodyStart), ext)
  } else {
    bodyLines = stripAttribution(lines, ext)
  }

  const header = commentLine(ext)
  const parts = []

  if (preamble.length > 0) {
    parts.push(...preamble)
  }

  parts.push(header)

  if (bodyLines.length > 0) {
    parts.push(...bodyLines)
    parts.push('')
  }

  parts.push(header)

  let result = parts.join('\n')
  if (hadTrailingNewline || result.length > 0) {
    result += '\n'
  }

  return result
}

function alreadyHasAttribution(content, ext) {
  const normalized = content.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n').filter((line, idx, arr) => {
    if (idx === arr.length - 1 && line === '') return false
    return true
  })

  if (lines.length === 0) return false

  let headerIndex = 0
  if (ext === '.py') {
    headerIndex = splitPythonPreamble(lines).bodyStart
  } else {
    while (headerIndex < lines.length && lines[headerIndex].trim() === '') {
      headerIndex += 1
    }
  }

  let footerIndex = lines.length - 1
  while (footerIndex > headerIndex && lines[footerIndex].trim() === '') {
    footerIndex -= 1
  }

  return (
    hasAttributionLine(lines[headerIndex], ext) &&
    hasAttributionLine(lines[footerIndex], ext)
  )
}

function collectFiles() {
  const files = []
  for (const root of TARGET_ROOTS) {
    walk(join(ROOT, root), files)
  }
  for (const file of ROOT_FILES) {
    const fullPath = join(ROOT, file)
    try {
      if (statSync(fullPath).isFile()) files.push(fullPath)
    } catch {
      // ignore missing optional root files
    }
  }
  return [...new Set(files)].sort()
}

function main() {
  const files = collectFiles()
  let updated = 0
  let skipped = 0

  for (const filePath of files) {
    const ext = filePath.slice(filePath.lastIndexOf('.'))
    const original = readFileSync(filePath, 'utf8')

    if (alreadyHasAttribution(original, ext)) {
      skipped += 1
      continue
    }

    const next = transform(original, ext)
    if (next === original) {
      skipped += 1
      continue
    }

    if (!DRY_RUN) {
      writeFileSync(filePath, next, 'utf8')
    }
    updated += 1
  }

  const mode = DRY_RUN ? 'Would update' : 'Updated'
  console.log(`${mode} ${updated} file(s), skipped ${skipped}, scanned ${files.length}`)
}

main()
