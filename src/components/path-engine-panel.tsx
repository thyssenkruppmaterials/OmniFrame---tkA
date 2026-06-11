// Created and developed by Jai Singh
import { useState, useMemo } from 'react'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  HelpCircle,
  Info,
  Loader2,
  MapPin,
  Plus,
  Route,
  Save,
  Search,
  Settings2,
  Trash2,
  Eye,
} from 'lucide-react'
import type {
  LocationResolutionRule,
  PathRule,
} from '@/lib/supabase/path-rules.service'
import { cn } from '@/lib/utils'
import { usePathRules } from '@/hooks/use-path-rules'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

type Tab = 'resolution' | 'path-rules' | 'preview'

const STRATEGY_LABELS: Record<string, { label: string; desc: string }> = {
  serpentine_zone: {
    label: 'Serpentine Zone',
    desc: 'Partition zones among counters; walk aisles in S-curve order.',
  },
  directional: {
    label: 'Directional',
    desc: 'Counter A goes top-to-bottom, counter B goes bottom-to-top.',
  },
  alternating_aisles: {
    label: 'Alternating Aisles',
    desc: 'Odd aisles to one set of counters, even aisles to another.',
  },
}

export default function PathEnginePanel() {
  const [tab, setTab] = useState<Tab>('resolution')
  const {
    resolutionRules,
    pathRules,
    resolvedPreview,
    claimOrderPreview,
    isLoading,
    isLoadingPreview,
    isLoadingClaimPreview,
    upsertResolutionRule,
    deleteResolutionRule,
    upsertPathRule,
    deletePathRule,
    testPattern,
  } = usePathRules()

  if (isLoading) {
    return (
      <div className='flex h-64 items-center justify-center'>
        <Loader2 className='text-muted-foreground h-8 w-8 animate-spin' />
      </div>
    )
  }

  return (
    <div className='space-y-4'>
      <div className='flex items-center gap-3'>
        <div className='rounded-xl bg-linear-to-br from-blue-500/20 to-blue-500/5 p-2.5'>
          <Route className='h-6 w-6 text-blue-600' />
        </div>
        <div>
          <h2 className='text-foreground text-xl font-bold tracking-tight'>
            Path Engine
          </h2>
          <p className='text-muted-foreground text-sm'>
            Configure how location codes are parsed and how workers are routed
            to prevent aisle congestion
          </p>
        </div>
      </div>

      <div className='flex gap-2 border-b pb-2'>
        <Button
          variant={tab === 'resolution' ? 'secondary' : 'ghost'}
          size='sm'
          onClick={() => setTab('resolution')}
        >
          <Settings2 className='mr-1.5 h-3.5 w-3.5' />
          Location Rules
        </Button>
        <Button
          variant={tab === 'path-rules' ? 'secondary' : 'ghost'}
          size='sm'
          onClick={() => setTab('path-rules')}
        >
          <MapPin className='mr-1.5 h-3.5 w-3.5' />
          Counting Rules
        </Button>
        <Button
          variant={tab === 'preview' ? 'secondary' : 'ghost'}
          size='sm'
          onClick={() => setTab('preview')}
        >
          <Eye className='mr-1.5 h-3.5 w-3.5' />
          Preview
        </Button>
      </div>

      {tab === 'resolution' && (
        <ResolutionRulesTab
          rules={resolutionRules}
          onUpsert={upsertResolutionRule}
          onDelete={deleteResolutionRule}
          testPattern={testPattern}
        />
      )}
      {tab === 'path-rules' && (
        <PathRulesTab
          rules={pathRules}
          onUpsert={upsertPathRule}
          onDelete={deletePathRule}
        />
      )}
      {tab === 'preview' && (
        <PreviewTab
          data={resolvedPreview}
          claimOrder={claimOrderPreview}
          isLoading={isLoadingPreview || isLoadingClaimPreview}
        />
      )}
    </div>
  )
}

function FieldHelp({ text }: { text: string }) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <HelpCircle className='text-muted-foreground inline h-3 w-3 cursor-help' />
        </TooltipTrigger>
        <TooltipContent side='top' className='max-w-64'>
          <p>{text}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function FieldLabel({
  children,
  help,
}: {
  children: React.ReactNode
  help?: string
}) {
  return (
    <Label className='flex items-center gap-1.5 text-xs'>
      {children}
      {help && <FieldHelp text={help} />}
    </Label>
  )
}

function resolveTemplate(
  template: string | null | undefined,
  groups: string[]
): string {
  if (!template) return ''
  let result = template
  for (let i = 0; i < groups.length; i++) {
    result = result.split(`\\${i + 1}`).join(groups[i])
  }
  return result
}

function ResolutionRulesTab({
  rules,
  onUpsert,
  onDelete,
  testPattern,
}: {
  rules: LocationResolutionRule[]
  onUpsert: (r: any) => Promise<any>
  onDelete: (id: string) => Promise<any>
  testPattern: (
    p: string,
    l: string[]
  ) => { location: string; matched: boolean; groups: string[] }[]
}) {
  const [editing, setEditing] =
    useState<Partial<LocationResolutionRule> | null>(null)
  const [testInput, setTestInput] = useState('')
  const [testResults, setTestResults] = useState<
    { location: string; matched: boolean; groups: string[] }[]
  >([])
  const [showAdvanced, setShowAdvanced] = useState(false)

  const handleTest = () => {
    if (!editing?.regex_pattern || !testInput.trim()) return
    const locs = testInput
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    setTestResults(testPattern(editing.regex_pattern, locs))
  }

  const handleSave = async () => {
    if (!editing) return
    await onUpsert(editing)
    setEditing(null)
  }

  return (
    <div className='grid grid-cols-1 gap-4 lg:grid-cols-2'>
      <Card>
        <CardHeader className='pb-3'>
          <div className='flex items-center justify-between'>
            <div>
              <CardTitle className='text-sm font-semibold'>
                Location Rules
              </CardTitle>
              <p className='text-muted-foreground mt-0.5 text-xs'>
                Define how location codes are parsed into zones and aisles
              </p>
            </div>
            <Button
              size='sm'
              variant='outline'
              onClick={() =>
                setEditing({
                  name: '',
                  warehouse_code: null,
                  regex_pattern: '',
                  canonical_bin_template: null,
                  zone_template: null,
                  aisle_template: null,
                  sequence_template: null,
                  priority: 0,
                  is_active: true,
                })
              }
            >
              <Plus className='mr-1.5 h-3.5 w-3.5' />
              Add Rule
            </Button>
          </div>
        </CardHeader>
        <CardContent className='space-y-2'>
          {rules.length === 0 && (
            <div className='py-8 text-center'>
              <Settings2 className='text-muted-foreground/50 mx-auto mb-2 h-8 w-8' />
              <p className='text-muted-foreground text-sm'>
                No location rules configured yet.
              </p>
              <p className='text-muted-foreground mt-1 text-xs'>
                Add a rule to teach the system how to read your location codes
                (e.g. RD-14-A-01).
              </p>
            </div>
          )}
          {rules.map((rule) => (
            <div
              key={rule.id}
              className={cn(
                'hover:bg-accent/50 flex cursor-pointer items-center justify-between rounded-lg border p-3 transition-colors',
                editing?.id === rule.id && 'border-primary bg-accent/30'
              )}
              onClick={() => setEditing({ ...rule })}
            >
              <div className='min-w-0 flex-1'>
                <p className='text-sm font-medium'>{rule.name}</p>
                <div className='text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs'>
                  <span>{rule.warehouse_code || 'All warehouses'}</span>
                  <span className='text-muted-foreground/40'>&middot;</span>
                  <span>Priority {rule.priority}</span>
                  {rule.zone_template && (
                    <>
                      <span className='text-muted-foreground/40'>&middot;</span>
                      <span>Zone: {rule.zone_template}</span>
                    </>
                  )}
                </div>
              </div>
              <div className='flex items-center gap-2'>
                <Badge variant={rule.is_active ? 'default' : 'secondary'}>
                  {rule.is_active ? 'Active' : 'Inactive'}
                </Badge>
                <ChevronRight className='text-muted-foreground h-4 w-4' />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {editing && (
        <Card>
          <CardHeader className='pb-3'>
            <CardTitle className='text-sm font-semibold'>
              {editing.id ? 'Edit Rule' : 'New Rule'}
            </CardTitle>
            <p className='text-muted-foreground mt-0.5 text-xs'>
              Configure how a type of location code is broken down into zone,
              aisle, and walking order.
            </p>
          </CardHeader>
          <CardContent className='space-y-4'>
            {/* Basic info */}
            <div>
              <FieldLabel>Rule Name</FieldLabel>
              <Input
                placeholder='e.g. Racks (RD/RE/RF)'
                value={editing.name ?? ''}
                onChange={(e) =>
                  setEditing((p) => ({ ...p, name: e.target.value }))
                }
              />
            </div>
            <div className='grid grid-cols-2 gap-3'>
              <div>
                <FieldLabel help='Leave blank to apply to all warehouses.'>
                  Warehouse
                </FieldLabel>
                <Input
                  placeholder='All warehouses'
                  value={editing.warehouse_code ?? ''}
                  onChange={(e) =>
                    setEditing((p) => ({
                      ...p,
                      warehouse_code: e.target.value || null,
                    }))
                  }
                />
              </div>
              <div>
                <FieldLabel help="Higher priority rules are checked first. Use the same priority for rules that don't overlap.">
                  Priority
                </FieldLabel>
                <Input
                  type='number'
                  value={editing.priority ?? 0}
                  onChange={(e) =>
                    setEditing((p) => ({
                      ...p,
                      priority: parseInt(e.target.value) || 0,
                    }))
                  }
                />
              </div>
            </div>

            <Separator />

            {/* Location pattern */}
            <div>
              <FieldLabel help='A pattern that matches your location codes. Use parentheses ( ) around each part you want to capture. Example: ^(RD)-(\d+)-([A-Z])-(\d+)$ captures the aisle, bay, level, and bin from RD-14-A-01.'>
                Location Pattern
              </FieldLabel>
              <Input
                className='font-mono text-xs'
                placeholder='e.g. ^(R[D-F])-(\d+)-([A-Z])-(\d+)$'
                value={editing.regex_pattern ?? ''}
                onChange={(e) =>
                  setEditing((p) => ({ ...p, regex_pattern: e.target.value }))
                }
              />
              <p className='text-muted-foreground mt-1 text-[11px]'>
                Each part in parentheses becomes a captured value (\1, \2, \3,
                ...) you can reference below.
              </p>
            </div>

            {/* Output mapping */}
            <div className='bg-muted/30 space-y-3 rounded-lg border p-3'>
              <div className='flex items-center gap-1.5'>
                <MapPin className='text-muted-foreground h-3.5 w-3.5' />
                <span className='text-xs font-medium'>Output Mapping</span>
                <span className='text-muted-foreground text-[11px]'>
                  &mdash; How captured values map to zone, aisle, and order
                </span>
              </div>

              <div>
                <FieldLabel help='The area or section name for these locations. Use a fixed name like "Racks" or a captured value like \1.'>
                  Zone Name
                </FieldLabel>
                <Input
                  className='text-xs'
                  placeholder='e.g. Racks, Kardex, Shelves'
                  value={editing.zone_template ?? ''}
                  onChange={(e) =>
                    setEditing((p) => ({
                      ...p,
                      zone_template: e.target.value || null,
                    }))
                  }
                />
              </div>

              <div>
                <FieldLabel help='Which captured value identifies the aisle. Workers in the same aisle are subject to collision limits. Use \1, \2, etc.'>
                  Aisle Identifier
                </FieldLabel>
                <Input
                  className='font-mono text-xs'
                  placeholder='e.g. \1'
                  value={editing.aisle_template ?? ''}
                  onChange={(e) =>
                    setEditing((p) => ({
                      ...p,
                      aisle_template: e.target.value || null,
                    }))
                  }
                />
              </div>

              <div>
                <FieldLabel help='Determines the order locations are visited within an aisle. Combine captured values to create a number, e.g. \2\4 turns bay 14 + bin 01 into 1401.'>
                  Walking Order
                </FieldLabel>
                <Input
                  className='font-mono text-xs'
                  placeholder='e.g. \2\4'
                  value={editing.sequence_template ?? ''}
                  onChange={(e) =>
                    setEditing((p) => ({
                      ...p,
                      sequence_template: e.target.value || null,
                    }))
                  }
                />
              </div>
            </div>

            {/* Advanced section */}
            <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
              <CollapsibleTrigger asChild>
                <button
                  type='button'
                  className='text-muted-foreground hover:text-foreground flex w-full items-center gap-1.5 text-xs transition-colors'
                >
                  <ChevronDown
                    className={cn(
                      'h-3 w-3 transition-transform',
                      !showAdvanced && '-rotate-90'
                    )}
                  />
                  Advanced Options
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className='mt-2 space-y-3'>
                <div>
                  <FieldLabel help='How the location code should be stored after normalization. Leave blank to keep the original. Use \1, \2, etc. to build a canonical form.'>
                    Normalized Location Format
                  </FieldLabel>
                  <Input
                    className='font-mono text-xs'
                    placeholder='e.g. \1-\2-\3-\4  (leave blank to keep original)'
                    value={editing.canonical_bin_template ?? ''}
                    onChange={(e) =>
                      setEditing((p) => ({
                        ...p,
                        canonical_bin_template: e.target.value || null,
                      }))
                    }
                  />
                </div>
              </CollapsibleContent>
            </Collapsible>

            <div className='flex items-center gap-2'>
              <Switch
                checked={editing.is_active ?? true}
                onCheckedChange={(v) =>
                  setEditing((p) => ({ ...p, is_active: v }))
                }
              />
              <Label className='text-xs'>Active</Label>
            </div>

            <Separator />

            {/* Test section */}
            <div>
              <div className='mb-1.5 flex items-center gap-1.5'>
                <Search className='text-muted-foreground h-3.5 w-3.5' />
                <span className='text-xs font-medium'>Test Your Rule</span>
              </div>
              <p className='text-muted-foreground mb-2 text-[11px]'>
                Paste sample location codes to verify they are parsed correctly.
              </p>
              <Textarea
                rows={3}
                className='font-mono text-xs'
                placeholder={'RD-14-A-01\nK3-01-01-2\nSF-22-A-01'}
                value={testInput}
                onChange={(e) => setTestInput(e.target.value)}
              />
              <Button
                variant='outline'
                size='sm'
                className='mt-2'
                onClick={handleTest}
              >
                <Search className='mr-1.5 h-3.5 w-3.5' />
                Test Rule
              </Button>
            </div>

            {testResults.length > 0 && (
              <div className='max-h-56 overflow-auto rounded border text-xs'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className='text-xs'>Location</TableHead>
                      <TableHead className='text-xs'>Status</TableHead>
                      <TableHead className='text-xs'>Zone</TableHead>
                      <TableHead className='text-xs'>Aisle</TableHead>
                      <TableHead className='text-xs'>Order</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {testResults.map((r, i) => {
                      const zone = r.matched
                        ? resolveTemplate(editing.zone_template, r.groups)
                        : ''
                      const aisle = r.matched
                        ? resolveTemplate(editing.aisle_template, r.groups)
                        : ''
                      const seq = r.matched
                        ? resolveTemplate(editing.sequence_template, r.groups)
                        : ''
                      return (
                        <TableRow key={i}>
                          <TableCell className='font-mono'>
                            {r.location}
                          </TableCell>
                          <TableCell>
                            {r.matched ? (
                              <div className='flex items-center gap-1'>
                                <Check className='h-3.5 w-3.5 text-green-600' />
                                <span className='text-green-600'>Matched</span>
                              </div>
                            ) : (
                              <div className='flex items-center gap-1'>
                                <AlertTriangle className='h-3.5 w-3.5 text-red-500' />
                                <span className='text-red-500'>No match</span>
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            {zone || (
                              <span className='text-muted-foreground'>
                                &mdash;
                              </span>
                            )}
                          </TableCell>
                          <TableCell className='font-mono'>
                            {aisle || (
                              <span className='text-muted-foreground'>
                                &mdash;
                              </span>
                            )}
                          </TableCell>
                          <TableCell className='font-mono tabular-nums'>
                            {seq || (
                              <span className='text-muted-foreground'>
                                &mdash;
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            )}

            {testResults.length > 0 && testResults.some((r) => !r.matched) && (
              <div className='flex items-start gap-2 rounded-md bg-orange-500/10 p-2.5 text-xs text-orange-600'>
                <Info className='mt-0.5 h-3.5 w-3.5 shrink-0' />
                <span>
                  Some locations didn&apos;t match. Check that the location
                  pattern covers all variants of this location type.
                </span>
              </div>
            )}

            <div className='flex gap-2'>
              <Button size='sm' onClick={handleSave}>
                <Save className='mr-1.5 h-3.5 w-3.5' />
                Save
              </Button>
              {editing.id && (
                <Button
                  size='sm'
                  variant='destructive'
                  onClick={async () => {
                    await onDelete(editing.id!)
                    setEditing(null)
                  }}
                >
                  <Trash2 className='mr-1.5 h-3.5 w-3.5' />
                  Delete
                </Button>
              )}
              <Button
                size='sm'
                variant='ghost'
                onClick={() => setEditing(null)}
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

const FALLBACK_LABELS: Record<string, { label: string; desc: string }> = {
  allow_unmapped_last: {
    label: 'Count Unmapped Last',
    desc: "Locations that couldn't be parsed are still counted, but after all mapped locations.",
  },
  block_unmapped: {
    label: 'Block Unmapped',
    desc: "Workers cannot claim locations that couldn't be parsed. These need resolution rules first.",
  },
  ignore_path_rules: {
    label: 'No Collision Prevention',
    desc: 'Disable aisle limits entirely. Workers can claim any location regardless of who else is nearby.',
  },
}

function PathRulesTab({
  rules,
  onUpsert,
  onDelete,
}: {
  rules: PathRule[]
  onUpsert: (r: any) => Promise<any>
  onDelete: (id: string) => Promise<any>
}) {
  const [editing, setEditing] = useState<Partial<PathRule> | null>(null)

  const handleSave = async () => {
    if (!editing) return
    await onUpsert(editing)
    setEditing(null)
  }

  return (
    <div className='grid grid-cols-1 gap-4 lg:grid-cols-2'>
      <Card>
        <CardHeader className='pb-3'>
          <div className='flex items-center justify-between'>
            <div>
              <CardTitle className='text-sm font-semibold'>
                Counting Rules
              </CardTitle>
              <p className='text-muted-foreground mt-0.5 text-xs'>
                Control walking strategy and how many workers can be in the same
                aisle
              </p>
            </div>
            <Button
              size='sm'
              variant='outline'
              onClick={() =>
                setEditing({
                  warehouse_code: null,
                  zone_filter: null,
                  aisle_filter: null,
                  strategy: 'serpentine_zone',
                  direction: 'ascending',
                  max_counters_per_aisle: 1,
                  fallback_behavior: 'allow_unmapped_last',
                  priority: 0,
                  is_active: true,
                })
              }
            >
              <Plus className='mr-1.5 h-3.5 w-3.5' />
              Add Rule
            </Button>
          </div>
        </CardHeader>
        <CardContent className='space-y-2'>
          {rules.length === 0 && (
            <div className='py-8 text-center'>
              <Route className='text-muted-foreground/50 mx-auto mb-2 h-8 w-8' />
              <p className='text-muted-foreground text-sm'>
                No counting rules configured.
              </p>
              <p className='text-muted-foreground mt-1 text-xs'>
                Without rules, counts are assigned by priority and creation time
                with no collision prevention.
              </p>
            </div>
          )}
          {rules.map((rule) => {
            const meta = STRATEGY_LABELS[rule.strategy]
            return (
              <div
                key={rule.id}
                className={cn(
                  'hover:bg-accent/50 flex cursor-pointer items-center justify-between rounded-lg border p-3 transition-colors',
                  editing?.id === rule.id && 'border-primary bg-accent/30'
                )}
                onClick={() => setEditing({ ...rule })}
              >
                <div className='min-w-0 flex-1'>
                  <p className='text-sm font-medium'>
                    {rule.zone_filter
                      ? `${rule.zone_filter} Zone`
                      : (meta?.label ?? rule.strategy)}
                  </p>
                  <div className='text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs'>
                    <span>{rule.warehouse_code || 'All warehouses'}</span>
                    <span className='text-muted-foreground/40'>&middot;</span>
                    <span>
                      {rule.max_counters_per_aisle === 1
                        ? '1 worker per aisle'
                        : `${rule.max_counters_per_aisle} workers per aisle`}
                    </span>
                    <span className='text-muted-foreground/40'>&middot;</span>
                    <span>{meta?.label ?? rule.strategy}</span>
                  </div>
                </div>
                <div className='flex items-center gap-2'>
                  <Badge variant={rule.is_active ? 'default' : 'secondary'}>
                    {rule.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                  <ChevronRight className='text-muted-foreground h-4 w-4' />
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>

      {editing && (
        <Card>
          <CardHeader className='pb-3'>
            <CardTitle className='text-sm font-semibold'>
              {editing.id ? 'Edit Rule' : 'New Rule'}
            </CardTitle>
            <p className='text-muted-foreground mt-0.5 text-xs'>
              Set how workers are routed through a zone to prevent aisle
              congestion.
            </p>
          </CardHeader>
          <CardContent className='space-y-4'>
            <div className='grid grid-cols-2 gap-3'>
              <div>
                <FieldLabel help='Leave blank to apply to all warehouses.'>
                  Warehouse
                </FieldLabel>
                <Input
                  placeholder='All warehouses'
                  value={editing.warehouse_code ?? ''}
                  onChange={(e) =>
                    setEditing((p) => ({
                      ...p,
                      warehouse_code: e.target.value || null,
                    }))
                  }
                />
              </div>
              <div>
                <FieldLabel help='Higher priority rules are checked first.'>
                  Priority
                </FieldLabel>
                <Input
                  type='number'
                  value={editing.priority ?? 0}
                  onChange={(e) =>
                    setEditing((p) => ({
                      ...p,
                      priority: parseInt(e.target.value) || 0,
                    }))
                  }
                />
              </div>
            </div>

            <div>
              <FieldLabel help='How workers walk through aisles when counting.'>
                Walking Strategy
              </FieldLabel>
              <Select
                value={editing.strategy ?? 'serpentine_zone'}
                onValueChange={(v) =>
                  setEditing((p) => ({ ...p, strategy: v as any }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(STRATEGY_LABELS).map(([key, meta]) => (
                    <SelectItem key={key} value={key}>
                      <div>
                        <p className='font-medium'>{meta.label}</p>
                        <p className='text-muted-foreground text-xs'>
                          {meta.desc}
                        </p>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {editing.strategy === 'directional' && (
              <div>
                <FieldLabel>Direction</FieldLabel>
                <Select
                  value={editing.direction ?? 'ascending'}
                  onValueChange={(v) =>
                    setEditing((p) => ({ ...p, direction: v as any }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='ascending'>
                      Low to High (A-01 &rarr; A-99)
                    </SelectItem>
                    <SelectItem value='descending'>
                      High to Low (A-99 &rarr; A-01)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <div>
              <FieldLabel help='Maximum workers allowed in the same aisle at once. Set to 1 to prevent any aisle overlap.'>
                Max Workers Per Aisle
              </FieldLabel>
              <Input
                type='number'
                min={1}
                value={editing.max_counters_per_aisle ?? 1}
                onChange={(e) =>
                  setEditing((p) => ({
                    ...p,
                    max_counters_per_aisle: parseInt(e.target.value) || 1,
                  }))
                }
              />
              <p className='text-muted-foreground mt-1 text-[11px]'>
                {editing.max_counters_per_aisle === 1
                  ? 'Only one worker can count in an aisle at a time.'
                  : `Up to ${editing.max_counters_per_aisle ?? 1} workers can count in the same aisle simultaneously.`}
              </p>
            </div>

            <Separator />

            <div className='grid grid-cols-2 gap-3'>
              <div>
                <FieldLabel help='Only apply this rule to a specific zone (e.g. Racks, Kardex, Shelves). Leave blank to apply to all zones.'>
                  Zone Filter
                </FieldLabel>
                <Input
                  placeholder='All zones'
                  value={editing.zone_filter ?? ''}
                  onChange={(e) =>
                    setEditing((p) => ({
                      ...p,
                      zone_filter: e.target.value || null,
                    }))
                  }
                />
              </div>
              <div>
                <FieldLabel help='Only apply this rule to a specific aisle (e.g. RD, K3). Leave blank to apply to all aisles.'>
                  Aisle Filter
                </FieldLabel>
                <Input
                  placeholder='All aisles'
                  value={editing.aisle_filter ?? ''}
                  onChange={(e) =>
                    setEditing((p) => ({
                      ...p,
                      aisle_filter: e.target.value || null,
                    }))
                  }
                />
              </div>
            </div>

            <div>
              <FieldLabel help="What happens when a location couldn't be parsed by any location rule.">
                Unrecognized Locations
              </FieldLabel>
              <Select
                value={editing.fallback_behavior ?? 'allow_unmapped_last'}
                onValueChange={(v) =>
                  setEditing((p) => ({ ...p, fallback_behavior: v as any }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(FALLBACK_LABELS).map(([key, meta]) => (
                    <SelectItem key={key} value={key}>
                      <div>
                        <p className='font-medium'>{meta.label}</p>
                        <p className='text-muted-foreground text-xs'>
                          {meta.desc}
                        </p>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className='flex items-center gap-2'>
              <Switch
                checked={editing.is_active ?? true}
                onCheckedChange={(v) =>
                  setEditing((p) => ({ ...p, is_active: v }))
                }
              />
              <Label className='text-xs'>Active</Label>
            </div>

            <Separator />

            <div className='flex gap-2'>
              <Button size='sm' onClick={handleSave}>
                <Save className='mr-1.5 h-3.5 w-3.5' />
                Save
              </Button>
              {editing.id && (
                <Button
                  size='sm'
                  variant='destructive'
                  onClick={async () => {
                    await onDelete(editing.id!)
                    setEditing(null)
                  }}
                >
                  <Trash2 className='mr-1.5 h-3.5 w-3.5' />
                  Delete
                </Button>
              )}
              <Button
                size='sm'
                variant='ghost'
                onClick={() => setEditing(null)}
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function PreviewTab({
  data,
  claimOrder,
  isLoading,
}: {
  data: {
    location: string
    resolved_key: string
    resolved_zone: string
    resolved_aisle: string
    resolved_sequence: number
    source: string
  }[]
  claimOrder: {
    count_number: string
    location: string
    priority: string
    resolved_zone: string
    resolved_aisle: string
    resolved_sequence: number
    source: string
  }[]
  isLoading: boolean
}) {
  const [filter, setFilter] = useState('')

  const filtered = useMemo(() => {
    if (!filter.trim()) return data
    const q = filter.toLowerCase()
    return data.filter(
      (r) =>
        r.location.toLowerCase().includes(q) ||
        r.resolved_zone.toLowerCase().includes(q) ||
        r.resolved_aisle.toLowerCase().includes(q) ||
        r.source.toLowerCase().includes(q)
    )
  }, [data, filter])

  const stats = useMemo(() => {
    const total = data.length
    const mapped = data.filter((r) => r.source === 'map').length
    const rule = data.filter((r) => r.source === 'rule').length
    const unresolved = data.filter((r) => r.source === 'unresolved').length
    return { total, mapped, rule, unresolved }
  }, [data])

  if (isLoading) {
    return (
      <div className='flex h-40 items-center justify-center'>
        <Loader2 className='text-muted-foreground h-6 w-6 animate-spin' />
      </div>
    )
  }

  return (
    <div className='space-y-4'>
      <div className='grid grid-cols-4 gap-3'>
        <Card className='p-3'>
          <p className='text-muted-foreground text-xs'>Total Sampled</p>
          <p className='text-2xl font-bold'>{stats.total}</p>
        </Card>
        <Card className='p-3'>
          <p className='text-xs text-green-600'>Map Resolved</p>
          <p className='text-2xl font-bold text-green-700'>{stats.mapped}</p>
        </Card>
        <Card className='p-3'>
          <p className='text-xs text-blue-600'>Rule Resolved</p>
          <p className='text-2xl font-bold text-blue-700'>{stats.rule}</p>
        </Card>
        <Card className='p-3'>
          <p className='text-xs text-orange-600'>Unresolved</p>
          <p className='text-2xl font-bold text-orange-700'>
            {stats.unresolved}
          </p>
        </Card>
      </div>

      <div className='flex items-center gap-2'>
        <Search className='text-muted-foreground h-4 w-4' />
        <Input
          placeholder='Filter locations...'
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className='max-w-sm'
        />
      </div>

      <div className='max-h-96 overflow-auto rounded border'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className='text-xs'>Raw Location</TableHead>
              <TableHead className='text-xs'>Resolved Key</TableHead>
              <TableHead className='text-xs'>Zone</TableHead>
              <TableHead className='text-xs'>Aisle</TableHead>
              <TableHead className='text-xs'>Seq</TableHead>
              <TableHead className='text-xs'>Source</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className='text-muted-foreground py-8 text-center text-sm'
                >
                  No resolved locations found. Create resolution rules and
                  import counts to see preview data.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className='font-mono text-xs'>
                    {r.location}
                  </TableCell>
                  <TableCell className='font-mono text-xs'>
                    {r.resolved_key}
                  </TableCell>
                  <TableCell className='text-xs'>{r.resolved_zone}</TableCell>
                  <TableCell className='text-xs'>{r.resolved_aisle}</TableCell>
                  <TableCell className='text-xs tabular-nums'>
                    {r.resolved_sequence}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        r.source === 'map'
                          ? 'default'
                          : r.source === 'rule'
                            ? 'secondary'
                            : 'destructive'
                      }
                      className='text-xs'
                    >
                      {r.source}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Card>
        <CardHeader className='pb-3'>
          <CardTitle className='text-sm font-semibold'>
            Next Claim Order Preview
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className='max-h-72 overflow-auto rounded border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className='text-xs'>#</TableHead>
                  <TableHead className='text-xs'>Count</TableHead>
                  <TableHead className='text-xs'>Priority</TableHead>
                  <TableHead className='text-xs'>Zone</TableHead>
                  <TableHead className='text-xs'>Aisle</TableHead>
                  <TableHead className='text-xs'>Seq</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {claimOrder.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className='text-muted-foreground py-6 text-center text-sm'
                    >
                      No claim-order preview available yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  claimOrder.map((row, index) => (
                    <TableRow key={`${row.count_number}-${index}`}>
                      <TableCell className='text-xs tabular-nums'>
                        {index + 1}
                      </TableCell>
                      <TableCell className='font-mono text-xs'>
                        {row.count_number}
                      </TableCell>
                      <TableCell className='text-xs capitalize'>
                        {row.priority}
                      </TableCell>
                      <TableCell className='text-xs'>
                        {row.resolved_zone}
                      </TableCell>
                      <TableCell className='text-xs'>
                        {row.resolved_aisle}
                      </TableCell>
                      <TableCell className='text-xs tabular-nums'>
                        {row.resolved_sequence}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// Created and developed by Jai Singh
