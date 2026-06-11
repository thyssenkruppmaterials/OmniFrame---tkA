// Created and developed by Jai Singh
/**
 * BroadcastDialog — Tier 2 #3 (2026-05-06).
 *
 * Supervisor "Broadcast to..." dialog. MVP UX:
 *   - Targeting picker: Zone | Role | Specific users.
 *   - Message textarea.
 *   - Optional priority select.
 *   - Submit calls `POST /api/v1/dispatch/broadcast`; the Rust route
 *     resolves the target list server-side (org-scoped — cross-org
 *     IDs silently filtered) and broadcasts an extended PushedWork
 *     event over the existing WS singleton. Recipients see a toast
 *     in `usePushedWork`'s broadcast handler.
 *
 * UX decisions documented for product review:
 *   - Targeting is mutually-exclusive in the UI (one of zone/role/users)
 *     even though the API tolerates combinations. Mixing felt
 *     confusing for an MVP.
 *   - "Specific users" picker is a placeholder textarea — we accept
 *     newline-separated UUIDs because the supervisor surface for
 *     this sprint doesn't have a user-finder primitive yet.
 *     PRODUCT: replace with a real user-search combobox when the
 *     supervisor UI gets a proper rev.
 *   - Zone / role are free-text (tied into the same column shapes
 *     the Rust route resolves against — `worker_heartbeats.current_zone`
 *     and `user_profiles.role::text`). PRODUCT: replace with a
 *     dropdown sourced from existing zone / role catalogues when
 *     this gets product attention.
 */
import { useState } from 'react'
import { Megaphone, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { broadcastDispatch } from '@/lib/work-service/dispatch.client'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'

type TargetMode = 'zone' | 'role' | 'users'

const PRIORITIES = ['critical', 'hot', 'normal', 'low'] as const

interface BroadcastDialogProps {
  /**
   * Optional trigger element. When omitted, the dialog renders its
   * own Megaphone-icon button so callers can drop it into a toolbar
   * without ceremony.
   */
  trigger?: React.ReactNode
  /** Fires after a successful broadcast. */
  onBroadcast?: (info: {
    resolvedUserCount: number
    targetType: string
  }) => void
}

export function BroadcastDialog({
  trigger,
  onBroadcast,
}: BroadcastDialogProps) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<TargetMode>('zone')
  const [zone, setZone] = useState('')
  const [role, setRole] = useState('')
  const [userIdsRaw, setUserIdsRaw] = useState('')
  const [message, setMessage] = useState('')
  const [priority, setPriority] =
    useState<(typeof PRIORITIES)[number]>('normal')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const resetForm = () => {
    setZone('')
    setRole('')
    setUserIdsRaw('')
    setMessage('')
    setPriority('normal')
  }

  const handleSubmit = async () => {
    if (!message.trim()) {
      toast.error('Message is required')
      return
    }

    let target_zone: string | undefined
    let target_role: string | undefined
    let target_user_ids: string[] | undefined

    if (mode === 'zone') {
      if (!zone.trim()) {
        toast.error('Zone is required')
        return
      }
      target_zone = zone.trim()
    } else if (mode === 'role') {
      if (!role.trim()) {
        toast.error('Role is required')
        return
      }
      target_role = role.trim()
    } else {
      const ids = userIdsRaw
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean)
      if (ids.length === 0) {
        toast.error('At least one user_id is required')
        return
      }
      target_user_ids = ids
    }

    setIsSubmitting(true)
    try {
      const res = await broadcastDispatch({
        message: message.trim(),
        priority,
        target_zone,
        target_role,
        target_user_ids,
      })
      toast.success(
        `Broadcast sent — ${res.resolved_user_count} operator${res.resolved_user_count === 1 ? '' : 's'} matched`
      )
      onBroadcast?.({
        resolvedUserCount: res.resolved_user_count,
        targetType: res.target_type,
      })
      setOpen(false)
      resetForm()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Broadcast failed'
      toast.error(`Broadcast failed: ${msg}`)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) resetForm()
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant='outline' size='sm' className='gap-1.5'>
            <Megaphone className='size-3.5' />
            Broadcast
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className='sm:max-w-[480px]'>
        <DialogHeader>
          <DialogTitle>Broadcast to operators</DialogTitle>
          <DialogDescription>
            Send a message to all operators in a zone, with a role, or to a
            specific user list. Recipients see a toast on their next WS event.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={mode} onValueChange={(v) => setMode(v as TargetMode)}>
          <TabsList className='grid w-full grid-cols-3'>
            <TabsTrigger value='zone'>Zone</TabsTrigger>
            <TabsTrigger value='role'>Role</TabsTrigger>
            <TabsTrigger value='users'>Specific users</TabsTrigger>
          </TabsList>
          <TabsContent value='zone' className='space-y-2'>
            <Label htmlFor='broadcast-zone'>Zone</Label>
            <Input
              id='broadcast-zone'
              placeholder='e.g. K1, K2, A-AISLE'
              value={zone}
              onChange={(e) => setZone(e.target.value)}
              autoComplete='off'
            />
            <p className='text-muted-foreground text-[11px]'>
              Resolved against `worker_heartbeats.current_zone` for online
              operators in your org.
            </p>
          </TabsContent>
          <TabsContent value='role' className='space-y-2'>
            <Label htmlFor='broadcast-role'>Role</Label>
            <Input
              id='broadcast-role'
              placeholder='e.g. operator, picker, supervisor'
              value={role}
              onChange={(e) => setRole(e.target.value)}
              autoComplete='off'
            />
            <p className='text-muted-foreground text-[11px]'>
              Resolved against `user_profiles.role` (case-sensitive enum value).
            </p>
          </TabsContent>
          <TabsContent value='users' className='space-y-2'>
            <Label htmlFor='broadcast-user-ids'>User IDs</Label>
            <Textarea
              id='broadcast-user-ids'
              placeholder={
                'One UUID per line, or comma-separated.\n\n550e8400-e29b-41d4-a716-446655440000'
              }
              value={userIdsRaw}
              onChange={(e) => setUserIdsRaw(e.target.value)}
              rows={4}
              className='font-mono text-xs'
            />
            <p className='text-muted-foreground text-[11px]'>
              Cross-org IDs are silently filtered server-side.
            </p>
          </TabsContent>
        </Tabs>

        <div className='space-y-2'>
          <Label htmlFor='broadcast-message'>Message</Label>
          <Textarea
            id='broadcast-message'
            placeholder='e.g. Switch priority to receiving for the next hour'
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
          />
        </div>

        <div className='space-y-2'>
          <Label htmlFor='broadcast-priority'>Priority</Label>
          <Select
            value={priority}
            onValueChange={(v) => setPriority(v as typeof priority)}
          >
            <SelectTrigger id='broadcast-priority' className='w-full'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRIORITIES.map((p) => (
                <SelectItem key={p} value={p} className='capitalize'>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <DialogFooter className='gap-2'>
          <Button
            variant='ghost'
            onClick={() => setOpen(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting && (
              <Loader2 className='mr-1.5 size-3.5 animate-spin' />
            )}
            Send broadcast
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Created and developed by Jai Singh
