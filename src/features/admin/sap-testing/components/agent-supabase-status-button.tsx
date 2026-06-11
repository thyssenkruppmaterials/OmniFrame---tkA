// Created and developed by Jai Singh
/**
 * AgentSupabaseStatusButton — single shared "Connect Account" pill.
 *
 * Used in:
 *   - AgentHealthCard header (Inventory Management tab)
 *   - InventoryManagementTab status bar
 *   - AgentTriggersTab status bar
 *   - OutboundDataManager (next to SmartImportButton)
 *
 * Behaviour
 * ---------
 * - Polls `GET /supabase/session` every 30s plus on mount, on dialog
 *   close, and immediately after a successful login/logout.
 * - When the agent isn't reachable, hides itself (caller already shows
 *   an "agent offline" CTA elsewhere — no point double-prompting).
 * - When the agent IS reachable but has no Supabase session: renders
 *   a yellow "Connect Account" CTA opening AgentSupabaseLoginDialog.
 * - When already signed in: renders a compact green "Signed in as
 *   <email>" pill with a click-to-disconnect affordance.
 *
 * Why a shared component
 * ----------------------
 * Without this, each tab would re-implement the same poll loop +
 * dialog wiring and they'd drift out of sync (one tab showing "signed
 * in", another still showing "not signed in" until its own poller
 * fires). Centralising the poll keeps the UX consistent.
 */
import { useCallback, useEffect, useState } from 'react'
import { ShieldAlert, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useAgentDetection } from '../hooks/use-agent-detection'
import { agentFetch } from '../lib/agent-fetch'
import {
  AgentSupabaseLoginDialog,
  type AgentSupabaseSession,
} from './agent-supabase-login-dialog'

const POLL_INTERVAL_MS = 30_000

interface AgentSupabaseStatusButtonProps {
  /** Tighten/loosen the visual size. `compact` is used in card headers,
   *  default fits inline next to other buttons in a status bar. */
  size?: 'default' | 'compact'
  className?: string
  /** Hide entirely if the agent isn't reachable (default true). The
   *  outbound data manager passes false so the CTA stays visible while
   *  the user is still launching the EXE. */
  hideWhenAgentMissing?: boolean
}

export function AgentSupabaseStatusButton({
  size = 'default',
  className,
  hideWhenAgentMissing = true,
}: AgentSupabaseStatusButtonProps) {
  const detection = useAgentDetection()
  const [session, setSession] = useState<AgentSupabaseSession | null>(null)
  const [open, setOpen] = useState(false)

  const refresh = useCallback(async () => {
    if (!detection.available) {
      setSession(null)
      return
    }
    try {
      const res = await agentFetch('/supabase/session', {
        signal: AbortSignal.timeout(2000),
        cache: 'no-store',
      })
      if (res.ok) {
        const data = (await res.json()) as AgentSupabaseSession
        setSession(data)
      } else if (res.status === 404) {
        // Agent is older than 1.6.2 — endpoint doesn't exist. Fall back
        // to the pre-existing /status endpoint which has logged_in info.
        const statusRes = await agentFetch('/status', {
          signal: AbortSignal.timeout(2000),
        })
        if (statusRes.ok) {
          const s = await statusRes.json()
          setSession({
            ok: true,
            logged_in: !!s.supabase_logged_in,
            email: s.user_email || null,
            user_id: null,
            org_id: null,
          })
        }
      }
    } catch {
      /* keep last known */
    }
  }, [detection.available])

  useEffect(() => {
    void refresh()
    const t = setInterval(refresh, POLL_INTERVAL_MS)
    return () => clearInterval(t)
  }, [refresh])

  if (hideWhenAgentMissing && !detection.available) {
    return null
  }

  const isCompact = size === 'compact'
  // v1.7.2 — `useAgentDetection().authenticated` is the authoritative
  // signal: it polls /agent-token/check (auth-required) AND listens
  // for the `omniframe:agent-token-stale` event fired by `agentFetch`
  // on any 401. When the agent is reachable but the JWT has expired
  // (the v1.7.1-and-earlier `/supabase/session` endpoint kept saying
  // "logged in" as long as `state.supabase_token` was a non-empty
  // string, regardless of whether the JWT had expired), the pill
  // would have read "Signed in / Disconnect" while every authenticated
  // RPC was 401-ing. v1.7.2 forces "Reconnect Account" copy in that
  // case so the user knows the right next action. The agent-side
  // /supabase/session was also fixed in v1.7.2 to check expiry, but
  // we keep the frontend-side gate so older agents (1.7.1 and below)
  // also surface the correct CTA when their token expires in-process.
  const isReachableButStale = detection.available && !detection.authenticated
  const sessionLoggedIn = !!session?.logged_in
  // The /supabase/session endpoint can also return reason='expired' on
  // v1.7.2+ agents — treat that the same as a stale-token scenario.
  const sessionExpired =
    !!session &&
    session.logged_in === false &&
    (session as { reason?: string }).reason === 'expired'
  const isLoggedIn = sessionLoggedIn && !isReachableButStale && !sessionExpired
  const isReconnect = isReachableButStale || sessionExpired
  const email = session?.email ?? null

  return (
    <>
      <Button
        variant='outline'
        size={isCompact ? 'sm' : 'sm'}
        className={cn(
          isCompact ? 'h-7 px-2 text-xs' : 'h-8 text-xs',
          isLoggedIn
            ? 'border-emerald-500/50 text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400'
            : isReconnect
              ? 'border-yellow-500/70 bg-yellow-500/10 text-yellow-800 hover:bg-yellow-500/20 dark:text-yellow-300'
              : 'border-amber-500/60 text-amber-700 hover:bg-amber-500/10 dark:text-amber-400',
          className
        )}
        onClick={(e) => {
          e.stopPropagation()
          setOpen(true)
        }}
        title={
          isLoggedIn
            ? `Signed in as ${email ?? 'unknown'} — click to disconnect`
            : isReconnect
              ? `Agent session expired (JWT no longer valid) — click to reconnect${email ? ` as ${email}` : ''}`
              : 'Click to connect this agent to your OmniFrame account'
        }
      >
        {isLoggedIn ? (
          <>
            <ShieldCheck
              className={cn('mr-1', isCompact ? 'h-3 w-3' : 'h-3.5 w-3.5')}
            />
            <span className='max-w-[160px] truncate'>
              {email ?? 'Signed in'}
            </span>
          </>
        ) : isReconnect ? (
          <>
            <ShieldAlert
              className={cn('mr-1', isCompact ? 'h-3 w-3' : 'h-3.5 w-3.5')}
            />
            Reconnect Account
          </>
        ) : (
          <>
            <ShieldAlert
              className={cn('mr-1', isCompact ? 'h-3 w-3' : 'h-3.5 w-3.5')}
            />
            Connect Account
          </>
        )}
      </Button>

      <AgentSupabaseLoginDialog
        open={open}
        onOpenChange={setOpen}
        initialSession={session}
        onSessionChanged={() => {
          void refresh()
        }}
      />
    </>
  )
}

// Created and developed by Jai Singh
