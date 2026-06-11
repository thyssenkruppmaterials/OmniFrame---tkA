// Created and developed by Jai Singh
/**
 * AgentSupabaseLoginDialog — first-class UI replacement for the
 * `curl -X POST http://127.0.0.1:8765/supabase/login` flow.
 *
 * Why this exists
 * ---------------
 * The agent's `/supabase/login` endpoint has shipped since v1.4.0 but
 * had no corresponding call site in the frontend — users had to open
 * a terminal and copy/paste curl commands to mint the per-session
 * `agent_token` that the trigger runtime + queue poller depend on.
 *
 * Behaviour
 * ---------
 * - Hydrates `url` + `key` from the same env vars as the web app's
 *   Supabase client (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`).
 *   These are PUBLIC values — safe to ship to the agent.
 * - On submit, POSTs to `/supabase/login`. On success: stores the
 *   returned `agent_token`, fires a refresh of the shared agent
 *   detection cache, toasts "Agent connected as <email>", closes.
 * - On failure: surfaces `data.error` inline; the dialog stays open
 *   so the user can correct typos without losing form state.
 * - When already logged in (queried via `/supabase/session`), shows
 *   a "Disconnect" button that POSTs `/supabase/logout` and clears
 *   the local agent_token.
 */
import { useEffect, useState } from 'react'
import { Loader2, LogIn, LogOut, ShieldCheck, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { refreshAgentDetection } from '../hooks/use-agent-detection'
import { agentFetch, setAgentToken } from '../lib/agent-fetch'

export interface AgentSupabaseSession {
  ok: boolean
  logged_in: boolean
  email: string | null
  user_id: string | null
  org_id: string | null
  /** v1.7.2 — surfaced by the agent when `state.supabase_token` exists
   *  but `state.token_expires_at` is in the past. Status button uses
   *  this to render "Reconnect Account" instead of "Connect Account".
   *  Older agents (1.7.1 and below) never set this. */
  reason?: 'expired'
  /** v1.7.2 — epoch seconds (matches Python `time.time()`). Present
   *  when `reason === 'expired'`. Diagnostic only. */
  expires_at?: number
}

interface AgentSupabaseLoginDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Current session as last polled by the parent button (avoids a flash
   *  of "not signed in" while the dialog re-fetches). */
  initialSession?: AgentSupabaseSession | null
  /** Fired after a successful login OR logout so the parent can
   *  re-poll `/supabase/session` and update its label immediately. */
  onSessionChanged?: () => void
}

export function AgentSupabaseLoginDialog({
  open,
  onOpenChange,
  initialSession,
  onSessionChanged,
}: AgentSupabaseLoginDialogProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? ''
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''
  const envOk = !!(supabaseUrl && supabaseAnonKey)

  const isLoggedIn = !!initialSession?.logged_in
  const currentEmail = initialSession?.email ?? null

  useEffect(() => {
    if (!open) {
      setPassword('')
      setError(null)
    }
  }, [open])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!envOk) {
      setError(
        'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in this build.'
      )
      return
    }
    if (!email.trim() || !password) {
      setError('Email and password are required.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await agentFetch('/supabase/login', {
        method: 'POST',
        body: JSON.stringify({
          url: supabaseUrl,
          key: supabaseAnonKey,
          email: email.trim(),
          password,
        }),
      })
      const data = await res.json()
      if (!data?.ok) {
        setError(data?.error || `Login failed (HTTP ${res.status}).`)
        return
      }
      if (data.agent_token) {
        setAgentToken(data.agent_token)
      }
      toast.success(`Agent connected as ${data.email || email}`)
      void refreshAgentDetection()
      onSessionChanged?.()
      onOpenChange(false)
    } catch (err) {
      setError(
        err instanceof Error
          ? `Could not reach agent: ${err.message}`
          : 'Could not reach agent. Is OmniFrame_Agent.exe running?'
      )
    } finally {
      setBusy(false)
    }
  }

  const handleLogout = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await agentFetch('/supabase/logout', { method: 'POST' })
      const data = await res.json()
      if (!data?.ok) {
        setError(data?.error || `Logout failed (HTTP ${res.status}).`)
        return
      }
      setAgentToken(null)
      toast.success('Agent disconnected.')
      void refreshAgentDetection()
      onSessionChanged?.()
      onOpenChange(false)
    } catch (err) {
      setError(
        err instanceof Error
          ? `Could not reach agent: ${err.message}`
          : 'Could not reach agent.'
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className='sm:max-w-[440px]' showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <ShieldCheck className='h-5 w-5 text-emerald-500' />
            Connect Agent to OmniFrame
          </DialogTitle>
          <DialogDescription>
            Authenticate the on-prem SAP agent with your OmniFrame account so it
            can write audit logs, claim queued jobs, and react to triggers.
          </DialogDescription>
        </DialogHeader>

        {isLoggedIn ? (
          <div className='space-y-3'>
            <div className='flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm'>
              <ShieldCheck className='h-4 w-4 shrink-0 text-emerald-500' />
              <div className='min-w-0 flex-1'>
                <div className='font-medium'>Signed in</div>
                <div className='text-muted-foreground truncate font-mono text-xs'>
                  {currentEmail ?? '(unknown email)'}
                </div>
              </div>
            </div>
            {error && (
              <div className='flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/5 p-2 text-xs text-red-700 dark:text-red-400'>
                <XCircle className='mt-0.5 h-3 w-3 shrink-0' />
                {error}
              </div>
            )}
            <DialogFooter>
              <Button
                variant='outline'
                onClick={() => onOpenChange(false)}
                disabled={busy}
              >
                Close
              </Button>
              <Button
                variant='destructive'
                onClick={handleLogout}
                disabled={busy}
              >
                {busy ? (
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                ) : (
                  <LogOut className='mr-2 h-4 w-4' />
                )}
                Disconnect
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleLogin} className='space-y-3'>
            {!envOk && (
              <div className='rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-amber-700 dark:text-amber-400'>
                Web app is missing <code>VITE_SUPABASE_URL</code> /{' '}
                <code>VITE_SUPABASE_ANON_KEY</code>. Fix your{' '}
                <code>.env.local</code> and rebuild.
              </div>
            )}
            <div className='space-y-1.5'>
              <Label htmlFor='agent-supabase-email' className='text-xs'>
                Email
              </Label>
              <Input
                id='agent-supabase-email'
                type='email'
                autoComplete='username'
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder='you@company.com'
                disabled={busy}
              />
            </div>
            <div className='space-y-1.5'>
              <Label htmlFor='agent-supabase-password' className='text-xs'>
                Password
              </Label>
              <Input
                id='agent-supabase-password'
                type='password'
                autoComplete='current-password'
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder='Your OmniFrame password'
                disabled={busy}
              />
            </div>
            {error && (
              <div className='flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/5 p-2 text-xs text-red-700 dark:text-red-400'>
                <XCircle className='mt-0.5 h-3 w-3 shrink-0' />
                <span className='wrap-break-word'>{error}</span>
              </div>
            )}
            <p className='text-muted-foreground text-[10px]'>
              Credentials are sent only to <code>http://127.0.0.1:8765</code> on
              this machine — never to OmniFrame's cloud. The agent uses them to
              mint a Supabase JWT it stores locally.
            </p>
            <DialogFooter>
              <Button
                type='button'
                variant='outline'
                onClick={() => onOpenChange(false)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button type='submit' disabled={busy || !envOk}>
                {busy ? (
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                ) : (
                  <LogIn className='mr-2 h-4 w-4' />
                )}
                Connect
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

// Created and developed by Jai Singh
