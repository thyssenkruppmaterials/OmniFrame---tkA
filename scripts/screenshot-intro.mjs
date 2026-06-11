#!/usr/bin/env node
/**
 * Capture two 4K-class PNG screenshots from the OmniFrame /intro cinematic page.
 *
 * Outputs (default destination is the user's Mac↔Windows bridge folder):
 *
 *   Dark mode (default — `--theme=dark` or omit):
 *     1. omniframe-intro-hero.png — wide hero banner: cube logo + orbital design
 *        on the left, "OmniFrame" wordmark + "UNIFIED LOGISTICS INTELLIGENCE"
 *        tagline on the right, with the dark cyan grid + radial glow backdrop.
 *     2. omniframe-logo-mark.png — square crop of just the CinematicLogo (cube
 *        + orbital rings + glow halo + pulsar shockwaves), tight to the
 *        outermost ring. No wordmark.
 *
 *   Light mode (`--theme=light`):
 *     1. omniframe-intro-hero-light.png — same composition, light palette
 *        (off-white stage, dark teal wordmark, muted slate vignette).
 *     2. omniframe-logo-mark-light.png — same square crop, light palette.
 *        Pulsars + rings render via `cinematic-pulsar-light` /
 *        `cinematic-logo-reveal-light` keyframes.
 *
 * Both renders are taken at viewport 3840x2160 (true 4K, deviceScaleFactor 1)
 * so the on-screen layout matches the desktop reveal that the user attached
 * as reference.
 *
 * Usage:
 *   pnpm dev                       # in another terminal, OR an existing Vite
 *                                  # dev server on the URL below
 *
 *   # Dark mode (existing behavior — overwrites the dark PNGs):
 *   node scripts/screenshot-intro.mjs \
 *       [--url=http://localhost:5173/intro]                  \
 *       [--out=/Users/jaisingh/Downloads/MacWindowsBridge]   \
 *       [--wait=11000]                                       \
 *       [--width=3840] [--height=2160]
 *
 *   # Light mode (writes *-light.png alongside; appends ?theme=light to URL):
 *   node scripts/screenshot-intro.mjs --theme=light \
 *       [--url=http://localhost:5173/intro]
 *
 *   # Capture BOTH modes back-to-back (uses one browser session):
 *   node scripts/screenshot-intro.mjs --theme=all
 *
 * Light mode skips the `CinematicOverture` (Act I) entirely — the intro
 * page short-circuits `overtureDone = true` immediately for `?theme=light`.
 * The default `--wait=11000` is more than enough for either mode; light
 * mode just sees the stage reveal sooner. No need to dial it down.
 *
 * The script depends on two `data-testid` attributes added to
 * `src/features/intro/intro-screen.tsx`:
 *   - `data-testid="intro-hero-cluster"` on the logo+wordmark flex row
 *   - `data-testid="intro-logo-mark"`     on the 208*1.45 logo box
 */
import { mkdirSync, existsSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')

function parseArgs() {
  const args = {
    url: 'http://localhost:5173/intro',
    out: '/Users/jaisingh/Downloads/MacWindowsBridge',
    wait: 11000,
    width: 3840,
    height: 2160,
    // deviceScaleFactor of 2 oversamples the layout: each CSS pixel renders
    // as 2x2 physical pixels. Combined with viewport=3840 this yields ~7680x4320
    // raw rendering, which lets the clipped element screenshots come out at
    // genuinely 4K-class density even though we crop to the cluster bounds.
    dsf: 2,
    // Generous CSS-pixel expansion around the cluster bounding box so the
    // hero captures the dark cyan grid + radial glow, not just the cluster.
    heroExpand: 280,
    // Expansion around the 302-CSS-px logo box — tight enough to read as a
    // standalone logo mark while still capturing the outermost orbital ring
    // and pulsar shockwaves + a sliver of the radial halo. The wordmark
    // column is hidden during capture so we don't worry about bleeding into
    // the "O" of "OmniFrame" on the right edge.
    logoExpand: 110,
    // 'dark' (default), 'light', or 'all' (captures both back-to-back).
    theme: 'dark',
  }
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/)
    if (!m) continue
    const [, k, v] = m
    if (
      k === 'wait' ||
      k === 'width' ||
      k === 'height' ||
      k === 'dsf' ||
      k === 'heroExpand' ||
      k === 'logoExpand'
    ) {
      args[k] = Number(v)
    } else if (k in args) {
      args[k] = v
    }
  }
  if (args.theme !== 'dark' && args.theme !== 'light' && args.theme !== 'all') {
    throw new Error(
      `--theme must be 'dark', 'light', or 'all' (got '${args.theme}')`
    )
  }
  return args
}

/**
 * Pause every CSS animation/transition on the page and force the cube logo
 * to be axis-aligned (so it doesn't get caught mid-spin). Also ensures the
 * letterbox bars are slid in (transform: translateY(0)) and the wordmark
 * cluster is fully visible at opacity 1.
 *
 * Returns the number of elements whose inline style was tweaked, mostly for
 * sanity-logging.
 */
async function freezeAndAlignAnimations(page) {
  // Inject CSS that pauses every animation + transition. This is cheaper
  // than reaching into every styled element via JS and flipping styles
  // imperatively.
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-play-state: paused !important;
        transition: none !important;
      }
    `,
  })

  // Force the cube image upright. Even with animation paused, the cube is
  // mid-spin — pause freezes WHEREVER the animation timer happens to be.
  // Setting the inline transform overrides whatever the keyframe was at.
  return page.evaluate(() => {
    let touched = 0
    const cube = document.querySelector('img[alt="OmniFrame Logo"]')
    if (cube) {
      cube.style.transform = 'none'
      cube.style.animation = 'none'
      touched += 1
    }
    return touched
  })
}

async function snapshot({ page, locator, expandPx, outPath, label }) {
  const handle = await locator.elementHandle({ timeout: 5000 })
  if (!handle) throw new Error(`[${label}] locator did not resolve`)
  const box = await handle.boundingBox()
  if (!box) throw new Error(`[${label}] no bounding box (offscreen?)`)

  const viewport = page.viewportSize()
  const dsf = await page.evaluate(() => window.devicePixelRatio)
  // Playwright's screenshot `clip` is in CSS pixels; the resulting image's
  // physical dimensions are clip * deviceScaleFactor.
  const x = Math.max(0, Math.floor(box.x - expandPx))
  const y = Math.max(0, Math.floor(box.y - expandPx))
  const widthCss = Math.min(
    viewport.width - x,
    Math.ceil(box.width + expandPx * 2)
  )
  const heightCss = Math.min(
    viewport.height - y,
    Math.ceil(box.height + expandPx * 2)
  )

  await page.screenshot({
    path: outPath,
    type: 'png',
    omitBackground: false,
    clip: { x, y, width: widthCss, height: heightCss },
  })

  const stats = statSync(outPath)
  const physW = Math.round(widthCss * dsf)
  const physH = Math.round(heightCss * dsf)
  console.log(
    `  -> ${outPath}  (${physW}x${physH} physical px / ${widthCss}x${heightCss} CSS px @ DSF ${dsf}, ${(stats.size / 1024 / 1024).toFixed(2)} MB)`
  )
}

/**
 * Compose the URL for a given theme — light mode appends `?theme=light`
 * (preserving any existing query params if the caller passed them).
 */
function urlForTheme(baseUrl, theme) {
  if (theme === 'dark') return baseUrl
  const u = new URL(baseUrl)
  u.searchParams.set('theme', 'light')
  return u.toString()
}

/**
 * Returns the destination filenames for hero + logo captures for a given
 * theme. Dark keeps the original (no-suffix) filenames; light gets a
 * `-light` suffix so the dark + light pair coexist in the same folder.
 */
function pathsForTheme(out, theme) {
  if (theme === 'dark') {
    return {
      heroPath: resolve(out, 'omniframe-intro-hero.png'),
      logoPath: resolve(out, 'omniframe-logo-mark.png'),
    }
  }
  return {
    heroPath: resolve(out, 'omniframe-intro-hero-light.png'),
    logoPath: resolve(out, 'omniframe-logo-mark-light.png'),
  }
}

async function captureTheme({
  context,
  baseUrl,
  out,
  wait,
  heroExpand,
  logoExpand,
  theme,
}) {
  const url = urlForTheme(baseUrl, theme)
  const { heroPath, logoPath } = pathsForTheme(out, theme)
  const page = await context.newPage()

  await page.goto(url, { waitUntil: 'domcontentloaded' })

  // Wait for the cinematic reveal:
  //   Dark — overture (~4.8s) + handoff (~0.35s) + title stream (~1s) +
  //          tagline transition (~1.4s) → ~7.5s; 11s gives ~3.5s headroom.
  //   Light — overture is bypassed, so reveal is ~2.85s; 11s is overkill
  //          but harmless and keeps the script symmetric.
  console.log(`> [${theme}] Waiting ${wait}ms for the reveal to finish (${url})`)
  await page.waitForTimeout(wait)

  // Make sure the testid'd cluster is on the page; if not, the reveal hasn't
  // fired yet and the wait was too short.
  const cluster = page.locator('[data-testid="intro-hero-cluster"]')
  await cluster.waitFor({ state: 'visible', timeout: 5000 })

  const touched = await freezeAndAlignAnimations(page)
  console.log(`> [${theme}] Froze animations (cube alignment overrides: ${touched})`)

  // Iter-6 belt-and-suspenders: the in-page light/dark theme toggle is
  // anchored at top-right of the outer fixed container, OUTSIDE both
  // testids the script clips to (`intro-hero-cluster` and
  // `intro-logo-mark`). It should never appear in the captures. But hide
  // it via JS too in case a future layout shift drags it inside a clip.
  const toggleHidden = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="intro-theme-toggle"]')
    if (el && el instanceof HTMLElement) {
      el.style.visibility = 'hidden'
      return true
    }
    return false
  })
  if (toggleHidden) {
    console.log(`> [${theme}] Hid theme-toggle button for capture`)
  }

  // Tiny settle frame so the inline style writes paint before the snap.
  await page.waitForTimeout(120)

  console.log(`> [${theme}] Capturing hero banner ${heroPath}`)
  await snapshot({
    page,
    locator: cluster,
    expandPx: heroExpand,
    outPath: heroPath,
    label: `${theme}-hero`,
  })

  // For the logo-only capture, hide the wordmark column. Its sibling div
  // inside the cluster is the second flex child holding LensSweep +
  // StreamingTitle + Tagline. Hiding it lets us use a generous square clip
  // centered on the logo box without the "O" of "OmniFrame" bleeding into
  // the right edge of the frame.
  const wordmarkHidden = await page.evaluate(() => {
    const cluster = document.querySelector(
      '[data-testid="intro-hero-cluster"]'
    )
    if (!cluster) return false
    const children = cluster.children
    if (children.length < 2) return false
    const wordmarkCol = children[1]
    wordmarkCol.style.visibility = 'hidden'
    return true
  })
  if (!wordmarkHidden) {
    console.warn(`  ! [${theme}] could not hide wordmark column for logo capture`)
  }

  const logoBox = page.locator('[data-testid="intro-logo-mark"]')
  console.log(`> [${theme}] Capturing logo mark ${logoPath}`)
  await snapshot({
    page,
    locator: logoBox,
    expandPx: logoExpand,
    outPath: logoPath,
    label: `${theme}-logo`,
  })

  await page.close()
}

async function main() {
  const { url, out, wait, width, height, dsf, heroExpand, logoExpand, theme } =
    parseArgs()
  if (!existsSync(out)) mkdirSync(out, { recursive: true })

  const themes =
    theme === 'all' ? ['dark', 'light'] : [theme]

  console.log(
    `> Launching headless Chromium @ ${width}x${height} CSS px / DSF ${dsf} (physical ${width * dsf}x${height * dsf}) for ${url}`
  )
  console.log(`> Theme(s) to capture: ${themes.join(', ')}`)
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: dsf,
    reducedMotion: 'no-preference', // we want the reveal to play through
  })

  for (const t of themes) {
    await captureTheme({
      context,
      baseUrl: url,
      out,
      wait,
      heroExpand,
      logoExpand,
      theme: t,
    })
  }

  await context.close()
  await browser.close()

  console.log('> Done')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
