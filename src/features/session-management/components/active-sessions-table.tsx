// Created and developed by Jai Singh
import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { ColumnDef } from '@tanstack/react-table'
import {
  IconDeviceDesktop,
  IconDeviceMobile,
  IconDeviceTablet,
  IconDots,
  IconEye,
  IconMapPin,
  IconUserOff,
} from '@tabler/icons-react'
import { logger } from '@/lib/utils/logger'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { PermissionGuard } from '@/components/auth/PermissionGuard'
import { DataTable } from '@/components/data-table/data-table'
import type { UserSession } from '../types'

interface ActiveSessionsTableProps {
  sessions: UserSession[]
  onTerminateSession: (sessionId: string) => void
  isLoading: boolean
}

export function ActiveSessionsTable({
  sessions,
  onTerminateSession,
  isLoading,
}: ActiveSessionsTableProps) {
  const [terminateSessionId, setTerminateSessionId] = useState<string | null>(
    null
  )

  const getDeviceIcon = (deviceType: string) => {
    switch (deviceType) {
      case 'Mobile':
        return <IconDeviceMobile className='h-4 w-4' />
      case 'Tablet':
        return <IconDeviceTablet className='h-4 w-4' />
      default:
        return <IconDeviceDesktop className='h-4 w-4' />
    }
  }

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'superadmin':
        return 'destructive'
      case 'admin':
        return 'default'
      case 'manager':
        return 'secondary'
      case 'cashier':
        return 'outline'
      default:
        return 'outline'
    }
  }

  const columns: ColumnDef<UserSession>[] = [
    {
      accessorKey: 'user_name',
      header: 'User',
      cell: ({ row }) => {
        const session = row.original
        const initials = session.user_name
          ? session.user_name
              .split(' ')
              .map((n) => n[0])
              .join('')
              .toUpperCase()
          : 'UN'

        return (
          <div className='flex items-center space-x-3'>
            <Avatar className='h-8 w-8'>
              <AvatarFallback className='text-xs'>{initials}</AvatarFallback>
            </Avatar>
            <div>
              <div className='font-medium'>
                {session.user_name || 'Unknown User'}
              </div>
              <div className='text-muted-foreground text-sm'>
                {session.user_email}
              </div>
            </div>
          </div>
        )
      },
    },
    {
      accessorKey: 'user_role',
      header: 'Role',
      cell: ({ row }) => {
        const role = row.getValue('user_role') as string
        return (
          <Badge variant={getRoleColor(role)} className='capitalize'>
            {role || 'viewer'}
          </Badge>
        )
      },
    },
    {
      accessorKey: 'device_type',
      header: 'Device',
      cell: ({ row }) => {
        const session = row.original
        const displayName =
          session.device_name || session.device_type || 'Desktop'
        const hasCustomName = !!session.device_name

        return (
          <div className='flex items-center space-x-2'>
            {getDeviceIcon(session.device_type || 'Desktop')}
            <div>
              <div
                className={`text-sm font-medium ${hasCustomName ? 'text-primary' : ''}`}
              >
                {displayName}
              </div>
              <div className='text-muted-foreground text-xs'>
                {session.browser || 'Unknown'}
              </div>
            </div>
          </div>
        )
      },
    },
    {
      accessorKey: 'ip_address',
      header: 'Location',
      cell: ({ row }) => {
        const session = row.original
        return (
          <div className='flex items-center space-x-2'>
            <IconMapPin className='text-muted-foreground h-4 w-4' />
            <div>
              <div className='text-sm font-medium'>
                {session.location || 'Unknown'}
              </div>
              <div className='text-muted-foreground text-xs'>
                {session.ip_address}
              </div>
            </div>
          </div>
        )
      },
    },
    {
      accessorKey: 'last_activity',
      header: 'Last Activity',
      cell: ({ row }) => {
        const lastActivity = row.getValue('last_activity') as string
        return (
          <div>
            <div className='text-sm font-medium'>
              {formatDistanceToNow(new Date(lastActivity), { addSuffix: true })}
            </div>
            <div className='text-muted-foreground text-xs'>
              {new Date(lastActivity).toLocaleTimeString()}
            </div>
          </div>
        )
      },
    },
    {
      accessorKey: 'time_remaining',
      header: 'Expires In',
      cell: ({ row }) => {
        const timeRemaining = row.getValue('time_remaining') as string
        const isExpiringSoon =
          timeRemaining.includes('m') &&
          parseInt(timeRemaining) < 30 &&
          !timeRemaining.includes('h')

        return (
          <Badge variant={isExpiringSoon ? 'destructive' : 'secondary'}>
            {timeRemaining}
          </Badge>
        )
      },
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => {
        const session = row.original

        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant='ghost'
                className='flex h-8 w-8 p-0'
                onClick={(e) => e.stopPropagation()}
              >
                <IconDots className='h-4 w-4' />
                <span className='sr-only'>Open menu</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align='end'
              onCloseAutoFocus={(e) => e.preventDefault()}
            >
              <DropdownMenuItem
                onClick={() => logger.log('View session details:', session.id)}
              >
                <IconEye className='mr-2 h-4 w-4' />
                View Details
              </DropdownMenuItem>
              <PermissionGuard resource='sessions' action='manage'>
                <DropdownMenuItem
                  onClick={() => setTerminateSessionId(session.id)}
                  className='text-destructive focus:text-destructive'
                >
                  <IconUserOff className='mr-2 h-4 w-4' />
                  Terminate Session
                </DropdownMenuItem>
              </PermissionGuard>
            </DropdownMenuContent>
          </DropdownMenu>
        )
      },
    },
  ]

  const handleTerminateSession = () => {
    if (terminateSessionId) {
      onTerminateSession(terminateSessionId)
      setTerminateSessionId(null)
    }
  }

  return (
    <>
      {isLoading ? (
        <div className='flex items-center justify-center py-8'>
          <div className='text-muted-foreground'>Loading sessions...</div>
        </div>
      ) : (
        <DataTable columns={columns} data={sessions} />
      )}

      {/* Terminate Session Confirmation Dialog */}
      <AlertDialog
        open={!!terminateSessionId}
        onOpenChange={() => setTerminateSessionId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Terminate Session</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to terminate this user session? This will
              immediately log out the user and they will need to sign in again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleTerminateSession}
              className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
            >
              Terminate Session
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

// Created and developed by Jai Singh
