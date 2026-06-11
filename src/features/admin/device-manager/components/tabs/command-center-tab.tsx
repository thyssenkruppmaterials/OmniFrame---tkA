// Created and developed by Jai Singh
import { useState } from 'react'
import {
  IconPlayerPlay,
  IconSearch,
  IconAlertTriangle,
  IconRefresh,
} from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  COMMAND_CATEGORIES,
  getCommandsByCategory,
  type CommandDefinition,
} from '../../constants/command-definitions'
import { useDeviceList } from '../../hooks/use-device-inventory'
import {
  useCommandList,
  useCommandApprovals,
  useQueueCommand,
} from '../../hooks/use-mdm-commands'
import type {
  MdmCommandType,
  MdmCommand,
  MdmDevice,
} from '../../types/device-manager.types'
import { ApprovalBanner } from '../shared/approval-banner'
import { CommandStatusBadge } from '../shared/command-status-badge'
import { DeviceIcon } from '../shared/device-icon'

export function CommandCenterTab() {
  const [selectedCommand, setSelectedCommand] =
    useState<CommandDefinition | null>(null)
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('')
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null)
  const [cmdSearch, setCmdSearch] = useState('')

  const {
    data: commandData,
    isLoading: loadingCommands,
    refetch,
  } = useCommandList({ page: 1, perPage: 20 })
  const { data: approvals } = useCommandApprovals()
  const { data: devicesData } = useDeviceList({ perPage: 100 })
  const queueMutation = useQueueCommand()

  const devices: MdmDevice[] =
    devicesData?.map((r: { device: MdmDevice }) => r.device) ?? []
  const commands = commandData?.commands ?? []
  const pendingApprovals = approvals?.length ?? 0

  const filteredCommands = COMMAND_CATEGORIES.flatMap((cat) => {
    if (categoryFilter && cat.id !== categoryFilter) return []
    return getCommandsByCategory(cat.id).filter(
      (c) =>
        !cmdSearch || c.label.toLowerCase().includes(cmdSearch.toLowerCase())
    )
  })

  const handleExecute = () => {
    if (!selectedCommand || !selectedDeviceId) return
    if (selectedCommand.destructive) {
      if (
        !confirm(
          `Are you sure you want to execute "${selectedCommand.label}"? This action is destructive and cannot be undone.`
        )
      )
        return
    }
    queueMutation.mutate({
      deviceId: selectedDeviceId,
      commandType: selectedCommand.type as MdmCommandType,
      payload: selectedCommand.defaultPayload || undefined,
    })
  }

  return (
    <div className='space-y-4'>
      <ApprovalBanner pendingCount={pendingApprovals} onReview={() => {}} />

      <div className='grid gap-4 lg:grid-cols-[280px_1fr_320px]'>
        <Card>
          <CardHeader className='pb-3'>
            <CardTitle className='text-base'>Commands</CardTitle>
          </CardHeader>
          <CardContent className='space-y-3'>
            <div className='relative'>
              <IconSearch className='text-muted-foreground absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2' />
              <Input
                placeholder='Search...'
                value={cmdSearch}
                onChange={(e) => setCmdSearch(e.target.value)}
                className='h-8 pl-8 text-xs'
              />
            </div>
            <div className='flex flex-wrap gap-1'>
              <Button
                variant={categoryFilter === null ? 'default' : 'outline'}
                size='sm'
                className='h-6 px-2 text-xs'
                onClick={() => setCategoryFilter(null)}
              >
                All
              </Button>
              {COMMAND_CATEGORIES.map((cat) => (
                <Button
                  key={cat.id}
                  variant={categoryFilter === cat.id ? 'default' : 'outline'}
                  size='sm'
                  className='h-6 px-2 text-xs'
                  onClick={() => setCategoryFilter(cat.id)}
                >
                  {cat.label}
                </Button>
              ))}
            </div>
            <div className='max-h-[500px] space-y-0.5 overflow-y-auto'>
              {filteredCommands.map((cmd) => (
                <button
                  key={cmd.type}
                  onClick={() => setSelectedCommand(cmd)}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                    selectedCommand?.type === cmd.type
                      ? 'bg-primary/10 text-primary'
                      : 'hover:bg-muted/50'
                  }`}
                >
                  {cmd.destructive && (
                    <IconAlertTriangle className='h-3 w-3 shrink-0 text-red-500' />
                  )}
                  <span className='truncate'>{cmd.label}</span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className='pb-3'>
            <CardTitle className='text-base'>
              {selectedCommand ? selectedCommand.label : 'Select a Command'}
            </CardTitle>
            {selectedCommand && (
              <p className='text-muted-foreground text-xs'>
                {selectedCommand.description}
              </p>
            )}
          </CardHeader>
          <CardContent>
            {!selectedCommand ? (
              <div className='flex h-48 items-center justify-center'>
                <p className='text-muted-foreground text-sm'>
                  Choose a command from the palette
                </p>
              </div>
            ) : (
              <div className='space-y-4'>
                {selectedCommand.destructive && (
                  <div className='flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 dark:border-red-800 dark:bg-red-950/50'>
                    <IconAlertTriangle className='h-4 w-4 text-red-600' />
                    <p className='text-xs text-red-700 dark:text-red-300'>
                      Destructive action - requires approval
                    </p>
                  </div>
                )}
                <div>
                  <label className='text-muted-foreground mb-1 block text-xs font-medium'>
                    Target Device
                  </label>
                  <select
                    value={selectedDeviceId}
                    onChange={(e) => setSelectedDeviceId(e.target.value)}
                    className='border-input bg-background w-full rounded-md border px-3 py-2 text-sm'
                  >
                    <option value=''>Select a device...</option>
                    {devices.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.device_name || d.serial_number || d.udid || d.id}
                      </option>
                    ))}
                  </select>
                </div>
                {selectedCommand.defaultPayload && (
                  <div>
                    <label className='text-muted-foreground mb-1 block text-xs font-medium'>
                      Payload
                    </label>
                    <pre className='bg-muted max-h-32 overflow-auto rounded-md p-3 text-xs'>
                      {JSON.stringify(selectedCommand.defaultPayload, null, 2)}
                    </pre>
                  </div>
                )}
                <div className='flex items-center gap-2 pt-2'>
                  <span className='text-muted-foreground text-xs'>
                    Category: {selectedCommand.category}
                  </span>
                  <span className='text-muted-foreground text-xs'>|</span>
                  <span className='text-muted-foreground text-xs'>
                    Permission: {selectedCommand.permission}
                  </span>
                </div>
                <Button
                  onClick={handleExecute}
                  disabled={!selectedDeviceId || queueMutation.isPending}
                  variant={
                    selectedCommand.destructive ? 'destructive' : 'default'
                  }
                  className='w-full'
                >
                  <IconPlayerPlay className='mr-1 h-4 w-4' />
                  {queueMutation.isPending
                    ? 'Queueing...'
                    : selectedCommand.destructive
                      ? `Execute ${selectedCommand.label}`
                      : `Queue ${selectedCommand.label}`}
                </Button>
                {queueMutation.isSuccess && (
                  <p className='text-xs text-green-600'>
                    Command queued successfully
                  </p>
                )}
                {queueMutation.isError && (
                  <p className='text-destructive text-xs'>
                    Failed to queue command
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className='pb-3'>
            <div className='flex items-center justify-between'>
              <CardTitle className='text-base'>Queue & History</CardTitle>
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
            {loadingCommands ? (
              <div className='space-y-2'>
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className='bg-muted/30 h-14 animate-pulse rounded-lg'
                  />
                ))}
              </div>
            ) : commands.length === 0 ? (
              <div className='flex h-48 items-center justify-center'>
                <p className='text-muted-foreground text-sm'>No commands yet</p>
              </div>
            ) : (
              <div className='max-h-[500px] space-y-1.5 overflow-y-auto'>
                {commands.map((cmd: MdmCommand) => {
                  const device = devices.find((d) => d.id === cmd.device_id)
                  return (
                    <div
                      key={cmd.id}
                      className='flex items-center gap-2 rounded-lg border px-3 py-2'
                    >
                      <DeviceIcon
                        model={device?.model ?? null}
                        productName={device?.product_name ?? null}
                        size={16}
                      />
                      <div className='min-w-0 flex-1'>
                        <p className='truncate text-xs font-medium'>
                          {cmd.command_type}
                        </p>
                        <p className='text-muted-foreground truncate text-[10px]'>
                          {device?.device_name || cmd.device_id.slice(0, 8)}
                        </p>
                      </div>
                      <CommandStatusBadge status={cmd.status} />
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

// Created and developed by Jai Singh
