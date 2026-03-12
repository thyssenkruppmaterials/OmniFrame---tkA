/**
 * usePresenceTracker - App-level hook (mount once in AuthenticatedLayout)
 * Initializes the presence service, manages lifecycle, and provides
 * the presence context value.
 */
import { useEffect, useRef, useCallback, useState, useMemo } from 'react'
import { useLocation } from '@tanstack/react-router'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { presenceService } from '@/lib/presence/presence.service'
import type {
  PresenceStatus,
  PresenceUser,
  OnlineUsersState,
  PresenceContextType,
} from '@/lib/presence/types'

export function usePresenceTracker(): PresenceContextType {
  const { authState } = useUnifiedAuth()
  const { user, profile, isAuthenticated } = authState
  const location = useLocation()

  // State - initialize from service's saved preference so UI is in sync on load
  const [myStatus, setMyStatusState] = useState<PresenceStatus>(() =>
    presenceService.getManualStatus()
  )
  const [customStatusText, setCustomStatusTextState] = useState<string | null>(
    null
  )
  const [presenceUsers, setPresenceUsers] = useState<PresenceUser[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const [channelError, setChannelError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const initializedRef = useRef(false)
  const orgIdRef = useRef<string | null>(null)

  // Initialize presence service when authenticated
  useEffect(() => {
    if (
      !isAuthenticated ||
      !user?.id ||
      !profile?.organization_id ||
      !profile?.email
    ) {
      return
    }

    // Don't re-initialize for same org
    if (
      initializedRef.current &&
      orgIdRef.current === profile.organization_id
    ) {
      return
    }

    initializedRef.current = true
    orgIdRef.current = profile.organization_id

    const roleName = profile?.role || null

    presenceService.initialize({
      userId: user.id,
      email: profile.email,
      fullName: profile.full_name,
      firstName: profile.first_name,
      avatarUrl: profile.avatar_url,
      roleName,
      roleId: profile.role_id || null,
      organizationId: profile.organization_id,
      onPresenceSync: (users) => {
        setPresenceUsers(users)
        setIsLoading(false)
      },
      onConnectionChange: (connected, error) => {
        setIsConnected(connected)
        setChannelError(error || null)
        if (connected) setIsLoading(false)
      },
    })

    // Sync React state with whatever the service loaded from localStorage
    setMyStatusState(presenceService.getManualStatus())

    return () => {
      presenceService.destroy()
      initializedRef.current = false
      orgIdRef.current = null
    }
  }, [
    isAuthenticated,
    user?.id,
    profile?.organization_id,
    profile?.email,
    profile?.full_name,
    profile?.first_name,
    profile?.avatar_url,
    profile?.role_id,
    profile?.role,
  ])

  // Track page changes
  useEffect(() => {
    if (initializedRef.current) {
      presenceService.updateCurrentPage(location.pathname)
    }
  }, [location.pathname])

  // Set status handler
  const setMyStatus = useCallback((status: PresenceStatus) => {
    setMyStatusState(status)
    presenceService.setStatus(status)
  }, [])

  // Set custom status text handler
  const setCustomStatusText = useCallback((text: string | null) => {
    setCustomStatusTextState(text)
    presenceService.setCustomStatusText(text)
  }, [])

  // Compute grouped users
  const onlineUsersState = useMemo<OnlineUsersState>(() => {
    const onlineUsers = presenceUsers.filter((u) => u.status === 'online')
    const awayUsers = presenceUsers.filter((u) => u.status === 'away')
    const busyUsers = presenceUsers.filter(
      (u) => u.status === 'busy' || u.status === 'do_not_disturb'
    )

    return {
      onlineUsers,
      awayUsers,
      busyUsers,
      allPresent: presenceUsers,
      totalOnline: onlineUsers.length,
      totalAway: awayUsers.length,
      totalBusy: busyUsers.length,
      totalPresent: presenceUsers.length,
      isLoading,
      error: channelError,
    }
  }, [presenceUsers, isLoading, channelError])

  // Single user lookup
  const getUserPresence = useCallback(
    (userId: string): PresenceUser | null => {
      return presenceUsers.find((u) => u.user_id === userId) || null
    },
    [presenceUsers]
  )

  const isUserOnline = useCallback(
    (userId: string): boolean => {
      return presenceUsers.some(
        (u) => u.user_id === userId && u.status !== 'offline'
      )
    },
    [presenceUsers]
  )

  return {
    myStatus,
    setMyStatus,
    setCustomStatusText,
    customStatusText,
    onlineUsersState,
    getUserPresence,
    isUserOnline,
    isConnected,
    channelError,
  }
}
