// Created and developed by Jai Singh
/**
 * OmniBelt — Radial Fan
 *
 * Renders the orb skin's expanded state: a 130° arc of glass tool
 * discs above the corner orb. Each disc is a `<motion.button>`
 * that "shoots out" from the orb's centre using a polar→Cartesian
 * transform.
 *
 * Mounted only when `collapseState === 'panel'` AND `skin === 'orb'`
 * (the parent `<OmniBeltOrb>` gates the mount). Click-outside +
 * Escape collapse back to `pill`, mirroring `OmniBeltPanel`'s
 * dismissal contract.
 *
 * Layout math (`(angle, radius) → (x, y)`):
 * - Origin = the orb's centre (bottom-right gutter offset).
 * - Arc spans 130° centred on 225° (up-and-left from the corner),
 *   so the fan opens away from the page edge no matter how many
 *   tiles are shown.
 * - Tile radius = 120 px from the orb centre, giving the discs
 *   visual breathing room without crowding the page chrome.
 * - Up to 8 tiles; if more pinned tools exist, the v1 fan caps at
 *   8 (no "more" tile until v1.5 — see implementation log).
 */
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { motion, useReducedMotion } from 'framer-motion'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { HOUSE_SPRING } from '../../lib/motion'
import { useOmnibeltStore } from '../../store/omnibeltStore'
import type { ToolAccent, ToolDef } from '../../tools/registry'
import { useResolvedTools } from '../../tools/use-resolved-tools'

const ACCENT_BG_BY_ACCENT: Record<ToolAccent, string> = {
  teal: 'from-teal-400/80 to-teal-600/80',
  blue: 'from-blue-400/80 to-blue-600/80',
  violet: 'from-violet-400/80 to-violet-600/80',
  amber: 'from-amber-400/80 to-amber-600/80',
  rose: 'from-rose-400/80 to-rose-600/80',
  lime: 'from-lime-400/80 to-lime-600/80',
  cyan: 'from-cyan-400/80 to-cyan-600/80',
  indigo: 'from-indigo-400/80 to-indigo-600/80',
}

/** Maximum number of fan tiles for v1 (no overflow / "more" tile). */
export const RADIAL_FAN_MAX_TILES = 8

/** Arc geometry. Centre angle 225° (pointing up-left from the
 *  bottom-right gutter); 130° total spread; 120 px radius. */
const ARC_CENTER_DEG = 225
const ARC_SPREAD_DEG = 130
const ARC_RADIUS_PX = 120

/** Disc size (44 px to match `<ToolTile />`'s icon disc). */
const TILE_SIZE = 44

/** Convert polar → Cartesian, with y inverted so that −y is up
 *  in screen-space (CSS-coordinate convention). */
/* eslint-disable-next-line react-refresh/only-export-components -- pure math helper colocated for testing */
export function polarToOffset(
  angleDeg: number,
  radiusPx: number
): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180
  return {
    x: Math.cos(rad) * radiusPx,
    y: Math.sin(rad) * radiusPx,
  }
}

/** Distribute `count` tiles evenly along an arc of `spreadDeg`
 *  centred on `centerDeg`. With count === 1, the single tile sits
 *  on the centre angle. */
/* eslint-disable-next-line react-refresh/only-export-components -- pure math helper colocated for testing */
export function fanAngles(
  count: number,
  centerDeg = ARC_CENTER_DEG,
  spreadDeg = ARC_SPREAD_DEG
): number[] {
  if (count <= 0) return []
  if (count === 1) return [centerDeg]
  const startDeg = centerDeg - spreadDeg / 2
  const stepDeg = spreadDeg / (count - 1)
  return Array.from({ length: count }, (_, i) => startDeg + i * stepDeg)
}

type RadialFanProps = {
  /** Diameter of the orb (in px) — used to compute the orb-centre
   *  origin for tile fly-out animations. */
  orbSize: number
  /**
   * Optional callback invoked when the user picks a shell-backed
   * tool (no `navigationUrl`). When set, the fan delegates to the
   * caller (the Orb skin opens an `<OrbShellPopover>`) instead of
   * just collapsing. When omitted, the v1 behaviour stands: the
   * fan closes silently.
   *
   * v1 (the omitted-callback path) was the root cause of the
   * "buttons don't work" complaint for shell-backed tools — see
   * `Fix-OmniBelt-Orb-Interactivity-And-Skin-Picker.md`.
   */
  onLaunchShell?: (tool: ToolDef) => void
}

export function RadialFan({ orbSize, onLaunchShell }: RadialFanProps) {
  const setCollapseState = useOmnibeltStore((s) => s.setCollapseState)
  const navigate = useNavigate()
  const prefersReducedMotion = useReducedMotion()
  const { pinned, all } = useResolvedTools()

  // Show pinned first; fall back to the first N from the surviving
  // registry so the fan is never empty on first paint (mirrors the
  // Pill skin's empty-pin fallback).
  const display = useMemo<ToolDef[]>(() => {
    const source = pinned.length > 0 ? pinned : all
    return source.slice(0, RADIAL_FAN_MAX_TILES)
  }, [pinned, all])

  const angles = useMemo(() => fanAngles(display.length), [display.length])

  const close = useCallback(() => setCollapseState('pill'), [setCollapseState])

  // Esc + click-outside dismissal — mirrors `OmniBeltPanel`.
  const containerRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close()
      }
    }
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node | null
      if (!target) return
      // Ignore clicks anywhere tagged as the OmniBelt host (the orb
      // morphs into / out of the same layoutId — clicking it should
      // toggle, not double-close).
      const el = (target as Element).closest?.('[data-omnibelt-host]')
      if (el) return
      if (containerRef.current?.contains(target)) return
      close()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [close])

  const launch = (tool: ToolDef) => {
    if (tool.navigationUrl) {
      navigate({ to: tool.navigationUrl })
      close()
      return
    }
    // Shell-backed tools — delegate to the host skin if it provided a
    // launcher (the Orb skin opens an `<OrbShellPopover>` anchored
    // above the orb). The fan stays mounted briefly while the popover
    // takes focus; the popover's click-outside handler dismisses the
    // fan on next user interaction. If no handler is supplied (legacy
    // callers / future skins), fall back to closing — users still have
    // the on-orb `⋮` settings menu to swap skins from there.
    if (onLaunchShell) {
      onLaunchShell(tool)
      close()
      return
    }
    close()
  }

  // Orb's resting centre in viewport-space: 24 px gutter + half orb.
  const orbCenterRightOffset = 24 + orbSize / 2
  const orbCenterBottomOffset = 24 + orbSize / 2

  if (display.length === 0) return null

  return (
    <div
      ref={containerRef}
      data-testid='omnibelt-radial-fan'
      aria-label='OmniBelt — radial fan'
      role='menu'
      className='pointer-events-none fixed z-[58]'
      style={{
        right: orbCenterRightOffset - TILE_SIZE / 2,
        bottom: orbCenterBottomOffset - TILE_SIZE / 2,
        width: TILE_SIZE,
        height: TILE_SIZE,
      }}
    >
      {display.map((tool, idx) => {
        const angle = angles[idx]
        const target = polarToOffset(angle, ARC_RADIUS_PX)
        return (
          <FanTile
            key={tool.id}
            tool={tool}
            x={target.x}
            y={target.y}
            index={idx}
            reducedMotion={Boolean(prefersReducedMotion)}
            onLaunch={launch}
          />
        )
      })}
    </div>
  )
}

type FanTileProps = {
  tool: ToolDef
  x: number
  y: number
  index: number
  reducedMotion: boolean
  onLaunch: (tool: ToolDef) => void
}

function FanTile({ tool, x, y, index, reducedMotion, onLaunch }: FanTileProps) {
  const Icon = tool.icon
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <motion.button
            type='button'
            role='menuitem'
            data-testid={`omnibelt-fan-tile-${tool.id}`}
            data-tool-id={tool.id}
            onClick={() => onLaunch(tool)}
            aria-label={tool.label}
            // Each tile starts at the orb's centre (relative origin
            // is the container, which is itself centred on the orb)
            // and shoots to its arc seat — staggered by ~30 ms.
            initial={
              reducedMotion
                ? { opacity: 0, x, y, scale: 1 }
                : { opacity: 0, scale: 0.2, x: 0, y: 0 }
            }
            animate={
              reducedMotion
                ? { opacity: 1, x, y, scale: 1 }
                : { opacity: 1, scale: 1, x, y }
            }
            exit={
              reducedMotion
                ? { opacity: 0 }
                : { opacity: 0, scale: 0.2, x: 0, y: 0 }
            }
            transition={{ ...HOUSE_SPRING, delay: index * 0.03 }}
            style={{
              width: TILE_SIZE,
              height: TILE_SIZE,
            }}
            className={cn(
              'focus-visible:ring-ring/50 pointer-events-auto absolute inline-flex items-center justify-center rounded-full shadow-lg transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:outline-none',
              'bg-gradient-to-br',
              ACCENT_BG_BY_ACCENT[tool.accent]
            )}
          >
            <Icon className='size-5 text-white drop-shadow-sm' />
          </motion.button>
        </TooltipTrigger>
        <TooltipContent side='top'>{tool.label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

// Created and developed by Jai Singh
