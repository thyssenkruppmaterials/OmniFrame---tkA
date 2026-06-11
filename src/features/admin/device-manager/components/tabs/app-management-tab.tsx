// Created and developed by Jai Singh
import { useState } from 'react'
import { IconSearch, IconApps } from '@tabler/icons-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useApps } from '../../hooks/use-agent-health'
import type { MdmApp } from '../../types/device-manager.types'

export function AppManagementTab() {
  const [search, setSearch] = useState('')
  const { data: apps, isLoading, error } = useApps()

  const filtered = (apps || []).filter(
    (a: MdmApp) =>
      !search ||
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.bundle_id.toLowerCase().includes(search.toLowerCase())
  )

  if (error) {
    return (
      <Card>
        <CardContent className='py-8 text-center'>
          <p className='text-destructive text-sm'>Failed to load apps</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className='space-y-4'>
      <div className='flex items-center gap-3'>
        <div className='relative max-w-md flex-1'>
          <IconSearch className='text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2' />
          <Input
            placeholder='Search apps by name or bundle ID...'
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className='pl-9'
          />
        </div>
      </div>

      <div className='grid gap-6 lg:grid-cols-[1fr_300px]'>
        <Card>
          <CardHeader className='pb-3'>
            <CardTitle className='text-base'>
              App Catalog{' '}
              <span className='text-muted-foreground ml-1 text-sm font-normal'>
                ({filtered.length})
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className='grid gap-3 sm:grid-cols-2'>
                {[1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className='bg-muted/30 h-20 animate-pulse rounded-lg'
                  />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className='py-12 text-center'>
                <IconApps className='text-muted-foreground mx-auto h-8 w-8' />
                <p className='text-muted-foreground mt-2 text-sm'>
                  {search
                    ? 'No apps match your search'
                    : 'No managed apps configured'}
                </p>
              </div>
            ) : (
              <div className='grid gap-3 sm:grid-cols-2'>
                {filtered.map((app: MdmApp) => (
                  <div
                    key={app.id}
                    className='hover:bg-muted/30 flex items-center gap-3 rounded-lg border p-3 transition-colors'
                  >
                    <div className='bg-muted flex h-10 w-10 shrink-0 items-center justify-center rounded-lg'>
                      {app.icon_url ? (
                        <img
                          src={app.icon_url}
                          alt={app.name}
                          className='h-8 w-8 rounded'
                        />
                      ) : (
                        <IconApps className='text-muted-foreground h-5 w-5' />
                      )}
                    </div>
                    <div className='min-w-0 flex-1'>
                      <p className='truncate text-sm font-medium'>{app.name}</p>
                      <p className='text-muted-foreground truncate text-xs'>
                        {app.bundle_id}
                      </p>
                      <div className='mt-1 flex items-center gap-2'>
                        {app.version && (
                          <span className='text-muted-foreground text-[10px]'>
                            v{app.version}
                          </span>
                        )}
                        {app.managed && (
                          <span className='rounded bg-blue-100 px-1 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'>
                            Managed
                          </span>
                        )}
                        {app.blacklisted && (
                          <span className='rounded bg-red-100 px-1 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400'>
                            Blocked
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className='pb-3'>
            <CardTitle className='text-base'>License Summary</CardTitle>
          </CardHeader>
          <CardContent className='space-y-3'>
            {isLoading ? (
              <div className='space-y-3'>
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className='bg-muted/30 h-12 animate-pulse rounded-lg'
                  />
                ))}
              </div>
            ) : (
              <>
                {filtered.filter((a: MdmApp) => a.vpp_license_count != null)
                  .length === 0 ? (
                  <p className='text-muted-foreground py-8 text-center text-xs'>
                    No VPP licenses configured
                  </p>
                ) : (
                  filtered
                    .filter((a: MdmApp) => a.vpp_license_count != null)
                    .map((app: MdmApp) => {
                      const total = app.vpp_license_count || 0
                      const used = app.vpp_licenses_used || 0
                      const pct =
                        total > 0 ? Math.round((used / total) * 100) : 0
                      return (
                        <div key={app.id}>
                          <div className='flex items-center justify-between text-xs'>
                            <span className='truncate font-medium'>
                              {app.name}
                            </span>
                            <span className='text-muted-foreground'>
                              {used}/{total}
                            </span>
                          </div>
                          <div className='bg-muted mt-1 h-2 w-full rounded-full'>
                            <div
                              className={`h-2 rounded-full ${pct > 90 ? 'bg-red-500' : pct > 75 ? 'bg-amber-500' : 'bg-green-500'}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      )
                    })
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

// Created and developed by Jai Singh
