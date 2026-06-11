#!/usr/bin/env node
/**
 * Record the /intro screen to a video file.
 *
 * Launches Playwright against a running Vite dev server (default
 * http://localhost:5173/intro), captures the full cinematic sequence,
 * and writes a .webm (native) plus an optional .mp4 (if ffmpeg exists).
 *
 * Usage:
 *   pnpm dev          # in another terminal
 *   node scripts/record-intro.mjs [--url=http://localhost:5173/intro] \
 *                                 [--duration=6000]                  \
 *                                 [--out=./intro-capture]
 */
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')

function parseArgs() {
  const args = {
    url: 'http://localhost:5173/intro',
    duration: 6000,
    out: 'intro-capture',
    width: 1920,
    height: 1080,
    crf: 18,
    preset: 'slow',
  }
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/)
    if (!m) continue
    const [, k, v] = m
    if (k === 'duration' || k === 'width' || k === 'height' || k === 'crf') {
      args[k] = Number(v)
    } else if (k in args) {
      args[k] = v
    } else if (k === 'quality') {
      // Shortcut presets: 1080 (default), 4k, master
      if (v === '4k') {
        args.width = 3840
        args.height = 2160
        args.crf = 14
      } else if (v === 'master') {
        args.width = 3840
        args.height = 2160
        args.crf = 12
        args.preset = 'veryslow'
      }
    }
  }
  return args
}

async function main() {
  const { url, duration, out, width, height, crf, preset } = parseArgs()
  const outDir = resolve(repoRoot, out)
  if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })

  const viewport = { width, height }
  console.log(
    `▶ Recording ${url} for ${duration}ms @ ${width}x${height} (crf ${crf}, preset ${preset})`
  )

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    recordVideo: { dir: outDir, size: viewport },
  })
  const page = await context.newPage()

  // Navigate but don't wait for full load — we want the black screen in frame 1.
  const nav = page.goto(url, { waitUntil: 'domcontentloaded' })
  await nav
  await page.waitForTimeout(duration)

  await page.close()
  await context.close()
  await browser.close()

  // Playwright names videos with a random UUID; rename to intro.webm.
  const files = readdirSync(outDir).filter((f) => f.endsWith('.webm'))
  if (!files.length) {
    console.error('✗ No .webm produced')
    process.exit(1)
  }
  const webm = join(outDir, 'intro.webm')
  renameSync(join(outDir, files[0]), webm)
  console.log(`✓ Saved ${webm}`)

  // Best-effort MP4 transcode via ffmpeg (H.264 + yuv420p for broad playback).
  const ffCheck = spawnSync('which', ['ffmpeg'])
  if (ffCheck.status === 0) {
    const mp4 = join(outDir, 'intro.mp4')
    const ff = spawnSync(
      'ffmpeg',
      [
        '-y',
        '-i', webm,
        '-c:v', 'libx264',
        '-preset', String(preset),
        '-crf', String(crf),
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        mp4,
      ],
      { stdio: 'inherit' }
    )
    if (ff.status === 0) console.log(`✓ Saved ${mp4}`)
    else console.warn('! ffmpeg failed — keeping .webm only')
  } else {
    console.log('• ffmpeg not found — skipping MP4 transcode')
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
