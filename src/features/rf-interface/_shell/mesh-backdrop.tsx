// Created and developed by Jai Singh
import { memo } from 'react'

/**
 * Animated mesh gradient backdrop for the RF interface.
 *
 * Three slowly-drifting radial blobs built from theme tokens
 * (`--primary`, `--rf-accent-scan`, `--rf-accent-putaway`). Switches
 * automatically between light/dark/custom palettes — every value
 * resolves through CSS custom properties.
 *
 * The blobs are pure CSS animations on `transform` + `opacity` only.
 * Animation pauses under `prefers-reduced-motion: reduce`.
 */
export const MeshBackdrop = memo(function MeshBackdrop() {
  return (
    <div
      aria-hidden
      className='pointer-events-none fixed inset-0 -z-10 overflow-hidden'
    >
      <div className='rf-mesh-blob rf-mesh-blob-1' />
      <div className='rf-mesh-blob rf-mesh-blob-2' />
      <div className='rf-mesh-blob rf-mesh-blob-3' />
      <div className='bg-background/40 absolute inset-0 backdrop-blur-3xl' />
    </div>
  )
})

// Created and developed by Jai Singh
