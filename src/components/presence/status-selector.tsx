// Created and developed by Jai Singh
/**
 * StatusSelector - Dropdown to set your own presence status
 * Placed in the NavUser area of the sidebar
 */
import { useState } from 'react'
import { ChevronDown, MessageSquare, X } from 'lucide-react'
import {
  PRESENCE_STATUS_CONFIG,
  type PresenceStatus,
} from '@/lib/presence/types'
import { cn } from '@/lib/utils'
import { usePresence } from '@/context/presence-context'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { StatusIndicator } from './status-indicator'

interface StatusSelectorProps {
  className?: string
}

const statusOptions: { status: PresenceStatus; icon?: string }[] = [
  { status: 'online' },
  { status: 'away' },
  { status: 'busy' },
  { status: 'do_not_disturb' },
  { status: 'offline' },
]

export function StatusSelector({ className }: StatusSelectorProps) {
  const { myStatus, setMyStatus, customStatusText, setCustomStatusText } =
    usePresence()
  const [showCustomInput, setShowCustomInput] = useState(false)
  const [inputText, setInputText] = useState(customStatusText || '')

  const currentConfig = PRESENCE_STATUS_CONFIG[myStatus]

  const handleSaveCustom = () => {
    setCustomStatusText(inputText.trim() || null)
    setShowCustomInput(false)
  }

  const handleClearCustom = () => {
    setCustomStatusText(null)
    setInputText('')
    setShowCustomInput(false)
  }

  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className='text-muted-foreground hover:text-foreground hover:bg-accent/50 flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs transition-colors focus:outline-none'
            aria-label='Set status'
          >
            <StatusIndicator status={myStatus} size='xs' showTooltip={false} />
            <span className='max-w-[100px] truncate'>
              {customStatusText || currentConfig.label}
            </span>
            <ChevronDown className='h-3 w-3 shrink-0 opacity-50' />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='start' side='top' className='w-56'>
          <DropdownMenuLabel className='text-xs'>Set Status</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            {statusOptions.map(({ status }) => {
              const config = PRESENCE_STATUS_CONFIG[status]
              return (
                <DropdownMenuItem
                  key={status}
                  onClick={() => setMyStatus(status)}
                  className='gap-2'
                >
                  <span
                    className={cn('h-2 w-2 rounded-full', config.dotClass)}
                  />
                  <span className='flex-1'>{config.label}</span>
                  {status === myStatus && (
                    <span className='text-muted-foreground text-[10px]'>
                      Current
                    </span>
                  )}
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={(e) => {
              e.preventDefault()
              setShowCustomInput(true)
            }}
            className='gap-2'
          >
            <MessageSquare className='h-3.5 w-3.5' />
            <span>Set custom status...</span>
          </DropdownMenuItem>
          {customStatusText && (
            <DropdownMenuItem
              onClick={handleClearCustom}
              className='text-destructive gap-2'
            >
              <X className='h-3.5 w-3.5' />
              <span>Clear custom status</span>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Custom status input overlay */}
      {showCustomInput && (
        <div
          className='fixed inset-0 z-50 flex items-center justify-center bg-black/20'
          onClick={() => setShowCustomInput(false)}
        >
          <div
            className='bg-popover w-80 rounded-lg border p-4 shadow-lg'
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className='mb-2 text-sm font-medium'>Set a custom status</h3>
            <input
              type='text'
              placeholder="What's your status?"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveCustom()
                if (e.key === 'Escape') setShowCustomInput(false)
              }}
              className='border-input bg-background placeholder:text-muted-foreground focus:ring-ring w-full rounded-md border px-3 py-2 text-sm focus:ring-1 focus:outline-none'
              maxLength={100}
              autoFocus
            />
            <div className='mt-3 flex justify-end gap-2'>
              <button
                onClick={() => setShowCustomInput(false)}
                className='hover:bg-accent rounded-md border px-3 py-1.5 text-xs transition-colors'
              >
                Cancel
              </button>
              <button
                onClick={handleSaveCustom}
                className='bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-3 py-1.5 text-xs transition-colors'
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Created and developed by Jai Singh
