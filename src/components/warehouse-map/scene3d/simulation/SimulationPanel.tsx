// Created and developed by Jai Singh
// ---------------------------------------------------------------------------
// SimulationPanel — configure and drive live pick-path scenarios.
// ---------------------------------------------------------------------------
// Lazy-loaded DOM overlay. Picks N virtual pickers, samples bins from the
// layout's mapped bins, routes each one's tour through the aisle graph
// (`get_pick_tour`), then runs them in the 3D scene at adjustable time scale
// with live KPIs and a short cross-run comparison history.
import { useEffect, useMemo } from 'react'
import { Activity, Pause, Play, RotateCcw, X } from 'lucide-react'
import { scenarioKpis } from './sim-core'
import { useSimulation, type SimulationConfig } from './simulation.store'

interface SimulationPanelProps {
  mapId: string
  /** Pool of mapped storage bins on the current layout. */
  bins: string[]
  onClose: () => void
}

function NumField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
  disabled,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  suffix?: string
  disabled?: boolean
}) {
  return (
    <label className='flex flex-col gap-1 text-xs'>
      <span className='text-muted-foreground'>{label}</span>
      <span className='flex items-center gap-1'>
        <input
          type='number'
          value={value}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onChange={(e) => {
            const v = Number(e.target.value)
            if (Number.isFinite(v)) onChange(v)
          }}
          className='bg-muted/50 focus:ring-ring w-full rounded-md border px-2 py-1.5 focus:ring-1 focus:outline-none disabled:opacity-50'
        />
        {suffix && <span className='text-muted-foreground'>{suffix}</span>}
      </span>
    </label>
  )
}

const fmtClock = (s: number) => {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

const SPEEDS = [1, 2, 5, 10]

export default function SimulationPanel({
  mapId,
  bins,
  onClose,
}: SimulationPanelProps) {
  const status = useSimulation((s) => s.status)
  const error = useSimulation((s) => s.error)
  const config = useSimulation((s) => s.config)
  const setConfig = useSimulation((s) => s.setConfig)
  const timeScale = useSimulation((s) => s.timeScale)
  const setTimeScale = useSimulation((s) => s.setTimeScale)
  const showHeat = useSimulation((s) => s.showHeat)
  const toggleHeat = useSimulation((s) => s.toggleHeat)
  const start = useSimulation((s) => s.start)
  const pause = useSimulation((s) => s.pause)
  const resume = useSimulation((s) => s.resume)
  const reset = useSimulation((s) => s.reset)
  const runs = useSimulation((s) => s.runs)
  // version drives the live-stats re-render (~2×/sim-second).
  useSimulation((s) => s.version)

  const { agents, meta } = useSimulation.getState()
  const kpis = scenarioKpis(agents, meta.clock)

  // Leaving simulate mode tears the scenario down — markers must never linger
  // in view mode.
  useEffect(() => () => useSimulation.getState().reset(), [])

  const configurable = status === 'idle' || status === 'done'
  const running = status === 'running'
  const datalistBins = useMemo(() => bins.slice(0, 500), [bins])

  const set = <K extends keyof SimulationConfig>(
    k: K,
    v: SimulationConfig[K]
  ) => setConfig({ [k]: v })

  return (
    <div className='bg-card/95 absolute top-16 left-4 z-10 flex max-h-[calc(100%-9rem)] w-72 flex-col gap-3 overflow-y-auto rounded-lg border p-3 shadow-lg backdrop-blur-sm'>
      <div className='flex items-center justify-between'>
        <h3 className='flex items-center gap-1.5 text-sm font-semibold'>
          <Activity className='h-4 w-4' /> Scenario simulation
        </h3>
        <button
          type='button'
          onClick={onClose}
          aria-label='Close simulation'
          className='text-muted-foreground hover:text-foreground rounded p-0.5'
        >
          <X className='h-4 w-4' />
        </button>
      </div>

      {bins.length === 0 ? (
        <p className='text-muted-foreground text-xs'>
          No mapped bins on this layout yet — map storage bins to racks first,
          then run pick scenarios against them.
        </p>
      ) : (
        <>
          <div className='grid grid-cols-2 gap-2'>
            <NumField
              label='Pickers'
              value={config.pickers}
              min={1}
              max={8}
              disabled={!configurable}
              onChange={(v) =>
                set('pickers', Math.min(Math.max(Math.round(v), 1), 8))
              }
            />
            <NumField
              label='Bins per picker'
              value={config.binsPerPicker}
              min={1}
              max={20}
              disabled={!configurable}
              onChange={(v) =>
                set('binsPerPicker', Math.min(Math.max(Math.round(v), 1), 20))
              }
            />
            <NumField
              label='Walk speed'
              value={config.walkSpeedMps}
              min={0.4}
              max={3}
              step={0.1}
              suffix='m/s'
              disabled={!configurable}
              onChange={(v) => set('walkSpeedMps', v)}
            />
            <NumField
              label='Pick time'
              value={config.pickSeconds}
              min={1}
              max={120}
              suffix='s'
              disabled={!configurable}
              onChange={(v) => set('pickSeconds', v)}
            />
          </div>

          <label className='flex flex-col gap-1 text-xs'>
            <span className='text-muted-foreground'>
              Start bin (dock / pack bench)
            </span>
            <input
              type='text'
              list='sim-start-bins'
              value={config.startBin}
              placeholder={bins[0]}
              disabled={!configurable}
              onChange={(e) => set('startBin', e.target.value.toUpperCase())}
              className='bg-muted/50 focus:ring-ring rounded-md border px-2 py-1.5 focus:ring-1 focus:outline-none disabled:opacity-50'
            />
            <datalist id='sim-start-bins'>
              {datalistBins.map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
          </label>

          {error && (
            <p className='rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-800'>
              {error}
            </p>
          )}

          <div className='flex items-center gap-2'>
            {configurable ? (
              <button
                type='button'
                onClick={() => void start(mapId, bins)}
                className='bg-primary text-primary-foreground flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium'
              >
                <Play className='h-3.5 w-3.5' />
                {status === 'done' ? 'Run again' : 'Run scenario'}
              </button>
            ) : status === 'loading' ? (
              <button
                type='button'
                disabled
                className='bg-primary/60 text-primary-foreground flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium'
              >
                Routing tours…
              </button>
            ) : (
              <button
                type='button'
                onClick={running ? pause : resume}
                className='bg-primary text-primary-foreground flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium'
              >
                {running ? (
                  <>
                    <Pause className='h-3.5 w-3.5' /> Pause
                  </>
                ) : (
                  <>
                    <Play className='h-3.5 w-3.5' /> Resume
                  </>
                )}
              </button>
            )}
            <button
              type='button'
              onClick={reset}
              title='Reset scenario'
              className='text-muted-foreground hover:text-foreground rounded-md border px-2 py-1.5'
            >
              <RotateCcw className='h-3.5 w-3.5' />
            </button>
          </div>

          <div className='flex items-center justify-between text-xs'>
            <div
              className='flex items-center gap-1 rounded-md border p-0.5'
              role='group'
              aria-label='Time scale'
            >
              {SPEEDS.map((s) => (
                <button
                  key={s}
                  type='button'
                  onClick={() => setTimeScale(s)}
                  aria-pressed={timeScale === s}
                  className={`rounded px-1.5 py-0.5 ${
                    timeScale === s
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {s}×
                </button>
              ))}
            </div>
            <label className='flex items-center gap-1.5'>
              <input type='checkbox' checked={showHeat} onChange={toggleHeat} />
              Congestion
            </label>
          </div>

          {agents.length > 0 && (
            <div className='flex flex-col gap-2 border-t pt-2'>
              <div className='grid grid-cols-2 gap-x-3 gap-y-1 text-xs'>
                <span className='text-muted-foreground'>Sim clock</span>
                <span className='text-right font-medium tabular-nums'>
                  {fmtClock(meta.clock)}
                </span>
                <span className='text-muted-foreground'>Picks</span>
                <span className='text-right font-medium tabular-nums'>
                  {kpis.totalPicks}/{kpis.targetPicks}
                </span>
                <span className='text-muted-foreground'>Distance walked</span>
                <span className='text-right font-medium tabular-nums'>
                  {Math.round(kpis.totalDistanceM)} m
                </span>
                <span className='text-muted-foreground'>Picks / labour hr</span>
                <span className='text-right font-medium tabular-nums'>
                  {kpis.picksPerHour.toFixed(1)}
                </span>
                <span className='text-muted-foreground'>Walk per pick</span>
                <span className='text-right font-medium tabular-nums'>
                  {kpis.metersPerPick.toFixed(1)} m
                </span>
              </div>

              <div className='flex flex-col gap-1'>
                {agents.map((a) => (
                  <div
                    key={a.id}
                    className='flex items-center gap-2 text-[11px]'
                  >
                    <span
                      className='h-2 w-2 shrink-0 rounded-full'
                      style={{ background: a.color }}
                    />
                    <span className='w-16 truncate'>{a.name}</span>
                    <span className='text-muted-foreground capitalize'>
                      {a.state}
                    </span>
                    <span className='text-muted-foreground ml-auto tabular-nums'>
                      {a.picksDone}/{a.stops.length} ·{' '}
                      {Math.round(a.distance / 100)} m
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {runs.length > 0 && (
            <div className='flex flex-col gap-1 border-t pt-2'>
              <span className='text-muted-foreground text-xs font-medium'>
                Completed runs
              </span>
              {runs
                .slice()
                .reverse()
                .map((r) => (
                  <div key={r.id} className='text-[11px]'>
                    <span className='font-medium'>{r.label}</span>
                    <span className='text-muted-foreground'>
                      {' '}
                      — {fmtClock(r.clockSeconds)} ·{' '}
                      {Math.round(r.kpis.totalDistanceM)} m ·{' '}
                      {r.kpis.picksPerHour.toFixed(1)} picks/hr
                    </span>
                  </div>
                ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// Created and developed by Jai Singh
