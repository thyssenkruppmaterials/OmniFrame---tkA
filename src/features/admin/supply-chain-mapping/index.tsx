// Created and developed by Jai Singh
// Supply Chain Mapping — a WebGPU-first 3D flow map of multi-tier supply
// chains. Light-waves travel each lane in the direction of flow; their
// color is the lane's derived health (nominal/elevated/bottleneck/broken),
// and downstream site risk re-propagates live as disruptions are injected.
import { lazy, Suspense, useMemo, useState } from 'react'
import { Globe2, Loader2, Undo2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { AlertsPanel } from './components/AlertsPanel'
import { InspectorPanel } from './components/InspectorPanel'
import { KpiBar } from './components/KpiBar'
import { LegendPanel } from './components/LegendPanel'
import { analyzeNetwork, analyzeRegion } from './data/analysis'
import {
  CONTINENT_LABELS,
  continentOfNode,
  continentsInNetwork,
  type Continent,
} from './data/continents'
import { DEMO_NETWORKS } from './data/demo-networks'
import type {
  LinkDisruption,
  LinkStatus,
  MapSelection,
  TransportMode,
} from './data/types'
import { LANE_STYLE_LABELS, type LaneStyle } from './palette'

// The whole three/webgpu engine stays out of the route chunk until the
// page actually renders the canvas.
const SupplyChainScene = lazy(() => import('./scene/SupplyChainScene'))

export function SupplyChainMappingPage() {
  const [scenarioId, setScenarioId] = useState(DEMO_NETWORKS[0].id)
  const [overrides, setOverrides] = useState<
    Record<string, Record<string, LinkDisruption | null>>
  >({})
  const [selection, setSelection] = useState<MapSelection>(null)
  const [autoRotate, setAutoRotate] = useState(true)
  const [showLabels, setShowLabels] = useState(false)
  const [laneStyle, setLaneStyle] = useState<LaneStyle>('pulse')
  const [focusContinent, setFocusContinent] = useState<Continent | null>(null)
  const [showCriticalPath, setShowCriticalPath] = useState(false)
  const [visibleStatuses, setVisibleStatuses] = useState<
    Record<string, boolean>
  >({})
  const [visibleModes, setVisibleModes] = useState<Record<string, boolean>>({})
  const [backend, setBackend] = useState<'WebGPU' | 'WebGL2' | null>(null)

  const network = useMemo(() => {
    const base = DEMO_NETWORKS.find((d) => d.id === scenarioId)!
    const scenarioOverrides = overrides[scenarioId]
    if (!scenarioOverrides) return base
    return {
      ...base,
      links: base.links.map((link) => {
        if (!(link.id in scenarioOverrides)) return link
        const disruption = scenarioOverrides[link.id]
        return { ...link, disruption: disruption ?? undefined }
      }),
    }
  }, [scenarioId, overrides])

  const analysis = useMemo(() => analyzeNetwork(network), [network])

  const continentByNode = useMemo(
    () => new Map(network.nodes.map((n) => [n.id, continentOfNode(n)])),
    [network.nodes]
  )
  const availableContinents = useMemo(
    () => continentsInNetwork(network),
    [network]
  )
  const focusNodeIds = useMemo(() => {
    if (!focusContinent) return null
    return new Set(
      network.nodes
        .filter((n) => continentByNode.get(n.id) === focusContinent)
        .map((n) => n.id)
    )
  }, [focusContinent, network.nodes, continentByNode])
  const regionAnalysis = useMemo(
    () =>
      focusNodeIds ? analyzeRegion(network, analysis, focusNodeIds) : null,
    [network, analysis, focusNodeIds]
  )

  const setDisruption = (linkId: string, disruption: LinkDisruption | null) =>
    setOverrides((prev) => ({
      ...prev,
      [scenarioId]: { ...prev[scenarioId], [linkId]: disruption },
    }))

  const toggleStatus = (status: LinkStatus) =>
    setVisibleStatuses((prev) => ({
      ...prev,
      [status]: prev[status] === false,
    }))

  const toggleMode = (mode: TransportMode) =>
    setVisibleModes((prev) => ({
      ...prev,
      [mode]: prev[mode] === false,
    }))

  const focusRegion = (continent: Continent | null) => {
    setFocusContinent(continent)
    // A spinning planet fights the close-up framing — let the user re-enable
    if (continent) setAutoRotate(false)
  }

  return (
    <>
      <Header fixed>
        <Search />
        <div className='ml-auto flex items-center space-x-4'>
          <ThemeSwitch />
          <ProfileDropdown />
        </div>
      </Header>

      <Main>
        <div className='mb-2 flex flex-wrap items-center justify-between gap-2'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>
              Supply Chain Mapping
            </h2>
            <p className='text-muted-foreground text-sm'>
              Live 3D flow matrix — light-waves trace every lane; color shifts
              expose pinch points and broken links across the full network.
              Focus a region to study a continent&apos;s domestic chain and its
              import exposure.
            </p>
          </div>
          {backend && (
            <Badge variant='outline' className='text-xs'>
              Engine: {backend}
            </Badge>
          )}
        </div>

        <div className='relative h-[calc(100dvh-13rem)] min-h-[480px] overflow-hidden rounded-xl border border-white/10 bg-[#030714]'>
          <Suspense
            fallback={
              <div className='flex h-full flex-col items-center justify-center gap-3 text-slate-400'>
                <Loader2 className='h-6 w-6 animate-spin' />
                <p className='text-sm'>Spinning up the 3D engine…</p>
              </div>
            }
          >
            <SupplyChainScene
              network={network}
              analysis={analysis}
              selection={selection}
              onSelect={setSelection}
              autoRotate={autoRotate}
              showLabels={showLabels}
              visibleStatuses={visibleStatuses}
              visibleModes={visibleModes}
              laneStyle={laneStyle}
              focusNodeIds={focusNodeIds}
              showCriticalPath={showCriticalPath}
              criticalPathLinkIds={
                regionAnalysis?.criticalPathLinkIds ??
                analysis.criticalPathLinkIds
              }
              onBackendDetected={setBackend}
            />
          </Suspense>

          {/* HUD overlays — pointer events pass through except on panels */}
          <div className='pointer-events-none absolute inset-0 flex flex-col justify-between p-3'>
            <div className='flex items-start justify-between gap-3'>
              <div className='flex min-w-0 flex-col gap-2'>
                {focusContinent && (
                  <button
                    type='button'
                    onClick={() => focusRegion(null)}
                    className='pointer-events-auto flex w-fit items-center gap-2 rounded-lg border border-white/10 bg-slate-950/70 px-3 py-1.5 text-xs text-slate-200 shadow-lg backdrop-blur-md hover:bg-slate-900/80'
                  >
                    <Undo2 className='h-3 w-3 text-slate-400' />
                    <span className='text-slate-400'>Global</span>
                    <span className='text-slate-500'>▸</span>
                    <span className='font-semibold'>
                      {CONTINENT_LABELS[focusContinent]}
                    </span>
                    <span className='text-slate-500'>
                      · domestic view — click to zoom out
                    </span>
                  </button>
                )}
                <KpiBar
                  kpis={analysis.kpis}
                  regionKpis={regionAnalysis?.kpis}
                />
              </div>
              <div className='flex shrink-0 flex-col items-end gap-2'>
                <div className='pointer-events-auto flex flex-col gap-2 rounded-xl border border-white/10 bg-slate-950/70 p-3 shadow-xl backdrop-blur-md'>
                  <Select
                    value={scenarioId}
                    onValueChange={(id) => {
                      setScenarioId(id)
                      setFocusContinent(null)
                    }}
                  >
                    <SelectTrigger className='h-8 w-64 text-xs'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DEMO_NETWORKS.map((d) => (
                        <SelectItem key={d.id} value={d.id} className='text-xs'>
                          {d.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className='flex items-center justify-between gap-3'>
                    <Label className='text-xs text-slate-300'>Region</Label>
                    <Select
                      value={focusContinent ?? 'global'}
                      onValueChange={(v) =>
                        focusRegion(v === 'global' ? null : (v as Continent))
                      }
                    >
                      <SelectTrigger className='h-7 w-36 text-xs'>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value='global' className='text-xs'>
                          <span className='flex items-center gap-1.5'>
                            <Globe2 className='h-3 w-3' /> Global
                          </span>
                        </SelectItem>
                        {availableContinents.map((c) => (
                          <SelectItem key={c} value={c} className='text-xs'>
                            {CONTINENT_LABELS[c]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className='flex items-center justify-between gap-3'>
                    <Label className='text-xs text-slate-300'>Lane style</Label>
                    <Select
                      value={laneStyle}
                      onValueChange={(v) => setLaneStyle(v as LaneStyle)}
                    >
                      <SelectTrigger className='h-7 w-36 text-xs'>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(
                          Object.entries(LANE_STYLE_LABELS) as Array<
                            [LaneStyle, string]
                          >
                        ).map(([value, label]) => (
                          <SelectItem
                            key={value}
                            value={value}
                            className='text-xs'
                          >
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className='flex items-center justify-between gap-3'>
                    <Label
                      htmlFor='scm-critical'
                      className='text-xs text-slate-300'
                    >
                      Critical path
                    </Label>
                    <Switch
                      id='scm-critical'
                      checked={showCriticalPath}
                      onCheckedChange={setShowCriticalPath}
                    />
                  </div>
                  <div className='flex items-center justify-between gap-3'>
                    <Label
                      htmlFor='scm-rotate'
                      className='text-xs text-slate-300'
                    >
                      Auto-rotate
                    </Label>
                    <Switch
                      id='scm-rotate'
                      checked={autoRotate}
                      onCheckedChange={setAutoRotate}
                    />
                  </div>
                  <div className='flex items-center justify-between gap-3'>
                    <Label
                      htmlFor='scm-labels'
                      className='text-xs text-slate-300'
                    >
                      All labels
                    </Label>
                    <Switch
                      id='scm-labels'
                      checked={showLabels}
                      onCheckedChange={setShowLabels}
                    />
                  </div>
                </div>
                <AlertsPanel
                  network={network}
                  analysis={analysis}
                  focusNodeIds={focusNodeIds}
                  selection={selection}
                  onSelect={setSelection}
                />
              </div>
            </div>

            <div className='flex items-end justify-between gap-3'>
              <LegendPanel
                visibleStatuses={visibleStatuses}
                visibleModes={visibleModes}
                onToggleStatus={toggleStatus}
                onToggleMode={toggleMode}
              />
              {selection && (
                <InspectorPanel
                  network={network}
                  analysis={analysis}
                  selection={selection}
                  continentByNode={continentByNode}
                  focusContinent={focusContinent}
                  onFocusContinent={focusRegion}
                  onSelect={setSelection}
                  onSetDisruption={setDisruption}
                />
              )}
            </div>
          </div>
        </div>
      </Main>
    </>
  )
}

// Created and developed by Jai Singh
