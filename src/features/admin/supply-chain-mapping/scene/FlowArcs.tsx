// Created and developed by Jai Singh
// One great-circle tube per lane, carrying the TSL comet light-wave.
// Picking happens on an invisible fat tube so raycasts stay cheap and
// forgiving; the visible tube never sees pointer events.
import { useEffect, useMemo, useState } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import { TubeGeometry } from 'three/webgpu'
import type {
  MapSelection,
  NetworkAnalysis,
  SupplyChainLink,
  SupplyChainNetwork,
  SupplyChainNode,
  TransportMode,
} from '../data/types'
import { STATUS_COLORS, type LaneStyle } from '../palette'
import { GLOBE_RADIUS, GreatCircleArc, latLngToVector3 } from './coords'
import { createLaneMaterial } from './materials'

/** Air freight flies high; sea lanes hug the planet. */
const MODE_LIFT: Record<TransportMode, number> = {
  air: 0.46,
  sea: 0.22,
  road: 0.14,
  rail: 0.17,
}

/** Comet head travel speed, lane-lengths per second. */
const MODE_SPEED: Record<TransportMode, number> = {
  air: 0.4,
  sea: 0.16,
  road: 0.28,
  rail: 0.24,
}

function hashPhase(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 9973
  return h / 9973
}

/** How a lane relates to the focused region (null = no focus). */
type FocusCategory = 'intra' | 'crossing' | 'outside' | null

function laneFocusCategory(
  link: SupplyChainLink,
  focusNodeIds: Set<string> | null
): FocusCategory {
  if (!focusNodeIds) return null
  const fromIn = focusNodeIds.has(link.from)
  const toIn = focusNodeIds.has(link.to)
  if (fromIn && toIn) return 'intra'
  if (fromIn || toIn) return 'crossing'
  return 'outside'
}

/**
 * Hover/selection always win so dimmed lanes stay inspectable; otherwise
 * the ambient level applies (region ghosting / critical-path spotlight).
 */
function laneEmphasis(
  link: SupplyChainLink,
  selection: MapSelection,
  hoveredId: string | null,
  ambient: number
): number {
  if (hoveredId === link.id) return 1.55
  if (!selection) return ambient
  if (selection.type === 'link') return selection.id === link.id ? 1.55 : 0.12
  return link.from === selection.id || link.to === selection.id ? 1.35 : 0.12
}

interface LaneProps {
  link: SupplyChainLink
  from: SupplyChainNode
  to: SupplyChainNode
  status: keyof typeof STATUS_COLORS
  maxFlow: number
  emphasis: number
  visible: boolean
  laneStyle: LaneStyle
  onSelect: (id: string) => void
  onHover: (id: string | null) => void
}

function Lane({
  link,
  from,
  to,
  status,
  maxFlow,
  emphasis,
  visible,
  laneStyle,
  onSelect,
  onHover,
}: LaneProps) {
  const arc = useMemo(
    () =>
      new GreatCircleArc(
        latLngToVector3(from.lat, from.lng),
        latLngToVector3(to.lat, to.lng),
        GLOBE_RADIUS,
        MODE_LIFT[link.mode]
      ),
    [from.lat, from.lng, to.lat, to.lng, link.mode]
  )

  const radius = 0.13 + (link.flowPerWeek / Math.max(1, maxFlow)) * 0.32
  const { geometry, hitGeometry } = useMemo(() => {
    const segments = Math.min(140, Math.max(28, Math.round(arc.span * 64)))
    return {
      geometry: new TubeGeometry(arc, segments, radius, 7, false),
      hitGeometry: new TubeGeometry(
        arc,
        Math.max(12, Math.round(segments / 4)),
        Math.max(1.7, radius * 3.2),
        4,
        false
      ),
    }
  }, [arc, radius])
  useEffect(
    () => () => {
      geometry.dispose()
      hitGeometry.dispose()
    },
    [geometry, hitGeometry]
  )

  // Created once per lane mount (Lane is keyed by link.id); status/flow
  // updates go through uniform setters so the program is never rebuilt.
  const [handle] = useState(() => {
    const phase = hashPhase(link.id)
    const pulses = Math.max(2, Math.round(arc.span * 7))
    return createLaneMaterial({
      colorHex: STATUS_COLORS[status],
      pulses,
      speed: pulses * MODE_SPEED[link.mode],
      phase,
      broken: status === 'broken',
      style: laneStyle,
    })
  })
  useEffect(() => () => handle.material.dispose(), [handle])

  useEffect(() => {
    handle.setColor(STATUS_COLORS[status])
    handle.setBroken(status === 'broken')
  }, [handle, status])
  useEffect(() => {
    handle.setEmphasis(emphasis)
  }, [handle, emphasis])
  useEffect(() => {
    handle.setStyle(laneStyle)
  }, [handle, laneStyle])
  useEffect(() => {
    const pulses = Math.max(2, Math.round(arc.span * 7))
    handle.setFlow(pulses, pulses * MODE_SPEED[link.mode])
  }, [handle, arc, link.mode])

  return (
    <group visible={visible}>
      <mesh geometry={geometry} material={handle.material} />
      <mesh
        geometry={hitGeometry}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation()
          onSelect(link.id)
        }}
        onPointerOver={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation()
          onHover(link.id)
        }}
        onPointerOut={() => onHover(null)}
      >
        <meshBasicMaterial colorWrite={false} depthWrite={false} transparent />
      </mesh>
    </group>
  )
}

interface FlowArcsProps {
  network: SupplyChainNetwork
  analysis: NetworkAnalysis
  selection: MapSelection
  hoveredLinkId: string | null
  visibleStatuses: Record<string, boolean>
  visibleModes: Record<string, boolean>
  laneStyle: LaneStyle
  focusNodeIds: Set<string> | null
  showCriticalPath: boolean
  criticalPathLinkIds: Set<string>
  onSelect: (selection: MapSelection) => void
  onHover: (id: string | null) => void
}

export function FlowArcs({
  network,
  analysis,
  selection,
  hoveredLinkId,
  visibleStatuses,
  visibleModes,
  laneStyle,
  focusNodeIds,
  showCriticalPath,
  criticalPathLinkIds,
  onSelect,
  onHover,
}: FlowArcsProps) {
  const nodesById = useMemo(
    () => new Map(network.nodes.map((n) => [n.id, n])),
    [network.nodes]
  )
  const maxFlow = useMemo(
    () => Math.max(...network.links.map((l) => l.flowPerWeek), 1),
    [network.links]
  )

  return (
    <group>
      {network.links.map((link) => {
        const from = nodesById.get(link.from)
        const to = nodesById.get(link.to)
        if (!from || !to) return null
        const status = analysis.linkHealth.get(link.id)?.status ?? 'nominal'
        const category = laneFocusCategory(link, focusNodeIds)
        // Ambient level: critical-path spotlight dominates; otherwise
        // border-crossing lanes ghost so the domestic network pops.
        const ambient = showCriticalPath
          ? criticalPathLinkIds.has(link.id)
            ? 1.45
            : 0.08
          : category === 'crossing'
            ? 0.18
            : 1
        return (
          <Lane
            key={link.id}
            link={link}
            from={from}
            to={to}
            status={status}
            maxFlow={maxFlow}
            emphasis={laneEmphasis(link, selection, hoveredLinkId, ambient)}
            visible={
              visibleStatuses[status] !== false &&
              visibleModes[link.mode] !== false &&
              category !== 'outside'
            }
            laneStyle={laneStyle}
            onSelect={(id) => onSelect({ type: 'link', id })}
            onHover={onHover}
          />
        )
      })}
    </group>
  )
}
