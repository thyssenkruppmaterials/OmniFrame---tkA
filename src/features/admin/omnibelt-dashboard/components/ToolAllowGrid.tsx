// Created and developed by Jai Singh
/**
 * ToolAllowGrid — 4-col checkbox grid for the org tool allow-list.
 *
 * Reads `TOOL_REGISTRY` from the launcher feature so the dashboard
 * and the launcher always agree on the canonical tool set. Each tile
 * shows the tool icon, label, category, description, and a
 * "X users pinned" stat from the prefs aggregate (best-effort —
 * empty when RLS restricts cross-user reads).
 *
 * The "Allowed" checkbox state is derived from the org allow-list:
 *   - `allowList === null`  → no restriction; every tool checked
 *   - `allowList === []`    → fully restricted; nothing checked
 *   - `allowList === [...]` → only listed tool IDs checked
 *
 * Save commits the current state via `useUpdateAllowList`. Reset
 * mirrors the current server-truth state.
 */
import { useEffect, useMemo, useState } from 'react'
import { IconCheck, IconRefresh } from '@tabler/icons-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { TOOL_REGISTRY, type ToolDef } from '@/features/omnibelt/tools/registry'
import { useUpdateAllowList } from '../hooks/useUpdateAllowList'
import { usePrefsAggregate } from '../hooks/useUsageStats'

interface ToolAllowGridProps {
  allowList: string[] | null
}

const CATEGORY_LABEL: Record<string, string> = {
  operations: 'Operations',
  admin: 'Admin',
  self: 'Self',
  help: 'Help',
}

export function ToolAllowGrid({ allowList }: ToolAllowGridProps) {
  const { mutate, isPending, error } = useUpdateAllowList()
  const { data: prefsAgg } = usePrefsAggregate()

  const initial = useMemo(() => buildInitial(allowList), [allowList])
  const [selected, setSelected] = useState<Record<string, boolean>>(initial)

  // Keep local selection in sync with server truth when the allow-list
  // changes externally (e.g. config invalidator fires from a peer admin).
  useEffect(() => {
    setSelected(buildInitial(allowList))
  }, [allowList])

  const grouped = useMemo(() => groupByCategory(TOOL_REGISTRY), [])
  const dirty = useMemo(
    () => !sameShape(selected, initial),
    [selected, initial]
  )

  const handleSave = () => {
    const ids = Object.keys(selected).filter((id) => selected[id])
    mutate(ids)
  }

  const handleReset = () => {
    setSelected(initial)
  }

  return (
    <div className='space-y-4'>
      <div className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
        <div className='space-y-1'>
          <p className='text-muted-foreground text-sm'>
            Toggle which tools land in the OmniBelt launcher for every user in
            this organization. Disabling a tool removes it from the panel and
            search without changing per-role defaults.
          </p>
          {allowList === null && (
            <p className='text-muted-foreground text-xs'>
              No allow-list row exists yet — every registry tool is allowed by
              default. Saving creates the row.
            </p>
          )}
        </div>
        <div className='flex items-center gap-2'>
          <Button
            variant='outline'
            size='sm'
            onClick={handleReset}
            disabled={!dirty || isPending}
          >
            <IconRefresh className='mr-2 h-4 w-4' aria-hidden /> Reset
          </Button>
          <Button size='sm' onClick={handleSave} disabled={!dirty || isPending}>
            <IconCheck className='mr-2 h-4 w-4' aria-hidden />
            {isPending ? 'Saving…' : 'Save Allow-list'}
          </Button>
        </div>
      </div>
      {error && (
        <Card className='border-rose-500/40 bg-rose-500/5 p-3 text-sm text-rose-600'>
          {error instanceof Error ? error.message : String(error)}
        </Card>
      )}
      <div className='space-y-6'>
        {grouped.map(([category, tools]) => (
          <section key={category} className='space-y-3'>
            <div className='flex items-center gap-2'>
              <h3 className='text-sm font-medium'>
                {CATEGORY_LABEL[category] ?? category}
              </h3>
              <Badge variant='outline' className='text-[10px]'>
                {tools.length}
              </Badge>
            </div>
            <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
              {tools.map((tool) => {
                const Icon = tool.icon
                const pinCount = prefsAgg?.pinned[tool.id] ?? 0
                return (
                  <Card
                    key={tool.id}
                    className='flex h-full flex-col gap-2 p-3'
                  >
                    <label className='flex cursor-pointer items-start gap-3'>
                      <Checkbox
                        checked={Boolean(selected[tool.id])}
                        onCheckedChange={(next) =>
                          setSelected((prev) => ({
                            ...prev,
                            [tool.id]: Boolean(next),
                          }))
                        }
                        aria-label={`Allow ${tool.label}`}
                      />
                      <div className='space-y-1 leading-tight'>
                        <div className='flex items-center gap-2'>
                          <Icon className='h-4 w-4' aria-hidden />
                          <span className='font-medium'>{tool.label}</span>
                        </div>
                        {tool.description && (
                          <p className='text-muted-foreground text-xs'>
                            {tool.description}
                          </p>
                        )}
                      </div>
                    </label>
                    <div className='text-muted-foreground mt-auto flex items-center justify-between text-[11px]'>
                      <span>
                        ID: <code>{tool.id}</code>
                      </span>
                      <span>
                        {pinCount > 0 ? `${pinCount} pinned` : 'No pins yet'}
                      </span>
                    </div>
                  </Card>
                )
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

function buildInitial(allowList: string[] | null): Record<string, boolean> {
  const result: Record<string, boolean> = {}
  if (allowList === null) {
    for (const t of TOOL_REGISTRY) result[t.id] = true
  } else {
    const allow = new Set(allowList)
    for (const t of TOOL_REGISTRY) result[t.id] = allow.has(t.id)
  }
  return result
}

function groupByCategory(tools: readonly ToolDef[]): [string, ToolDef[]][] {
  const map = new Map<string, ToolDef[]>()
  for (const tool of tools) {
    const list = map.get(tool.category) ?? []
    list.push(tool)
    map.set(tool.category, list)
  }
  return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b))
}

function sameShape(
  a: Record<string, boolean>,
  b: Record<string, boolean>
): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const k of keys) {
    if (Boolean(a[k]) !== Boolean(b[k])) return false
  }
  return true
}

// Created and developed by Jai Singh
