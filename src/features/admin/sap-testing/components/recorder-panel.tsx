// Created and developed by Jai Singh
/**
 * Phase D #12 — Self-Recording Mode UI (v1.5.0).
 *
 * Lives inside the Inventory Management tab as a new "Recorder" section
 * (opened via the new `tools` category in QUERY_LIBRARY). One-click
 * Record → perform in SAP → Stop → get a draft Python handler.
 *
 * Architecture notes:
 *   - All capture happens on the local agent. Nothing is uploaded.
 *   - The translator runs on the agent too (cheap, deterministic, and
 *     keeps recording payloads off the network).
 *   - Recordings list is read from the agent's encrypted store; the meta
 *     sidecar is plaintext so the list renders without decrypting blobs.
 *   - Replay is opt-in (sends X-Recording-Allow-Replay: yes only after
 *     the user confirms).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Code2,
  Copy,
  Download,
  FileCode2,
  Lightbulb,
  Lock,
  PlayCircle,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Square,
  StopCircle,
  Trash2,
  Video,
  XCircle,
  Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  type AgentHealth,
  hasCapability,
  // v1.7.2 — recommend the latest version in user-facing copy. The
  // minimum-required floor (1.4.0) is unchanged for compat checks but
  // the upgrade prompt should point at what we actually want shipped.
  LATEST_AGENT_VERSION,
} from '../lib/agent-fetch'
import {
  confidenceLabel,
  deleteRecording,
  downloadTextFile,
  formatDurationMs,
  getRecording,
  getRecordingStatus,
  type InputOverride,
  listRecordings,
  type RecordingDetail,
  type RecordingEvent,
  type RecordingKind,
  type RecordingLiveStatus,
  type RecordingMeta,
  type RecordingTranslateResponse,
  replayRecording,
  startRecording,
  stopRecording,
  translateRecording,
} from '../lib/recorder'
import { logSapAudit } from '../lib/sap-audit'

// ─────────────────────────────────────────────────────────────────────────
// Public component
// ─────────────────────────────────────────────────────────────────────────

interface RecorderPanelProps {
  agentHealth: AgentHealth | null
  agentConnected: boolean
  agentVersion?: string
}

export function RecorderPanel({
  agentHealth,
  agentConnected,
  agentVersion,
}: RecorderPanelProps) {
  const supported = hasCapability(agentHealth, 'recording-start')

  const [mode, setMode] = useState<'hooks' | 'polling'>('hooks')
  const [recordingName, setRecordingName] = useState('')
  const [live, setLive] = useState<RecordingLiveStatus | null>(null)
  const [items, setItems] = useState<RecordingMeta[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<RecordingDetail | null>(null)
  const [busy, setBusy] = useState<
    null | 'starting' | 'stopping' | 'deleting' | 'loading' | 'replaying'
  >(null)
  const [translation, setTranslation] = useState<
    | (RecordingTranslateResponse & { _name: string; _kind: RecordingKind })
    | null
  >(null)
  const [translateOpen, setTranslateOpen] = useState(false)
  const [replayConfirm, setReplayConfirm] = useState<RecordingMeta | null>(null)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const refreshList = useCallback(async () => {
    if (!agentConnected || !supported) return
    try {
      const res = await listRecordings({ limit: 50 })
      if (res.ok) setItems(res.items)
    } catch {
      /* ignore */
    }
  }, [agentConnected, supported])

  const refreshLive = useCallback(async () => {
    if (!agentConnected || !supported) {
      setLive(null)
      return
    }
    try {
      const res = await getRecordingStatus()
      setLive(res)
    } catch {
      setLive(null)
    }
  }, [agentConnected, supported])

  // Initial load + periodic refresh
  useEffect(() => {
    void refreshLive()
    void refreshList()
  }, [refreshLive, refreshList])

  // Poll live status while recording
  useEffect(() => {
    if (!live?.active) {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
      return
    }
    pollRef.current = setInterval(() => {
      void refreshLive()
    }, 1000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [live?.active, refreshLive])

  const onStart = useCallback(async () => {
    setBusy('starting')
    try {
      const res = await startRecording({
        name: recordingName || undefined,
        mode,
      })
      if (!res.ok) {
        toast.error('Could not start recording', { description: res.error })
        return
      }
      toast.success('Recording started', {
        description: `mode: ${res.mode_used} · go perform the SAP transaction now`,
      })
      void logSapAudit({
        transactionCode: 'RECORDER',
        action: 'recording_start',
        status: 'success',
        payload: {
          recording_id: res.recording_id,
          mode_used: res.mode_used,
        },
        agentVersion: agentVersion ?? null,
      })
      await refreshLive()
      await refreshList()
    } catch (e) {
      toast.error('Recording start failed', {
        description: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setBusy(null)
    }
  }, [agentVersion, mode, recordingName, refreshList, refreshLive])

  const onStop = useCallback(async () => {
    setBusy('stopping')
    try {
      const res = await stopRecording()
      if (!res.ok) {
        toast.error('Could not stop recording', { description: res.error })
        return
      }
      toast.success(`Recording saved — ${res.event_count ?? 0} events`, {
        description: res.transactions?.length
          ? `transactions: ${res.transactions.join(', ')}`
          : undefined,
      })
      void logSapAudit({
        transactionCode: 'RECORDER',
        action: 'recording_stop',
        status: res.status === 'partial' ? 'warning' : 'success',
        payload: {
          recording_id: res.recording_id,
          event_count: res.event_count,
          transactions: res.transactions,
        },
        agentVersion: agentVersion ?? null,
      })
      await refreshLive()
      await refreshList()
      if (res.recording_id) {
        setSelectedId(res.recording_id)
      }
    } catch (e) {
      toast.error('Recording stop failed', {
        description: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setBusy(null)
    }
  }, [agentVersion, refreshList, refreshLive])

  // Load detail when selectedId changes
  useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      return
    }
    setBusy('loading')
    void (async () => {
      try {
        const res = await getRecording(selectedId)
        if (res.ok && res.recording) setDetail(res.recording)
        else {
          toast.error('Could not load recording', { description: res.error })
          setDetail(null)
        }
      } finally {
        setBusy(null)
      }
    })()
  }, [selectedId])

  const onDelete = useCallback(
    async (id: string) => {
      setBusy('deleting')
      try {
        const res = await deleteRecording(id)
        if (!res.ok) {
          toast.error('Could not delete recording', { description: res.error })
          return
        }
        toast.success('Recording deleted')
        if (selectedId === id) setSelectedId(null)
        await refreshList()
      } finally {
        setBusy(null)
      }
    },
    [refreshList, selectedId]
  )

  const onTranslate = useCallback(
    async (
      rec: RecordingDetail,
      args: {
        name: string
        kind: RecordingKind
        overrides: Record<string, InputOverride>
      }
    ) => {
      try {
        const res = await translateRecording(rec.id, {
          name: args.name,
          kind: args.kind,
          input_overrides: args.overrides,
        })
        if (!res.ok) {
          toast.error('Translation failed', { description: res.error })
          return
        }
        setTranslation({ ...res, _name: args.name, _kind: args.kind })
        setTranslateOpen(true)
        void logSapAudit({
          transactionCode: 'RECORDER',
          action: 'recording_translate',
          status: 'success',
          payload: {
            recording_id: rec.id,
            name: args.name,
            kind: args.kind,
            confidence: res.confidence,
            warnings: res.warnings,
          },
          agentVersion: agentVersion ?? null,
        })
      } catch (e) {
        toast.error('Translation error', {
          description: e instanceof Error ? e.message : String(e),
        })
      }
    },
    [agentVersion]
  )

  const onReplayConfirmed = useCallback(
    async (rec: RecordingMeta) => {
      setBusy('replaying')
      setReplayConfirm(null)
      try {
        const res = await replayRecording(rec.id)
        if (!res.ok) {
          toast.error('Replay failed', {
            description:
              res.error ??
              `${res.errors_at_step?.length ?? 0} step error(s) at step ${
                res.errors_at_step?.[0]?.step ?? '?'
              }`,
          })
        } else {
          toast.success(
            `Replay completed — ${res.steps_executed} steps executed`
          )
        }
        void logSapAudit({
          transactionCode: 'RECORDER',
          action: 'recording_replay',
          status: res.ok ? 'success' : 'error',
          payload: {
            recording_id: rec.id,
            steps_executed: res.steps_executed,
            errors_at_step: res.errors_at_step,
          },
          agentVersion: agentVersion ?? null,
        })
      } catch (e) {
        toast.error('Replay error', {
          description: e instanceof Error ? e.message : String(e),
        })
      } finally {
        setBusy(null)
      }
    },
    [agentVersion]
  )

  // ── Render ──
  if (!agentConnected) {
    return (
      <Card className='border-amber-500/40'>
        <CardContent className='flex items-center gap-3 py-4'>
          <ShieldAlert className='h-5 w-5 text-amber-500' />
          <div className='text-sm'>
            Start the SAP Agent to use the Recorder.
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!supported) {
    return (
      <Card className='border-amber-500/60 bg-amber-500/5'>
        <CardContent className='flex items-center gap-3 py-4'>
          <ShieldAlert className='h-5 w-5 text-amber-600' />
          <div className='text-sm'>
            Recording requires <span className='font-mono'>v1.5.0+</span>. Your
            agent reports{' '}
            <span className='font-mono'>v{agentVersion ?? '?'}</span>{' '}
            (capability <span className='font-mono'>recording-start</span>{' '}
            missing). Update the agent to enable the recorder.
            <div className='text-muted-foreground mt-1 text-xs'>
              Recommended agent: v{LATEST_AGENT_VERSION}.
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className='space-y-4'>
      {/* Privacy banner */}
      <Card className='border-blue-500/40 bg-blue-500/5'>
        <CardContent className='flex items-start gap-3 py-3 text-xs'>
          <Lock className='mt-0.5 h-4 w-4 shrink-0 text-blue-500' />
          <div>
            <span className='font-semibold'>
              Recordings stay on this machine.
            </span>{' '}
            Captured field values (material numbers, bin IDs, customer codes)
            are encrypted at rest with a key derived from your agent token +
            machine name. The browser only sees what you explicitly translate
            and view. Recordings auto-purge after 30 days.
          </div>
        </CardContent>
      </Card>

      <RecorderControls
        live={live}
        mode={mode}
        onModeChange={setMode}
        recordingName={recordingName}
        onNameChange={setRecordingName}
        onStart={onStart}
        onStop={onStop}
        busy={busy}
      />

      <div className='grid gap-4 lg:grid-cols-[340px_1fr]'>
        <RecordingsList
          items={items}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onDelete={onDelete}
          onRefresh={refreshList}
          onReplay={(rec) => setReplayConfirm(rec)}
          busy={busy}
        />
        <RecordingDetailView
          rec={detail}
          loading={busy === 'loading'}
          onTranslate={onTranslate}
          onDelete={onDelete}
          onReplay={(rec) => setReplayConfirm(rec)}
        />
      </div>

      {/* Translation result modal */}
      <TranslationDialog
        open={translateOpen}
        onOpenChange={setTranslateOpen}
        translation={translation}
      />

      {/* Replay confirm modal */}
      <Dialog
        open={replayConfirm !== null}
        onOpenChange={(o) => {
          if (!o) setReplayConfirm(null)
        }}
      >
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle className='flex items-center gap-2'>
              <ShieldAlert className='h-5 w-5 text-amber-500' />
              Replay in Live SAP Session?
            </DialogTitle>
            <DialogDescription>
              This will execute every captured action against your currently
              connected SAP session — including any Save (commit) presses.
              <br />
              <br />
              Recording:{' '}
              <span className='font-mono font-semibold'>
                {replayConfirm?.name}
              </span>
              <br />
              Transactions:{' '}
              <span className='font-mono'>
                {replayConfirm?.transactions?.join(', ') || '—'}
              </span>
              <br />
              Events:{' '}
              <span className='font-mono'>
                {replayConfirm?.event_count ?? 0}
              </span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant='outline' onClick={() => setReplayConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant='destructive'
              onClick={() =>
                replayConfirm && void onReplayConfirmed(replayConfirm)
              }
              disabled={busy === 'replaying'}
            >
              <PlayCircle className='mr-2 h-4 w-4' />
              Yes, replay {replayConfirm?.event_count ?? 0} events
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// RecorderControls — big record/stop button + mode picker
// ─────────────────────────────────────────────────────────────────────────

function RecorderControls({
  live,
  mode,
  onModeChange,
  recordingName,
  onNameChange,
  onStart,
  onStop,
  busy,
}: {
  live: RecordingLiveStatus | null
  mode: 'hooks' | 'polling'
  onModeChange: (m: 'hooks' | 'polling') => void
  recordingName: string
  onNameChange: (s: string) => void
  onStart: () => void
  onStop: () => void
  busy: string | null
}) {
  const isActive = Boolean(live?.active)
  const elapsed = formatDurationMs(live?.duration_ms)

  return (
    <Card
      className={cn(
        'border-2',
        isActive
          ? 'animate-pulse border-red-500/70 bg-red-500/5'
          : 'border-border'
      )}
    >
      <CardContent className='flex flex-wrap items-center gap-4 py-5'>
        <button
          onClick={isActive ? onStop : onStart}
          disabled={Boolean(busy)}
          className={cn(
            'group relative flex h-16 w-16 items-center justify-center rounded-full border-2 transition-all',
            isActive
              ? 'border-red-500 bg-red-500/10 hover:bg-red-500/20'
              : 'border-emerald-500/60 bg-emerald-500/5 hover:bg-emerald-500/10',
            busy && 'opacity-60'
          )}
          aria-label={isActive ? 'Stop recording' : 'Start recording'}
        >
          {isActive ? (
            <Square className='h-6 w-6 fill-red-500 text-red-500' />
          ) : (
            <div className='h-7 w-7 rounded-full bg-red-500 transition-transform group-hover:scale-110' />
          )}
        </button>
        <div className='flex-1 space-y-2'>
          <div className='flex items-center gap-2'>
            <Video className='text-muted-foreground h-4 w-4' />
            <span className='text-sm font-semibold'>
              {isActive ? 'Recording…' : 'Ready to record'}
            </span>
            {isActive && (
              <Badge
                variant='outline'
                className='border-red-500/60 bg-red-500/10 font-mono text-xs text-red-700 dark:text-red-400'
              >
                {elapsed} · {live?.event_count ?? 0} events
              </Badge>
            )}
            {isActive && live?.transactions?.length ? (
              <Badge variant='secondary' className='font-mono text-xs'>
                {live.transactions.join(' → ')}
              </Badge>
            ) : null}
            {isActive && live?.mode_used && (
              <Badge variant='outline' className='font-mono text-[10px]'>
                {live.mode_used}
              </Badge>
            )}
          </div>
          <div className='flex flex-wrap items-center gap-2'>
            <Input
              value={recordingName}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder='Recording name (optional)'
              disabled={isActive || Boolean(busy)}
              className='h-8 max-w-[280px] text-xs'
            />
            <Label className='text-muted-foreground text-xs'>
              Capture mode:
            </Label>
            <select
              className='border-input bg-background h-8 rounded-md border px-2 text-xs'
              value={mode}
              onChange={(e) =>
                onModeChange(e.target.value as 'hooks' | 'polling')
              }
              disabled={isActive || Boolean(busy)}
            >
              <option value='hooks'>Hooks (preferred)</option>
              <option value='polling'>Polling (fallback)</option>
            </select>
            {isActive ? (
              <Button
                onClick={onStop}
                variant='destructive'
                size='sm'
                disabled={Boolean(busy)}
              >
                <StopCircle className='mr-2 h-4 w-4' />
                Stop & Save
              </Button>
            ) : (
              <Button onClick={onStart} size='sm' disabled={Boolean(busy)}>
                <Video className='mr-2 h-4 w-4' />
                Start Recording
              </Button>
            )}
          </div>
          <div className='text-muted-foreground text-xs'>
            <Lightbulb className='mr-1 inline h-3 w-3' />
            Tip: hooks mode subscribes to SAP COM events; polling diffs the GUI
            tree every 200ms. Both run together when hooks are available — the
            recorder picks whichever the agent reports as <em>mode_used</em>.
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// RecordingsList
// ─────────────────────────────────────────────────────────────────────────

function RecordingsList({
  items,
  selectedId,
  onSelect,
  onDelete,
  onRefresh,
  onReplay,
  busy,
}: {
  items: RecordingMeta[] | null
  selectedId: string | null
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onRefresh: () => void
  onReplay: (rec: RecordingMeta) => void
  busy: string | null
}) {
  return (
    <Card className='flex h-[520px] min-h-0 flex-col overflow-hidden'>
      <CardHeader className='flex-row items-center justify-between space-y-0 pb-2'>
        <CardTitle className='flex items-center gap-2 text-base'>
          <FileCode2 className='h-4 w-4' />
          Recordings
          {items && (
            <Badge variant='outline' className='font-mono text-xs'>
              {items.length}
            </Badge>
          )}
        </CardTitle>
        <Button
          size='sm'
          variant='ghost'
          onClick={onRefresh}
          disabled={Boolean(busy)}
        >
          <RefreshCw className='h-3 w-3' />
        </Button>
      </CardHeader>
      <CardContent className='min-h-0 flex-1 overflow-y-auto p-2'>
        {items === null ? (
          <div className='text-muted-foreground py-10 text-center text-xs'>
            Loading…
          </div>
        ) : items.length === 0 ? (
          <div className='text-muted-foreground py-10 text-center text-xs'>
            No recordings yet. Hit the big red button to capture your first SAP
            transaction.
          </div>
        ) : (
          <div className='space-y-1'>
            {items.map((rec) => (
              <RecordingListItem
                key={rec.id}
                rec={rec}
                selected={rec.id === selectedId}
                onSelect={() => onSelect(rec.id)}
                onDelete={() => onDelete(rec.id)}
                onReplay={() => onReplay(rec)}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function RecordingListItem({
  rec,
  selected,
  onSelect,
  onDelete,
  onReplay,
}: {
  rec: RecordingMeta
  selected: boolean
  onSelect: () => void
  onDelete: () => void
  onReplay: () => void
}) {
  const statusColor = (() => {
    if (rec.status === 'stopped')
      return 'border-emerald-500/40 text-emerald-700 dark:text-emerald-400'
    if (rec.status === 'partial')
      return 'border-amber-500/50 text-amber-700 dark:text-amber-400'
    if (rec.status === 'recording')
      return 'border-red-500/60 text-red-700 dark:text-red-400 animate-pulse'
    return 'border-zinc-400/40 text-zinc-600 dark:text-zinc-400'
  })()
  return (
    <div
      className={cn(
        'group hover:bg-accent rounded-md border px-3 py-2 transition-colors',
        selected ? 'bg-accent border-primary/50' : 'border-transparent'
      )}
    >
      <button onClick={onSelect} className='w-full text-left'>
        <div className='flex items-start gap-2'>
          <ChevronRight
            className={cn(
              'mt-0.5 h-3 w-3 shrink-0 transition-transform',
              selected && 'text-primary rotate-90'
            )}
          />
          <div className='min-w-0 flex-1'>
            <div className='flex flex-wrap items-center gap-1'>
              <span className='truncate text-sm font-medium'>{rec.name}</span>
              <Badge
                variant='outline'
                className={cn('font-mono text-[10px]', statusColor)}
              >
                {rec.status}
              </Badge>
            </div>
            <div className='text-muted-foreground mt-0.5 flex flex-wrap items-center gap-1 text-[11px]'>
              <span>
                {new Date(rec.started_at).toLocaleString(undefined, {
                  dateStyle: 'short',
                  timeStyle: 'short',
                })}
              </span>
              <span>·</span>
              <span>{rec.event_count ?? 0} ev</span>
              <span>·</span>
              <span>{formatDurationMs(rec.duration_ms)}</span>
              {rec.transactions?.length ? (
                <>
                  <span>·</span>
                  <span className='font-mono'>
                    {rec.transactions.join(',')}
                  </span>
                </>
              ) : null}
            </div>
          </div>
        </div>
      </button>
      <div className='mt-1 flex justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100'>
        <Button
          size='sm'
          variant='ghost'
          className='h-6 px-2 text-xs'
          onClick={(e) => {
            e.stopPropagation()
            onReplay()
          }}
          title='Replay against live SAP'
        >
          <Zap className='mr-1 h-3 w-3' />
          Replay
        </Button>
        <Button
          size='sm'
          variant='ghost'
          className='hover:bg-destructive/20 hover:text-destructive h-6 px-2 text-xs'
          onClick={(e) => {
            e.stopPropagation()
            if (confirm(`Delete "${rec.name}"? This cannot be undone.`)) {
              onDelete()
            }
          }}
          title='Delete recording'
        >
          <Trash2 className='h-3 w-3' />
        </Button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// RecordingDetailView — events timeline + variable mapping + translate
// ─────────────────────────────────────────────────────────────────────────

function RecordingDetailView({
  rec,
  loading,
  onTranslate,
  onDelete,
  onReplay,
}: {
  rec: RecordingDetail | null
  loading: boolean
  onTranslate: (
    rec: RecordingDetail,
    args: {
      name: string
      kind: RecordingKind
      overrides: Record<string, InputOverride>
    }
  ) => void
  onDelete: (id: string) => void
  onReplay: (rec: RecordingMeta) => void
}) {
  const [eventSearch, setEventSearch] = useState('')
  const [handlerName, setHandlerName] = useState('')
  const [kind, setKind] = useState<RecordingKind>('mutation')
  const [overrides, setOverrides] = useState<Record<string, InputOverride>>({})

  // Reset edit state when the selection changes
  useEffect(() => {
    if (rec) {
      const tx = (rec.transactions?.[0] ?? '').toLowerCase()
      setHandlerName(tx ? `${tx}_action` : '')
      setKind(detectKindHeuristic(rec))
      setOverrides({})
      setEventSearch('')
    }
  }, [rec?.id])

  const filteredEvents = useMemo(() => {
    if (!rec) return []
    const q = eventSearch.trim().toLowerCase()
    if (!q) return rec.events
    return rec.events.filter((e) => JSON.stringify(e).toLowerCase().includes(q))
  }, [rec, eventSearch])

  const inputCandidates = useMemo(() => {
    if (!rec) return []
    return collectInputCandidates(rec.events)
  }, [rec])

  if (!rec) {
    return (
      <Card className='flex h-[520px] items-center justify-center'>
        <div className='text-muted-foreground space-y-2 text-center text-sm'>
          <FileCode2 className='mx-auto h-8 w-8 opacity-30' />
          <div>
            {loading
              ? 'Loading…'
              : 'Select a recording from the list to view its events.'}
          </div>
        </div>
      </Card>
    )
  }

  return (
    <Card className='flex h-[520px] min-h-0 flex-col overflow-hidden'>
      <CardHeader className='flex-row items-start justify-between gap-2 space-y-0 pb-2'>
        <div className='min-w-0 flex-1'>
          <CardTitle className='flex flex-wrap items-center gap-2 text-base'>
            <Video className='h-4 w-4' />
            <span className='truncate'>{rec.name}</span>
            <Badge variant='outline' className='font-mono text-[10px]'>
              {rec.id}
            </Badge>
            <Badge
              variant='outline'
              className={cn(
                'font-mono text-[10px]',
                rec.status === 'stopped'
                  ? 'border-emerald-500/40 text-emerald-700 dark:text-emerald-400'
                  : rec.status === 'partial'
                    ? 'border-amber-500/50 text-amber-700 dark:text-amber-400'
                    : ''
              )}
            >
              {rec.status}
            </Badge>
          </CardTitle>
          <CardDescription className='mt-1 flex flex-wrap items-center gap-1 text-[11px]'>
            <span>
              {new Date(rec.started_at).toLocaleString()} ·{' '}
              {formatDurationMs(rec.duration_ms)} · {rec.event_count} events
            </span>
            {rec.transactions?.length ? (
              <span className='font-mono'>
                · tx {rec.transactions.join(', ')}
              </span>
            ) : null}
            {rec.sap_session?.system && (
              <span className='font-mono'>
                · {rec.sap_session.system}/{rec.sap_session.client} (
                {rec.sap_session.user})
              </span>
            )}
          </CardDescription>
        </div>
        <div className='flex items-center gap-1'>
          <Button
            size='sm'
            variant='outline'
            onClick={() => onReplay(rec)}
            disabled={loading}
          >
            <Zap className='mr-1 h-3 w-3' />
            Replay
          </Button>
          <Button
            size='sm'
            variant='ghost'
            onClick={() => {
              if (confirm(`Delete "${rec.name}"? This cannot be undone.`)) {
                onDelete(rec.id)
              }
            }}
            className='hover:bg-destructive/20 hover:text-destructive'
          >
            <Trash2 className='h-3 w-3' />
          </Button>
        </div>
      </CardHeader>
      <CardContent className='min-h-0 flex-1 overflow-hidden p-0'>
        <Tabs defaultValue='events' className='flex h-full flex-col'>
          <TabsList className='mx-3 mt-1 w-fit'>
            <TabsTrigger value='events'>
              <Video className='mr-1 h-3 w-3' />
              Events ({rec.event_count})
            </TabsTrigger>
            <TabsTrigger value='variables'>
              <Code2 className='mr-1 h-3 w-3' />
              Variables ({inputCandidates.length})
            </TabsTrigger>
            <TabsTrigger value='translate'>
              <PlayCircle className='mr-1 h-3 w-3' />
              Generate
            </TabsTrigger>
          </TabsList>

          <TabsContent value='events' className='m-0 flex-1 overflow-hidden'>
            <EventsTimeline
              events={filteredEvents}
              search={eventSearch}
              onSearchChange={setEventSearch}
              total={rec.events.length}
            />
          </TabsContent>

          <TabsContent
            value='variables'
            className='m-0 flex-1 overflow-y-auto p-3'
          >
            <VariablesEditor
              candidates={inputCandidates}
              overrides={overrides}
              onOverridesChange={setOverrides}
            />
          </TabsContent>

          <TabsContent
            value='translate'
            className='m-0 flex-1 overflow-y-auto p-3'
          >
            <TranslateForm
              rec={rec}
              handlerName={handlerName}
              onHandlerNameChange={setHandlerName}
              kind={kind}
              onKindChange={setKind}
              onTranslate={() =>
                onTranslate(rec, { name: handlerName, kind, overrides })
              }
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}

function detectKindHeuristic(rec: RecordingDetail): RecordingKind {
  // If we saw a Save (btn[11]) press → mutation. Otherwise query.
  for (const e of rec.events) {
    if (
      e.kind === 'press' &&
      typeof e.target === 'string' &&
      e.target.includes('btn[11]')
    ) {
      return 'mutation'
    }
  }
  return 'query'
}

interface InputCandidate {
  target: string
  label: string
  capturedValue: string
  controlType: string
  wnd: number
}

function collectInputCandidates(events: RecordingEvent[]): InputCandidate[] {
  const map = new Map<string, InputCandidate>()
  for (const e of events) {
    if (
      (e.kind === 'set_text' ||
        e.kind === 'selected' ||
        e.kind === 'select_dropdown') &&
      typeof e.target === 'string'
    ) {
      map.set(e.target, {
        target: e.target,
        label: typeof e.label === 'string' ? e.label : '',
        capturedValue: String(e.value ?? ''),
        controlType: typeof e.control_type === 'string' ? e.control_type : '',
        wnd: typeof e.wnd === 'number' ? e.wnd : 0,
      })
    }
  }
  return Array.from(map.values())
}

// ─────────────────────────────────────────────────────────────────────────
// EventsTimeline
// ─────────────────────────────────────────────────────────────────────────

function EventsTimeline({
  events,
  search,
  onSearchChange,
  total,
}: {
  events: RecordingEvent[]
  search: string
  onSearchChange: (s: string) => void
  total: number
}) {
  return (
    <div className='flex h-full flex-col'>
      <div className='border-b px-3 py-2'>
        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder='Search events (target, value, kind…)'
          className='h-8 text-xs'
        />
        <div className='text-muted-foreground mt-1 text-[10px]'>
          Showing {events.length} of {total} events
        </div>
      </div>
      <div className='flex-1 overflow-y-auto'>
        <table className='w-full text-[11px]'>
          <thead className='bg-muted/50 sticky top-0'>
            <tr>
              <th className='px-2 py-1 text-left font-mono'>t (s)</th>
              <th className='px-2 py-1 text-left'>kind</th>
              <th className='px-2 py-1 text-left'>target / detail</th>
              <th className='px-2 py-1 text-left'>value</th>
              <th className='px-2 py-1 text-left'>wnd</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e, i) => (
              <tr key={i} className='hover:bg-accent border-b'>
                <td className='px-2 py-1 font-mono text-zinc-500'>
                  {Number(e.ts).toFixed(2)}
                </td>
                <td className='px-2 py-1'>
                  <span
                    className={cn(
                      'rounded px-1 font-mono text-[10px]',
                      kindColor(String(e.kind))
                    )}
                  >
                    {String(e.kind)}
                  </span>
                </td>
                <td className='max-w-md truncate px-2 py-1 font-mono text-[10px]'>
                  {String(e.target ?? e.title ?? e.text ?? e.hint ?? '')}
                </td>
                <td className='max-w-xs truncate px-2 py-1 font-mono'>
                  {e.value !== undefined ? String(e.value) : ''}
                </td>
                <td className='px-2 py-1 font-mono'>{e.wnd ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function kindColor(kind: string): string {
  if (kind === 'set_text' || kind === 'selected' || kind === 'select_dropdown')
    return 'bg-blue-500/20 text-blue-700 dark:text-blue-300'
  if (kind === 'press')
    return 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
  if (kind === 'send_vkey' || kind === 'inferred_action')
    return 'bg-purple-500/20 text-purple-700 dark:text-purple-300'
  if (kind === 'transaction' || kind === 'screen_change')
    return 'bg-amber-500/20 text-amber-700 dark:text-amber-300'
  if (kind === 'popup_open' || kind === 'popup_close')
    return 'bg-pink-500/20 text-pink-700 dark:text-pink-300'
  if (kind === 'sbar') return 'bg-zinc-500/20 text-zinc-700 dark:text-zinc-300'
  return 'bg-muted text-muted-foreground'
}

// ─────────────────────────────────────────────────────────────────────────
// VariablesEditor
// ─────────────────────────────────────────────────────────────────────────

function VariablesEditor({
  candidates,
  overrides,
  onOverridesChange,
}: {
  candidates: InputCandidate[]
  overrides: Record<string, InputOverride>
  onOverridesChange: (next: Record<string, InputOverride>) => void
}) {
  const types = ['str', 'int', 'float', 'bool', 'Optional[str]']

  if (candidates.length === 0) {
    return (
      <div className='text-muted-foreground py-10 text-center text-sm'>
        No user-input fields detected in this recording.
      </div>
    )
  }

  return (
    <div className='space-y-2'>
      <div className='text-muted-foreground text-xs'>
        Each unique field where you typed becomes a Pydantic input. Edit the
        Python identifier or type before generating the handler. Empty name =
        auto-derive from the SAP control id.
      </div>
      <div className='overflow-x-auto'>
        <table className='w-full text-xs'>
          <thead className='bg-muted/50'>
            <tr>
              <th className='px-2 py-1 text-left'>SAP Control</th>
              <th className='px-2 py-1 text-left'>Captured</th>
              <th className='px-2 py-1 text-left'>Python name</th>
              <th className='px-2 py-1 text-left'>Type</th>
              <th className='px-2 py-1 text-left'>Required</th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((c) => {
              const ov = overrides[c.target] ?? {}
              return (
                <tr key={c.target} className='border-b'>
                  <td className='px-2 py-1 font-mono text-[10px]'>
                    {c.target}
                    {c.label && (
                      <div className='text-muted-foreground'>{c.label}</div>
                    )}
                  </td>
                  <td className='px-2 py-1 font-mono text-[10px]'>
                    {c.capturedValue || '—'}
                  </td>
                  <td className='px-2 py-1'>
                    <Input
                      value={ov.name ?? ''}
                      onChange={(e) =>
                        onOverridesChange({
                          ...overrides,
                          [c.target]: { ...ov, name: e.target.value },
                        })
                      }
                      placeholder='auto'
                      className='h-7 text-[11px]'
                    />
                  </td>
                  <td className='px-2 py-1'>
                    <select
                      className='border-input bg-background h-7 rounded-md border px-1 text-[11px]'
                      value={ov.type ?? ''}
                      onChange={(e) =>
                        onOverridesChange({
                          ...overrides,
                          [c.target]: {
                            ...ov,
                            type: e.target.value || undefined,
                          },
                        })
                      }
                    >
                      <option value=''>auto</option>
                      {types.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className='px-2 py-1'>
                    <input
                      type='checkbox'
                      checked={ov.required !== false}
                      onChange={(e) =>
                        onOverridesChange({
                          ...overrides,
                          [c.target]: { ...ov, required: e.target.checked },
                        })
                      }
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// TranslateForm
// ─────────────────────────────────────────────────────────────────────────

function TranslateForm({
  rec,
  handlerName,
  onHandlerNameChange,
  kind,
  onKindChange,
  onTranslate,
}: {
  rec: RecordingDetail
  handlerName: string
  onHandlerNameChange: (s: string) => void
  kind: RecordingKind
  onKindChange: (k: RecordingKind) => void
  onTranslate: () => void
}) {
  return (
    <div className='space-y-4'>
      <div className='space-y-2'>
        <Label htmlFor='handler-name'>Handler name</Label>
        <Input
          id='handler-name'
          value={handlerName}
          onChange={(e) => onHandlerNameChange(e.target.value)}
          placeholder='e.g. lt01_create_to'
          className='font-mono text-sm'
        />
        <div className='text-muted-foreground text-[11px]'>
          Becomes <code className='font-mono'>handler_&lt;name&gt;</code> for
          query handlers, or{' '}
          <code className='font-mono'>POST /sap/&lt;name&gt;</code> (kebab-case)
          for mutations.
        </div>
      </div>
      <div className='space-y-2'>
        <Label>Kind</Label>
        <div className='flex gap-2'>
          {(['mutation', 'query'] as const).map((k) => (
            <button
              key={k}
              onClick={() => onKindChange(k)}
              className={cn(
                'rounded-md border px-3 py-1.5 text-xs transition-colors',
                kind === k
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'hover:bg-accent border-input'
              )}
            >
              {k === 'mutation'
                ? 'Mutation (writes to SAP)'
                : 'Query (read-only)'}
            </button>
          ))}
        </div>
      </div>
      <div className='bg-muted/40 rounded-md border p-3 text-[11px]'>
        <div className='mb-1 font-semibold'>Detected from recording:</div>
        <ul className='list-disc space-y-0.5 pl-4'>
          <li>
            Transaction(s):{' '}
            <span className='font-mono'>
              {rec.transactions?.join(', ') || '—'}
            </span>
          </li>
          <li>
            Auto-detected save:{' '}
            <span className='font-mono'>
              {rec.events.some(
                (e) =>
                  e.kind === 'press' &&
                  typeof e.target === 'string' &&
                  e.target.includes('btn[11]')
              )
                ? 'yes'
                : 'no'}
            </span>
          </li>
          <li>
            Popups:{' '}
            <span className='font-mono'>
              {rec.events.filter((e) => e.kind === 'popup_open').length}
            </span>
          </li>
        </ul>
      </div>
      <Button onClick={onTranslate} disabled={!handlerName.trim()}>
        <PlayCircle className='mr-2 h-4 w-4' />
        Generate Handler
      </Button>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// TranslationDialog — code preview
// ─────────────────────────────────────────────────────────────────────────

function TranslationDialog({
  open,
  onOpenChange,
  translation,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  translation:
    | (RecordingTranslateResponse & { _name: string; _kind: RecordingKind })
    | null
}) {
  const [tab, setTab] = useState<'python' | 'vbs'>('python')
  if (!translation) return null
  const {
    python_code,
    vbs_code,
    confidence,
    warnings,
    detected,
    _name,
    _kind,
  } = translation
  const conf = confidenceLabel(confidence)
  const code = tab === 'python' ? (python_code ?? '') : (vbs_code ?? '')
  const filename =
    tab === 'python'
      ? `${_name || 'recording'}.py`
      : `${_name || 'recording'}.vbs`

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[90vh] sm:max-w-[920px]'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <Code2 className='h-5 w-5' />
            Generated handler — <span className='font-mono'>{_name}</span>
            <Badge
              variant='outline'
              className={cn(
                'font-mono text-xs',
                conf.tone === 'high'
                  ? 'border-emerald-500/50 text-emerald-700 dark:text-emerald-400'
                  : conf.tone === 'low'
                    ? 'border-red-500/50 text-red-700 dark:text-red-400'
                    : 'border-amber-500/50 text-amber-700 dark:text-amber-400'
              )}
            >
              confidence: {conf.pct}
            </Badge>
            <Badge variant='secondary' className='font-mono text-xs'>
              {_kind}
            </Badge>
          </DialogTitle>
          <DialogDescription className='space-y-1 text-xs'>
            {detected && (
              <span>
                Detected: {detected.inputs} input
                {detected.inputs === 1 ? '' : 's'}, {detected.popups} popup
                {detected.popups === 1 ? '' : 's'}, {detected.soft_warnings}{' '}
                soft-warning{detected.soft_warnings === 1 ? '' : 's'}, two-step:{' '}
                {detected.two_step ? 'yes' : 'no'}, save:{' '}
                {detected.save_pressed ? 'yes' : 'no'}.
              </span>
            )}
          </DialogDescription>
        </DialogHeader>
        {warnings && warnings.length > 0 && (
          <div className='max-h-32 overflow-y-auto rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs'>
            {warnings.map((w, i) => (
              <div key={i} className='flex items-start gap-2'>
                <AlertTriangle className='mt-0.5 h-3 w-3 shrink-0 text-amber-500' />
                <span>{w}</span>
              </div>
            ))}
          </div>
        )}
        <Tabs value={tab} onValueChange={(v) => setTab(v as 'python' | 'vbs')}>
          <TabsList>
            <TabsTrigger value='python'>
              <Code2 className='mr-1 h-3 w-3' />
              Python
            </TabsTrigger>
            <TabsTrigger value='vbs'>
              <FileCode2 className='mr-1 h-3 w-3' />
              VBS (1:1 replay)
            </TabsTrigger>
          </TabsList>
          <TabsContent value='python' className='m-0'>
            <CodeViewer code={python_code ?? ''} language='python' />
          </TabsContent>
          <TabsContent value='vbs' className='m-0'>
            <CodeViewer code={vbs_code ?? ''} language='vbscript' />
          </TabsContent>
        </Tabs>
        <DialogFooter className='flex flex-wrap items-center justify-between gap-2 sm:justify-between'>
          <div className='text-muted-foreground flex items-center gap-2 text-[11px]'>
            <ShieldCheck className='h-3 w-3' />
            Paste the Python into{' '}
            <span className='font-mono'>omni_agent/agent.py</span> and rebuild
            the agent EXE to make this handler available.
          </div>
          <div className='flex items-center gap-2'>
            <Button
              size='sm'
              variant='outline'
              onClick={() => {
                navigator.clipboard.writeText(code).then(
                  () => toast.success('Copied to clipboard'),
                  () => toast.error('Copy failed')
                )
              }}
            >
              <Copy className='mr-1 h-3 w-3' />
              Copy
            </Button>
            <Button
              size='sm'
              variant='outline'
              onClick={() => downloadTextFile(filename, code)}
            >
              <Download className='mr-1 h-3 w-3' />
              Download .{tab === 'python' ? 'py' : 'vbs'}
            </Button>
            <Button size='sm' onClick={() => onOpenChange(false)}>
              <CheckCircle2 className='mr-1 h-3 w-3' />
              Done
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CodeViewer({ code, language }: { code: string; language: string }) {
  return (
    <div className='bg-muted/30 max-h-[55vh] overflow-auto rounded-md border'>
      <pre className='p-3 font-mono text-[11px] leading-relaxed whitespace-pre'>
        <code data-lang={language}>{code}</code>
      </pre>
    </div>
  )
}

// Re-export the icons module so it doesn't get tree-shaken inadvertently.
export const _RecorderIcons = {
  XCircle,
  PlayCircle,
}

// Created and developed by Jai Singh
