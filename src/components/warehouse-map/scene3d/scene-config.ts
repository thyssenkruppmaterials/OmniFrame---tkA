// Created and developed by Jai Singh
// ---------------------------------------------------------------------------
// Warehouse 3D Scene — shared configuration tokens
// ---------------------------------------------------------------------------
// Central home for every magic number, palette token, and quality preset used
// by the isometric scene engine. Keeping these in one module means the camera
// rig, lighting rig, material presets, and object renderers all agree on
// scale, height, and look — no drift between files.
//
// Coordinate convention (must match the legacy warehouse-3d-view.tsx so existing
// persisted layouts render unchanged):
//   2D world units (~1 cm) × WORLD_SCALE → meters.
//   2D x → 3D x,  2D y → 3D z,  floor plane at y = 0.
//   rack.rotation (deg) → rotationY = -(rotation · π / 180).
import * as THREE from 'three'

/** 2D world units (~1 cm) → Three.js meters. */
export const WORLD_SCALE = 1 / 100

// ---- Vertical scale --------------------------------------------------------

export const FLOOR_Y = 0
/** Per-floor vertical separation for stacked multi-floor warehouses (meters). */
export const FLOOR_HEIGHT = 5
/** Default interior building wall height (meters). */
export const BUILDING_WALL_HEIGHT = 5
/** Shelf deck thickness (meters). */
export const RACK_BASE_HEIGHT = 0.12
/** Vertical spacing between rack shelves (meters). */
export const SHELF_SPACING = 0.5
/** Default real-world rack depth along Z when the 2D footprint is large (m). */
export const RACK_DEPTH_DEFAULT = 1.1
/** Thin floor patch elevation for zones to avoid z-fighting (meters). */
export const ZONE_PATCH_Y = 0.012

// ---- Isometric camera rail -------------------------------------------------
// True isometric: azimuth 45°, elevation atan(1/√2) ≈ 35.264°. Looking from
// equal +x/+y/+z toward the target yields the classic "toy miniature" look
// with no vanishing point.

export const ISO_AZIMUTH = Math.PI / 4 // 45°
export const ISO_ELEVATION = Math.atan(1 / Math.SQRT2) // ≈ 35.264°
/** Unit direction from target → camera for the locked isometric rail. */
export const ISO_DIR = new THREE.Vector3(1, 1, 1).normalize()

/**
 * Distance from the framing target to the iso camera along ISO_DIR (meters).
 * Shared by the camera rig AND the fog math: fog near/far must be measured
 * from where the camera actually sits, not from the world origin — otherwise
 * the whole scene reads deep-in-fog at the default zoom (the "washed out /
 * black at night" bug).
 */
export function isoCameraDistance(span: number): number {
  return span * 2 + 60
}

// ---- Soft "miniature" palette ----------------------------------------------
// Bright, low-saturation tokens. The whole point of the overhaul: replace the
// dark-industrial `#020617` look with a soft, refined, daylight-toy aesthetic.

export const PALETTE = {
  /** Solid scene background fallback (overridden by weather sky when enabled). */
  background: '#dfe7f0',
  /** Soft ground plane outside the building footprint. Kept distinctly darker
   *  than the interior floor so the building reads as a lit slab sitting on a
   *  table (the "toy miniature" depth cue) instead of blending into it. */
  ground: '#b3c0d4',
  /** Interior concrete floor inside the building outline. */
  floor: '#e7ecf3',
  /** Subtle floor grid lines. */
  gridCell: '#c2ccda',
  gridSection: '#aab6c8',
  /** Building shell walls (light, semi-transparent). */
  wall: '#f3f5f9',
  /** Building outline — darker than the walls so the footprint stays crisp
   *  against the soft floor/ground even when the glass walls are barely tinted. */
  wallEdge: '#6b7c97',
  /** Painted-steel rack uprights. */
  rackPost: '#5b6b86',
  /** Rack shelf decks. */
  rackShelf: '#b9c4d6',
  /** Empty (unmapped) bin cell. */
  cellEmpty: '#d6deea',
  /** Hover / selection accent. */
  accent: '#22d3ee',
  selection: '#f59e0b',
  /** Scene-object defaults (overridden per object type). */
  wood: '#c79a6b',
  drywall: '#eef1f6',
  metal: '#8b97a8',
  glass: '#bcd7e6',
  label: '#1f2a3a',
  labelOutline: '#ffffff',
} as const

// ---- Quality presets -------------------------------------------------------
// Desktop/tablet get the full soft-PBR treatment; "low" is a safety valve for
// constrained hardware (and a graceful prefers-reduced-motion fallback).

export type SceneQuality = 'high' | 'medium' | 'low'

export interface QualitySettings {
  /** Device-pixel-ratio clamp for the renderer. */
  dpr: [number, number]
  /** Shadow map resolution (0 = shadows off). */
  shadowMapSize: number
  /** Enable post-processing (SSAO / subtle bloom) sub-chunk. */
  postFx: boolean
  /** Render weather precipitation particles. */
  weatherParticles: boolean
  /** Max precipitation particle count. */
  maxParticles: number
}

export const QUALITY_PRESETS: Record<SceneQuality, QualitySettings> = {
  high: {
    dpr: [1, 2],
    shadowMapSize: 2048,
    postFx: true,
    weatherParticles: true,
    maxParticles: 4000,
  },
  medium: {
    dpr: [1, 1.5],
    shadowMapSize: 1024,
    postFx: false,
    weatherParticles: true,
    maxParticles: 1500,
  },
  low: {
    dpr: [1, 1],
    shadowMapSize: 0,
    postFx: false,
    weatherParticles: false,
    maxParticles: 0,
  },
} as const

/** Tone-mapping exposure tuned for the soft daylight palette. */
export const TONE_MAPPING_EXPOSURE = 1.05

export type CameraMode = 'iso' | 'orbit' | 'fly'

// Created and developed by Jai Singh
