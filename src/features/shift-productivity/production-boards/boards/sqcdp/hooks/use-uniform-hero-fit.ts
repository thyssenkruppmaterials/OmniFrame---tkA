// Created and developed by Jai Singh
/**
 * Measure-and-fit uniform hero typography for the SQCDP TV view.
 *
 * v15 (`cqh`) → v15.1 (`vh`) → v15.2 (this module). Both prior CSS-only
 * passes left visible inconsistencies on a real TV: `cqh` resolved
 * against per-card heights so siblings drifted; `vh` picked the SAME
 * px in every card but had no width awareness, so longer values
 * (`99.7%`, `73 DAYS FOR PHYSICAL`) overflowed their cards and shorter
 * ones wrapped to 2 lines because nothing was measuring what actually
 * fits. The user's screenshot is the proof — see
 * `Sessions/2026-05-17.md` § "SQCDP measured hero typography (v15.2)".
 *
 * v15.2 measures each hero element's natural one-line width against
 * the actual card-body width, picks the largest px that fits the
 * smallest-relative-to-width card in a tier, and applies that uniform
 * px to every member of the tier. Three independent tiers
 * (`primary`, `sub`, `secondarySingle`) each pick their own size so
 * the primary chart-strip cards don't get dragged down by the
 * secondary single-mode card's longer values.
 *
 * Tier sizing inputs:
 *  - `availableWidth = element.clientWidth - inlineSafetyPx` (8 px
 *    each side so the glyph isn't kissing the card edge).
 *  - `naturalWidthAtRef = measured width of the value text at a
 *    reference 100 px, in the same computed font family / weight /
 *    transform / letter-spacing as the live element`.
 *  - `maxFitForEntry = (availableWidth / naturalWidthAtRef) * 100`.
 *  - `tierSize = min(maxFit across the tier)` — the largest font that
 *    fits the snuggest card.
 *  - Clamped above by `viewportHeight * viewportCeilingVh[tier] / 100`
 *    (so short values on huge screens don't balloon past taste).
 *  - Clamped below by `floorPx[tier]` (so very-narrow embedded
 *    previews don't shrink to unreadable).
 *  - Rounded to the nearest `roundToPx` (4 px default) to avoid
 *    fractional-pixel jitter on resize.
 *
 * Performance: shared ResizeObserver across all registered elements,
 * single debounced window-resize listener, RAF-collapsed recomputes,
 * natural-width cache keyed by `(text, font-family, font-weight,
 * font-style, letter-spacing, text-transform)` so resize ticks don't
 * trigger fresh measurements when nothing about the value changed.
 *
 * Curator override path: when `metric.styleConfig.primary.size` is
 * pinned the card sets `enabled: false` on the hook, skips
 * registration entirely, and the curator's `text-{N}xl` survives
 * (see [[Patterns/Per-Field-Style-Overrides]]).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefCallback,
} from 'react'

export type HeroTier = 'primary' | 'sub' | 'secondarySingle'

export interface UniformHeroFitOptions {
  /** Per-tier ceiling expressed in vh units (out of 100). */
  viewportCeilingVh: Record<HeroTier, number>
  /** Per-tier lower bound in px. */
  floorPx: Record<HeroTier, number>
  /**
   * Per-tier initial fallback font size in px, applied before the
   * first measurement lands. Tuned to land close to the v15.1
   * 1080p result so paint-frame 0 reads sensibly even if the fit
   * pass is briefly delayed.
   */
  initialPx: Record<HeroTier, number>
  /** Total inline horizontal slack subtracted from element clientWidth. */
  inlineSafetyPx: number
  /** Round chosen size to nearest N px to avoid resize jitter. */
  roundToPx: number
  /** Window resize debounce window in ms. */
  resizeDebounceMs: number
  /** Reference font size used when measuring natural one-line width. */
  referenceFontPx: number
}

export const DEFAULT_UNIFORM_HERO_FIT_OPTIONS: UniformHeroFitOptions = {
  // Roughly: primary maxes ~119 px on 1080p, ~158 px on 1440p, ~237 px on 4K.
  // Sub maxes ~65 px / ~86 px / ~130 px. Secondary-single maxes ~97 px / ~130 px / ~194 px.
  viewportCeilingVh: { primary: 11, sub: 6, secondarySingle: 9 },
  // Floors keep small embedded previews readable; they're chosen >= the
  // previous v15.1 `clamp` floors so this work is a strict improvement
  // at every viewport size.
  floorPx: { primary: 56, sub: 32, secondarySingle: 48 },
  initialPx: { primary: 128, sub: 56, secondarySingle: 96 },
  inlineSafetyPx: 16,
  roundToPx: 4,
  resizeDebounceMs: 100,
  referenceFontPx: 100,
}

interface RegistryEntry {
  el: HTMLElement
  text: string
}

export interface UniformHeroFitState {
  sizes: Record<HeroTier, number | null>
  overflowEntries: Set<string>
  ready: boolean
}

export interface UniformHeroFitContextValue {
  register: (tier: HeroTier, id: string, text: string, el: HTMLElement) => void
  unregister: (tier: HeroTier, id: string) => void
  state: UniformHeroFitState
  options: UniformHeroFitOptions
  enabled: boolean
}

export const UniformHeroFitContext =
  createContext<UniformHeroFitContextValue | null>(null)

function entryKey(tier: HeroTier, id: string): string {
  return `${tier}::${id}`
}

function roundTo(value: number, step: number): number {
  if (step <= 0) return value
  return Math.round(value / step) * step
}

/**
 * Build the live registry + recompute pipeline. Exported as a hook
 * (rather than inlined in the provider) so it's testable in isolation.
 * Tests opt into a synchronous-compute mode via `__syncForTests` —
 * production paths always go through the RAF / ResizeObserver pipeline.
 */
export function useUniformHeroFitRegistry(
  enabled: boolean,
  options: UniformHeroFitOptions
): UniformHeroFitContextValue {
  const registryRef = useRef<Map<HeroTier, Map<string, RegistryEntry>>>(
    new Map()
  )
  const measureCacheRef = useRef<Map<string, number>>(new Map())
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const rafRef = useRef<number | null>(null)
  const debounceTimerRef = useRef<number | null>(null)

  const [state, setState] = useState<UniformHeroFitState>(() => ({
    sizes: { primary: null, sub: null, secondarySingle: null },
    overflowEntries: new Set(),
    ready: false,
  }))

  const compute = useCallback((): void => {
    if (!enabled) return
    if (typeof window === 'undefined') return
    const reg = registryRef.current
    const tiers: HeroTier[] = ['primary', 'sub', 'secondarySingle']
    const viewportH = window.innerHeight || 0
    const nextSizes: Record<HeroTier, number | null> = {
      primary: null,
      sub: null,
      secondarySingle: null,
    }
    const overflow = new Set<string>()

    for (const tier of tiers) {
      const tierMap = reg.get(tier)
      if (!tierMap || tierMap.size === 0) {
        nextSizes[tier] = null
        continue
      }
      const ceilingPx = viewportH * (options.viewportCeilingVh[tier] / 100)
      const fits: { id: string; maxFit: number }[] = []

      for (const [id, entry] of tierMap.entries()) {
        const natural = measureNatural(
          entry.el,
          entry.text,
          options.referenceFontPx,
          measureCacheRef.current
        )
        if (natural <= 0) continue
        const availableWidth = entry.el.clientWidth - options.inlineSafetyPx
        if (availableWidth <= 0) continue
        const maxFit = (availableWidth / natural) * options.referenceFontPx
        fits.push({ id, maxFit })
      }

      if (fits.length === 0) {
        nextSizes[tier] = null
        continue
      }

      // Iteratively demote any entry whose one-line max-fit falls
      // below the tier floor. A demoted entry renders with
      // `whitespace-normal` + `line-clamp-2` so it can wrap to 2
      // lines at the chosen tier size. The loop terminates when all
      // remaining survivors fit >= floor, or when every entry has
      // been demoted (we still pick a chosen size — the floor — and
      // every member wraps).
      //
      // IMPORTANT — `working.length > 1` only gates the FILTER step,
      // not the `overflow.add(...)`. The original v15.2 ship made
      // both conditional and the sole survivor was silently left in
      // nowrap mode at the floor — which then overflowed the card
      // horizontally because by definition its `maxFit < floor` means
      // the floor doesn't fit either. That was the 2026-05-18
      // "500 Orders Shipp" clipping the user reported; see
      // `Sessions/2026-05-17.md` § "Fix: v15.2 hero-fit overflow on
      // secondary single-mode cards".
      let working = [...fits]
      let chosen: number | null = null
      while (working.length > 0) {
        const minFit = working.reduce(
          (acc, e) => (e.maxFit < acc ? e.maxFit : acc),
          working[0].maxFit
        )
        let candidate = Math.min(minFit, ceilingPx)
        candidate = Math.max(candidate, options.floorPx[tier])
        candidate = roundTo(candidate, options.roundToPx)
        if (minFit < options.floorPx[tier]) {
          const culprit = working.reduce((acc, e) =>
            e.maxFit < acc.maxFit ? e : acc
          )
          overflow.add(entryKey(tier, culprit.id))
          if (working.length > 1) {
            working = working.filter((e) => e.id !== culprit.id)
            continue
          }
        }
        chosen = candidate
        break
      }
      nextSizes[tier] = chosen
    }

    setState((prev) => {
      const same =
        prev.sizes.primary === nextSizes.primary &&
        prev.sizes.sub === nextSizes.sub &&
        prev.sizes.secondarySingle === nextSizes.secondarySingle &&
        prev.overflowEntries.size === overflow.size &&
        [...prev.overflowEntries].every((k) => overflow.has(k))
      if (same && prev.ready) return prev
      return { sizes: nextSizes, overflowEntries: overflow, ready: true }
    })
  }, [enabled, options])

  const schedule = useCallback((): void => {
    if (!enabled) return
    if (typeof window === 'undefined') return
    if (rafRef.current !== null) return
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null
      compute()
    })
  }, [compute, enabled])

  useEffect(() => {
    if (!enabled) return
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => schedule())
    resizeObserverRef.current = ro
    for (const tierMap of registryRef.current.values()) {
      for (const entry of tierMap.values()) ro.observe(entry.el)
    }
    return () => {
      ro.disconnect()
      resizeObserverRef.current = null
    }
  }, [enabled, schedule])

  useEffect(() => {
    if (!enabled) return
    if (typeof window === 'undefined') return
    const onResize = (): void => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current)
      }
      debounceTimerRef.current = window.setTimeout(() => {
        debounceTimerRef.current = null
        schedule()
      }, options.resizeDebounceMs)
    }
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [enabled, options.resizeDebounceMs, schedule])

  // Re-measure once the display font (Geist + friends) finishes
  // loading. Google Fonts is wired with `display=swap`, so the FIRST
  // compute pass runs against the system fallback — typically a
  // narrower glyph set than Geist. The fallback measurement
  // overestimates `maxFit`, which overestimates the chosen tier size,
  // which overflows the card horizontally once Geist swaps in.
  // Invalidate the natural-width cache (it's keyed by font-family but
  // identical names like "Geist, sans-serif" resolve differently
  // before vs. after the file lands) and re-schedule a compute. If
  // the fonts API isn't available (older browsers / jsdom), the
  // initial render simply stays as-is — no behaviour regression.
  useEffect(() => {
    if (!enabled) return
    if (typeof document === 'undefined') return
    const fonts: FontFaceSet | undefined = (
      document as Document & { fonts?: FontFaceSet }
    ).fonts
    if (!fonts || typeof fonts.ready?.then !== 'function') return
    let cancelled = false
    fonts.ready.then(() => {
      if (cancelled) return
      measureCacheRef.current.clear()
      schedule()
    })
    return () => {
      cancelled = true
    }
  }, [enabled, schedule])

  const register = useCallback(
    (tier: HeroTier, id: string, text: string, el: HTMLElement): void => {
      if (!enabled) return
      let tierMap = registryRef.current.get(tier)
      if (!tierMap) {
        tierMap = new Map()
        registryRef.current.set(tier, tierMap)
      }
      const existing = tierMap.get(id)
      tierMap.set(id, { el, text })
      const ro = resizeObserverRef.current
      if (ro) {
        if (existing && existing.el !== el) ro.unobserve(existing.el)
        ro.observe(el)
      }
      schedule()
    },
    [enabled, schedule]
  )

  const unregister = useCallback(
    (tier: HeroTier, id: string): void => {
      const tierMap = registryRef.current.get(tier)
      if (!tierMap) return
      const existing = tierMap.get(id)
      if (!existing) return
      tierMap.delete(id)
      if (resizeObserverRef.current) {
        resizeObserverRef.current.unobserve(existing.el)
      }
      schedule()
    },
    [schedule]
  )

  return useMemo(
    () => ({ register, unregister, state, options, enabled }),
    [register, unregister, state, options, enabled]
  )
}

/**
 * Per-element registration hook. Returns a stable ref callback + the
 * inline style block to spread onto the value element + an `overflow`
 * flag so callers can flip wrap behaviour for the unfittable case +
 * the resolved px size (`null` until measurement lands).
 *
 * Outside a provider the hook is a no-op — `register` returns
 * without doing anything, `sizePx` stays null, the caller's static
 * density token continues to render unchanged.
 */
export interface UseUniformHeroFitArgs {
  /** Local gate (e.g. `density === 'tv' && !curatorOverride`). */
  enabled: boolean
  tier: HeroTier
  id: string
  /** The exact text that will be rendered as the value. */
  text: string
}

export interface UseUniformHeroFitResult {
  ref: RefCallback<HTMLElement>
  /** Resolved size in px, or null while measuring / when disabled. */
  sizePx: number | null
  /** Pre-built style block, ready to spread onto the value element. */
  style: CSSProperties
  /**
   * True when this specific entry was demoted to the overflow set
   * (its one-line max-fit was below the tier floor). Callers should
   * relax `whitespace-nowrap` for this entry so the value can wrap to
   * 2 lines instead of clipping.
   */
  overflow: boolean
  /**
   * True once the tier has produced a measurement (state.ready). Used
   * by callers to flip a `motion-safe:transition-opacity` fade-in from
   * the invisible first frame to the measured render.
   */
  ready: boolean
}

export function useUniformHeroFit(
  args: UseUniformHeroFitArgs
): UseUniformHeroFitResult {
  const { enabled, tier, id, text } = args
  const ctx = useContext(UniformHeroFitContext)
  const contextEnabled = !!ctx && ctx.enabled
  const localEnabled = enabled && contextEnabled
  const elRef = useRef<HTMLElement | null>(null)

  // Keep the ref callback STABLE across hook re-renders. The context
  // value changes identity on every state update (the provider memos
  // a fresh object when sizes change), and if the ref callback's
  // identity tracked the context, React would tear down + re-attach
  // the element on every compute pass — which in turn would
  // unregister-then-register and cause spurious ResizeObserver
  // disconnect/observe churn. Stash the live values in refs so the
  // ref body can read them without re-creating itself.
  const ctxRef = useRef(ctx)
  const tierRef = useRef(tier)
  const idRef = useRef(id)
  const textRef = useRef(text)
  const localEnabledRef = useRef(localEnabled)
  ctxRef.current = ctx
  tierRef.current = tier
  idRef.current = id
  textRef.current = text
  localEnabledRef.current = localEnabled

  const ref = useCallback<RefCallback<HTMLElement>>((el) => {
    const prev = elRef.current
    elRef.current = el
    const ctxNow = ctxRef.current
    if (!ctxNow) return
    if (el) {
      if (localEnabledRef.current) {
        ctxNow.register(tierRef.current, idRef.current, textRef.current, el)
      }
    } else if (prev) {
      ctxNow.unregister(tierRef.current, idRef.current)
    }
  }, [])

  // Re-register when text / tier / id / enabled changes. Cleanup
  // unregisters with the OLD tier+id so the registry stays accurate
  // when a card's metric id or text content updates.
  useEffect(() => {
    const ctxNow = ctxRef.current
    if (!ctxNow) return
    if (!localEnabled) return
    if (!elRef.current) return
    ctxNow.register(tier, id, text, elRef.current)
    return () => {
      ctxNow.unregister(tier, id)
    }
  }, [tier, id, text, localEnabled])

  const sizePx = localEnabled ? (ctx?.state.sizes[tier] ?? null) : null
  const initialPx = ctx?.options.initialPx[tier] ?? null
  const overflow = localEnabled
    ? !!ctx?.state.overflowEntries.has(entryKey(tier, id))
    : false
  const ready = localEnabled ? !!ctx?.state.ready : false

  const style: CSSProperties = {}
  if (localEnabled) {
    const px = sizePx ?? initialPx
    if (px != null) style.fontSize = `${px}px`
  }

  return { ref, sizePx, style, overflow, ready }
}

/**
 * Measure a text element's natural one-line width at the reference
 * font size, using a hidden cloned span that inherits the element's
 * font-family / font-weight / font-style / letter-spacing /
 * text-transform from the live computed style. Result is cached so
 * resize ticks don't re-measure when nothing about the value changed.
 *
 * Returns 0 when no document is available (SSR) or when the measure
 * fails (e.g. the cloned span returns 0 width in jsdom without an
 * explicit mock). The caller drops 0-width entries from the tier so
 * the tier can still produce a measurement from any surviving entry.
 */
function measureNatural(
  el: HTMLElement,
  text: string,
  refPx: number,
  cache: Map<string, number>
): number {
  if (typeof document === 'undefined') return 0
  if (typeof window === 'undefined') return 0
  if (!text) return 0
  const style = window.getComputedStyle(el)
  const fontFamily = style.fontFamily
  const fontWeight = style.fontWeight
  const fontStyle = style.fontStyle
  const letterSpacing = style.letterSpacing
  const textTransform = style.textTransform
  const cacheKey = [
    text,
    fontFamily,
    fontWeight,
    fontStyle,
    letterSpacing,
    textTransform,
    String(refPx),
  ].join('|')
  const cached = cache.get(cacheKey)
  if (cached !== undefined) return cached

  const measurer = document.createElement('span')
  measurer.textContent = text
  measurer.setAttribute('aria-hidden', 'true')
  measurer.setAttribute('data-sqcdp-measurer', 'true')
  // Inline style covers the dimensions that matter for width — colour,
  // shadow, etc. are layout-irrelevant and not copied.
  measurer.style.cssText = [
    'position: absolute',
    'top: -9999px',
    'left: -9999px',
    'visibility: hidden',
    'pointer-events: none',
    'white-space: nowrap',
    `font-family: ${fontFamily}`,
    `font-weight: ${fontWeight}`,
    `font-style: ${fontStyle}`,
    `letter-spacing: ${letterSpacing}`,
    `text-transform: ${textTransform}`,
    `font-size: ${refPx}px`,
  ].join('; ')
  document.body.appendChild(measurer)
  const width = measurer.getBoundingClientRect().width
  document.body.removeChild(measurer)
  cache.set(cacheKey, width)
  return width
}

// Created and developed by Jai Singh
