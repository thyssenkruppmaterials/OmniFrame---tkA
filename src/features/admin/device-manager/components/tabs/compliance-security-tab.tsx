import {
  IconShieldCheck,
  IconAlertTriangle,
  IconActivity,
  IconRefresh,
} from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  useCompliancePolicies,
  useComplianceViolations,
} from '../../hooks/use-compliance-engine'
import { useFleetStatistics } from '../../hooks/use-device-inventory'
import type {
  CompliancePolicy,
  ComplianceViolation,
} from '../../types/device-manager.types'
import { ComplianceBadge } from '../shared/compliance-badge'

export function ComplianceSecurityTab() {
  const { data: stats, isLoading: loadingStats } = useFleetStatistics()
  const { data: policies, isLoading: loadingPolicies } = useCompliancePolicies()
  const {
    data: violations,
    isLoading: loadingViolations,
    refetch,
  } = useComplianceViolations({ status: 'Open' })

  return (
    <div className='space-y-6'>
      <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
        <KpiCard
          title='Compliance Rate'
          value={loadingStats ? '...' : `${stats?.compliance_rate ?? 100}%`}
          icon={<IconShieldCheck className='h-4 w-4 text-green-500' />}
        />
        <KpiCard
          title='Active Violations'
          value={loadingViolations ? '...' : String((violations || []).length)}
          icon={<IconAlertTriangle className='h-4 w-4 text-red-500' />}
        />
        <KpiCard
          title='Active Policies'
          value={
            loadingPolicies
              ? '...'
              : String(
                  (policies || []).filter((p: CompliancePolicy) => p.enabled)
                    .length
                )
          }
          icon={<IconActivity className='h-4 w-4 text-blue-500' />}
        />
        <KpiCard
          title='Avg Health Score'
          value={
            loadingStats ? '...' : String(stats?.average_health_score ?? 0)
          }
          icon={<IconShieldCheck className='h-4 w-4 text-amber-500' />}
        />
      </div>

      <div className='grid gap-6 lg:grid-cols-[1fr_320px]'>
        <Card>
          <CardHeader className='pb-3'>
            <div className='flex items-center justify-between'>
              <CardTitle className='text-base'>Violations</CardTitle>
              <Button
                variant='ghost'
                size='sm'
                className='h-7 w-7 p-0'
                onClick={() => refetch()}
              >
                <IconRefresh className='h-3.5 w-3.5' />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {loadingViolations ? (
              <div className='space-y-2'>
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className='bg-muted/30 h-14 animate-pulse rounded-lg'
                  />
                ))}
              </div>
            ) : (violations || []).length === 0 ? (
              <div className='py-12 text-center'>
                <IconShieldCheck className='text-muted-foreground mx-auto h-8 w-8' />
                <p className='text-muted-foreground mt-2 text-sm'>
                  No open violations
                </p>
              </div>
            ) : (
              <div className='space-y-1.5'>
                <div className='text-muted-foreground hidden items-center gap-3 px-3 py-1 text-[10px] font-medium uppercase md:flex'>
                  <div className='w-[100px]'>Device</div>
                  <div className='flex-1'>Details</div>
                  <div className='w-[70px]'>Severity</div>
                  <div className='w-[90px]'>Status</div>
                  <div className='w-[100px]'>Detected</div>
                </div>
                {(violations || []).map((v: ComplianceViolation) => (
                  <div
                    key={v.id}
                    className='flex items-center gap-3 rounded-lg border px-3 py-2'
                  >
                    <div className='w-[100px] truncate text-xs font-medium'>
                      {v.device_id.slice(0, 8)}
                    </div>
                    <div className='min-w-0 flex-1'>
                      <p className='truncate text-xs'>
                        {JSON.stringify(v.violation_details).slice(0, 60)}
                      </p>
                    </div>
                    <div className='w-[70px]'>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                          v.severity === 'critical'
                            ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                            : v.severity === 'high'
                              ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
                              : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                        }`}
                      >
                        {v.severity}
                      </span>
                    </div>
                    <div className='w-[90px]'>
                      <ComplianceBadge
                        compliant={v.remediation_status === 'Remediated'}
                      />
                    </div>
                    <div className='text-muted-foreground w-[100px] text-[10px]'>
                      {new Date(v.detected_at).toLocaleDateString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className='pb-3'>
            <CardTitle className='text-base'>Policies</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingPolicies ? (
              <div className='space-y-2'>
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className='bg-muted/30 h-12 animate-pulse rounded-lg'
                  />
                ))}
              </div>
            ) : (policies || []).length === 0 ? (
              <p className='text-muted-foreground py-8 text-center text-xs'>
                No compliance policies
              </p>
            ) : (
              <div className='space-y-2'>
                {(policies || []).map((p: CompliancePolicy) => (
                  <div key={p.id} className='rounded-lg border px-3 py-2'>
                    <div className='flex items-center justify-between'>
                      <p className='text-xs font-medium'>{p.name}</p>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] ${p.enabled ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-muted text-muted-foreground'}`}
                      >
                        {p.enabled ? 'Active' : 'Disabled'}
                      </span>
                    </div>
                    <p className='text-muted-foreground mt-0.5 text-[10px]'>
                      {p.severity} severity - {(p.rules || []).length} rule(s)
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function KpiCard({
  title,
  value,
  icon,
}: {
  title: string
  value: string
  icon: React.ReactNode
}) {
  return (
    <Card>
      <CardContent className='pt-6'>
        <div className='flex items-center justify-between'>
          <p className='text-muted-foreground text-sm font-medium'>{title}</p>
          {icon}
        </div>
        <div className='mt-2 text-2xl font-bold'>{value}</div>
      </CardContent>
    </Card>
  )
}
