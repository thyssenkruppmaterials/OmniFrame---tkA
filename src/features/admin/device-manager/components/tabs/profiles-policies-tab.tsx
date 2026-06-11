// Created and developed by Jai Singh
import { useState } from 'react'
import { IconSearch, IconPlus, IconFile } from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useProfiles } from '../../hooks/use-agent-health'
import type { MdmProfile } from '../../types/device-manager.types'

export function ProfilesPoliciesTab() {
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const { data: profiles, isLoading, error } = useProfiles()

  const filtered = (profiles || []).filter(
    (p: MdmProfile) =>
      !search ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.identifier.toLowerCase().includes(search.toLowerCase())
  )
  const selected = filtered.find((p: MdmProfile) => p.id === selectedId)

  if (error) {
    return (
      <Card>
        <CardContent className='py-8 text-center'>
          <p className='text-destructive text-sm'>Failed to load profiles</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className='grid gap-6 lg:grid-cols-[320px_1fr]'>
      <Card>
        <CardHeader className='pb-3'>
          <div className='flex items-center justify-between'>
            <CardTitle className='text-base'>Profiles</CardTitle>
            <Button size='sm' className='h-7 text-xs'>
              <IconPlus className='mr-1 h-3 w-3' />
              Add
            </Button>
          </div>
        </CardHeader>
        <CardContent className='space-y-3'>
          <div className='relative'>
            <IconSearch className='text-muted-foreground absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2' />
            <Input
              placeholder='Search profiles...'
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
                  className='bg-muted/30 h-12 animate-pulse rounded-lg'
                />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <p className='text-muted-foreground py-8 text-center text-xs'>
              No profiles found
            </p>
          ) : (
            <div className='max-h-[500px] space-y-1 overflow-y-auto'>
              {filtered.map((p: MdmProfile) => (
                <button
                  key={p.id}
                  onClick={() =>
                    setSelectedId(p.id === selectedId ? null : p.id)
                  }
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors ${
                    p.id === selectedId
                      ? 'bg-primary/10 border-primary/20 border'
                      : 'hover:bg-muted/50 border border-transparent'
                  }`}
                >
                  <IconFile className='text-muted-foreground h-4 w-4 shrink-0' />
                  <div className='min-w-0 flex-1'>
                    <p className='truncate text-xs font-medium'>{p.name}</p>
                    <p className='text-muted-foreground truncate text-[10px]'>
                      {p.profile_type} - {p.scope}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className='pb-3'>
          <CardTitle className='text-base'>
            {selected ? selected.name : 'Profile Details'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!selected ? (
            <div className='flex h-48 items-center justify-center'>
              <p className='text-muted-foreground text-sm'>
                Select a profile to view details
              </p>
            </div>
          ) : (
            <div className='space-y-4'>
              <div className='grid gap-3 sm:grid-cols-2'>
                <DetailField label='Identifier' value={selected.identifier} />
                <DetailField label='Type' value={selected.profile_type} />
                <DetailField label='Scope' value={selected.scope} />
                <DetailField label='Version' value={String(selected.version)} />
                <DetailField
                  label='Removal Allowed'
                  value={selected.removal_allowed ? 'Yes' : 'No'}
                />
                <DetailField
                  label='Encrypted'
                  value={selected.is_encrypted ? 'Yes' : 'No'}
                />
              </div>
              {selected.payload_plist && (
                <div>
                  <p className='text-muted-foreground mb-1 text-xs font-medium'>
                    Payload (plist)
                  </p>
                  <pre className='bg-muted max-h-64 overflow-auto rounded-md p-3 text-xs'>
                    {selected.payload_plist}
                  </pre>
                </div>
              )}
              <p className='text-muted-foreground text-[10px]'>
                Created: {new Date(selected.created_at).toLocaleString()}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function DetailField({
  label,
  value,
}: {
  label: string
  value: string | null | undefined
}) {
  return (
    <div>
      <p className='text-muted-foreground text-[10px] font-medium uppercase'>
        {label}
      </p>
      <p className='text-sm'>{value || '—'}</p>
    </div>
  )
}

// Created and developed by Jai Singh
