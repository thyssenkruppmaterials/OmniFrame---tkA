// Created and developed by Jai Singh
// ---------------------------------------------------------------------------
// /supply-chain-harness — DEV-ONLY testbed for the supply-chain 3D globe.
// Mounts <SupplyChainScene> with a demo network (no auth) so rendering
// regressions (blank canvas, WebGPU/WebGL2 fallback issues, shader bugs)
// can be reproduced headlessly. Renders nothing on real deployments.
// ?scenario=electronics|automotive|pharma picks the dataset.
// ?style=pulse|beam|dash|wave|aurora picks the lane visual style.
// ?region=asia|europe|north_america|… activates the continent focus level.
// ?critical=1 turns on the critical-path spotlight.
// ---------------------------------------------------------------------------
import { lazy, Suspense, useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import {
  analyzeNetwork,
  analyzeRegion,
} from '@/features/admin/supply-chain-mapping/data/analysis'
import {
  CONTINENT_LABELS,
  continentOfNode,
  type Continent,
} from '@/features/admin/supply-chain-mapping/data/continents'
import { DEMO_NETWORKS } from '@/features/admin/supply-chain-mapping/data/demo-networks'
import type { MapSelection } from '@/features/admin/supply-chain-mapping/data/types'
import {
  LANE_STYLE_INDEX,
  type LaneStyle,
} from '@/features/admin/supply-chain-mapping/palette'

const SupplyChainScene = lazy(
  () => import('@/features/admin/supply-chain-mapping/scene/SupplyChainScene')
)

const isLocalhost = () =>
  typeof window !== 'undefined' &&
  ['localhost', '127.0.0.1'].includes(window.location.hostname)

function SupplyChainHarness() {
  const [selection, setSelection] = useState<MapSelection>(null)
  const [backend, setBackend] = useState<string | null>(null)

  const network = useMemo(() => {
    const wanted = new URLSearchParams(window.location.search).get('scenario')
    return DEMO_NETWORKS.find((d) => d.id === wanted) ?? DEMO_NETWORKS[0]
  }, [])
  const laneStyle = useMemo<LaneStyle>(() => {
    const wanted = new URLSearchParams(window.location.search).get('style')
    return wanted && wanted in LANE_STYLE_INDEX
      ? (wanted as LaneStyle)
      : 'pulse'
  }, [])
  const focusContinent = useMemo<Continent | null>(() => {
    const wanted = new URLSearchParams(window.location.search).get('region')
    return wanted && wanted in CONTINENT_LABELS ? (wanted as Continent) : null
  }, [])
  const showCriticalPath = useMemo(
    () => new URLSearchParams(window.location.search).get('critical') === '1',
    []
  )
  const analysis = useMemo(() => analyzeNetwork(network), [network])
  const focusNodeIds = useMemo(() => {
    if (!focusContinent) return null
    return new Set(
      network.nodes
        .filter((n) => continentOfNode(n) === focusContinent)
        .map((n) => n.id)
    )
  }, [network, focusContinent])
  const regionAnalysis = useMemo(
    () =>
      focusNodeIds ? analyzeRegion(network, analysis, focusNodeIds) : null,
    [network, analysis, focusNodeIds]
  )

  if (!import.meta.env.DEV && !isLocalhost()) return null

  return (
    <div className='h-screen w-screen bg-[#030714]'>
      {backend && (
        <div
          data-testid='harness-backend'
          className='absolute top-2 left-2 z-10 rounded bg-slate-900/80 px-2 py-1 text-xs text-slate-200'
        >
          {backend}
        </div>
      )}
      <Suspense
        fallback={<div data-testid='harness-loading'>Loading scene…</div>}
      >
        <SupplyChainScene
          network={network}
          analysis={analysis}
          selection={selection}
          onSelect={setSelection}
          autoRotate={false}
          showLabels
          visibleStatuses={{}}
          visibleModes={{}}
          laneStyle={laneStyle}
          focusNodeIds={focusNodeIds}
          showCriticalPath={showCriticalPath}
          criticalPathLinkIds={
            regionAnalysis?.criticalPathLinkIds ?? analysis.criticalPathLinkIds
          }
          onBackendDetected={setBackend}
        />
      </Suspense>
    </div>
  )
}

export const Route = createFileRoute('/supply-chain-harness')({
  component: SupplyChainHarness,
})

// Created and developed by Jai Singh
