// Created and developed by Jai Singh
/**
 * SapSessionPicker (v1.7.9)
 * ────────────────────────────────────────────────────────────────────
 * Compact dropdown that lets the user dedicate ONE specific SAP GUI
 * session to the OmniFrame agent so manual SAP work in OTHER sessions
 * (different system / client / user) doesn't get hijacked by the
 * agent's auto-select. Backs the two new agent endpoints:
 *
 *   POST /sap/select-session  → pin (captures system/client/user as
 *                                durable identity so SAP renumbering
 *                                across launches doesn't break the pin)
 *   POST /sap/unpin-session   → clear pin, return to auto-select
 *
 * The pin survives EXE rebuild + restart because the agent persists
 * `pinned_session` to %APPDATA%\OmniFrameAgent\config.json. Older
 * agents (≤1.7.8) won't advertise the `sap-session-pinning` capability,
 * in which case this component is hidden by the parent (the legacy
 * inline `<select>` keeps working for one-off session swaps).
 *
 * UI shape (matches the v1.7.9 spec):
 *   - Pinned   → 🔒 SYS/CLT/USER ▾  (lock icon, env-coloured pill)
 *   - Auto     → Auto: SYS/CLT/USER ▾  (open lock, neutral pill)
 *   - Disconnected → "No SAP session" (greyed out, not interactive)
 *
 * Dropdown content:
 *   - One row per available SAP session showing system / client / user
 *     + active transaction code. Currently-pinned row gets a check.
 *   - Footer "Unpin (return to auto-select)" when something is pinned.
 *
 * Used in both `inventory-management-tab.tsx` and `agent-triggers-tab.tsx`
 * so the operator sees the same picker no matter which SAP Testing tab
 * they're on.
 */
import { Check, ChevronDown, Lock, Unlock } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { agentFetch } from '../lib/agent-fetch'

// ──────────────────────────────────────────────────────────────────────
// Types — mirror the v1.7.9 `/sap/sessions` response shape
// ──────────────────────────────────────────────────────────────────────

export interface SapSessionEntry {
  index: number
  label: string
  /** v1.7.9 — identity fields used by the env-pill renderer + the
   *  pinned-row checkmark. Older agent payloads omit these (the
   *  picker still renders the row by `label`). */
  system?: string
  client?: string
  user?: string
  transaction?: string
  pinned?: boolean
  is_active?: boolean
}

export interface SapConnectionEntry {
  index: number
  label: string
  sessions: SapSessionEntry[]
}

export interface PinnedSessionCriteria {
  conn_idx: number
  sess_idx: number
  system: string
  client: string
  user: string
  /** v1.8.1 — SAP transaction active at pin time. Optional — agents
   *  ≤1.8.0 never recorded this field. Today it's purely informational
   *  (the /sap/sessions winner selector picks deterministically by
   *  enumeration order when pin_by_criteria matches multiple sessions);
   *  future disambiguation logic can use it as a tiebreaker. */
  transaction?: string
  pinned_at: string
  by_criteria: boolean
}

export interface SapSessionsPayload {
  ok: boolean
  error?: string
  connections: SapConnectionEntry[]
  selected_conn: number
  selected_sess: number
  /** v1.7.9 — top-level echo so the picker can show the pinned
   *  criteria even when the underlying SAP session isn't currently
   *  visible (e.g. user closed it before the picker re-fetched). */
  pinned_session?: PinnedSessionCriteria | null
}

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

/** Compact identity slug used inside the pill. Falls back gracefully
 *  when any of the three fields is empty (older agent / mid-attach). */
function identitySlug(system?: string, client?: string, user?: string): string {
  const parts = [system, client, user].filter((p): p is string =>
    Boolean(p && p.trim())
  )
  return parts.join('/')
}

/** Env-tint mirroring the existing pill in `inventory-management-tab.tsx`
 *  + `agent-triggers-tab.tsx` (PRD red, QA amber, DEV/TST green,
 *  otherwise blue). Centralising here keeps the env colour story
 *  consistent across the picker, banners, and the SAP-system pill. */
function envClassFor(system: string | undefined): string {
  const sys = (system ?? '').toUpperCase()
  if (/PRD|PROD/.test(sys))
    return 'border-red-500/60 bg-red-500/10 text-red-700 dark:text-red-400'
  if (/QAS|QA\b/.test(sys))
    return 'border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-400'
  if (/DEV|TST|TEST/.test(sys))
    return 'border-emerald-500/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
  return 'border-blue-500/40 bg-blue-500/5 text-blue-700 dark:text-blue-400'
}

interface FlatSession extends SapSessionEntry {
  connIdx: number
  connLabel: string
}

function flattenSessions(payload: SapSessionsPayload | null): FlatSession[] {
  if (!payload?.connections) return []
  const out: FlatSession[] = []
  for (const c of payload.connections) {
    for (const s of c.sessions) {
      out.push({ ...s, connIdx: c.index, connLabel: c.label })
    }
  }
  return out
}

// ──────────────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────────────

export interface SapSessionPickerProps {
  /** Whatever the parent has from its last `/sap/sessions` call. May be
   *  null while the agent is missing or mid-attach. */
  sessions: SapSessionsPayload | null
  /** Called after a successful pin / unpin so the parent can re-fetch
   *  `/sap/sessions` (fresh active flag) and `/health` (fresh
   *  `sap_connected`). The parent decides whether to also refresh
   *  agent detection. */
  onChanged: () => void | Promise<void>
  /** Optional className applied to the trigger pill so the parent can
   *  align it with surrounding elements. */
  className?: string
}

export function SapSessionPicker({
  sessions,
  onChanged,
  className,
}: SapSessionPickerProps) {
  const flatSessions = flattenSessions(sessions)
  const pinned = sessions?.pinned_session ?? null

  // Currently-attached session (whatever the agent is using right now).
  // When pinned + healthy this matches the pinned criteria; when
  // unpinned this is whatever auto-select last picked.
  const activeSession =
    flatSessions.find((s) => s.is_active) ??
    (sessions
      ? flatSessions.find(
          (s) =>
            s.connIdx === sessions.selected_conn &&
            s.index === sessions.selected_sess
        )
      : undefined)

  // Display identity — prefer the live active session (most accurate),
  // fall back to the pinned criteria (so the pill still renders if the
  // pinned session is currently invisible / mid-attach).
  const displaySys = activeSession?.system || pinned?.system || ''
  const displayClient = activeSession?.client || pinned?.client || ''
  const displayUser = activeSession?.user || pinned?.user || ''
  const slug = identitySlug(displaySys, displayClient, displayUser)
  const envClass = envClassFor(displaySys)

  const noSessions = flatSessions.length === 0

  async function pinTo(connIdx: number, sessIdx: number) {
    try {
      const res = await agentFetch('/sap/select-session', {
        method: 'POST',
        body: JSON.stringify({
          conn_idx: connIdx,
          sess_idx: sessIdx,
          pin_by_criteria: true,
        }),
      })
      const data = (await res.json()) as {
        ok: boolean
        error?: string
        pinned?: PinnedSessionCriteria
      }
      if (!data.ok) {
        toast.error('Could not pin SAP session', {
          description: data.error ?? 'Unknown error',
        })
        return
      }
      const slug2 = identitySlug(
        data.pinned?.system,
        data.pinned?.client,
        data.pinned?.user
      )
      toast.success('SAP session pinned', {
        description: slug2
          ? `Agent will only attach to ${slug2}.`
          : 'Agent will only attach to the selected SAP session.',
      })
      await onChanged()
    } catch (e) {
      toast.error('Pin request failed', {
        description: e instanceof Error ? e.message : 'Unknown error',
      })
    }
  }

  async function unpin() {
    try {
      const res = await agentFetch('/sap/unpin-session', { method: 'POST' })
      const data = (await res.json()) as { ok: boolean; error?: string }
      if (!data.ok) {
        toast.error('Could not unpin SAP session', {
          description: data.error ?? 'Unknown error',
        })
        return
      }
      toast.success('SAP session unpinned', {
        description: 'Agent will auto-select the first usable session.',
      })
      await onChanged()
    } catch (e) {
      toast.error('Unpin request failed', {
        description: e instanceof Error ? e.message : 'Unknown error',
      })
    }
  }

  // Disabled state — no agent session reachable yet. Render a static
  // pill so the layout doesn't jump when sessions arrive.
  if (noSessions && !pinned) {
    return (
      <div
        className={cn(
          'text-muted-foreground inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs',
          className
        )}
        title='No SAP sessions detected by the agent yet'
      >
        <Unlock className='h-3 w-3' />
        <span className='font-mono'>No SAP session</span>
      </div>
    )
  }

  const triggerLabel = slug || (pinned ? 'pinned' : 'auto')

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size='sm'
          variant='outline'
          className={cn(
            'h-7 gap-1.5 border px-2.5 text-xs font-medium',
            pinned ? envClass : 'border-input bg-background',
            className
          )}
          title={
            pinned
              ? `Pinned to ${slug || 'a SAP session'} — agent will not attach to any other session. Click to switch or unpin.`
              : 'Auto-select mode — agent attaches to the first usable SAP session. Click to pin a specific session.'
          }
        >
          {pinned ? (
            <Lock className='h-3 w-3' />
          ) : (
            <Unlock className='h-3 w-3 opacity-70' />
          )}
          <span className='font-mono tracking-wide uppercase'>
            {pinned ? triggerLabel : `Auto: ${triggerLabel}`}
          </span>
          <ChevronDown className='h-3 w-3 opacity-70' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='w-80'>
        <DropdownMenuLabel className='text-[10px] font-semibold tracking-widest uppercase'>
          {pinned ? 'Pinned session' : 'SAP sessions'}
        </DropdownMenuLabel>

        {/* Pinned-but-not-visible callout. Renders when the pin's
            criteria don't match any currently-enumerated session — e.g.
            the user closed the SAP window or hasn't logged into the
            pinned system yet. The agent stays disconnected in this
            state per the v1.7.9 spec. */}
        {pinned && !flatSessions.some((s) => s.pinned) && (
          <div className='mx-1 mb-1 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs'>
            <div className='font-semibold text-amber-700 dark:text-amber-400'>
              Pinned session not currently available
            </div>
            <div className='text-muted-foreground mt-0.5'>
              Looking for{' '}
              <span className='font-mono'>
                {identitySlug(pinned.system, pinned.client, pinned.user)}
              </span>
              . Open it in SAP Logon or unpin to resume auto-select.
            </div>
          </div>
        )}

        {flatSessions.length === 0 && (
          <div className='text-muted-foreground px-2 py-2 text-xs'>
            No SAP sessions detected.
          </div>
        )}

        {flatSessions.map((s) => {
          const sessSlug = identitySlug(s.system, s.client, s.user)
          // v1.8.1 — surface the transaction code + connection label as
          // the primary visual disambiguator when multiple sessions
          // share the same (system, client, user). Examples after
          // this change for a user with 6 SAP windows on PRD/800/U8206556:
          //   tx=LT10             · 1.1.0 PRD ERP Production
          //   tx=SESSION_MANAGER  · 1.1.0 PRD ERP Production
          //   tx=ZV20             · 1.1.0 PRD ERP Production
          // Previously the subtitle dropped the TX when it was empty
          // which also dropped the TX when it was actually meaningful.
          const txLabel = s.transaction ? `tx=${s.transaction}` : 'tx=—'
          const subtitle = [txLabel, s.connLabel].filter(Boolean).join(' · ')
          // v1.8.1 — collapse ACTIVE + PINNED into a single right-aligned
          // pill per row so the "PINNED · PINNED" double-badge artifact
          // the user screenshotted can't recur. Precedence:
          //   pinned + active → "PINNED · ACTIVE"
          //   pinned only     → "PINNED"
          //   active only     → "ACTIVE"
          //   neither         → no pill
          let statusLabel: string | null = null
          let statusPillClass = ''
          if (s.pinned && s.is_active) {
            statusLabel = 'PINNED · ACTIVE'
            statusPillClass =
              'border-emerald-500/50 text-emerald-600 dark:text-emerald-400'
          } else if (s.pinned) {
            statusLabel = 'PINNED'
            statusPillClass =
              'border-blue-500/50 text-blue-600 dark:text-blue-400'
          } else if (s.is_active) {
            statusLabel = 'ACTIVE'
            statusPillClass =
              'border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
          }
          return (
            <DropdownMenuItem
              key={`${s.connIdx}:${s.index}`}
              onSelect={(e) => {
                e.preventDefault()
                if (s.pinned) return
                void pinTo(s.connIdx, s.index)
              }}
              className='flex items-start gap-2 text-xs'
            >
              <div className='flex h-4 w-4 shrink-0 items-center justify-center'>
                {s.pinned ? (
                  <Check className='h-3.5 w-3.5 text-emerald-500' />
                ) : null}
              </div>
              <div className='min-w-0 flex-1'>
                <div className='flex items-center gap-1.5'>
                  <span className='font-mono font-semibold'>
                    {sessSlug || s.label}
                  </span>
                  {statusLabel && (
                    <span
                      className={cn(
                        'ml-auto shrink-0 rounded border px-1 text-[9px] font-semibold tracking-wide uppercase',
                        statusPillClass
                      )}
                    >
                      {statusLabel}
                    </span>
                  )}
                </div>
                {subtitle && (
                  <div className='text-muted-foreground truncate text-[10px]'>
                    {subtitle}
                  </div>
                )}
              </div>
            </DropdownMenuItem>
          )
        })}

        {pinned && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault()
                void unpin()
              }}
              className='text-xs text-amber-600 dark:text-amber-400'
            >
              <Unlock className='mr-2 h-3.5 w-3.5' />
              Unpin (return to auto-select)
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// Created and developed by Jai Singh
