// Created and developed by Jai Singh
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  IconActivity,
  IconAlertTriangle,
  IconHistory,
  IconRefresh,
  IconServer,
} from '@tabler/icons-react'
import { SettingsService } from '@/lib/services/settings-service'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  useRailwayDeploymentLogs,
  useRailwayDeployments,
  useRailwayOverview,
  useRailwayRuntimeLogs,
} from '../hooks/use-railway-monitoring'
import type {
  LogKind,
  NormalizedLog,
} from '../services/railway-monitoring.service'
import { LogConsole } from './railway/LogConsole'
import { LogToolbar } from './railway/LogToolbar'
import { ServicePanel } from './railway/ServicePanel'

type Severity = 'error' | 'warn' | 'info' | 'debug'

interface MonitoringPreferences {
  selectedServiceId: string | null
  logKind: LogKind
  refreshInterval: number | false
  visibleSeverities: Severity[]
}

const DEFAULT_PREFS: MonitoringPreferences = {
  selectedServiceId: null,
  logKind: 'runtime',
  refreshInterval: 5000,
  visibleSeverities: ['error', 'warn', 'info', 'debug'],
}

const PREFS_KEY = 'system.railway_monitoring_preferences'

export function ServiceMonitoringSettings() {
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(
    null
  )
  const [logKind, setLogKind] = useState<LogKind>('runtime')
  const [searchText, setSearchText] = useState('')
  const [visibleSeverities, setVisibleSeverities] = useState<Set<Severity>>(
    new Set(['error', 'warn', 'info', 'debug'])
  )
  const [refreshInterval, setRefreshInterval] = useState<number | false>(5000)
  const [isPaused, setIsPaused] = useState(false)
  const [selectedDeploymentId, setSelectedDeploymentId] = useState<
    string | null
  >(null)
  const [logBuffer, setLogBuffer] = useState<NormalizedLog[]>([])
  const seenKeysRef = useRef(new Set<string>())
  const prefsLoaded = useRef(false)

  useEffect(() => {
    if (prefsLoaded.current) return
    prefsLoaded.current = true
    SettingsService.getSetting<MonitoringPreferences>(PREFS_KEY, DEFAULT_PREFS)
      .then((prefs) => {
        if (prefs.selectedServiceId !== undefined)
          setSelectedServiceId(prefs.selectedServiceId)
        if (prefs.logKind) setLogKind(prefs.logKind)
        if (prefs.refreshInterval !== undefined)
          setRefreshInterval(prefs.refreshInterval)
        if (prefs.visibleSeverities)
          setVisibleSeverities(new Set(prefs.visibleSeverities))
      })
      .catch(() => {})
  }, [])

  const savePrefs = useCallback(() => {
    const prefs: MonitoringPreferences = {
      selectedServiceId,
      logKind,
      refreshInterval,
      visibleSeverities: Array.from(visibleSeverities),
    }
    SettingsService.saveSetting(PREFS_KEY, prefs).catch(() => {})
  }, [selectedServiceId, logKind, refreshInterval, visibleSeverities])

  useEffect(() => {
    if (!prefsLoaded.current) return
    savePrefs()
  }, [savePrefs])

  const {
    data: overview,
    isLoading: overviewLoading,
    refetch: refetchOverview,
  } = useRailwayOverview()
  const runtimeQuery = useRailwayRuntimeLogs({
    serviceId: selectedServiceId ?? undefined,
    refetchInterval: isPaused ? false : refreshInterval || false,
    enabled: !selectedDeploymentId,
  })
  const deploymentsQuery = useRailwayDeployments(
    selectedServiceId ?? '',
    !!selectedServiceId
  )
  const deploymentLogsQuery = useRailwayDeploymentLogs(
    selectedDeploymentId ?? '',
    logKind,
    !!selectedDeploymentId
  )

  useEffect(() => {
    if (!runtimeQuery.data?.logs || selectedDeploymentId) return
    const newLogs = runtimeQuery.data.logs.filter(
      (l) => !seenKeysRef.current.has(l.dedup_key)
    )
    if (newLogs.length === 0) return
    for (const l of newLogs) seenKeysRef.current.add(l.dedup_key)
    setLogBuffer((prev) => {
      const combined = [...prev, ...newLogs]
      if (combined.length > 10_000) {
        const trimmed = combined.slice(-10_000)
        seenKeysRef.current = new Set(trimmed.map((l) => l.dedup_key))
        return trimmed
      }
      return combined
    })
  }, [runtimeQuery.data, selectedDeploymentId])

  const activeLogs = useMemo(() => {
    const source = selectedDeploymentId
      ? (deploymentLogsQuery.data?.logs ?? [])
      : logBuffer

    return source.filter((log) => {
      if (!visibleSeverities.has(log.severity as Severity)) return false
      if (searchText) {
        const q = searchText.toLowerCase()
        return (
          log.message.toLowerCase().includes(q) ||
          log.service_name.toLowerCase().includes(q) ||
          log.severity.includes(q)
        )
      }
      return true
    })
  }, [
    logBuffer,
    deploymentLogsQuery.data,
    selectedDeploymentId,
    visibleSeverities,
    searchText,
  ])

  const handleSelectService = useCallback((id: string | null) => {
    setSelectedServiceId(id)
    setSelectedDeploymentId(null)
    setLogBuffer([])
    seenKeysRef.current.clear()
  }, [])

  const handleClear = useCallback(() => {
    setLogBuffer([])
    seenKeysRef.current.clear()
  }, [])

  const toggleSeverity = useCallback((severity: Severity) => {
    setVisibleSeverities((prev) => {
      const next = new Set(prev)
      if (next.has(severity)) next.delete(severity)
      else next.add(severity)
      return next
    })
  }, [])

  const services = overview?.services ?? []
  const errorCount = logBuffer.filter((l) => l.severity === 'error').length
  const warnCount = logBuffer.filter((l) => l.severity === 'warn').length

  return (
    <div className='space-y-6'>
      {/* Overview Card */}
      <Card>
        <CardHeader className='pb-4'>
          <div className='flex items-center justify-between'>
            <div className='flex items-center gap-3'>
              <CardTitle className='flex items-center gap-2'>
                <IconActivity size={20} />
                Railway Service Monitor
              </CardTitle>
              {overview && (
                <Badge variant='outline' className='text-[10px]'>
                  {overview.environmentName}
                </Badge>
              )}
            </div>
            <div className='flex items-center gap-3'>
              {errorCount > 0 && (
                <Badge variant='destructive' className='gap-1 text-xs'>
                  <IconAlertTriangle size={12} />
                  {errorCount} {errorCount === 1 ? 'error' : 'errors'}
                </Badge>
              )}
              {warnCount > 0 && (
                <Badge
                  variant='outline'
                  className='gap-1 border-amber-500/30 text-xs text-amber-600 dark:text-amber-400'
                >
                  <IconAlertTriangle size={12} />
                  {warnCount}
                </Badge>
              )}
              <Badge variant='secondary' className='gap-1 text-xs'>
                <IconServer size={12} />
                {services.length} services
              </Badge>
              <Button
                size='icon'
                variant='ghost'
                className='h-7 w-7'
                onClick={() => refetchOverview()}
                title='Refresh overview'
              >
                <IconRefresh size={14} />
              </Button>
            </div>
          </div>
          <CardDescription>
            {overview?.projectName
              ? `Live monitoring for ${overview.projectName}`
              : 'Configure RAILWAY_API_TOKEN to enable monitoring'}
          </CardDescription>
        </CardHeader>
      </Card>

      {/* Console Card */}
      <Card className='overflow-hidden p-0'>
        <div className='flex' style={{ height: '560px' }}>
          {/* Service panel */}
          <div className='w-52 shrink-0'>
            <ServicePanel
              services={services}
              selectedServiceId={selectedServiceId}
              onSelectService={handleSelectService}
              isLoading={overviewLoading}
              environmentName={overview?.environmentName}
            />
          </div>

          {/* Console area */}
          <div className='flex flex-1 flex-col'>
            <LogToolbar
              logKind={logKind}
              onLogKindChange={setLogKind}
              searchText={searchText}
              onSearchTextChange={setSearchText}
              visibleSeverities={visibleSeverities}
              onToggleSeverity={toggleSeverity}
              refreshInterval={refreshInterval}
              onRefreshIntervalChange={setRefreshInterval}
              isPaused={isPaused}
              onTogglePause={() => setIsPaused((p) => !p)}
              onClear={handleClear}
              logs={activeLogs}
              showDeploymentDrillDown={!!selectedDeploymentId}
            />

            <div className='flex flex-1 overflow-hidden'>
              <div className='flex-1'>
                <LogConsole
                  logs={activeLogs}
                  isLoading={
                    selectedDeploymentId
                      ? deploymentLogsQuery.isLoading
                      : runtimeQuery.isLoading
                  }
                  showServiceName={!selectedServiceId}
                />
              </div>

              {/* Deployment history panel */}
              {selectedServiceId && (
                <div className='bg-card w-48 shrink-0 border-l'>
                  <div className='flex items-center gap-1.5 border-b px-3 py-2.5'>
                    <IconHistory size={13} className='text-muted-foreground' />
                    <span className='text-foreground text-[11px] font-medium'>
                      Deployments
                    </span>
                  </div>
                  <ScrollArea style={{ height: '480px' }}>
                    {deploymentsQuery.isLoading && (
                      <div className='text-muted-foreground px-3 py-4 text-center text-xs'>
                        Loading...
                      </div>
                    )}
                    {(deploymentsQuery.data?.deployments ?? []).map((dep) => {
                      const isActive = selectedDeploymentId === dep.id
                      return (
                        <button
                          key={dep.id}
                          onClick={() => {
                            setSelectedDeploymentId(isActive ? null : dep.id)
                          }}
                          className={`flex w-full flex-col gap-1 border-b px-3 py-2.5 text-left transition-colors ${
                            isActive
                              ? 'bg-primary/10 text-primary'
                              : 'text-foreground hover:bg-accent'
                          }`}
                        >
                          <div className='flex items-center justify-between'>
                            <Badge
                              variant={
                                dep.status === 'SUCCESS'
                                  ? 'secondary'
                                  : dep.status === 'FAILED'
                                    ? 'destructive'
                                    : 'outline'
                              }
                              className='h-4 text-[9px]'
                            >
                              {dep.status}
                            </Badge>
                            <span className='text-muted-foreground font-mono text-[9px]'>
                              {dep.id.slice(0, 8)}
                            </span>
                          </div>
                          <span className='text-muted-foreground text-[10px]'>
                            {new Date(dep.createdAt).toLocaleString()}
                          </span>
                        </button>
                      )
                    })}
                    {!deploymentsQuery.isLoading &&
                      (deploymentsQuery.data?.deployments ?? []).length ===
                        0 && (
                        <div className='text-muted-foreground px-3 py-4 text-center text-xs'>
                          No deployments
                        </div>
                      )}
                  </ScrollArea>
                </div>
              )}
            </div>
          </div>
        </div>
      </Card>
    </div>
  )
}

// Created and developed by Jai Singh
