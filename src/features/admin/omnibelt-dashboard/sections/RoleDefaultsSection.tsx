// Created and developed by Jai Singh
/**
 * RoleDefaultsSection — per-role belt editors.
 *
 * Renders one `RoleBeltEditor` card per visible role (system + custom)
 * in the admin's org. System roles surface first.
 */
import { useMemo } from 'react'
import type { OmnibeltRoleConfig } from '@/lib/supabase/database.types'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { RoleBeltEditor } from '../components/RoleBeltEditor'
import { useOmnibeltAdminBootstrap } from '../hooks/useOmnibeltAdminBootstrap'

export function RoleDefaultsSection() {
  const bootstrap = useOmnibeltAdminBootstrap()

  const configByRole = useMemo<Map<string, OmnibeltRoleConfig>>(() => {
    const map = new Map<string, OmnibeltRoleConfig>()
    for (const c of bootstrap.data?.roleConfigs ?? []) {
      map.set(c.role_id, c)
    }
    return map
  }, [bootstrap.data?.roleConfigs])

  if (bootstrap.isLoading) {
    return (
      <div className='space-y-3'>
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className='h-72 w-full' />
        ))}
      </div>
    )
  }

  if (bootstrap.isError || !bootstrap.data) {
    return (
      <Card className='border-rose-500/40 bg-rose-500/5 p-4 text-sm text-rose-600'>
        Failed to load role defaults:{' '}
        {bootstrap.error instanceof Error
          ? bootstrap.error.message
          : 'unknown error'}
      </Card>
    )
  }

  const { roles, allowList } = bootstrap.data

  if (roles.length === 0) {
    return (
      <Card className='text-muted-foreground p-4 text-sm'>
        No roles are visible to this user. Ensure the role permissions are
        configured and that you have <code>roles.read</code>.
      </Card>
    )
  }

  return (
    <div className='space-y-4'>
      <p className='text-muted-foreground text-sm'>
        Each role&apos;s default belt applies to every user with that role at
        first login. Users can override pin order, hide tools, and switch skins
        inside the bounds you set here.
      </p>
      {roles.map((role) => (
        <RoleBeltEditor
          key={role.id}
          role={role}
          config={configByRole.get(role.id) ?? null}
          allowList={allowList}
        />
      ))}
    </div>
  )
}

// Created and developed by Jai Singh
