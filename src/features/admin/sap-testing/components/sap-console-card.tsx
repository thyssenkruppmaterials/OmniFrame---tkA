// Created and developed by Jai Singh
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download, FileSearch, History, Search, X } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { detectToNumber, openToNumberInToHistory } from '../lib/console-helpers'

// ──────────────────────────────────────────────────────────────────────
// Shared SAP Console
//
// This module owns the persistent rolling console used by both
// Inventory Management and Agent Triggers tabs. New messages stream in
// with a per-character typewriter effect; restored history (older than
// 3s) renders instantly. The console is sticky-to-bottom unless the
// user scrolls up.
// ──────────────────────────────────────────────────────────────────────

export type ConsoleLevel = 'info' | 'success' | 'warning' | 'error'

export interface ConsoleMessage {
  id: string
  timestamp: number
  level: ConsoleLevel
  /** Short tag — e.g. 'LT01', 'LT10', 'LS02N', 'Agent', or trigger name. */
  source: string
  text: string
  /** Optional second line for SAP messages, error details, etc. */
  detail?: string
}

export type PushConsole = (
  msg: Omit<ConsoleMessage, 'id' | 'timestamp'>
) => void

const DEFAULT_MAX_MESSAGES = 200

// ──────────────────────────────────────────────────────────────────────
// useSapConsole — owns the persisted message buffer for a single
// console instance (per `storageKey`).
// ──────────────────────────────────────────────────────────────────────

export interface UseSapConsoleResult {
  messages: ConsoleMessage[]
  push: PushConsole
  clear: () => void
}

export function useSapConsole(
  storageKey: string,
  maxMessages: number = DEFAULT_MAX_MESSAGES
): UseSapConsoleResult {
  const [messages, setMessages] = useState<ConsoleMessage[]>(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      if (!raw) return []
      const parsed = JSON.parse(raw) as ConsoleMessage[]
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  })

  const push = useCallback<PushConsole>(
    (msg) => {
      setMessages((prev) => {
        const entry: ConsoleMessage = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          timestamp: Date.now(),
          ...msg,
        }
        const next = [...prev, entry].slice(-maxMessages)
        try {
          localStorage.setItem(storageKey, JSON.stringify(next))
        } catch {
          /* storage full — drop silently */
        }
        return next
      })
    },
    [storageKey, maxMessages]
  )

  const clear = useCallback(() => {
    setMessages([])
    try {
      localStorage.removeItem(storageKey)
    } catch {
      /* noop */
    }
  }, [storageKey])

  return { messages, push, clear }
}

// ──────────────────────────────────────────────────────────────────────
// Level color tokens
// ──────────────────────────────────────────────────────────────────────

export const LEVEL_CLASSES: Record<
  ConsoleLevel,
  { dot: string; text: string; mark: string }
> = {
  info: { dot: 'bg-zinc-500', text: 'text-zinc-300', mark: 'text-zinc-500' },
  success: {
    dot: 'bg-emerald-500',
    text: 'text-emerald-300',
    mark: 'text-emerald-400',
  },
  warning: {
    dot: 'bg-amber-500',
    text: 'text-amber-300',
    mark: 'text-amber-400',
  },
  error: { dot: 'bg-red-500', text: 'text-red-300', mark: 'text-red-400' },
}

// ──────────────────────────────────────────────────────────────────────
// SapConsoleCard — the actual UI component
// ──────────────────────────────────────────────────────────────────────

export interface SapConsoleCardProps {
  messages: ConsoleMessage[]
  onClear: () => void
  /** Optional title override (defaults to "SAP Console"). */
  title?: string
  /** Optional className applied to the outer Card. Use to override the
   *  default `lg:h-[440px]` height (e.g. `lg:h-full` for a sidebar). */
  className?: string
  /** When set, overrides the default TO-History handoff. Pass a no-op
   *  to disable the inline TO link entirely. */
  onOpenToNumber?: (toNumber: string) => void
  /** Phase 6 (rust-work-service integration plan, 2026-05-07) —
   *  optional agent filter dropdown. When provided, the card renders
   *  a small select that lets the operator narrow the live console
   *  stream to a single fleet agent. The card itself doesn't drive
   *  the WS subscription — `useAgentConsoleStream` does — so the
   *  callbacks here just expose UI state.
   *
   *  - `agents`: list of agent ids (typically
   *    `useAgentDetection().fleet.agents.map(a => a.id)`).
   *  - `selected`: currently-active filter (`null` ⇒ show all).
   *  - `onChange`: invoked with the new filter when the operator
   *    picks a different agent or "All agents".
   *
   *  Omit the prop entirely to render the legacy single-buffer
   *  card without a filter dropdown. */
  agentFilter?: {
    agents: string[]
    selected: string | null
    onChange: (next: string | null) => void
  }
}

export function SapConsoleCard({
  messages,
  onClear,
  title = 'SAP Console',
  className,
  onOpenToNumber = openToNumberInToHistory,
  agentFilter,
}: SapConsoleCardProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)
  const [search, setSearch] = useState('')
  const [levelFilter, setLevelFilter] = useState<Set<ConsoleLevel>>(
    new Set(['info', 'success', 'warning', 'error'])
  )

  const filteredMessages = useMemo(() => {
    const q = search.trim().toLowerCase()
    return messages.filter((m) => {
      if (!levelFilter.has(m.level)) return false
      if (!q) return true
      return (
        m.text.toLowerCase().includes(q) ||
        (m.detail && m.detail.toLowerCase().includes(q)) ||
        m.source.toLowerCase().includes(q)
      )
    })
  }, [messages, search, levelFilter])

  const scrollToBottom = () => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    stickToBottomRef.current = distance < 40
  }

  useEffect(() => {
    if (stickToBottomRef.current) scrollToBottom()
  }, [filteredMessages.length])

  useEffect(() => {
    const content = contentRef.current
    if (!content) return
    const ro = new ResizeObserver(() => {
      if (stickToBottomRef.current) scrollToBottom()
    })
    ro.observe(content)
    return () => ro.disconnect()
  }, [])

  const handleCopyAll = () => {
    if (!filteredMessages.length) return
    const text = filteredMessages
      .map((m) => {
        const t = new Date(m.timestamp).toLocaleString()
        const head = `[${t}] ${m.source} ${m.level.toUpperCase()}: ${m.text}`
        return m.detail ? `${head}\n    ${m.detail}` : head
      })
      .join('\n')
    void navigator.clipboard.writeText(text)
    toast.success('Console copied to clipboard', {
      description: `${filteredMessages.length} message(s)`,
    })
  }

  const handleExportCsv = () => {
    if (!filteredMessages.length) return
    const esc = (v: string) =>
      /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
    const header = 'timestamp,level,source,text,detail'
    const lines = filteredMessages.map((m) =>
      [
        new Date(m.timestamp).toISOString(),
        m.level,
        m.source,
        esc(m.text),
        esc(m.detail ?? ''),
      ].join(',')
    )
    const csv = [header, ...lines].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `sap-console-${Date.now()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const toggleLevel = (lvl: ConsoleLevel) => {
    setLevelFilter((prev) => {
      const next = new Set(prev)
      if (next.has(lvl)) next.delete(lvl)
      else next.add(lvl)
      // Never let the user filter out everything.
      if (next.size === 0)
        return new Set(['info', 'success', 'warning', 'error'])
      return next
    })
  }

  return (
    <Card
      className={cn(
        'flex min-h-0 flex-col overflow-hidden lg:h-[440px]',
        className
      )}
    >
      <CardHeader className='flex flex-col items-stretch space-y-2 pb-2'>
        <div className='flex flex-row items-center justify-between'>
          <CardTitle className='flex items-center gap-2 text-base'>
            <FileSearch className='h-4 w-4' />
            {title}
            <Badge variant='secondary' className='font-mono text-xs'>
              {filteredMessages.length}
              {filteredMessages.length !== messages.length &&
                `/${messages.length}`}
            </Badge>
          </CardTitle>
          <div className='flex items-center gap-1'>
            <Button
              variant='ghost'
              size='sm'
              className='h-7 px-2 text-xs'
              onClick={handleCopyAll}
              disabled={filteredMessages.length === 0}
              title='Copy all messages'
            >
              <Download className='mr-1 h-3 w-3' />
              Copy
            </Button>
            <Button
              variant='ghost'
              size='sm'
              className='h-7 px-2 text-xs'
              onClick={handleExportCsv}
              disabled={filteredMessages.length === 0}
              title='Export visible messages as CSV'
            >
              <Download className='mr-1 h-3 w-3' />
              CSV
            </Button>
            <Button
              variant='ghost'
              size='sm'
              className='h-7 px-2 text-xs'
              onClick={onClear}
              disabled={messages.length === 0}
              title='Clear console'
            >
              <X className='mr-1 h-3 w-3' />
              Clear
            </Button>
          </div>
        </div>
        <div className='flex flex-wrap items-center gap-1.5'>
          <div className='relative min-w-[160px] flex-1'>
            <Search className='text-muted-foreground absolute top-1/2 left-2 h-3 w-3 -translate-y-1/2' />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder='Search console…'
              className='h-7 pl-7 text-[11px]'
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className='text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2'
                aria-label='Clear search'
              >
                <X className='h-3 w-3' />
              </button>
            )}
          </div>
          {agentFilter && agentFilter.agents.length > 0 && (
            // Phase 6 — agent filter dropdown. Native <select> instead
            // of shadcn's Select primitive to keep the card self-
            // contained (the rest of the row uses native controls
            // too — search Input, toggle buttons). Empty string
            // sentinel maps to "All agents" because <select>'s value
            // attribute can't be `null`.
            <select
              value={agentFilter.selected ?? ''}
              onChange={(e) => agentFilter.onChange(e.target.value || null)}
              className='border-input bg-background text-muted-foreground h-7 rounded-md border px-1.5 text-[10px] tracking-wide uppercase focus:ring-1 focus:outline-none'
              title='Filter live console by agent'
            >
              <option value=''>All agents</option>
              {agentFilter.agents.map((agentId) => (
                <option key={agentId} value={agentId}>
                  {/* Show the leading hostname segment for legibility. */}
                  {agentId.split('-')[0] || agentId}
                </option>
              ))}
            </select>
          )}
          {(['info', 'success', 'warning', 'error'] as ConsoleLevel[]).map(
            (lvl) => {
              const active = levelFilter.has(lvl)
              const colors = LEVEL_CLASSES[lvl]
              return (
                <button
                  key={lvl}
                  onClick={() => toggleLevel(lvl)}
                  className={cn(
                    'flex h-7 items-center gap-1 rounded-md border px-2 text-[10px] tracking-wide uppercase',
                    active
                      ? `${colors.text} border-current/40 bg-current/5`
                      : 'border-input text-muted-foreground opacity-50'
                  )}
                >
                  <span
                    className={cn(
                      'inline-block h-1.5 w-1.5 rounded-full',
                      colors.dot
                    )}
                  />
                  {lvl}
                </button>
              )
            }
          )}
        </div>
      </CardHeader>
      <CardContent className='min-h-0 flex-1 px-3 pb-3'>
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className='h-full overflow-y-auto rounded-lg border border-zinc-800/40 bg-zinc-950/40 px-3 py-2 font-mono text-[11px] leading-relaxed text-zinc-300 shadow-inner dark:border-zinc-800/60 dark:bg-black/40'
        >
          <div ref={contentRef}>
            {filteredMessages.length === 0 ? (
              <div className='text-muted-foreground py-6 text-center text-xs'>
                {messages.length === 0
                  ? 'No messages yet. Run a query or trigger an SAP action to see live output here.'
                  : 'No messages match the current filter.'}
              </div>
            ) : (
              filteredMessages.map((m) => (
                <ConsoleLine
                  key={m.id}
                  message={m}
                  onOpenToNumber={onOpenToNumber}
                />
              ))
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ──────────────────────────────────────────────────────────────────────
// ConsoleLine — single row with typewriter text and TO-link affordance
// ──────────────────────────────────────────────────────────────────────

export function ConsoleLine({
  message,
  onOpenToNumber,
}: {
  message: ConsoleMessage
  onOpenToNumber?: (toNumber: string) => void
}) {
  const time = new Date(message.timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const cls = LEVEL_CLASSES[message.level]
  // Anything older than 3 seconds is restored history — render instantly
  // so users don't watch their localStorage rewind on every page load.
  const instant = Date.now() - message.timestamp > 3000
  const toNumber = onOpenToNumber ? detectToNumber(message.text) : null

  const borderClass: Record<ConsoleLevel, string> = {
    info: 'border-l-zinc-700',
    success: 'border-l-emerald-500/70',
    warning: 'border-l-amber-500/70',
    error: 'border-l-red-500/70',
  }

  return (
    <div
      className={cn(
        'border-b border-l-2 border-zinc-800/60 py-1 pl-1.5 last:border-b-0',
        borderClass[message.level]
      )}
    >
      <div className='flex items-center gap-1.5'>
        <span
          className={cn('inline-block h-1.5 w-1.5 rounded-full', cls.dot)}
        />
        <span className='text-zinc-500'>{time}</span>
        <span className='text-cyan-400'>{message.source}</span>
        <span className={cls.mark}>›</span>
        <span className={cn('flex-1', cls.text)}>
          <TypewriterText text={message.text} instant={instant} />
        </span>
        {toNumber && onOpenToNumber && (
          <button
            onClick={() => onOpenToNumber(toNumber)}
            className='ml-1 flex items-center gap-0.5 rounded border border-cyan-500/40 px-1 text-[9px] text-cyan-400 uppercase hover:bg-cyan-500/10'
            title={`Open TO ${toNumber} in TO History`}
          >
            <History className='h-2.5 w-2.5' />
            TO {toNumber}
          </button>
        )}
      </div>
      {message.detail && (
        <div className='mt-0.5 ml-4 text-zinc-500'>
          <TypewriterText text={message.detail} instant={instant} speed={4} />
        </div>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────
// TypewriterText — per-character animation; instant when restoring.
// ──────────────────────────────────────────────────────────────────────

export function TypewriterText({
  text,
  instant = false,
  speed,
}: {
  text: string
  instant?: boolean
  speed?: number
}) {
  const [shown, setShown] = useState(instant ? text : '')

  useEffect(() => {
    if (instant) {
      setShown(text)
      return
    }
    if (!text) return
    // Aim for ~600ms total, faster for very long strings, with a floor.
    const computedSpeed = speed ?? Math.max(2, Math.min(20, 600 / text.length))
    let i = 0
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const tick = () => {
      if (cancelled) return
      i += 1
      setShown(text.slice(0, i))
      if (i < text.length) {
        timer = setTimeout(tick, computedSpeed)
      }
    }
    timer = setTimeout(tick, computedSpeed)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
    // We deliberately do not depend on `text` mutating mid-flight; each
    // ConsoleMessage is keyed by id so a new text means a fresh mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <span>{shown}</span>
}

// Created and developed by Jai Singh
