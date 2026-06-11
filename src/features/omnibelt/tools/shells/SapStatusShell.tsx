// Created and developed by Jai Singh
/**
 * OmniBelt — SAP Status shell (P4)
 *
 * Read-only panel surfacing the local SAP-agent heartbeat + fleet
 * snapshot from `useAgentDetection` (the same hook driving the
 * SmartImportButton subLabel and Agent Triggers UI). The shell
 * deliberately exposes NO mutations — clicking through to
 * `/admin/sap-testing` is the canonical surface for SAP work, and
 * surfacing job buttons here would duplicate auth/error paths.
 *
 * Heartbeat semantics (see `useAgentDetection`):
 *   - `available && authenticated` → green (local agent reachable
 *     and the X-Agent-Token check passed).
 *   - `available && !authenticated` → amber (process up but token
 *     stale; user needs to re-auth in the SAP Testing surface).
 *   - `!available` AND fleet has online agents → amber (local
 *     down but at least one Citrix box can route).
 *   - otherwise → red.
 */
import { useNavigate } from '@tanstack/react-router'
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconExternalLink,
  IconPlugConnected,
  IconPlugX,
  IconX,
} from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import { useAgentDetection } from '@/features/admin/sap-testing/hooks/use-agent-detection'
import type { ToolShellProps } from '../registry'

type StatusTone = 'ok' | 'warn' | 'down'

type Status = {
  tone: StatusTone
  label: string
  detail: string
  icon: typeof IconCircleCheck
}

function deriveStatus(detection: ReturnType<typeof useAgentDetection>): Status {
  if (detection.available && detection.authenticated) {
    return {
      tone: 'ok',
      label: 'Local agent online',
      detail: detection.agentName
        ? `Authenticated as ${detection.agentName}.`
        : 'Authenticated and ready.',
      icon: IconCircleCheck,
    }
  }
  if (detection.available && !detection.authenticated) {
    return {
      tone: 'warn',
      label: 'Token stale',
      detail:
        'Local agent process is up but its X-Agent-Token check is failing — re-auth in SAP Testing.',
      icon: IconAlertTriangle,
    }
  }
  if (detection.fleet.online > 0) {
    return {
      tone: 'warn',
      label: 'Local agent offline',
      detail: `Local process unreachable — ${detection.fleet.online} fleet agent(s) online for routing.`,
      icon: IconAlertTriangle,
    }
  }
  return {
    tone: 'down',
    label: 'No agents reachable',
    detail:
      'Neither the local agent nor any fleet agent is responding. SAP-driven actions will fall back to manual flows.',
    icon: IconPlugX,
  }
}

const TONE_DOT: Record<StatusTone, string> = {
  ok: 'bg-emerald-500',
  warn: 'bg-amber-500',
  down: 'bg-destructive',
}

const TONE_TEXT: Record<StatusTone, string> = {
  ok: 'text-emerald-600 dark:text-emerald-400',
  warn: 'text-amber-600 dark:text-amber-400',
  down: 'text-destructive',
}

function formatStartedAt(iso: string | null | undefined): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return '—'
  const deltaMs = Date.now() - t
  if (deltaMs < 0) return 'just now'
  const seconds = Math.floor(deltaMs / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export default function SapStatusShell({ onClose }: ToolShellProps) {
  const detection = useAgentDetection()
  const navigate = useNavigate()
  const status = deriveStatus(detection)
  const StatusIcon = status.icon
  const startedAtIso = detection.health?.started_at ?? null
  const version = detection.health?.version ?? null

  return (
    <div className='flex flex-col gap-3 text-sm'>
      <header className='flex items-center justify-between'>
        <h2 className='flex items-center gap-2 text-base font-semibold'>
          <IconPlugConnected className='size-4' />
          SAP Status
        </h2>
        <Button
          variant='ghost'
          size='icon'
          aria-label='Close SAP Status'
          onClick={onClose}
        >
          <IconX className='size-4' />
        </Button>
      </header>

      <p className='text-muted-foreground text-xs'>
        Live heartbeat for the local SAP agent and the org's online fleet.
        Read-only — head to SAP Testing to manage jobs.
      </p>

      <div
        className='flex items-start gap-3 rounded-lg border p-3'
        role='status'
        aria-live='polite'
      >
        <span
          className={`mt-1 inline-block size-2.5 shrink-0 rounded-full ${TONE_DOT[status.tone]}`}
          aria-hidden='true'
        />
        <div className='flex flex-1 flex-col gap-1'>
          <div className='flex items-center gap-2'>
            <StatusIcon className={`size-4 ${TONE_TEXT[status.tone]}`} />
            <span className={`text-sm font-medium ${TONE_TEXT[status.tone]}`}>
              {status.label}
            </span>
          </div>
          <p className='text-muted-foreground text-xs'>{status.detail}</p>
        </div>
      </div>

      <dl className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs'>
        <dt className='text-muted-foreground'>Local agent</dt>
        <dd>
          {detection.available
            ? (detection.agentName ?? 'reachable')
            : 'unreachable'}
        </dd>

        {version && (
          <>
            <dt className='text-muted-foreground'>Agent version</dt>
            <dd className='font-mono'>{version}</dd>
          </>
        )}

        {startedAtIso && (
          <>
            <dt className='text-muted-foreground'>Agent started</dt>
            <dd className='font-mono'>{formatStartedAt(startedAtIso)}</dd>
          </>
        )}

        <dt className='text-muted-foreground'>Authenticated</dt>
        <dd>{detection.authenticated ? 'yes' : 'no'}</dd>

        <dt className='text-muted-foreground'>Fleet online</dt>
        <dd>
          {detection.fleet.online} agent
          {detection.fleet.online === 1 ? '' : 's'}
        </dd>
      </dl>

      <Button
        variant='outline'
        size='sm'
        className='justify-between'
        onClick={() => {
          navigate({ to: '/admin/sap-testing' })
          onClose()
        }}
      >
        <span>Open SAP Testing</span>
        <IconExternalLink className='size-3.5' aria-hidden='true' />
      </Button>
    </div>
  )
}

// Created and developed by Jai Singh
