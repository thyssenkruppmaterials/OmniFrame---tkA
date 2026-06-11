// Created and developed by Jai Singh
import { useCallback } from 'react'
import {
  IconAlertTriangle,
  IconBug,
  IconDownload,
  IconInfoCircle,
  IconPlayerPause,
  IconPlayerPlay,
  IconSearch,
  IconTrash,
  IconUrgent,
} from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import type {
  LogKind,
  NormalizedLog,
} from '../../services/railway-monitoring.service'

type Severity = 'error' | 'warn' | 'info' | 'debug'

interface LogToolbarProps {
  logKind: LogKind
  onLogKindChange: (kind: LogKind) => void
  searchText: string
  onSearchTextChange: (text: string) => void
  visibleSeverities: Set<Severity>
  onToggleSeverity: (severity: Severity) => void
  refreshInterval: number | false
  onRefreshIntervalChange: (ms: number | false) => void
  isPaused: boolean
  onTogglePause: () => void
  onClear: () => void
  logs: NormalizedLog[]
  showDeploymentDrillDown?: boolean
}

const SEVERITY_TOGGLES: {
  key: Severity
  label: string
  icon: typeof IconUrgent
  activeClass: string
  inactiveClass: string
}[] = [
  {
    key: 'error',
    label: 'ERR',
    icon: IconUrgent,
    activeClass:
      'bg-red-500/15 text-red-500 border-red-500/30 dark:bg-red-500/20 dark:text-red-400',
    inactiveClass: 'text-muted-foreground',
  },
  {
    key: 'warn',
    label: 'WRN',
    icon: IconAlertTriangle,
    activeClass:
      'bg-amber-500/15 text-amber-600 border-amber-500/30 dark:bg-amber-500/20 dark:text-amber-400',
    inactiveClass: 'text-muted-foreground',
  },
  {
    key: 'info',
    label: 'INF',
    icon: IconInfoCircle,
    activeClass:
      'bg-emerald-500/15 text-emerald-600 border-emerald-500/30 dark:bg-emerald-500/20 dark:text-emerald-400',
    inactiveClass: 'text-muted-foreground',
  },
  {
    key: 'debug',
    label: 'DBG',
    icon: IconBug,
    activeClass: 'bg-muted text-foreground border-border',
    inactiveClass: 'text-muted-foreground',
  },
]

const INTERVAL_OPTIONS = [
  { value: '2000', label: '2s' },
  { value: '5000', label: '5s' },
  { value: '10000', label: '10s' },
  { value: '30000', label: '30s' },
  { value: 'manual', label: 'Manual' },
]

export function LogToolbar({
  logKind,
  onLogKindChange,
  searchText,
  onSearchTextChange,
  visibleSeverities,
  onToggleSeverity,
  refreshInterval,
  onRefreshIntervalChange,
  isPaused,
  onTogglePause,
  onClear,
  logs,
  showDeploymentDrillDown = false,
}: LogToolbarProps) {
  const exportLogs = useCallback(() => {
    const data = JSON.stringify(logs, null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `railway-logs-${new Date().toISOString().slice(0, 19)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [logs])

  return (
    <div className='bg-card flex flex-wrap items-center gap-2 border-b px-3 py-2'>
      {showDeploymentDrillDown && (
        <Select
          value={logKind}
          onValueChange={(v) => onLogKindChange(v as LogKind)}
        >
          <SelectTrigger className='h-7 w-24 max-w-full min-w-0 text-xs'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='runtime'>Runtime</SelectItem>
            <SelectItem value='build'>Build</SelectItem>
            <SelectItem value='http'>HTTP</SelectItem>
          </SelectContent>
        </Select>
      )}

      <div className='flex gap-1'>
        {SEVERITY_TOGGLES.map(({ key, label, activeClass, inactiveClass }) => (
          <button
            key={key}
            onClick={() => onToggleSeverity(key)}
            className={cn(
              'rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors',
              visibleSeverities.has(key)
                ? activeClass
                : `border-transparent bg-transparent ${inactiveClass} opacity-50`
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <Separator orientation='vertical' className='h-5!' />

      <div className='relative min-w-0 flex-1'>
        <IconSearch
          size={13}
          className='text-muted-foreground absolute top-1/2 left-2.5 -translate-y-1/2'
        />
        <Input
          value={searchText}
          onChange={(e) => onSearchTextChange(e.target.value)}
          placeholder='Filter logs...'
          className='h-7 pl-7 text-xs'
        />
      </div>

      <Separator orientation='vertical' className='h-5!' />

      <Select
        value={refreshInterval === false ? 'manual' : String(refreshInterval)}
        onValueChange={(v) =>
          onRefreshIntervalChange(v === 'manual' ? false : Number(v))
        }
      >
        <SelectTrigger className='h-7 w-20 max-w-full min-w-0 text-xs'>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {INTERVAL_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className='flex items-center gap-0.5'>
        <Button
          size='sm'
          variant='ghost'
          className='text-muted-foreground hover:text-foreground h-7 w-7 p-0'
          onClick={onTogglePause}
          title={isPaused ? 'Resume' : 'Pause'}
        >
          {isPaused ? (
            <IconPlayerPlay size={14} />
          ) : (
            <IconPlayerPause size={14} />
          )}
        </Button>
        <Button
          size='sm'
          variant='ghost'
          className='text-muted-foreground hover:text-foreground h-7 w-7 p-0'
          onClick={onClear}
          title='Clear console'
        >
          <IconTrash size={14} />
        </Button>
        <Button
          size='sm'
          variant='ghost'
          className='text-muted-foreground hover:text-foreground h-7 w-7 p-0'
          onClick={exportLogs}
          title='Export logs'
        >
          <IconDownload size={14} />
        </Button>
      </div>
    </div>
  )
}

// Created and developed by Jai Singh
