// Created and developed by Jai Singh
// ---------------------------------------------------------------------------
// Simulation store — scenario orchestration shared by the DOM panel and the
// in-canvas layer.
// ---------------------------------------------------------------------------
// Hot per-frame state (agent positions, the clock, the heat map) is MUTATED in
// place and read imperatively by the 3D layer's useFrame — pushing it through
// React at 60 fps would melt the panel. The store's reactive `version` bumps
// ~2×/sim-second instead, which is all the DOM stats need. Tours come from the
// existing `get_pick_tour` A* RPC (aisle graph) — no realtime channels, no new
// tables.
import { create } from 'zustand'
import { warehouseMapService } from '@/lib/supabase/warehouse-map.service'
import {
  accumulateHeat,
  buildTour,
  createAgent,
  scenarioKpis,
  tickAgent,
  type ScenarioKpis,
  type SimAgent,
} from './sim-core'

/** Congestion grid cell size, world units (100 ≈ 1 m). */
export const HEAT_CELL_WORLD = 100
/** Reactive version bumps at most this often (simulated seconds). */
const VERSION_INTERVAL_S = 0.5

const AGENT_COLORS = [
  '#0ea5e9',
  '#f59e0b',
  '#10b981',
  '#a855f7',
  '#ef4444',
  '#14b8a6',
  '#f97316',
  '#6366f1',
]

export type SimulationStatus =
  | 'idle'
  | 'loading'
  | 'running'
  | 'paused'
  | 'done'

export interface SimulationConfig {
  pickers: number
  /** Walk speed in m/s (typical order-picker pace ≈ 1.2). */
  walkSpeedMps: number
  /** Dwell per pick, seconds. */
  pickSeconds: number
  binsPerPicker: number
  /** Tour start/end anchor (dock door, packing bench…). */
  startBin: string
}

export interface RunSummary {
  id: number
  label: string
  config: SimulationConfig
  clockSeconds: number
  kpis: ScenarioKpis
}

/** Mutable per-frame scratch — stable reference, never replaced mid-run. */
interface SimMeta {
  clock: number
  lastVersionAt: number
}

interface SimulationStore {
  status: SimulationStatus
  error: string | null
  timeScale: number
  showHeat: boolean
  /** Reactive change counter for DOM subscribers (throttled). */
  version: number
  /** Mutated in place by tick(); read imperatively by the 3D layer. */
  agents: SimAgent[]
  heat: Map<string, number>
  meta: SimMeta
  config: SimulationConfig
  runs: RunSummary[]

  setConfig: (patch: Partial<SimulationConfig>) => void
  setTimeScale: (s: number) => void
  toggleHeat: () => void
  start: (mapId: string, binPool: string[]) => Promise<void>
  pause: () => void
  resume: () => void
  reset: () => void
  /** Advance the scenario by dt simulated seconds (called from useFrame). */
  tick: (dt: number) => void
}

const DEFAULT_CONFIG: SimulationConfig = {
  pickers: 3,
  walkSpeedMps: 1.2,
  pickSeconds: 12,
  binsPerPicker: 6,
  startBin: '',
}

function shuffled<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export const useSimulation = create<SimulationStore>((set, get) => ({
  status: 'idle',
  error: null,
  timeScale: 1,
  showHeat: true,
  version: 0,
  agents: [],
  heat: new Map(),
  meta: { clock: 0, lastVersionAt: 0 },
  config: DEFAULT_CONFIG,
  runs: [],

  setConfig: (patch) => set((s) => ({ config: { ...s.config, ...patch } })),
  setTimeScale: (timeScale) => set({ timeScale }),
  toggleHeat: () => set((s) => ({ showHeat: !s.showHeat })),

  start: async (mapId, binPool) => {
    const { config, status } = get()
    if (status === 'loading') return
    const pool = binPool.filter(Boolean)
    if (pool.length === 0) {
      set({ error: 'No mapped bins on this layout to pick from.' })
      return
    }
    const startBin = config.startBin || pool[0]
    set({ status: 'loading', error: null })
    try {
      // Spread the pool across pickers without replacement while it lasts.
      const deck = shuffled(pool.filter((b) => b !== startBin))
      const agents: SimAgent[] = []
      const failures: string[] = []
      await Promise.all(
        Array.from({ length: config.pickers }, async (_, i) => {
          const bins = Array.from(
            { length: config.binsPerPicker },
            (_, k) => deck[(i * config.binsPerPicker + k) % deck.length]
          ).filter(Boolean)
          if (bins.length === 0) return
          const tour = await warehouseMapService.getPickTour(
            mapId,
            startBin,
            Array.from(new Set(bins))
          )
          if (!tour?.found || !tour.legs?.length) {
            failures.push(`Picker ${i + 1}`)
            return
          }
          const built = buildTour(tour.legs)
          if (!built) {
            failures.push(`Picker ${i + 1}`)
            return
          }
          agents.push(
            createAgent({
              id: `sim-${i}`,
              name: `Picker ${i + 1}`,
              color: AGENT_COLORS[i % AGENT_COLORS.length],
              path: built.path,
              stops: built.stops,
              speedMps: config.walkSpeedMps,
              pickSeconds: config.pickSeconds,
            })
          )
        })
      )
      if (agents.length === 0) {
        set({
          status: 'idle',
          error:
            'No pick tours could be routed. The aisle graph may be missing — seed and connect aisle nodes from the 2D editor (Edit aisles), and make sure bins have nearby nodes.',
        })
        return
      }
      agents.sort((a, b) => a.id.localeCompare(b.id))
      set({
        status: 'running',
        error:
          failures.length > 0
            ? `${failures.join(', ')} couldn't be routed — running with ${agents.length}.`
            : null,
        agents,
        heat: new Map(),
        meta: { clock: 0, lastVersionAt: 0 },
        version: get().version + 1,
      })
    } catch (e) {
      set({
        status: 'idle',
        error: e instanceof Error ? e.message : 'Failed to start the scenario.',
      })
    }
  },

  pause: () => set((s) => (s.status === 'running' ? { status: 'paused' } : s)),
  resume: () => set((s) => (s.status === 'paused' ? { status: 'running' } : s)),

  reset: () =>
    set({
      status: 'idle',
      error: null,
      agents: [],
      heat: new Map(),
      meta: { clock: 0, lastVersionAt: 0 },
      version: get().version + 1,
    }),

  tick: (dt) => {
    const s = get()
    if (s.status !== 'running' || dt <= 0) return
    s.meta.clock += dt
    for (const a of s.agents) tickAgent(a, dt)
    accumulateHeat(s.heat, s.agents, dt, HEAT_CELL_WORLD)
    const done = s.agents.every((a) => a.state === 'done')
    if (done) {
      const kpis = scenarioKpis(s.agents, s.meta.clock)
      const run: RunSummary = {
        id: s.runs.length + 1,
        label: `Run ${s.runs.length + 1} — ${s.config.pickers}×${s.config.binsPerPicker} bins`,
        config: { ...s.config },
        clockSeconds: s.meta.clock,
        kpis,
      }
      set({
        status: 'done',
        runs: [...s.runs.slice(-4), run],
        version: s.version + 1,
      })
      return
    }
    if (s.meta.clock - s.meta.lastVersionAt >= VERSION_INTERVAL_S) {
      s.meta.lastVersionAt = s.meta.clock
      set({ version: s.version + 1 })
    }
  },
}))

// Created and developed by Jai Singh
