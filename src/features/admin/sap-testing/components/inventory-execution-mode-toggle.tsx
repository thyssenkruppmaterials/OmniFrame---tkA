// Created and developed by Jai Singh
/**
 * InventoryExecutionModeToggle — Local / Fleet routing toggle for the
 * Inventory Management tab (2026-05-09).
 *
 * Renders a compact strip with two halves:
 *   - LEFT — segmented Local | Fleet button group (the toggle).
 *   - RIGHT — only when `mode === 'fleet'`, a dropdown picker listing
 *     online fleet agents; the picked agent's hostname + capability
 *     count is the dropdown label.
 *
 * Active capability check is per-action — the dropdown ALWAYS shows
 * every online agent (so a user can pre-flip the toggle even when
 * they're standing on a query the picked agent can't run yet),
 * with a small amber warning under the dropdown when the picked
 * agent doesn't advertise the active query's `requiredCapability`.
 *
 * Lives ABOVE the existing `AgentStatusBar` so the user sees the
 * routing decision before the SAP-session pill / Console toggle
 * (which apply ONLY to local mode — fleet mode runs SAP on the
 * remote agent's pinned session).
 *
 * Out-of-scope tools (SAP Recorder, Reversal Engine) bypass this
 * toggle entirely; the parent tab disables their selection in the
 * Library when fleet mode is active and surfaces a "Local-only"
 * pill so the user understands why.
 *
 * Related:
 *   - [[Implementations/Implement-Inventory-Management-Fleet-Routing]]
 *   - [[Patterns/Fleet-Aware-Smart-Routing]]
 */
import { Cpu, Globe, Server, ShieldAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { type FleetAgent } from '../hooks/use-agent-detection'
import { type ExecutionMode } from '../hooks/use-execution-mode'

interface InventoryExecutionModeToggleProps {
  mode: ExecutionMode
  onModeChange: (mode: ExecutionMode) => void
  fleetAgentId: string | null
  onFleetAgentChange: (id: string | null) => void
  /** Online fleet agents from `useAgentDetection().fleet.agents`.
   *  Empty array when the org has no online agents — in that case
   *  the toggle still lets the user flip to fleet mode but the
   *  dropdown carries an inline empty-state. */
  fleetAgents: FleetAgent[]
  /** Capability the active query needs from the picked agent.
   *  Optional — when omitted the toggle just shows mode + dropdown
   *  without surfacing the per-action capability warning. */
  activeCapability?: string
  /** Active query name — used in the capability warning copy so the
   *  user knows WHICH query they're being warned about. */
  activeQueryName?: string
  /** Whether the toggle is locked. Used during in-flight queries to
   *  prevent the user changing modes mid-dispatch. */
  disabled?: boolean
}

// ─────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────
export function InventoryExecutionModeToggle({
  mode,
  onModeChange,
  fleetAgentId,
  onFleetAgentChange,
  fleetAgents,
  activeCapability,
  activeQueryName,
  disabled,
}: InventoryExecutionModeToggleProps) {
  const isFleet = mode === 'fleet'
  const pickedAgent = fleetAgentId
    ? (fleetAgents.find((a) => a.id === fleetAgentId) ?? null)
    : null
  const pickedAgentMissingCap = Boolean(
    isFleet &&
    activeCapability &&
    pickedAgent &&
    !pickedAgent.capabilities.includes(activeCapability)
  )
  // 2026-05-10 — base "no pick" on the user's intent (`!fleetAgentId`),
  // not on `pickedAgent` resolution. A stale persisted id that doesn't
  // match any current online agent used to surface "Pick a fleet agent
  // above" even though the user HAD picked one. `useExecutionMode`
  // auto-promotes those stale picks to the first online agent on the
  // next render, so within one tick the dropdown's value matches an
  // option AND `pickedAgent` resolves cleanly. Treating `noAgentPicked`
  // as the no-intent case keeps the toggle's warning copy accurate
  // during that transient render.
  const noAgentPicked = isFleet && !fleetAgentId
  const noOnlineAgents = isFleet && fleetAgents.length === 0

  return (
    <div className='bg-card flex flex-wrap items-center gap-2 rounded-md border px-2.5 py-2 shadow-sm'>
      {/* Toggle group — the primary control */}
      <div className='inline-flex items-center gap-0 overflow-hidden rounded-md border'>
        <Button
          type='button'
          size='sm'
          variant={mode === 'local' ? 'default' : 'ghost'}
          className={cn(
            'h-7 gap-1.5 rounded-none border-0 px-3 text-xs',
            mode === 'local' && 'shadow-none'
          )}
          onClick={() => onModeChange('local')}
          disabled={disabled}
          title='Run all inventory actions through the on-prem agent on this machine (localhost:8765)'
        >
          <Cpu className='h-3.5 w-3.5' />
          Local Agent
        </Button>
        <Button
          type='button'
          size='sm'
          variant={mode === 'fleet' ? 'default' : 'ghost'}
          className={cn(
            'h-7 gap-1.5 rounded-none border-0 border-l px-3 text-xs',
            mode === 'fleet' && 'shadow-none'
          )}
          onClick={() => onModeChange('fleet')}
          disabled={disabled}
          title='Route all inventory actions to a remote fleet agent via the sap_agent_jobs queue'
        >
          <Globe className='h-3.5 w-3.5' />
          Fleet Agent
        </Button>
      </div>

      {/* Mode caption — explains routing in one line */}
      <span className='text-muted-foreground text-xs'>
        {isFleet
          ? 'Inventory actions route through rust-work-service to the picked fleet agent.'
          : 'Inventory actions run on the on-prem agent on this machine.'}
      </span>

      {/* Fleet picker — only when in fleet mode */}
      {isFleet && (
        <>
          <div className='ml-auto flex items-center gap-1.5'>
            <Server className='h-3.5 w-3.5 shrink-0 text-blue-500' />
            <span className='text-muted-foreground text-xs'>Agent:</span>
            <select
              className='border-input bg-background h-7 rounded-md border px-2 text-xs'
              value={fleetAgentId ?? ''}
              onChange={(e) => onFleetAgentChange(e.target.value || null)}
              disabled={disabled || noOnlineAgents}
              aria-label='Pick a fleet agent'
            >
              {noOnlineAgents ? (
                <option value=''>No online agents in your org</option>
              ) : (
                <>
                  {!fleetAgentId && <option value=''>— pick an agent —</option>}
                  {fleetAgents.map((agent) => {
                    const label = agent.hostname || agent.id.slice(0, 8)
                    const ver = agent.version ? ` v${agent.version}` : ''
                    const session = agent.citrix_session
                      ? ` · ${agent.citrix_session}`
                      : ''
                    const capCount = agent.capabilities.length
                    const capMark =
                      activeCapability &&
                      !agent.capabilities.includes(activeCapability)
                        ? ' ⚠'
                        : ''
                    return (
                      <option key={agent.id} value={agent.id}>
                        {label}
                        {ver}
                        {session} · {capCount} caps
                        {capMark}
                      </option>
                    )
                  })}
                </>
              )}
            </select>
          </div>

          {/* Inline warnings — keep them on the same row when there's
              space, drop to a sibling row on narrow viewports. */}
          {(pickedAgentMissingCap || noAgentPicked || noOnlineAgents) && (
            <div className='flex w-full items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/5 px-2 py-1 text-[11px] text-amber-700 dark:text-amber-300'>
              <ShieldAlert className='h-3 w-3 shrink-0' />
              {noOnlineAgents ? (
                <span>
                  No fleet agents are online in your organisation. Switch back
                  to <strong>Local Agent</strong> or wait for a Citrix-hosted
                  agent to come online.
                </span>
              ) : noAgentPicked ? (
                <span>
                  Pick a fleet agent above to enable inventory actions.
                </span>
              ) : pickedAgentMissingCap ? (
                <span>
                  Picked agent doesn't advertise{' '}
                  <code className='rounded bg-amber-500/20 px-1 font-mono'>
                    {activeCapability}
                  </code>{' '}
                  {activeQueryName ? `(needed for ${activeQueryName})` : ''} —
                  pick another agent or switch to Local Agent.
                </span>
              ) : null}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// Created and developed by Jai Singh
