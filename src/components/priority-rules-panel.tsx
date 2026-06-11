// Created and developed by Jai Singh
'use client'

import { useState } from 'react'
import { Flame, Info, Loader2, Plus, Save, Trash2, Zap } from 'lucide-react'
import { toast } from 'sonner'
import type {
  PriorityLevel,
  PriorityRule,
  PriorityRuleUpsert,
} from '@/lib/supabase/priority-rules.service'
import { cn } from '@/lib/utils'
import { usePriorityRules } from '@/hooks/use-priority-rules'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

const PRIORITY_COLORS: Record<PriorityLevel, string> = {
  critical: 'bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30',
  hot: 'bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30',
  normal: 'bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30',
  low: 'bg-slate-500/15 text-slate-700 dark:text-slate-400 border-slate-500/30',
}

const EMPTY_DRAFT: PriorityRuleUpsert = {
  name: '',
  enabled: true,
  priority_level: 'hot',
  match_zone: null,
  match_count_type: null,
  match_warehouse: null,
  match_age_gte_hours: null,
  match_variance_gte_pct: null,
  match_requires_recount: null,
  sort_order: 100,
  notes: null,
}

export default function PriorityRulesPanel() {
  const { rules, isLoading, isMutating, isApplying, save, remove, apply } =
    usePriorityRules()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<PriorityRuleUpsert>(EMPTY_DRAFT)

  const openNew = () => {
    setEditingId(null)
    setDraft({ ...EMPTY_DRAFT })
    setDialogOpen(true)
  }

  const openEdit = (rule: PriorityRule) => {
    setEditingId(rule.id)
    setDraft({
      id: rule.id,
      name: rule.name,
      enabled: rule.enabled,
      priority_level: rule.priority_level,
      match_zone: rule.match_zone,
      match_count_type: rule.match_count_type,
      match_warehouse: rule.match_warehouse,
      match_age_gte_hours: rule.match_age_gte_hours,
      match_variance_gte_pct: rule.match_variance_gte_pct,
      match_requires_recount: rule.match_requires_recount,
      sort_order: rule.sort_order,
      notes: rule.notes,
    })
    setDialogOpen(true)
  }

  const handleSave = async () => {
    if (!draft.name.trim()) {
      toast.error('Name is required.')
      return
    }
    try {
      await save({
        ...draft,
        name: draft.name.trim(),
        match_zone: draft.match_zone?.trim() || null,
        match_count_type: draft.match_count_type?.trim() || null,
        match_warehouse: draft.match_warehouse?.trim() || null,
        notes: draft.notes?.trim() || null,
      })
      toast.success(editingId ? 'Rule updated.' : 'Rule created.')
      setDialogOpen(false)
    } catch {
      // toast in hook
    }
  }

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`Delete rule "${name}"?`)) return
    try {
      await remove(id)
      toast.success('Rule deleted.')
    } catch {
      // toast in hook
    }
  }

  if (isLoading) {
    return (
      <div className='flex h-64 items-center justify-center'>
        <Loader2 className='text-muted-foreground h-8 w-8 animate-spin' />
      </div>
    )
  }

  return (
    <div className='space-y-4'>
      <Card>
        <CardHeader className='flex flex-row items-start justify-between gap-3 space-y-0'>
          <div className='flex items-start gap-3'>
            <div className='bg-primary/10 text-primary rounded-xl p-2'>
              <Zap className='h-5 w-5' />
            </div>
            <div>
              <CardTitle className='text-lg'>Priority Rules</CardTitle>
              <p className='text-muted-foreground mt-1 text-xs'>
                Automatically score cycle counts based on zone, type, age,
                variance, or recount state. Lower sort-order wins when multiple
                rules match. Run &ldquo;Evaluate Now&rdquo; to apply rules
                across the queue.
              </p>
            </div>
          </div>
          <div className='flex shrink-0 gap-2'>
            <Button
              size='sm'
              variant='default'
              onClick={async () => {
                await apply()
              }}
              disabled={isApplying}
            >
              {isApplying ? (
                <Loader2 className='mr-1.5 h-3.5 w-3.5 animate-spin' />
              ) : (
                <Flame className='mr-1.5 h-3.5 w-3.5' />
              )}
              Evaluate Now
            </Button>
            <Button size='sm' variant='default' onClick={openNew}>
              <Plus className='mr-1.5 h-3.5 w-3.5' />
              New Rule
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {rules.length === 0 ? (
            <div className='text-muted-foreground flex flex-col items-center gap-2 py-10 text-center text-sm'>
              <Info className='h-8 w-8 opacity-40' />
              <p>No priority rules yet.</p>
              <p className='text-xs'>
                Create a rule to auto-escalate counts that match specific
                conditions (e.g. &ldquo;K1 counts are always critical&rdquo; or
                &ldquo;Counts pending &gt;72h bump to hot&rdquo;).
              </p>
            </div>
          ) : (
            <div className='space-y-2'>
              {rules.map((rule) => (
                <div
                  key={rule.id}
                  className={cn(
                    'flex items-start justify-between gap-2 rounded-lg border p-3',
                    !rule.enabled && 'bg-muted/30 opacity-70'
                  )}
                >
                  <div className='flex min-w-0 items-start gap-3'>
                    <span
                      className='text-muted-foreground font-mono text-[10px] tabular-nums'
                      title='Sort order — lower wins'
                    >
                      #{rule.sort_order}
                    </span>
                    <div className='min-w-0'>
                      <div className='flex items-center gap-2'>
                        <span className='text-sm font-semibold'>
                          {rule.name}
                        </span>
                        <Badge
                          className={cn(
                            'text-[10px]',
                            PRIORITY_COLORS[rule.priority_level]
                          )}
                        >
                          → {rule.priority_level}
                        </Badge>
                        {!rule.enabled && (
                          <Badge variant='outline' className='text-[10px]'>
                            disabled
                          </Badge>
                        )}
                      </div>
                      <div className='text-muted-foreground mt-1 flex flex-wrap items-center gap-1 text-[11px]'>
                        {renderCondition('zone', rule.match_zone)}
                        {renderCondition('count_type', rule.match_count_type)}
                        {renderCondition('warehouse', rule.match_warehouse)}
                        {renderCondition(
                          'age ≥',
                          rule.match_age_gte_hours
                            ? `${rule.match_age_gte_hours}h`
                            : null
                        )}
                        {renderCondition(
                          'variance ≥',
                          rule.match_variance_gte_pct != null
                            ? `${rule.match_variance_gte_pct}%`
                            : null
                        )}
                        {rule.match_requires_recount != null &&
                          renderCondition(
                            'recount',
                            rule.match_requires_recount ? 'yes' : 'no'
                          )}
                        {!hasAnyCondition(rule) && (
                          <span className='italic opacity-60'>
                            matches every pending row
                          </span>
                        )}
                      </div>
                      {rule.notes && (
                        <p className='text-muted-foreground mt-1 line-clamp-2 text-[11px] italic'>
                          {rule.notes}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className='flex shrink-0 items-center gap-1'>
                    <Button
                      size='sm'
                      variant='ghost'
                      onClick={() => openEdit(rule)}
                      className='h-7 px-2 text-[11px]'
                    >
                      Edit
                    </Button>
                    <Button
                      size='sm'
                      variant='ghost'
                      onClick={() => handleDelete(rule.id, rule.name)}
                      className='h-7 w-7 p-0'
                      title='Delete'
                    >
                      <Trash2 className='text-destructive h-3.5 w-3.5' />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className='max-w-xl'>
          <DialogHeader>
            <DialogTitle>
              {editingId ? 'Edit Priority Rule' : 'New Priority Rule'}
            </DialogTitle>
            <DialogDescription>
              All conditions you set must match for the rule to apply. Leave a
              field blank to match any value.
            </DialogDescription>
          </DialogHeader>

          <div className='grid gap-3 py-2 md:grid-cols-2'>
            <Field label='Name (required)' className='md:col-span-2'>
              <Input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder='e.g. Critical K1 counts'
                maxLength={80}
              />
            </Field>

            <Field label='Assigns priority'>
              <Select
                value={draft.priority_level}
                onValueChange={(v) =>
                  setDraft({ ...draft, priority_level: v as PriorityLevel })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(['critical', 'hot', 'normal', 'low'] as const).map((p) => (
                    <SelectItem key={p} value={p}>
                      <span className='capitalize'>{p}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label='Sort order (lower = higher precedence)'>
              <Input
                type='number'
                min={0}
                max={9999}
                value={draft.sort_order}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    sort_order: Math.max(
                      0,
                      Math.min(9999, parseInt(e.target.value || '0', 10))
                    ),
                  })
                }
              />
            </Field>

            <Field label='Match zone'>
              <Input
                value={draft.match_zone ?? ''}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    match_zone: e.target.value.toUpperCase() || null,
                  })
                }
                placeholder='e.g. K1'
                className='font-mono uppercase'
              />
            </Field>

            <Field label='Match count type'>
              <Input
                value={draft.match_count_type ?? ''}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    match_count_type: e.target.value.toLowerCase() || null,
                  })
                }
                placeholder='e.g. 999_count'
                className='font-mono'
              />
            </Field>

            <Field label='Match warehouse'>
              <Input
                value={draft.match_warehouse ?? ''}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    match_warehouse: e.target.value.toUpperCase() || null,
                  })
                }
                placeholder='e.g. WH01'
                className='font-mono uppercase'
              />
            </Field>

            <Field label='Age ≥ (hours)'>
              <Input
                type='number'
                min={0}
                value={draft.match_age_gte_hours ?? ''}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    match_age_gte_hours: e.target.value
                      ? parseInt(e.target.value, 10)
                      : null,
                  })
                }
                placeholder='e.g. 72'
              />
            </Field>

            <Field label='Variance ≥ (%)'>
              <Input
                type='number'
                min={0}
                step={0.5}
                value={draft.match_variance_gte_pct ?? ''}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    match_variance_gte_pct: e.target.value
                      ? parseFloat(e.target.value)
                      : null,
                  })
                }
                placeholder='e.g. 10'
              />
            </Field>

            <Field label='Requires recount'>
              <Select
                value={
                  draft.match_requires_recount == null
                    ? 'any'
                    : draft.match_requires_recount
                      ? 'true'
                      : 'false'
                }
                onValueChange={(v) =>
                  setDraft({
                    ...draft,
                    match_requires_recount: v === 'any' ? null : v === 'true',
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='any'>Any</SelectItem>
                  <SelectItem value='true'>Yes</SelectItem>
                  <SelectItem value='false'>No</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            <Field label='Enabled'>
              <div className='flex h-9 items-center'>
                <Switch
                  checked={draft.enabled}
                  onCheckedChange={(v) => setDraft({ ...draft, enabled: v })}
                />
                <span className='text-muted-foreground ml-2 text-xs'>
                  {draft.enabled ? 'Active' : 'Paused'}
                </span>
              </div>
            </Field>

            <Field label='Notes' className='md:col-span-2'>
              <Textarea
                rows={2}
                value={draft.notes ?? ''}
                onChange={(e) =>
                  setDraft({ ...draft, notes: e.target.value || null })
                }
                placeholder='Optional notes for other admins.'
              />
            </Field>
          </div>

          <DialogFooter>
            <Button
              variant='ghost'
              onClick={() => setDialogOpen(false)}
              disabled={isMutating}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={isMutating || !draft.name.trim()}
            >
              {isMutating ? (
                <Loader2 className='mr-1.5 h-3.5 w-3.5 animate-spin' />
              ) : (
                <Save className='mr-1.5 h-3.5 w-3.5' />
              )}
              {editingId ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Field({
  label,
  className,
  children,
}: {
  label: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label className='text-xs font-semibold'>{label}</Label>
      {children}
    </div>
  )
}

function renderCondition(label: string, value: string | null | undefined) {
  if (!value) return null
  return (
    <span className='border-border inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10px]'>
      <span className='text-muted-foreground'>{label}</span>
      <span className='font-semibold'>{value}</span>
    </span>
  )
}

function hasAnyCondition(rule: PriorityRule): boolean {
  return (
    !!rule.match_zone ||
    !!rule.match_count_type ||
    !!rule.match_warehouse ||
    rule.match_age_gte_hours != null ||
    rule.match_variance_gte_pct != null ||
    rule.match_requires_recount != null
  )
}

// Created and developed by Jai Singh
