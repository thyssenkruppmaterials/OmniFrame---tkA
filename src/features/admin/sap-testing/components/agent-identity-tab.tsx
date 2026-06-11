// Created and developed by Jai Singh
/**
 * Phase 10 (`.cursor/plans/rust_work_service_full_integration_5b88165d.plan.md`)
 * — Agent Setup admin tab.
 *
 * Replaces the previous "agent inherits a human user's Supabase
 * session" pattern with first-class service-key identity. Admin
 * registers an agent → server returns a plaintext `omni_sk_*` key
 * ONCE → admin saves it on the agent's Citrix box at
 * `~/.omniframe/agent_service_key.txt` → on next agent boot the
 * agent exchanges the key for a 15-min `kind: "agent"` JWT signed
 * locally by `WORK_SERVICE_AGENT_JWT_SECRET`.
 *
 * Surfaces:
 *
 *   - Active service keys list with `last_used_at`, `created_by`
 *     email, and a Revoke button per row.
 *   - "Register new agent" dialog with `agent_id` (free-text) +
 *     `label` (optional) inputs. On submit, the plaintext key shows
 *     ONCE in a copy-to-clipboard modal with a clear warning.
 *   - "Show revoked keys" toggle for forensic work.
 *
 * See:
 *   - REST client: `@/lib/work-service/agent-identity-client`
 *   - Rust route: `rust-work-service/src/api/routes/agent_identity.rs`
 *   - Decision: `Decisions/ADR-Agent-Identity-V2-Phase10.md`
 *   - Implementation: `Implementations/Implement-Rust-Work-Service-Phase10.md`
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  ClipboardCopy,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  listAgentServiceKeys,
  registerAgentServiceKey,
  revokeAgentServiceKey,
  type RegisterResponse,
  type ServiceKeyListEntry,
} from '@/lib/work-service/agent-identity-client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

/**
 * Render a relative timestamp ("3 minutes ago", "yesterday", …).
 * Pure function; no react import required so it can be tested without
 * the test renderer.
 */
function relativeTime(input: string | null): string {
  if (!input) return 'never'
  const then = new Date(input).getTime()
  if (!Number.isFinite(then)) return 'never'
  const delta = Date.now() - then
  if (delta < 0) return 'in the future'
  const sec = Math.round(delta / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.round(hr / 24)
  if (day < 30) return `${day}d ago`
  const month = Math.round(day / 30)
  if (month < 12) return `${month}mo ago`
  const year = Math.round(month / 12)
  return `${year}y ago`
}

function tooltipUtc(input: string | null): string {
  if (!input) return ''
  return new Date(input).toISOString()
}

// ──────────────────────────────────────────────────────────────────────
// Components
// ──────────────────────────────────────────────────────────────────────

export function AgentIdentityTab() {
  const [keys, setKeys] = useState<ServiceKeyListEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [includeRevoked, setIncludeRevoked] = useState(false)
  const [registerOpen, setRegisterOpen] = useState(false)
  const [revealed, setRevealed] = useState<RegisterResponse | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<ServiceKeyListEntry | null>(
    null
  )

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const rows = await listAgentServiceKeys({ includeRevoked })
      setKeys(rows)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [includeRevoked])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const activeCount = useMemo(
    () => keys.filter((k) => !k.revoked_at).length,
    [keys]
  )
  const revokedCount = useMemo(
    () => keys.filter((k) => k.revoked_at).length,
    [keys]
  )

  return (
    <div className='space-y-6'>
      {/* Header strip */}
      <Card>
        <CardContent className='flex flex-wrap items-center justify-between gap-4 py-5'>
          <div className='flex items-center gap-3'>
            <ShieldCheck className='size-6 text-emerald-600' />
            <div>
              <h3 className='text-lg font-semibold'>Agent Identity v2</h3>
              <p className='text-muted-foreground text-sm'>
                First-class service-key authentication for the OmniFrame on-prem
                agent fleet. Plaintext keys are returned ONCE at registration.
                Saved on disk on the Citrix box at
                <code className='bg-muted mx-1 rounded px-1 py-0.5 text-xs'>
                  ~/.omniframe/agent_service_key.txt
                </code>
                .
              </p>
            </div>
          </div>
          <div className='flex items-center gap-2'>
            <Badge
              variant='outline'
              className='border-emerald-500/40 bg-emerald-50 text-emerald-700 dark:bg-emerald-950'
            >
              {activeCount} active
            </Badge>
            {revokedCount > 0 && (
              <Badge
                variant='outline'
                className='border-amber-500/40 bg-amber-50 text-amber-700 dark:bg-amber-950'
              >
                {revokedCount} revoked
              </Badge>
            )}
            <div className='ml-2 flex items-center gap-2'>
              <Switch
                id='show-revoked'
                checked={includeRevoked}
                onCheckedChange={setIncludeRevoked}
              />
              <Label
                htmlFor='show-revoked'
                className='text-muted-foreground text-sm'
              >
                Show revoked
              </Label>
            </div>
            <Button
              variant='outline'
              size='sm'
              onClick={() => void refresh()}
              disabled={loading}
            >
              <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
              Refresh
            </Button>
            <Button onClick={() => setRegisterOpen(true)}>
              <Plus className='size-4' />
              Register new agent
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Empty / error / table */}
      {error && (
        <Card>
          <CardContent className='flex items-center gap-2 py-4 text-red-600'>
            <AlertCircle className='size-5' />
            <span className='text-sm'>{error}</span>
          </CardContent>
        </Card>
      )}

      {!error && keys.length === 0 && !loading && (
        <Card>
          <CardContent className='flex flex-col items-center gap-3 py-10 text-center'>
            <KeyRound className='text-muted-foreground size-10' />
            <div>
              <h4 className='text-base font-semibold'>No service keys yet</h4>
              <p className='text-muted-foreground mt-1 max-w-md text-sm'>
                Register an agent to mint the first <code>omni_sk_*</code> key.
                The plaintext is shown once — copy it to the target machine,
                then close the dialog.
              </p>
            </div>
            <Button onClick={() => setRegisterOpen(true)}>
              <Plus className='size-4' />
              Register first agent
            </Button>
          </CardContent>
        </Card>
      )}

      {keys.length > 0 && (
        <Card>
          <CardContent className='p-0'>
            <table className='w-full text-sm'>
              <thead className='bg-muted text-muted-foreground text-xs uppercase'>
                <tr>
                  <th className='px-4 py-2 text-left'>Agent</th>
                  <th className='px-4 py-2 text-left'>Key prefix</th>
                  <th className='px-4 py-2 text-left'>Label</th>
                  <th className='px-4 py-2 text-left'>Created</th>
                  <th className='px-4 py-2 text-left'>Last used</th>
                  <th className='px-4 py-2 text-left'>Status</th>
                  <th className='px-4 py-2 text-right'>Actions</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr
                    key={k.key_id}
                    className={cn(
                      'border-t',
                      k.revoked_at && 'bg-muted/40 opacity-60'
                    )}
                  >
                    <td className='px-4 py-2 font-mono text-xs'>
                      {k.agent_id}
                    </td>
                    <td className='px-4 py-2 font-mono text-xs'>
                      <code className='bg-muted rounded px-1 py-0.5'>
                        {k.key_prefix}…
                      </code>
                    </td>
                    <td className='px-4 py-2'>
                      {k.label ?? (
                        <span className='text-muted-foreground italic'>—</span>
                      )}
                    </td>
                    <td className='px-4 py-2' title={tooltipUtc(k.created_at)}>
                      {relativeTime(k.created_at)}
                      {k.created_by_email && (
                        <div className='text-muted-foreground text-xs'>
                          by {k.created_by_email}
                        </div>
                      )}
                    </td>
                    <td
                      className='px-4 py-2'
                      title={tooltipUtc(k.last_used_at)}
                    >
                      {relativeTime(k.last_used_at)}
                    </td>
                    <td className='px-4 py-2'>
                      {k.revoked_at ? (
                        <Badge
                          variant='outline'
                          className='border-amber-500/40 bg-amber-50 text-amber-700'
                        >
                          revoked {relativeTime(k.revoked_at)}
                        </Badge>
                      ) : (
                        <Badge
                          variant='outline'
                          className='border-emerald-500/40 bg-emerald-50 text-emerald-700'
                        >
                          active
                        </Badge>
                      )}
                    </td>
                    <td className='px-4 py-2 text-right'>
                      {!k.revoked_at && (
                        <Button
                          variant='ghost'
                          size='sm'
                          onClick={() => setRevokeTarget(k)}
                        >
                          <Trash2 className='size-4 text-red-600' />
                          Revoke
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <RegisterDialog
        open={registerOpen}
        onClose={() => setRegisterOpen(false)}
        onRegistered={(resp) => {
          setRegisterOpen(false)
          setRevealed(resp)
          void refresh()
        }}
      />

      <RevealKeyDialog revealed={revealed} onClose={() => setRevealed(null)} />

      <RevokeDialog
        target={revokeTarget}
        onClose={() => setRevokeTarget(null)}
        onRevoked={() => {
          setRevokeTarget(null)
          void refresh()
        }}
      />
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Register dialog
// ──────────────────────────────────────────────────────────────────────

interface RegisterDialogProps {
  open: boolean
  onClose: () => void
  onRegistered: (resp: RegisterResponse) => void
}

function RegisterDialog({ open, onClose, onRegistered }: RegisterDialogProps) {
  const [agentId, setAgentId] = useState('')
  const [label, setLabel] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setAgentId('')
      setLabel('')
      setError(null)
      setSubmitting(false)
    }
  }, [open])

  const submit = useCallback(async () => {
    const trimmed = agentId.trim()
    if (!trimmed) {
      setError('agent_id is required')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const resp = await registerAgentServiceKey({
        agent_id: trimmed,
        label: label.trim() || undefined,
      })
      onRegistered(resp)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      setSubmitting(false)
    }
  }, [agentId, label, onRegistered])

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>Register new agent</DialogTitle>
          <DialogDescription>
            Mints a fresh <code>omni_sk_*</code> service key for the agent. The
            plaintext key is shown ONCE — save it before closing the next
            dialog.
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-4'>
          <div className='space-y-1.5'>
            <Label htmlFor='agent-id'>Agent ID</Label>
            <Input
              id='agent-id'
              placeholder='e.g. INDPDC1-Console-aclark'
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              autoComplete='off'
            />
            <p className='text-muted-foreground text-xs'>
              Stable identifier for the Citrix box / Windows user. Mirrors the
              agent's <code>_agent_self_id()</code>{' '}
              (HOSTNAME-SESSIONNAME-USERNAME). Free-text — anything unique
              within the org works.
            </p>
          </div>

          <div className='space-y-1.5'>
            <Label htmlFor='label'>Label (optional)</Label>
            <Textarea
              id='label'
              placeholder='e.g. Citrix OmniBox 01 — Aaron Clark'
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              rows={2}
            />
          </div>

          {error && <div className='text-sm text-red-600'>{error}</div>}
        </div>

        <DialogFooter>
          <Button variant='ghost' onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={submitting}>
            {submitting && <Loader2 className='size-4 animate-spin' />}
            Generate key
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Reveal-key dialog (the ONE-TIME plaintext display)
// ──────────────────────────────────────────────────────────────────────

interface RevealKeyDialogProps {
  revealed: RegisterResponse | null
  onClose: () => void
}

function RevealKeyDialog({ revealed, onClose }: RevealKeyDialogProps) {
  const [copied, setCopied] = useState(false)
  const [confirmed, setConfirmed] = useState(false)

  useEffect(() => {
    if (!revealed) {
      setCopied(false)
      setConfirmed(false)
    }
  }, [revealed])

  const copyKey = useCallback(async () => {
    if (!revealed) return
    try {
      await navigator.clipboard.writeText(revealed.plaintext_key)
      setCopied(true)
      toast.success('Copied to clipboard')
    } catch (e) {
      toast.error(`Copy failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }, [revealed])

  if (!revealed) return null

  return (
    <Dialog open onOpenChange={(o) => !o && confirmed && onClose()}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <ShieldAlert className='size-5 text-amber-600' />
            Save this key now
          </DialogTitle>
          <DialogDescription>
            This is the ONE TIME this plaintext key is shown.{' '}
            <strong className='text-foreground'>We do not store it.</strong> If
            you lose it, you must revoke this key and register the agent again.
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-3'>
          <div className='space-y-1.5'>
            <Label className='text-xs uppercase'>Plaintext key</Label>
            <div className='bg-muted flex items-center gap-2 rounded border p-2 font-mono text-xs break-all'>
              <span className='flex-1'>{revealed.plaintext_key}</span>
              <Button variant='ghost' size='sm' onClick={() => void copyKey()}>
                <ClipboardCopy className='size-4' />
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </div>

          <div className='text-muted-foreground space-y-1 text-sm'>
            <p>Save this key on the agent machine at:</p>
            <code className='bg-muted block rounded px-2 py-1 text-xs'>
              ~/.omniframe/agent_service_key.txt
            </code>
            <p className='pt-2'>
              The agent reads it on boot, exchanges it at{' '}
              <code>POST /api/v1/agent-identity/exchange</code>, and caches the
              resulting 15-minute JWT.
            </p>
          </div>

          <div className='flex items-center gap-2 rounded border border-amber-500/40 bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200'>
            <Switch
              id='confirmed'
              checked={confirmed}
              onCheckedChange={setConfirmed}
            />
            <Label htmlFor='confirmed' className='cursor-pointer'>
              I have saved this key on the target machine.
            </Label>
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={onClose}
            disabled={!confirmed}
            variant={confirmed ? 'default' : 'secondary'}
          >
            <CheckCircle2 className='size-4' />
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Revoke confirmation
// ──────────────────────────────────────────────────────────────────────

interface RevokeDialogProps {
  target: ServiceKeyListEntry | null
  onClose: () => void
  onRevoked: () => void
}

function RevokeDialog({ target, onClose, onRevoked }: RevokeDialogProps) {
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!target) {
      setReason('')
      setSubmitting(false)
      setError(null)
    }
  }, [target])

  const submit = useCallback(async () => {
    if (!target) return
    setSubmitting(true)
    setError(null)
    try {
      await revokeAgentServiceKey({
        key_id: target.key_id,
        reason: reason.trim() || undefined,
      })
      toast.success(`Revoked key for ${target.agent_id}`)
      onRevoked()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      setSubmitting(false)
    }
  }, [target, reason, onRevoked])

  if (!target) return null

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <ShieldAlert className='size-5 text-red-600' />
            Revoke service key
          </DialogTitle>
          <DialogDescription>
            Revoking <code>{target.key_prefix}…</code> for agent{' '}
            <strong>{target.agent_id}</strong> takes effect within ~60 seconds
            (the middleware revocation cache TTL). The agent will fail its next
            call with a 401 and stop draining jobs until a new key is
            registered.
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-3'>
          <div className='space-y-1.5'>
            <Label htmlFor='reason'>Reason (optional)</Label>
            <Textarea
              id='reason'
              placeholder='e.g. Aaron offboarded — laptop wiped 2026-05-07'
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
            />
          </div>

          {error && <div className='text-sm text-red-600'>{error}</div>}
        </div>

        <DialogFooter>
          <Button variant='ghost' onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant='destructive'
            onClick={() => void submit()}
            disabled={submitting}
          >
            {submitting && <Loader2 className='size-4 animate-spin' />}
            Revoke
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Created and developed by Jai Singh
