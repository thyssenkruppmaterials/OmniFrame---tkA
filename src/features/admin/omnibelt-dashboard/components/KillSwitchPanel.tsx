// Created and developed by Jai Singh
/**
 * KillSwitchPanel — Overview tile for the org-wide kill switch.
 *
 * Renders the current state (ON / OFF), the source ('env' env-var
 * lock-out / 'org' explicit org row / 'none' default-enabled), and
 * a Switch that posts the new value via `useUpdateKillSwitch`. The
 * env-override case disables the Switch and surfaces a tooltip so
 * the admin understands why the toggle is read-only.
 */
import { IconBolt, IconLock } from '@tabler/icons-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { useUpdateKillSwitch } from '../hooks/useUpdateKillSwitch'
import type { KillSwitchRow } from '../services/omnibelt-admin.service'

interface KillSwitchPanelProps {
  killSwitch: KillSwitchRow
}

export function KillSwitchPanel({ killSwitch }: KillSwitchPanelProps) {
  const { mutate, isPending, error } = useUpdateKillSwitch()
  const envLocked = killSwitch.source === 'env'

  return (
    <Card>
      <CardHeader className='flex flex-row items-start justify-between space-y-0 pb-2'>
        <CardTitle className='flex items-center gap-2 text-base'>
          <IconBolt size={16} aria-hidden /> Master Kill Switch
        </CardTitle>
        <StatusBadge enabled={killSwitch.enabled} envLocked={envLocked} />
      </CardHeader>
      <CardContent className='space-y-3'>
        <div className='flex items-center justify-between gap-4'>
          <div className='space-y-1'>
            <p className='text-muted-foreground text-sm'>
              {killSwitch.enabled
                ? 'OmniBelt is visible to every authenticated user in this org.'
                : 'OmniBelt is hidden org-wide. Individual route exclusions and per-user hides still apply.'}
            </p>
            {envLocked && (
              <p className='text-muted-foreground flex items-center gap-1 text-xs'>
                <IconLock size={12} aria-hidden /> Locked by{' '}
                <code>VITE_OMNIBELT_DISABLED</code> env var — the org-level
                toggle has no effect.
              </p>
            )}
            {killSwitch.updated_at && (
              <p className='text-muted-foreground text-xs'>
                Last changed: {formatTimestamp(killSwitch.updated_at)}
              </p>
            )}
          </div>
          <Switch
            checked={killSwitch.enabled}
            disabled={envLocked || isPending}
            onCheckedChange={(next) => mutate(next)}
            aria-label='Toggle OmniBelt for all users in this organization'
          />
        </div>
        {error && (
          <p className='text-destructive text-xs'>
            {error instanceof Error ? error.message : String(error)}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function StatusBadge({
  enabled,
  envLocked,
}: {
  enabled: boolean
  envLocked: boolean
}) {
  if (envLocked) {
    return (
      <Badge variant='outline' className='border-amber-500/60 text-amber-700'>
        ENV-LOCKED
      </Badge>
    )
  }
  return enabled ? (
    <Badge variant='outline' className='border-emerald-500/50 text-emerald-700'>
      ON
    </Badge>
  ) : (
    <Badge variant='outline' className='border-rose-500/50 text-rose-700'>
      OFF
    </Badge>
  )
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso)
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`
  } catch {
    return iso
  }
}

// Created and developed by Jai Singh
