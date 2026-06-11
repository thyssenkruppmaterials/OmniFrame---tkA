// Created and developed by Jai Singh
import { IconCircleFilled, IconServer, IconStack2 } from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { RailwayServiceInfo } from '../../services/railway-monitoring.service'

interface ServicePanelProps {
  services: RailwayServiceInfo[]
  selectedServiceId: string | null
  onSelectService: (serviceId: string | null) => void
  isLoading: boolean
  environmentName?: string
}

function deploymentStatusColor(status: string | undefined): string {
  switch (status?.toUpperCase()) {
    case 'SUCCESS':
      return 'text-emerald-500'
    case 'DEPLOYING':
    case 'BUILDING':
    case 'INITIALIZING':
      return 'text-blue-500 animate-pulse'
    case 'FAILED':
    case 'CRASHED':
      return 'text-destructive'
    case 'REMOVED':
    case 'SLEEPING':
      return 'text-muted-foreground'
    default:
      return 'text-muted-foreground'
  }
}

function statusLabel(status: string | undefined): string {
  if (!status) return 'Unknown'
  return status.charAt(0) + status.slice(1).toLowerCase()
}

export function ServicePanel({
  services,
  selectedServiceId,
  onSelectService,
  isLoading,
  environmentName = 'production',
}: ServicePanelProps) {
  return (
    <div className='bg-card flex h-full flex-col border-r'>
      <div className='border-b px-3 py-2.5'>
        <div className='flex items-center gap-2'>
          <IconStack2 size={14} className='text-muted-foreground' />
          <span className='text-foreground text-xs font-medium'>Services</span>
        </div>
        <span className='text-muted-foreground text-[10px]'>
          {environmentName}
        </span>
      </div>

      <button
        onClick={() => onSelectService(null)}
        className={cn(
          'flex items-center gap-2 border-b px-3 py-2.5 text-left text-xs transition-colors',
          selectedServiceId === null
            ? 'bg-primary/10 text-primary'
            : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
        )}
      >
        <IconServer size={13} />
        <span className='font-medium'>All Services</span>
        <Badge variant='secondary' className='ml-auto h-4 px-1.5 text-[10px]'>
          {services.length}
        </Badge>
      </button>

      <ScrollArea className='flex-1'>
        {isLoading && services.length === 0 && (
          <div className='text-muted-foreground px-3 py-4 text-center text-xs'>
            Loading services...
          </div>
        )}
        {services.map((svc) => {
          const status = svc.latestDeployment?.status
          const isSelected = selectedServiceId === svc.id
          return (
            <button
              key={svc.id}
              onClick={() => onSelectService(svc.id)}
              className={cn(
                'flex w-full flex-col gap-0.5 border-b px-3 py-2.5 text-left transition-colors',
                isSelected
                  ? 'bg-primary/10 text-primary'
                  : 'text-foreground hover:bg-accent hover:text-accent-foreground'
              )}
            >
              <div className='flex items-center gap-2'>
                <IconCircleFilled
                  size={7}
                  className={deploymentStatusColor(status)}
                />
                <span className='truncate text-xs font-medium'>{svc.name}</span>
              </div>
              <div className='flex items-center gap-2 pl-[15px]'>
                <span
                  className={cn('text-[10px]', deploymentStatusColor(status))}
                >
                  {statusLabel(status)}
                </span>
                {svc.region && (
                  <span className='text-muted-foreground text-[10px]'>
                    {svc.region}
                  </span>
                )}
              </div>
            </button>
          )
        })}
      </ScrollArea>
    </div>
  )
}

// Created and developed by Jai Singh
