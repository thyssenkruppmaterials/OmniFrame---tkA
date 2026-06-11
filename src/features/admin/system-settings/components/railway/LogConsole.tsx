// Created and developed by Jai Singh
import { useCallback, useEffect, useRef, useState } from 'react'
import { IconArrowDown, IconCopy } from '@tabler/icons-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import type { NormalizedLog } from '../../services/railway-monitoring.service'

interface LogConsoleProps {
  logs: NormalizedLog[]
  isLoading: boolean
  showServiceName?: boolean
}

const SEVERITY_ROW: Record<string, string> = {
  error:
    'text-red-400 bg-red-500/10 border-l-2 border-l-red-500 dark:bg-red-500/8',
  warn: 'text-amber-500 bg-amber-500/8 border-l-2 border-l-amber-500 dark:text-amber-400',
  info: 'text-emerald-600 dark:text-emerald-400',
  debug: 'text-muted-foreground opacity-70',
}

const SEVERITY_LABEL: Record<string, string> = {
  error: 'text-red-500 font-semibold dark:text-red-400',
  warn: 'text-amber-600 font-medium dark:text-amber-400',
  info: 'text-emerald-600 dark:text-emerald-400',
  debug: 'text-muted-foreground',
}

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts)
    const base = d.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    const ms = String(d.getMilliseconds()).padStart(3, '0')
    return `${base}.${ms}`
  } catch {
    return ts
  }
}

export function LogConsole({
  logs,
  isLoading,
  showServiceName = true,
}: LogConsoleProps) {
  const parentRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const prevLengthRef = useRef(logs.length)

  const virtualizer = useVirtualizer({
    count: logs.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 24,
    overscan: 40,
  })

  const scrollToBottom = useCallback(() => {
    if (logs.length > 0) {
      virtualizer.scrollToIndex(logs.length - 1, { align: 'end' })
    }
  }, [logs.length, virtualizer])

  useEffect(() => {
    if (autoScroll && logs.length > prevLengthRef.current) {
      scrollToBottom()
    }
    prevLengthRef.current = logs.length
  }, [logs.length, autoScroll, scrollToBottom])

  const handleScroll = useCallback(() => {
    const el = parentRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    setAutoScroll(atBottom)
  }, [])

  const copyLine = useCallback((log: NormalizedLog) => {
    const text = `[${log.timestamp}] [${log.severity.toUpperCase()}] ${log.service_name ? `[${log.service_name}] ` : ''}${log.message}`
    navigator.clipboard.writeText(text)
    toast.success('Copied to clipboard')
  }, [])

  return (
    <div className='relative flex h-full flex-col'>
      <div
        ref={parentRef}
        onScroll={handleScroll}
        className='flex-1 overflow-auto bg-[#0a0a0f] font-mono text-xs leading-relaxed dark:bg-[#09090b]'
      >
        {isLoading && logs.length === 0 && (
          <div className='text-muted-foreground flex h-full items-center justify-center'>
            <div className='flex flex-col items-center gap-2'>
              <div className='h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent' />
              <span>Connecting to Railway...</span>
            </div>
          </div>
        )}
        {!isLoading && logs.length === 0 && (
          <div className='text-muted-foreground flex h-full items-center justify-center'>
            No logs available. Select a service or check the Railway API token
            configuration.
          </div>
        )}
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            position: 'relative',
            width: '100%',
          }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const log = logs[virtualRow.index]
            return (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                className={cn(
                  'group flex items-start gap-2 px-3 py-0.5 hover:bg-white/3',
                  SEVERITY_ROW[log.severity] || ''
                )}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <span className='shrink-0 text-white/30'>
                  {formatTimestamp(log.timestamp)}
                </span>
                <span
                  className={cn(
                    'w-10 shrink-0 text-right text-[10px] uppercase',
                    SEVERITY_LABEL[log.severity] || ''
                  )}
                >
                  {log.severity === 'error'
                    ? 'ERR'
                    : log.severity === 'warn'
                      ? 'WRN'
                      : log.severity === 'debug'
                        ? 'DBG'
                        : 'INF'}
                </span>
                {showServiceName && log.service_name && (
                  <span className='shrink-0 text-blue-400/60'>
                    [{log.service_name}]
                  </span>
                )}
                <span className='min-w-0 flex-1 break-all whitespace-pre-wrap text-white/80'>
                  {log.message}
                </span>
                <button
                  onClick={() => copyLine(log)}
                  className='shrink-0 text-white/20 opacity-0 transition-opacity group-hover:opacity-100'
                  title='Copy line'
                >
                  <IconCopy size={12} />
                </button>
              </div>
            )
          })}
        </div>
      </div>

      {!autoScroll && (
        <Button
          size='sm'
          variant='secondary'
          className='absolute right-4 bottom-4 gap-1 shadow-lg'
          onClick={() => {
            scrollToBottom()
            setAutoScroll(true)
          }}
        >
          <IconArrowDown size={14} />
          Latest
        </Button>
      )}

      <div className='absolute top-2 right-3 rounded-md bg-black/60 px-2 py-0.5 text-[10px] text-white/40 backdrop-blur-sm'>
        {logs.length.toLocaleString()} lines
      </div>
    </div>
  )
}

// Created and developed by Jai Singh
