// Created and developed by Jai Singh
/**
 * SqcdpHeroFitProvider — mounts the measure-and-fit registry once at
 * the SQCDP board root so every primary card, every sub-metric block,
 * and every secondary single-mode card shares one set of registries
 * (one per `HeroTier`). See [[Implementations/Implement-SQCDP-Measured-
 * Hero-Typography]] for the v15.2 work that introduced this surface.
 *
 * Gated on TV density — normal in-page rendering keeps the static
 * density tokens. The hook + context type live in
 * `../hooks/use-uniform-hero-fit.ts` so this `.tsx` only exports the
 * React component (keeps `react-refresh/only-export-components` happy).
 */
import type { ReactNode } from 'react'
import {
  DEFAULT_UNIFORM_HERO_FIT_OPTIONS,
  UniformHeroFitContext,
  useUniformHeroFitRegistry,
  type UniformHeroFitOptions,
} from '../hooks/use-uniform-hero-fit'

interface SqcdpHeroFitProviderProps {
  /** Pass `false` for normal in-page density; provider becomes inert. */
  enabled: boolean
  /** Optional overrides for the per-tier ceilings / floors / safety pad. */
  options?: Partial<UniformHeroFitOptions>
  children: ReactNode
}

export function SqcdpHeroFitProvider({
  enabled,
  options,
  children,
}: SqcdpHeroFitProviderProps) {
  const merged: UniformHeroFitOptions = options
    ? { ...DEFAULT_UNIFORM_HERO_FIT_OPTIONS, ...options }
    : DEFAULT_UNIFORM_HERO_FIT_OPTIONS
  const value = useUniformHeroFitRegistry(enabled, merged)
  return (
    <UniformHeroFitContext.Provider value={value}>
      {children}
    </UniformHeroFitContext.Provider>
  )
}

// Created and developed by Jai Singh
