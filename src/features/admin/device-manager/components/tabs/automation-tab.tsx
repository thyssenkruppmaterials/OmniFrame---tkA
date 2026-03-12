import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  IconSearch,
  IconPlus,
  IconBolt,
  IconPlayerPlay,
  IconHistory,
} from '@tabler/icons-react'
import { DeviceManagerService } from '@/lib/supabase/device-manager.service'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useWorkflows } from '../../hooks/use-agent-health'
import type {
  AutomationWorkflow,
  WorkflowExecution,
} from '../../types/device-manager.types'

export function AutomationTab() {
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const { data: workflows, isLoading, error } = useWorkflows()

  const filtered = (workflows || []).filter(
    (w: AutomationWorkflow) =>
      !search ||
      w.name.toLowerCase().includes(search.toLowerCase()) ||
      w.trigger_type.toLowerCase().includes(search.toLowerCase())
  )
  const selected = filtered.find((w: AutomationWorkflow) => w.id === selectedId)

  const { data: executions } = useQuery({
    queryKey: ['mdm-workflow-executions', selectedId],
    queryFn: () => DeviceManagerService.getWorkflowExecutions(selectedId!),
    enabled: !!selectedId,
    staleTime: 30_000,
  })

  if (error) {
    return (
      <Card>
        <CardContent className='py-8 text-center'>
          <p className='text-destructive text-sm'>Failed to load workflows</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className='grid gap-6 lg:grid-cols-[320px_1fr]'>
      <Card>
        <CardHeader className='pb-3'>
          <div className='flex items-center justify-between'>
            <CardTitle className='text-base'>Workflows</CardTitle>
            <Button size='sm' className='h-7 text-xs'>
              <IconPlus className='mr-1 h-3 w-3' />
              New
            </Button>
          </div>
        </CardHeader>
        <CardContent className='space-y-3'>
          <div className='relative'>
            <IconSearch className='text-muted-foreground absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2' />
            <Input
              placeholder='Search workflows...'
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className='h-8 pl-8 text-xs'
            />
          </div>
          {isLoading ? (
            <div className='space-y-2'>
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className='bg-muted/30 h-14 animate-pulse rounded-lg'
                />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className='py-8 text-center'>
              <IconBolt className='text-muted-foreground mx-auto h-6 w-6' />
              <p className='text-muted-foreground mt-2 text-xs'>
                {search ? 'No matching workflows' : 'No workflows yet'}
              </p>
            </div>
          ) : (
            <div className='max-h-[500px] space-y-1 overflow-y-auto'>
              {filtered.map((w: AutomationWorkflow) => (
                <button
                  key={w.id}
                  onClick={() =>
                    setSelectedId(w.id === selectedId ? null : w.id)
                  }
                  className={`flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left transition-colors ${
                    w.id === selectedId
                      ? 'bg-primary/10 border-primary/20'
                      : 'hover:bg-muted/50 border-transparent'
                  }`}
                >
                  <div
                    className={`h-2 w-2 shrink-0 rounded-full ${w.enabled ? 'bg-green-500' : 'bg-gray-400'}`}
                  />
                  <div className='min-w-0 flex-1'>
                    <p className='truncate text-xs font-medium'>{w.name}</p>
                    <p className='text-muted-foreground text-[10px]'>
                      Trigger: {w.trigger_type}
                    </p>
                  </div>
                  <div className='text-right'>
                    <p className='text-muted-foreground text-[10px]'>
                      {w.execution_count} runs
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className='space-y-4'>
        <Card>
          <CardHeader className='pb-3'>
            <CardTitle className='text-base'>
              {selected ? selected.name : 'Workflow Details'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!selected ? (
              <div className='flex h-48 items-center justify-center'>
                <p className='text-muted-foreground text-sm'>
                  Select a workflow to view details
                </p>
              </div>
            ) : (
              <div className='space-y-4'>
                <div className='grid gap-3 sm:grid-cols-2'>
                  <DetailField
                    label='Trigger Type'
                    value={selected.trigger_type}
                  />
                  <DetailField
                    label='Status'
                    value={selected.enabled ? 'Enabled' : 'Disabled'}
                  />
                  <DetailField
                    label='Executions'
                    value={String(selected.execution_count)}
                  />
                  <DetailField
                    label='Last Triggered'
                    value={
                      selected.last_triggered_at
                        ? new Date(selected.last_triggered_at).toLocaleString()
                        : 'Never'
                    }
                  />
                </div>
                {selected.description && (
                  <div>
                    <p className='text-muted-foreground text-[10px] font-medium uppercase'>
                      Description
                    </p>
                    <p className='text-sm'>{selected.description}</p>
                  </div>
                )}
                <div>
                  <p className='text-muted-foreground mb-1 text-[10px] font-medium uppercase'>
                    Trigger Config
                  </p>
                  <pre className='bg-muted max-h-32 overflow-auto rounded-md p-2 text-xs'>
                    {JSON.stringify(selected.trigger_config, null, 2)}
                  </pre>
                </div>
                <div>
                  <p className='text-muted-foreground mb-1 text-[10px] font-medium uppercase'>
                    Actions ({(selected.actions || []).length})
                  </p>
                  <pre className='bg-muted max-h-32 overflow-auto rounded-md p-2 text-xs'>
                    {JSON.stringify(selected.actions, null, 2)}
                  </pre>
                </div>
                <div className='bg-muted/30 flex items-center justify-center rounded-lg border border-dashed py-8'>
                  <div className='text-center'>
                    <IconBolt className='text-muted-foreground mx-auto h-6 w-6' />
                    <p className='text-muted-foreground mt-1 text-xs'>
                      Visual workflow editor (Phase B)
                    </p>
                    <p className='text-muted-foreground text-[10px]'>
                      @xyflow/react integration pending
                    </p>
                  </div>
                </div>
                <p className='text-muted-foreground text-[10px]'>
                  Created: {new Date(selected.created_at).toLocaleString()}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {selected && (
          <Card>
            <CardHeader className='pb-3'>
              <div className='flex items-center gap-2'>
                <IconHistory className='h-4 w-4' />
                <CardTitle className='text-base'>Execution Log</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {!executions || (executions as unknown[]).length === 0 ? (
                <p className='text-muted-foreground py-6 text-center text-xs'>
                  No executions yet
                </p>
              ) : (
                <div className='max-h-64 space-y-1.5 overflow-y-auto'>
                  {(executions as WorkflowExecution[]).map((exec) => (
                    <div
                      key={exec.id}
                      className='flex items-center gap-2 rounded-lg border px-3 py-2'
                    >
                      <IconPlayerPlay
                        className={`h-3 w-3 shrink-0 ${exec.status === 'Completed' ? 'text-green-500' : exec.status === 'Failed' ? 'text-red-500' : 'text-amber-500'}`}
                      />
                      <div className='min-w-0 flex-1'>
                        <p className='text-xs font-medium'>{exec.status}</p>
                        <p className='text-muted-foreground text-[10px]'>
                          {new Date(exec.started_at).toLocaleString()}
                        </p>
                      </div>
                      {exec.error_message && (
                        <span className='text-destructive truncate text-[10px]'>
                          {exec.error_message}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className='text-muted-foreground text-[10px] font-medium uppercase'>
        {label}
      </p>
      <p className='text-sm'>{value}</p>
    </div>
  )
}
