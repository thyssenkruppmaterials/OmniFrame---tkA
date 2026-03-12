import { useEffect, useMemo } from 'react'
import { useNavigationStore } from '@/stores/navigationStore'
import { usePermissionStore } from '@/stores/permissionStore'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { usePresenceOptional } from '@/context/presence-context'
import { usePresenceVisibility } from '@/hooks/use-presence-visibility'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
  SidebarSeparator,
  useSidebar,
} from '@/components/ui/sidebar'
import { NavUser } from '@/components/layout/nav-user'
import { OptimizedNavGroup } from '@/components/layout/optimized-nav-group'
import { TeamSwitcher } from '@/components/layout/team-switcher'
import { OnlineUsersPanel } from '@/components/presence/online-users-panel'
import { getSidebarData } from './data/sidebar-data'

export function OptimizedAppSidebar({
  ...props
}: React.ComponentProps<typeof Sidebar>) {
  const { authState } = useUnifiedAuth()
  const { user, profile } = authState
  const presence = usePresenceOptional()
  const { canViewPresence, visibility } = usePresenceVisibility()
  usePermissionStore() // Subscribe to permission store for OptimizedNavGroup re-renders
  const { initializeExpandedGroups } = useNavigationStore()
  const { state: sidebarState } = useSidebar()

  // Step 16: Load persisted expanded nav group state for the current user
  useEffect(() => {
    if (user?.id) {
      initializeExpandedGroups(user.id)
    }
  }, [user?.id, initializeExpandedGroups])

  // Memoize sidebar data to prevent recalculation on every render
  // Include permission store states as dependencies to recalculate when permissions change
  const sidebarData = useMemo(() => {
    const data = getSidebarData(user, profile)
    return data
  }, [user, profile])

  return (
    <Sidebar collapsible='icon' variant='floating' {...props}>
      <SidebarHeader>
        <TeamSwitcher teams={sidebarData.teams} />
      </SidebarHeader>
      <SidebarContent>
        {sidebarData.navGroups.map((props) => (
          <OptimizedNavGroup key={props.title} {...props} />
        ))}
      </SidebarContent>
      {presence && canViewPresence && (
        <>
          <SidebarSeparator />
          {visibility === 'count_only' ? (
            <OnlineUsersPanel collapsed={true} />
          ) : (
            <OnlineUsersPanel collapsed={sidebarState === 'collapsed'} />
          )}
        </>
      )}
      <SidebarFooter>
        <NavUser user={sidebarData.user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
