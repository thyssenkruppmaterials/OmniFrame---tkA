// Created and developed by Jai Singh
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Rocket,
  Package,
  Truck,
  Warehouse,
  ScanBarcode,
  Hash,
  SkipForward,
  Download,
  ShieldCheck,
  ShieldAlert,
  Info,
  MonitorDown,
  ChevronDown,
  ChevronUp,
  RefreshCw,
} from 'lucide-react'
import { toast } from 'sonner'
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
import { Progress } from '@/components/ui/progress'
import { Textarea } from '@/components/ui/textarea'

interface StepResult {
  step: number
  name: string
  status: 'ok' | 'error' | 'skipped' | 'running' | 'pending'
  msg: string
}

interface ShipmentResult {
  ok: boolean
  failed_step: number
  error: string
  results?: StepResult[]
  shipment_number?: string
}

interface ShipmentProgress {
  active: boolean
  status: 'idle' | 'running' | 'complete' | 'error'
  current_step: number
  total_steps: number
  step_name: string
  step_message: string
  step_status: 'pending' | 'running' | 'ok' | 'error' | 'skipped'
  delivery: string
  started_at: string | null
  finished_at: string | null
  results: StepResult[]
  shipment_number: string
  error: string
}

interface CitrixInfo {
  is_citrix: boolean
  session_name?: string | null
  client_name?: string | null
  computer_name?: string
  user_name?: string
}

interface AgentHealth {
  ok: boolean
  version?: string
  sap_connected?: boolean
  citrix?: CitrixInfo
}

interface SapSession {
  index: number
  label: string
}

interface SapConnection {
  index: number
  label: string
  sessions: SapSession[]
}

interface SapSessionsData {
  ok: boolean
  error?: string
  connections: SapConnection[]
  selected_conn: number
  selected_sess: number
}

type AgentStatus = 'checking' | 'connected' | 'missing' | 'bridge'

const AGENT_URL = 'http://127.0.0.1:8765'
const AGENT_DOWNLOAD_URL =
  'https://wncpqxwmbxjgxvrpcake.supabase.co/storage/v1/object/public/downloads/OmniFrame_Agent.zip'

const STEP_META: Record<number, { icon: React.ElementType; label: string }> = {
  1: { icon: ScanBarcode, label: 'ZV26 — Serial Numbers' },
  2: { icon: Package, label: 'VL02N — Pack BOX' },
  3: { icon: Hash, label: 'LT12 — Confirm TO' },
  4: { icon: Truck, label: 'VT01N — Create Shipment + Tracking' },
  5: { icon: Package, label: 'VL02N — Pack CASE + Output' },
  6: { icon: Rocket, label: 'VL02N — Post Goods Issue' },
}

export function OneClickShipTab() {
  const [isProcessing, setIsProcessing] = useState(false)
  const [result, setResult] = useState<ShipmentResult | null>(null)
  const [progress, setProgress] = useState<ShipmentProgress | null>(null)
  const [agentStatus, setAgentStatus] = useState<AgentStatus>('checking')
  const [agentHealth, setAgentHealth] = useState<AgentHealth | null>(null)
  const [downloadModalOpen, setDownloadModalOpen] = useState(false)
  const [sapSessions, setSapSessions] = useState<SapSessionsData | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [formData, setFormData] = useState({
    delivery: '',
    item: '0010',
    to_number: '',
    warehouse: 'PDC',
    tracking: 'Tracking',
    serials: '',
  })
  const pollAgentRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollProgressRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // --- Agent / Bridge detection ---
  const checkAgent = useCallback(async (): Promise<AgentStatus> => {
    const pywebview = (window as unknown as Record<string, unknown>)
      .pywebview as
      | { api?: Record<string, (...args: unknown[]) => Promise<unknown>> }
      | undefined

    if (pywebview?.api?.process_shipment) {
      setAgentStatus('bridge')
      setAgentHealth(null)
      return 'bridge'
    }

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 1500)
      const res = await fetch(`${AGENT_URL}/health`, {
        signal: controller.signal,
        cache: 'no-store',
      })
      clearTimeout(timeout)
      if (res.ok) {
        const data = (await res.json()) as AgentHealth
        setAgentHealth(data)
        setAgentStatus('connected')
        return 'connected'
      }
    } catch {
      // agent not running
    }
    setAgentHealth(null)
    setAgentStatus('missing')
    return 'missing'
  }, [])

  const loadSapSessions = useCallback(async () => {
    try {
      const res = await fetch(`${AGENT_URL}/sap/sessions`, {
        signal: AbortSignal.timeout(3000),
      })
      const data = (await res.json()) as SapSessionsData
      setSapSessions(data)
    } catch {
      setSapSessions(null)
    }
  }, [])

  const selectSapSession = useCallback(
    async (connIdx: number, sessIdx: number) => {
      try {
        await fetch(`${AGENT_URL}/sap/session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conn_idx: connIdx, sess_idx: sessIdx }),
        })
        toast.success('SAP Session switched', {
          description: `conn=${connIdx} sess=${sessIdx}`,
        })
        await loadSapSessions()
        await fetch(`${AGENT_URL}/sap/connect`, { method: 'POST' })
      } catch (e) {
        toast.error('Session select failed', {
          description: e instanceof Error ? e.message : 'Unknown error',
        })
      }
    },
    [loadSapSessions]
  )

  useEffect(() => {
    checkAgent()
    pollAgentRef.current = setInterval(() => {
      if (!isProcessing) checkAgent()
    }, 3000)
    return () => {
      if (pollAgentRef.current) clearInterval(pollAgentRef.current)
    }
  }, [checkAgent, isProcessing])

  useEffect(() => {
    if (agentStatus === 'connected') {
      loadSapSessions()
    } else {
      setSapSessions(null)
    }
  }, [agentStatus, loadSapSessions])

  // --- Live progress polling while processing ---
  const stopProgressPoll = useCallback(() => {
    if (pollProgressRef.current) {
      clearInterval(pollProgressRef.current)
      pollProgressRef.current = null
    }
  }, [])

  const startProgressPoll = useCallback(() => {
    stopProgressPoll()
    const tick = async () => {
      try {
        const res = await fetch(`${AGENT_URL}/sap/shipment-progress`, {
          cache: 'no-store',
          signal: AbortSignal.timeout(2000),
        })
        if (res.ok) {
          const data = (await res.json()) as ShipmentProgress
          setProgress(data)
          if (
            !data.active &&
            (data.status === 'complete' || data.status === 'error')
          ) {
            stopProgressPoll()
          }
        }
      } catch {
        /* ignore transient errors during agent restart */
      }
    }
    tick()
    pollProgressRef.current = setInterval(tick, 1000)
  }, [stopProgressPoll])

  useEffect(() => stopProgressPoll, [stopProgressPoll])

  const ensureSapConnected = async (): Promise<boolean> => {
    if (agentStatus !== 'connected') return true
    if (agentHealth?.sap_connected) return true
    try {
      const r = await fetch(`${AGENT_URL}/sap/connect`, { method: 'POST' })
      const data = await r.json()
      if (data.ok) {
        await checkAgent()
        return true
      }
      toast.error('SAP Connect Failed', { description: data.error })
      return false
    } catch (e) {
      toast.error('Agent Error', {
        description: e instanceof Error ? e.message : 'Unknown error',
      })
      return false
    }
  }

  const processShipment = async () => {
    if (
      !formData.delivery ||
      !formData.to_number ||
      !formData.warehouse ||
      !formData.tracking
    ) {
      toast.error('Validation Error', {
        description: 'Please fill in all required fields',
      })
      return
    }
    if (agentStatus === 'missing') {
      setDownloadModalOpen(true)
      return
    }

    setIsProcessing(true)
    setResult(null)
    setProgress(null)
    setDetailsOpen(false)

    const serialsList = formData.serials
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean)

    const payload = {
      delivery: formData.delivery,
      item: formData.item,
      to_number: formData.to_number,
      warehouse: formData.warehouse,
      tracking: formData.tracking,
      serials: serialsList,
    }

    try {
      let data: ShipmentResult
      if (agentStatus === 'bridge') {
        const pywebview = (window as unknown as Record<string, unknown>)
          .pywebview as {
          api: Record<string, (arg: unknown) => Promise<ShipmentResult>>
        }
        data = await pywebview.api.process_shipment(payload)
      } else {
        const ready = await ensureSapConnected()
        if (!ready) {
          setIsProcessing(false)
          return
        }
        startProgressPoll()
        const res = await fetch(`${AGENT_URL}/sap/process-shipment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        data = (await res.json()) as ShipmentResult
      }

      setResult(data)
      if (data.ok) {
        toast.success('Shipment Complete', {
          description: `Delivery ${formData.delivery}${
            data.shipment_number ? ` → Shipment ${data.shipment_number}` : ''
          }`,
        })
      } else {
        toast.error('Shipment Failed', {
          description: `Step ${data.failed_step}: ${data.error}`,
        })
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error'
      setResult({ ok: false, failed_step: 0, error: errorMessage })
      toast.error('Request Failed', { description: errorMessage })
    } finally {
      stopProgressPoll()
      setIsProcessing(false)
    }
  }

  const canSubmit = agentStatus === 'connected' || agentStatus === 'bridge'

  return (
    <div className='space-y-6'>
      {/* Unified Agent + SAP Session Status */}
      <AgentStatusBar
        status={agentStatus}
        health={agentHealth}
        sessions={sapSessions}
        onDownloadClick={() => setDownloadModalOpen(true)}
        onRefreshAgent={checkAgent}
        onSelectSession={selectSapSession}
        onRefreshSessions={loadSapSessions}
      />

      {/* Form */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <Rocket className='h-5 w-5' />
            One Click Ship
          </CardTitle>
          <CardDescription>
            Process a complete shipment end-to-end: serial numbers, packing, TO
            confirmation, shipment creation, output, and PGI — all in one click.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-6'>
          <div className='grid gap-4 md:grid-cols-2'>
            <div className='space-y-2'>
              <Label htmlFor='ocs-delivery'>Delivery # *</Label>
              <Input
                id='ocs-delivery'
                value={formData.delivery}
                onChange={(e) =>
                  setFormData({ ...formData, delivery: e.target.value })
                }
                placeholder='65506777'
                disabled={isProcessing}
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='ocs-item'>Item #</Label>
              <Input
                id='ocs-item'
                value={formData.item}
                onChange={(e) =>
                  setFormData({ ...formData, item: e.target.value })
                }
                placeholder='0010'
                disabled={isProcessing}
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='ocs-to' className='flex items-center gap-2'>
                <Hash className='h-4 w-4' />
                TO Number *
              </Label>
              <Input
                id='ocs-to'
                value={formData.to_number}
                onChange={(e) =>
                  setFormData({ ...formData, to_number: e.target.value })
                }
                placeholder='3672506'
                disabled={isProcessing}
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='ocs-wh' className='flex items-center gap-2'>
                <Warehouse className='h-4 w-4' />
                Warehouse *
              </Label>
              <Input
                id='ocs-wh'
                value={formData.warehouse}
                onChange={(e) =>
                  setFormData({ ...formData, warehouse: e.target.value })
                }
                placeholder='PDC'
                disabled={isProcessing}
              />
            </div>
            <div className='space-y-2 md:col-span-2'>
              <Label htmlFor='ocs-tracking' className='flex items-center gap-2'>
                <Truck className='h-4 w-4' />
                Tracking # *
              </Label>
              <Input
                id='ocs-tracking'
                value={formData.tracking}
                onChange={(e) =>
                  setFormData({ ...formData, tracking: e.target.value })
                }
                placeholder='Tracking number'
                disabled={isProcessing}
              />
            </div>
            <div className='space-y-2 md:col-span-2'>
              <Label htmlFor='ocs-serials' className='flex items-center gap-2'>
                <ScanBarcode className='h-4 w-4' />
                Serial Numbers (optional, one per line)
              </Label>
              <Textarea
                id='ocs-serials'
                value={formData.serials}
                onChange={(e) =>
                  setFormData({ ...formData, serials: e.target.value })
                }
                placeholder={'JJ2220\nJJ2230\nJJ2208'}
                rows={4}
                className='font-mono text-sm'
                disabled={isProcessing}
              />
              <p className='text-muted-foreground text-xs'>
                Leave empty if the delivery does not require serial numbers.
                Step 1 (ZV26) will be skipped.
              </p>
            </div>
          </div>

          <Button
            onClick={processShipment}
            disabled={isProcessing || !canSubmit}
            className='w-full md:w-auto'
            size='lg'
          >
            {isProcessing ? (
              <>
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                Processing Shipment...
              </>
            ) : !canSubmit ? (
              <>
                <MonitorDown className='mr-2 h-4 w-4' />
                SAP Agent Required
              </>
            ) : (
              <>
                <Rocket className='mr-2 h-4 w-4' />
                Process Shipment
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Live progress during processing */}
      {(isProcessing || (progress && progress.status !== 'idle' && !result)) &&
        progress && <ShipmentProgressCard progress={progress} />}

      {/* Final summary card after completion */}
      {result && !isProcessing && (
        <ShipmentSummaryCard
          result={result}
          detailsOpen={detailsOpen}
          onToggleDetails={() => setDetailsOpen((v) => !v)}
        />
      )}

      <AgentDownloadModal
        open={downloadModalOpen}
        onOpenChange={setDownloadModalOpen}
        citrix={agentHealth?.citrix}
      />
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Unified Agent Status Bar (Agent + SAP Session combined)
// ──────────────────────────────────────────────────────────────────────
function AgentStatusBar({
  status,
  health,
  sessions,
  onDownloadClick,
  onRefreshAgent,
  onSelectSession,
  onRefreshSessions,
}: {
  status: AgentStatus
  health: AgentHealth | null
  sessions: SapSessionsData | null
  onDownloadClick: () => void
  onRefreshAgent: () => void
  onSelectSession: (connIdx: number, sessIdx: number) => void
  onRefreshSessions: () => void
}) {
  if (status === 'checking') {
    return (
      <Card>
        <CardContent className='flex items-center gap-3 py-3'>
          <Loader2 className='h-4 w-4 animate-spin text-blue-500' />
          <span className='text-sm'>
            Checking for SAP Agent on this machine...
          </span>
        </CardContent>
      </Card>
    )
  }

  if (status === 'missing') {
    return (
      <Card className='border-amber-500/50'>
        <CardContent className='flex flex-col gap-3 py-3 sm:flex-row sm:items-center'>
          <div className='flex flex-1 items-start gap-3'>
            <ShieldAlert className='mt-0.5 h-5 w-5 shrink-0 text-amber-500' />
            <div className='flex-1'>
              <div className='text-sm font-medium'>SAP Agent Not Detected</div>
              <div className='text-muted-foreground text-xs'>
                One Click Ship needs a small background service on your Citrix
                desktop. Download and run it to enable shipment processing.
              </div>
            </div>
          </div>
          <div className='flex gap-2'>
            <Button size='sm' variant='outline' onClick={onRefreshAgent}>
              <RefreshCw className='mr-1 h-3 w-3' />
              Retry
            </Button>
            <Button size='sm' onClick={onDownloadClick}>
              <Download className='mr-1 h-3 w-3' />
              Download Agent
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (status === 'bridge') {
    return (
      <Card className='border-emerald-500/40'>
        <CardContent className='flex items-center gap-3 py-3'>
          <ShieldCheck className='h-4 w-4 text-emerald-500' />
          <div className='flex-1 text-sm font-medium'>
            Running inside OmniFrame SAP Bridge
            <span className='text-muted-foreground ml-2 font-normal'>
              · Commands execute via the bridge app
            </span>
          </div>
          <Badge
            variant='outline'
            className='border-emerald-500/50 text-emerald-600 dark:text-emerald-400'
          >
            Bridge
          </Badge>
        </CardContent>
      </Card>
    )
  }

  // connected
  const citrix = health?.citrix
  const allOptions: Array<{
    value: string
    label: string
    connIdx: number
    sessIdx: number
  }> = []
  sessions?.connections.forEach((c) => {
    c.sessions.forEach((s) => {
      allOptions.push({
        value: `${c.index}:${s.index}`,
        label: `${c.label} — ${s.label}`,
        connIdx: c.index,
        sessIdx: s.index,
      })
    })
  })
  const currentValue = sessions
    ? `${sessions.selected_conn}:${sessions.selected_sess}`
    : ''

  return (
    <Card className='border-emerald-500/40'>
      <CardContent className='space-y-2 py-3'>
        <div className='flex flex-wrap items-center gap-3'>
          <ShieldCheck className='h-4 w-4 shrink-0 text-emerald-500' />
          <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
            <div className='flex items-center gap-2 text-sm font-medium'>
              SAP Agent Connected
              {health?.version && (
                <span className='text-muted-foreground text-xs font-normal'>
                  v{health.version}
                </span>
              )}
              <Badge
                variant='outline'
                className={
                  health?.sap_connected
                    ? 'border-emerald-500/50 text-emerald-600 dark:text-emerald-400'
                    : 'border-amber-500/50 text-amber-600 dark:text-amber-400'
                }
              >
                SAP GUI: {health?.sap_connected ? 'connected' : 'not connected'}
              </Badge>
            </div>
            <div className='text-muted-foreground text-xs'>
              {AGENT_URL}
              {citrix?.is_citrix && citrix?.session_name && (
                <span> · Citrix {citrix.session_name}</span>
              )}
            </div>
          </div>

          {allOptions.length > 0 && (
            <div className='flex items-center gap-1'>
              <Info className='h-3 w-3 shrink-0 text-blue-500' />
              <span className='text-muted-foreground text-xs'>Session:</span>
              <select
                className='border-input bg-background w-80 rounded-md border px-2 py-1 text-xs'
                value={currentValue}
                onChange={(e) => {
                  const [c, s] = e.target.value.split(':').map(Number)
                  onSelectSession(c, s)
                }}
              >
                {allOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <Button
                size='sm'
                variant='ghost'
                className='h-7 w-7 p-0'
                onClick={onRefreshSessions}
                title='Refresh session list'
              >
                <RefreshCw className='h-3 w-3' />
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Live Progress Card (during processing)
// ──────────────────────────────────────────────────────────────────────
function ShipmentProgressCard({ progress }: { progress: ShipmentProgress }) {
  const pct = Math.max(
    0,
    Math.min(
      100,
      progress.total_steps > 0
        ? (progress.current_step / progress.total_steps) * 100
        : 0
    )
  )

  const elapsed = useElapsed(progress.started_at)

  return (
    <Card className='border-blue-500/40'>
      <CardContent className='space-y-4 py-4'>
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <div className='flex items-center gap-2'>
            <Loader2 className='h-5 w-5 animate-spin text-blue-500' />
            <div className='text-sm font-medium'>Processing Shipment</div>
            {progress.delivery && (
              <Badge variant='outline' className='font-mono text-xs'>
                {progress.delivery}
              </Badge>
            )}
            {progress.shipment_number && (
              <Badge variant='outline' className='font-mono text-xs'>
                → {progress.shipment_number}
              </Badge>
            )}
          </div>
          <div className='text-muted-foreground text-xs'>
            Step {progress.current_step} of {progress.total_steps} · {elapsed}
          </div>
        </div>

        <Progress value={pct} />

        <div className='space-y-1.5'>
          <div className='flex items-center gap-2 text-sm'>
            <Loader2 className='h-3 w-3 animate-spin text-blue-500' />
            <span className='font-medium'>
              {progress.step_name || 'Preparing...'}
            </span>
          </div>
          {progress.step_message && (
            <div className='text-muted-foreground font-mono text-xs'>
              {progress.step_message}
            </div>
          )}
        </div>

        {progress.results && progress.results.length > 0 && (
          <div className='border-t pt-3'>
            <div className='text-muted-foreground mb-2 text-xs font-medium'>
              Completed:
            </div>
            <div className='space-y-1'>
              {progress.results.map((step) => (
                <StepLine key={step.step} step={step} compact />
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function useElapsed(startedAt: string | null): string {
  const [elapsed, setElapsed] = useState('0s')
  useEffect(() => {
    if (!startedAt) return
    const start = new Date(startedAt).getTime()
    const update = () => {
      const secs = Math.floor((Date.now() - start) / 1000)
      setElapsed(
        secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`
      )
    }
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [startedAt])
  return elapsed
}

// ──────────────────────────────────────────────────────────────────────
// Summary Card (after completion) — collapsible details
// ──────────────────────────────────────────────────────────────────────
function ShipmentSummaryCard({
  result,
  detailsOpen,
  onToggleDetails,
}: {
  result: ShipmentResult
  detailsOpen: boolean
  onToggleDetails: () => void
}) {
  const okCount = result.results?.filter((r) => r.status === 'ok').length ?? 0
  const errorCount =
    result.results?.filter((r) => r.status === 'error').length ?? 0
  const skippedCount =
    result.results?.filter((r) => r.status === 'skipped').length ?? 0
  const total = result.results?.length ?? 0

  return (
    <Card className={result.ok ? 'border-green-500/50' : 'border-red-500/50'}>
      <CardContent className='space-y-3 py-4'>
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <div className='flex items-center gap-2'>
            {result.ok ? (
              <>
                <CheckCircle2 className='h-5 w-5 text-green-500' />
                <span className='text-sm font-medium'>Shipment Complete</span>
              </>
            ) : (
              <>
                <XCircle className='h-5 w-5 text-red-500' />
                <span className='text-sm font-medium'>
                  Shipment Failed
                  {result.failed_step > 0 && (
                    <span className='text-muted-foreground ml-1 font-normal'>
                      at Step {result.failed_step}
                    </span>
                  )}
                </span>
              </>
            )}
            {result.shipment_number && (
              <Badge variant='outline' className='font-mono text-xs'>
                Shipment {result.shipment_number}
              </Badge>
            )}
          </div>
          <div className='text-muted-foreground flex items-center gap-3 text-xs'>
            <span>
              {okCount}/{total} ok
              {skippedCount > 0 && ` · ${skippedCount} skipped`}
              {errorCount > 0 && ` · ${errorCount} error`}
            </span>
            <Button
              size='sm'
              variant='ghost'
              className='h-7 gap-1 px-2 text-xs'
              onClick={onToggleDetails}
            >
              {detailsOpen ? (
                <>
                  Hide details <ChevronUp className='h-3 w-3' />
                </>
              ) : (
                <>
                  Show details <ChevronDown className='h-3 w-3' />
                </>
              )}
            </Button>
          </div>
        </div>

        <Progress
          value={100}
          className={result.ok ? '[&>div]:bg-green-500' : '[&>div]:bg-red-500'}
        />

        {!result.ok && result.error && (
          <div className='rounded bg-red-50 p-2 font-mono text-xs text-red-600 dark:bg-red-950/20 dark:text-red-400'>
            {result.error}
          </div>
        )}

        {detailsOpen && result.results && result.results.length > 0 && (
          <div className='space-y-1.5 border-t pt-3'>
            {result.results.map((step) => (
              <StepLine key={step.step} step={step} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Step line (used in both progress card and summary details)
// ──────────────────────────────────────────────────────────────────────
function StepLine({ step, compact }: { step: StepResult; compact?: boolean }) {
  const meta = STEP_META[step.step]
  const Icon =
    step.status === 'skipped'
      ? SkipForward
      : step.status === 'ok'
        ? CheckCircle2
        : step.status === 'running'
          ? Loader2
          : XCircle
  const iconColor =
    step.status === 'ok'
      ? 'text-green-500'
      : step.status === 'skipped'
        ? 'text-zinc-400'
        : step.status === 'running'
          ? 'text-blue-500 animate-spin'
          : 'text-red-500'

  return (
    <div
      className={`flex items-start gap-2 ${compact ? 'py-0.5' : 'rounded-md border p-2'}`}
    >
      <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${iconColor}`} />
      <div className='min-w-0 flex-1'>
        <div className='flex items-center gap-2'>
          <span className='text-xs font-medium'>
            {meta?.label || step.name}
          </span>
          <Badge
            variant={
              step.status === 'ok'
                ? 'default'
                : step.status === 'skipped'
                  ? 'secondary'
                  : step.status === 'running'
                    ? 'outline'
                    : 'destructive'
            }
            className='text-[10px]'
          >
            {step.status}
          </Badge>
        </div>
        {step.msg && !compact && (
          <p className='text-muted-foreground mt-0.5 truncate font-mono text-[10px]'>
            {step.msg}
          </p>
        )}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Download modal (unchanged)
// ──────────────────────────────────────────────────────────────────────
function AgentDownloadModal({
  open,
  onOpenChange,
  citrix,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  citrix?: CitrixInfo
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-lg'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <MonitorDown className='h-5 w-5' />
            Install OmniFrame SAP Agent
          </DialogTitle>
          <DialogDescription>
            A lightweight local service that lets this browser drive SAP GUI on
            your Citrix desktop.
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-4 py-2'>
          <ol className='space-y-3 text-sm'>
            <li className='flex gap-3'>
              <span className='bg-primary text-primary-foreground flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold'>
                1
              </span>
              <div>
                <div className='font-medium'>Click Download</div>
                <div className='text-muted-foreground text-xs'>
                  A ~20 MB ZIP file (
                  <span className='font-mono'>OmniFrame_Agent.zip</span>){' '}
                  downloads to your Downloads folder.
                </div>
              </div>
            </li>
            <li className='flex gap-3'>
              <span className='bg-primary text-primary-foreground flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold'>
                2
              </span>
              <div>
                <div className='font-medium'>
                  Right-click the ZIP → Extract All
                </div>
                <div className='text-muted-foreground text-xs'>
                  This produces a folder containing{' '}
                  <span className='font-mono'>OmniFrame_Agent.exe</span>.
                </div>
              </div>
            </li>
            <li className='flex gap-3'>
              <span className='bg-primary text-primary-foreground flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold'>
                3
              </span>
              <div>
                <div className='font-medium'>
                  Double-click the extracted .exe
                </div>
                <div className='text-muted-foreground text-xs'>
                  A console window appears showing agent logs. Leave it open for
                  the whole session — closing it stops the agent. To stop or
                  remove the agent, simply close the window and delete the .exe.
                  Nothing is installed.
                </div>
              </div>
            </li>
            <li className='flex gap-3'>
              <span className='bg-primary text-primary-foreground flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold'>
                4
              </span>
              <div>
                <div className='font-medium'>Return to this page</div>
                <div className='text-muted-foreground text-xs'>
                  This page will automatically detect the agent within a few
                  seconds and enable One Click Ship.
                </div>
              </div>
            </li>
          </ol>

          {citrix?.is_citrix === false && (
            <div className='rounded-md border border-amber-500/40 bg-amber-50 p-3 text-xs dark:bg-amber-950/20'>
              <div className='font-medium text-amber-700 dark:text-amber-400'>
                Citrix not detected
              </div>
              <div className='mt-1 text-amber-600 dark:text-amber-300'>
                You appear to be on a local machine. The agent is intended for
                Citrix environments where SAP GUI runs. It will still work
                locally if SAP GUI is installed here.
              </div>
            </div>
          )}

          <div className='text-muted-foreground bg-muted rounded-md p-3 text-xs'>
            <div className='mb-1 font-medium'>What does the agent do?</div>
            Runs as a small local service on localhost:8765 while its window is
            open. It connects to SAP GUI via COM and exposes a REST API this
            page uses. Nothing is installed to your machine — just delete the
            downloaded file to fully remove it.
          </div>

          {/* Phase D #19 — Verify SHA-256 of the downloaded EXE */}
          <div className='bg-muted/30 rounded-md border p-3 text-xs'>
            <div className='mb-1 font-medium'>Verify integrity (optional)</div>
            <div className='text-muted-foreground'>
              The build pipeline publishes the agent's SHA-256 hash next to the
              ZIP. To verify after extracting:
            </div>
            <code className='bg-background mt-1 block rounded p-1.5 font-mono text-[10px]'>
              certutil -hashfile OmniFrame_Agent.exe SHA256
            </code>
            <div className='text-muted-foreground mt-1'>
              Expected: see the matching{' '}
              <span className='font-mono'>OmniFrame_Agent.exe.sha256</span> file
              in the build artifact (or the GitHub Actions run summary).
            </div>
          </div>
        </div>

        <DialogFooter className='gap-2 sm:gap-2'>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button asChild>
            <a href={AGENT_DOWNLOAD_URL} download>
              <Download className='mr-2 h-4 w-4' />
              Download Agent (ZIP)
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Created and developed by Jai Singh
