// Created and developed by Jai Singh
'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Clock,
  Info,
  Loader2,
  MapPin,
  Plus,
  RotateCcw,
  Save,
  ShieldCheck,
  Trash2,
  User,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  deriveZone,
  type ActiveZone,
  type ZonePolicy,
} from '@/lib/supabase/zone-rules.service'
import { cn } from '@/lib/utils'
import {
  useActiveZones,
  useOrgUsersForZoneAssignment,
  useZoneAssignments,
  useZoneRules,
} from '@/hooks/use-zone-rules'
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

const POLICY_OPTIONS: Array<{
  value: ZonePolicy
  label: string
  description: string
}> = [
  {
    value: 'off',
    label: 'Off',
    description:
      'No zone mutual exclusion. Any number of counters can work any zone simultaneously.',
  },
  {
    value: 'one_counter_per_zone',
    label: 'One counter per zone',
    description:
      'Only one counter can be actively working a given zone at a time. Others are skipped over until the zone is released.',
  },
]

const DEFAULT_SAMPLE_LOCATIONS = [
  'K1-08-02-2',
  'K1-07-08-2',
  'SC-22-C-01',
  'R0-19-C-03',
  'RB-25-E-02',
  'K4-04-08-1',
]

function timeSince(iso: string | null | undefined): string {
  if (!iso) return ''
  const start = new Date(iso).getTime()
  const diff = Date.now() - start
  if (diff < 60_000) return 'just now'
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  const remMins = mins - hours * 60
  if (hours < 24) return `${hours}h ${remMins}m ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export default function ZoneRulesPanel() {
  const { rules, isLoading, isSaving, save } = useZoneRules()
  const {
    onlineZones,
    stuckZones,
    isLoading: zonesLoading,
    refetch: refetchActiveZones,
    releaseStuck,
    releaseAllStuck,
    isReleasing,
  } = useActiveZones()

  const [enabled, setEnabled] = useState(false)
  const [policy, setPolicy] = useState<ZonePolicy>('one_counter_per_zone')
  const [zonePattern, setZonePattern] = useState('')
  const [stickyZone, setStickyZone] = useState(false)
  const [bypassPriorities, setBypassPriorities] = useState<string[]>([])
  const [bypassCountTypes, setBypassCountTypes] = useState<string[]>([])
  const [countTypeDraft, setCountTypeDraft] = useState('')
  const [notes, setNotes] = useState('')
  // Migration 252 / 253 review: expose the two new per-org rules.
  const [treatNullZoneAsLocked, setTreatNullZoneAsLocked] = useState(false)
  const [supervisorProtectHours, setSupervisorProtectHours] = useState(24)
  const [dirty, setDirty] = useState(false)

  // Hydrate form from fetched rules once loaded.
  useEffect(() => {
    if (!rules) return
    setEnabled(rules.enabled)
    setPolicy(rules.policy)
    setZonePattern(rules.zone_pattern ?? '')
    setStickyZone(rules.sticky_zone ?? false)
    setBypassPriorities(rules.bypass_priorities ?? [])
    setBypassCountTypes(rules.bypass_count_types ?? [])
    setNotes(rules.notes ?? '')
    setTreatNullZoneAsLocked(rules.treat_null_zone_as_locked ?? false)
    setSupervisorProtectHours(
      Number.isFinite(rules.supervisor_assignment_protection_hours)
        ? rules.supervisor_assignment_protection_hours
        : 24
    )
    setDirty(false)
  }, [rules])

  const patternPreview = useMemo(() => {
    const pattern = zonePattern.trim() || null
    return DEFAULT_SAMPLE_LOCATIONS.map((loc) => ({
      location: loc,
      zone: deriveZone(loc, pattern),
    }))
  }, [zonePattern])

  const patternIsValidRegex = useMemo(() => {
    const pattern = zonePattern.trim()
    if (!pattern) return true
    try {
      new RegExp(pattern)
      return true
    } catch {
      return false
    }
  }, [zonePattern])

  const handleSave = async () => {
    if (zonePattern.trim() && !patternIsValidRegex) {
      toast.error('Zone pattern is not a valid regular expression.')
      return
    }
    const protectHours = Math.max(
      1,
      Math.min(168, Math.round(Number(supervisorProtectHours) || 24))
    )
    try {
      await save({
        enabled,
        policy,
        zone_pattern: zonePattern.trim() ? zonePattern.trim() : null,
        sticky_zone: stickyZone,
        bypass_priorities: bypassPriorities,
        bypass_count_types: bypassCountTypes,
        notes: notes.trim() ? notes.trim() : null,
        treat_null_zone_as_locked: treatNullZoneAsLocked,
        supervisor_assignment_protection_hours: protectHours,
      })
      setDirty(false)
      toast.success(
        enabled
          ? 'Zone rules saved and active.'
          : 'Zone rules saved (currently disabled).'
      )
    } catch {
      // surface via toast inside hook
    }
  }

  const handleReset = () => {
    if (!rules) return
    setEnabled(rules.enabled)
    setPolicy(rules.policy)
    setZonePattern(rules.zone_pattern ?? '')
    setStickyZone(rules.sticky_zone ?? false)
    setBypassPriorities(rules.bypass_priorities ?? [])
    setBypassCountTypes(rules.bypass_count_types ?? [])
    setCountTypeDraft('')
    setNotes(rules.notes ?? '')
    setTreatNullZoneAsLocked(rules.treat_null_zone_as_locked ?? false)
    setSupervisorProtectHours(
      Number.isFinite(rules.supervisor_assignment_protection_hours)
        ? rules.supervisor_assignment_protection_hours
        : 24
    )
    setDirty(false)
  }

  const togglePriorityBypass = (level: string) => {
    setBypassPriorities((prev) =>
      prev.includes(level) ? prev.filter((p) => p !== level) : [...prev, level]
    )
    setDirty(true)
  }

  const addCountTypeBypass = () => {
    const v = countTypeDraft.trim().toLowerCase()
    if (!v || bypassCountTypes.includes(v)) {
      setCountTypeDraft('')
      return
    }
    setBypassCountTypes((prev) => [...prev, v])
    setCountTypeDraft('')
    setDirty(true)
  }

  const removeCountTypeBypass = (v: string) => {
    setBypassCountTypes((prev) => prev.filter((x) => x !== v))
    setDirty(true)
  }

  if (isLoading) {
    return (
      <div className='flex h-64 items-center justify-center'>
        <Loader2 className='text-muted-foreground h-8 w-8 animate-spin' />
      </div>
    )
  }

  return (
    <div className='grid gap-4 md:grid-cols-12'>
      {/* Left column: policy editor */}
      <div className='space-y-4 md:col-span-7'>
        <Card>
          <CardHeader className='flex flex-row items-start justify-between gap-3 space-y-0'>
            <div className='flex items-start gap-3'>
              <div className='bg-primary/10 text-primary rounded-xl p-2'>
                <ShieldCheck className='h-5 w-5' />
              </div>
              <div>
                <CardTitle className='text-lg'>Zone Mutual Exclusion</CardTitle>
                <p className='text-muted-foreground mt-1 text-xs'>
                  Prevent counters from working on top of each other. When
                  enabled, only one operator can be actively counting a given
                  zone at a time. Supervisors and admins retain override.
                </p>
              </div>
            </div>
            <div className='flex flex-col items-end gap-1'>
              <div className='flex items-center gap-2'>
                <Label
                  htmlFor='zone-rules-enabled'
                  className='text-xs font-medium'
                >
                  {enabled ? 'Enabled' : 'Disabled'}
                </Label>
                <Switch
                  id='zone-rules-enabled'
                  checked={enabled}
                  onCheckedChange={(v) => {
                    setEnabled(v)
                    setDirty(true)
                  }}
                />
              </div>
              <span className='text-muted-foreground text-[10px]'>
                {rules?.updated_at
                  ? `Updated ${timeSince(rules.updated_at)}`
                  : 'Never configured'}
              </span>
            </div>
          </CardHeader>

          <CardContent className='space-y-5'>
            <div className='space-y-2'>
              <Label className='text-xs font-semibold tracking-wide uppercase'>
                Policy
              </Label>
              <div className='grid gap-2 md:grid-cols-2'>
                {POLICY_OPTIONS.map((opt) => {
                  const active = policy === opt.value
                  return (
                    <button
                      type='button'
                      key={opt.value}
                      onClick={() => {
                        setPolicy(opt.value)
                        setDirty(true)
                      }}
                      className={cn(
                        'rounded-xl border p-3 text-left transition-colors',
                        active
                          ? 'border-primary ring-primary/60 bg-primary/5 ring-1'
                          : 'border-border hover:border-primary/40 bg-background'
                      )}
                    >
                      <div className='flex items-center justify-between'>
                        <span className='text-sm font-semibold'>
                          {opt.label}
                        </span>
                        {active && (
                          <Badge
                            variant='default'
                            className='h-5 px-1.5 text-[10px]'
                          >
                            Selected
                          </Badge>
                        )}
                      </div>
                      <p className='text-muted-foreground mt-1 text-[11px] leading-snug'>
                        {opt.description}
                      </p>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className='space-y-2'>
              <div className='flex items-center justify-between'>
                <Label
                  htmlFor='zone-pattern'
                  className='text-xs font-semibold tracking-wide uppercase'
                >
                  Zone Pattern (optional)
                </Label>
                {!patternIsValidRegex && (
                  <span className='text-destructive inline-flex items-center gap-1 text-[11px]'>
                    <AlertTriangle className='h-3 w-3' />
                    Invalid regex
                  </span>
                )}
              </div>
              <Input
                id='zone-pattern'
                placeholder='Default: first dash-separated segment (e.g. K1-08 → K1)'
                value={zonePattern}
                onChange={(e) => {
                  setZonePattern(e.target.value)
                  setDirty(true)
                }}
                className={cn(
                  'font-mono text-xs',
                  !patternIsValidRegex && 'border-destructive'
                )}
              />
              <p className='text-muted-foreground text-[11px]'>
                Leave empty to use the default rule (split on first dash). Use a
                POSIX regex to customize — e.g. <code>^[A-Z]+[0-9]+</code> to
                lump K1-08 and K1-09 under the same zone.
              </p>
            </div>

            <div className='bg-background flex items-start justify-between gap-3 rounded-xl border p-3'>
              <div className='min-w-0 space-y-0.5'>
                <Label htmlFor='sticky-zone' className='text-sm font-semibold'>
                  Sticky zone assignment
                </Label>
                <p className='text-muted-foreground text-[11px] leading-snug'>
                  When enabled, Pull Next prefers counts in a zone the operator
                  already holds before routing them to a new zone. Operators
                  finish a zone before leaving it.
                </p>
              </div>
              <Switch
                id='sticky-zone'
                checked={stickyZone}
                onCheckedChange={(v) => {
                  setStickyZone(v)
                  setDirty(true)
                }}
                disabled={!enabled || policy === 'off'}
              />
            </div>

            {/* Migration 252 controls (added in 253 review pass) */}
            <div className='bg-background flex items-start justify-between gap-3 rounded-xl border p-3'>
              <div className='min-w-0 space-y-0.5'>
                <Label
                  htmlFor='treat-null-zone-as-locked'
                  className='text-sm font-semibold'
                >
                  Treat NULL-zone locations as locked
                </Label>
                <p className='text-muted-foreground text-[11px] leading-snug'>
                  Some locations don&apos;t parse to a zone (empty,{' '}
                  <code>&lt;&lt;empty&gt;&gt;</code>, single-segment). When ON,
                  the trigger falls back to LOCATION-EXACT-MATCH exclusivity for
                  those rows so two operators can&apos;t end up at the same
                  physical bin. Default OFF preserves prior behavior.
                </p>
              </div>
              <Switch
                id='treat-null-zone-as-locked'
                checked={treatNullZoneAsLocked}
                onCheckedChange={(v) => {
                  setTreatNullZoneAsLocked(v)
                  setDirty(true)
                }}
                disabled={!enabled || policy === 'off'}
              />
            </div>

            <div className='bg-background flex items-start justify-between gap-3 rounded-xl border p-3'>
              <div className='min-w-0 flex-1 space-y-0.5'>
                <Label
                  htmlFor='supervisor-protect-hours'
                  className='text-sm font-semibold'
                >
                  Supervisor-assignment protection (hours)
                </Label>
                <p className='text-muted-foreground text-[11px] leading-snug'>
                  How long after an admin assigns a count the stale-reservation
                  escalator will skip it. Higher values give supervisors more
                  time to nurse manually-assigned work back to the operator
                  before it returns to the queue. Default 24h, range 1–168h.
                </p>
              </div>
              <Input
                id='supervisor-protect-hours'
                type='number'
                inputMode='numeric'
                min={1}
                max={168}
                step={1}
                value={supervisorProtectHours}
                onChange={(e) => {
                  const next = Number(e.target.value)
                  setSupervisorProtectHours(Number.isFinite(next) ? next : 24)
                  setDirty(true)
                }}
                className='h-9 w-24 text-right font-mono text-xs tabular-nums'
              />
            </div>

            {/* Dynamic bypass overrides (migration 230) */}
            <div className='bg-background space-y-3 rounded-xl border p-3'>
              <div>
                <Label className='text-sm font-semibold'>
                  Dynamic overrides
                </Label>
                <p className='text-muted-foreground mt-0.5 text-[11px] leading-snug'>
                  Counts that match any of these cut through the zone lock (e.g.
                  emergency recounts or non-disruptive checks). Use sparingly.
                </p>
              </div>

              <div className='space-y-1.5'>
                <Label className='text-muted-foreground text-[11px] font-semibold tracking-wide uppercase'>
                  Bypass by priority
                </Label>
                <div className='flex flex-wrap gap-1.5'>
                  {(['critical', 'hot', 'normal', 'low'] as const).map(
                    (level) => {
                      const active = bypassPriorities.includes(level)
                      return (
                        <button
                          type='button'
                          key={level}
                          onClick={() => togglePriorityBypass(level)}
                          disabled={!enabled || policy === 'off'}
                          className={cn(
                            'rounded-md border px-2 py-1 text-[11px] font-medium capitalize transition-colors disabled:opacity-50',
                            active
                              ? 'border-primary bg-primary/10 text-primary'
                              : 'border-border bg-background hover:border-primary/40'
                          )}
                        >
                          {level}
                        </button>
                      )
                    }
                  )}
                </div>
              </div>

              <div className='space-y-1.5'>
                <Label className='text-muted-foreground text-[11px] font-semibold tracking-wide uppercase'>
                  Bypass by count type
                </Label>
                <div className='flex flex-wrap items-center gap-1.5'>
                  {bypassCountTypes.map((ct) => (
                    <span
                      key={ct}
                      className='border-primary/40 bg-primary/10 text-primary inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[11px]'
                    >
                      {ct}
                      <button
                        type='button'
                        onClick={() => removeCountTypeBypass(ct)}
                        className='text-primary/70 hover:text-primary'
                        aria-label={`Remove ${ct}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <Input
                    value={countTypeDraft}
                    onChange={(e) => setCountTypeDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        addCountTypeBypass()
                      }
                    }}
                    placeholder='e.g. part_verification, audit…'
                    disabled={!enabled || policy === 'off'}
                    className='h-7 max-w-[220px] font-mono text-[11px]'
                  />
                  <Button
                    type='button'
                    size='sm'
                    variant='ghost'
                    onClick={addCountTypeBypass}
                    disabled={
                      !enabled || policy === 'off' || !countTypeDraft.trim()
                    }
                    className='h-7 px-2 text-[11px]'
                  >
                    Add
                  </Button>
                </div>
              </div>
            </div>

            <div className='space-y-2'>
              <Label
                htmlFor='zone-notes'
                className='text-xs font-semibold tracking-wide uppercase'
              >
                Notes
              </Label>
              <Textarea
                id='zone-notes'
                value={notes}
                onChange={(e) => {
                  setNotes(e.target.value)
                  setDirty(true)
                }}
                placeholder='Optional operational notes (visible to admins only).'
                rows={2}
                className='text-xs'
              />
            </div>

            <div className='bg-muted/40 flex items-start gap-2 rounded-lg border p-3'>
              <Info className='text-muted-foreground mt-0.5 h-4 w-4 shrink-0' />
              <div className='space-y-1 text-[11px] leading-relaxed'>
                <p>
                  <strong className='text-foreground'>Enforcement:</strong> a
                  database trigger rejects claim/start/assign transitions that
                  would violate the policy. Rust work-service pre-filters
                  candidate counts so operators don&apos;t get stuck.
                </p>
                <p>
                  <strong className='text-foreground'>Override:</strong>{' '}
                  supervisors and admins can force-assign a count into a locked
                  zone via the Supervisor Override action on the dashboard —
                  useful for reassignments, recounts, or emergencies.
                </p>
              </div>
            </div>

            <div className='flex items-center justify-end gap-2 border-t pt-3'>
              <Button
                variant='ghost'
                size='sm'
                onClick={handleReset}
                disabled={!dirty || isSaving}
              >
                <RotateCcw className='mr-1.5 h-3.5 w-3.5' />
                Reset
              </Button>
              <Button
                size='sm'
                onClick={handleSave}
                disabled={!dirty || isSaving || !patternIsValidRegex}
              >
                {isSaving ? (
                  <Loader2 className='mr-1.5 h-3.5 w-3.5 animate-spin' />
                ) : (
                  <Save className='mr-1.5 h-3.5 w-3.5' />
                )}
                Save
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className='text-base'>Pattern Preview</CardTitle>
            <p className='text-muted-foreground text-xs'>
              How sample location codes map to zones with your current pattern.
            </p>
          </CardHeader>
          <CardContent>
            <div className='grid gap-2 sm:grid-cols-2'>
              {patternPreview.map(({ location, zone }) => (
                <div
                  key={location}
                  className='bg-background flex items-center justify-between rounded-lg border px-3 py-1.5 text-xs'
                >
                  <span className='font-mono'>{location}</span>
                  <span
                    className={cn(
                      'font-mono font-semibold',
                      zone ? 'text-primary' : 'text-muted-foreground italic'
                    )}
                  >
                    {zone ?? '—'}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Right column: live zone activity */}
      <div className='space-y-4 md:col-span-5'>
        <Card>
          <CardHeader>
            <div className='flex items-start justify-between'>
              <div>
                <CardTitle className='text-base'>Live Zone Activity</CardTitle>
                <p className='text-muted-foreground mt-1 text-xs'>
                  Zones currently held by active counters (real-time).
                </p>
              </div>
              <Button
                size='sm'
                variant='ghost'
                onClick={() => {
                  void refetchActiveZones()
                }}
                title='Refresh live zone activity'
              >
                <RotateCcw className='h-3.5 w-3.5' />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {zonesLoading ? (
              <div className='flex h-32 items-center justify-center'>
                <Loader2 className='text-muted-foreground h-5 w-5 animate-spin' />
              </div>
            ) : onlineZones.length === 0 ? (
              <div className='text-muted-foreground flex flex-col items-center gap-2 py-6 text-center text-xs'>
                <Users className='h-6 w-6 opacity-40' />
                <p>No operators are currently counting a zone.</p>
              </div>
            ) : (
              <div className='space-y-2'>
                {onlineZones.map((z) => (
                  <div
                    key={`${z.zone}-${z.locked_by}`}
                    className='flex items-center justify-between gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2.5'
                  >
                    <div className='flex min-w-0 items-center gap-2'>
                      <Badge
                        variant='default'
                        className='bg-emerald-500/15 font-mono text-emerald-800 tabular-nums dark:text-emerald-300'
                      >
                        <MapPin className='mr-1 h-3 w-3' />
                        {z.zone}
                      </Badge>
                      <div className='min-w-0'>
                        <p className='truncate text-xs font-medium'>
                          {z.locked_by_name ||
                            z.locked_by_email ||
                            'Unknown counter'}
                        </p>
                        <p className='text-muted-foreground text-[10px]'>
                          {z.actively_counting > 0 && (
                            <>
                              {z.actively_counting} in progress
                              {z.reserved_count > 0 && ' · '}
                            </>
                          )}
                          {z.reserved_count > 0 && (
                            <>{z.reserved_count} reserved</>
                          )}
                          {z.actively_counting === 0 &&
                            z.reserved_count === 0 && <>0 holds</>}
                          {' · '}
                          online
                        </p>
                      </div>
                    </div>
                    <div className='text-muted-foreground flex shrink-0 items-center gap-1 text-[10px]'>
                      <Clock className='h-3 w-3' />
                      {timeSince(z.acquired_at)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <StuckZonesCard
          stuckZones={stuckZones}
          isReleasing={isReleasing}
          onReleaseOne={releaseStuck}
          onReleaseAll={(opts) => releaseAllStuck(10, opts)}
        />

        <ZoneAssignmentsCard />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Stuck Zones Card
// ---------------------------------------------------------------------------

interface StuckZonesCardProps {
  stuckZones: ActiveZone[]
  isReleasing: boolean
  onReleaseOne: (countId: string, opts?: { hard?: boolean }) => Promise<void>
  onReleaseAll: (opts?: { hard?: boolean }) => Promise<{ released: number }>
}

function StuckZonesCard({
  stuckZones,
  isReleasing,
  onReleaseOne,
  onReleaseAll,
}: StuckZonesCardProps) {
  if (stuckZones.length === 0) return null

  return (
    <Card className='border-amber-500/40 bg-amber-500/5'>
      <CardHeader className='flex flex-row items-start justify-between gap-3 space-y-0'>
        <div>
          <CardTitle className='flex items-center gap-2 text-base'>
            <AlertTriangle className='h-4 w-4 text-amber-600 dark:text-amber-400' />
            Stuck Assignments
            <Badge
              variant='default'
              className='bg-amber-500/15 text-amber-800 dark:text-amber-300'
            >
              {stuckZones.length}
            </Badge>
          </CardTitle>
          <p className='text-muted-foreground mt-1 text-xs'>
            Assignments in this zone &mdash; in progress or reserved &mdash;
            whose holder hasn&apos;t pinged in 10+ minutes.{' '}
            <strong>Release</strong> flips them back to pending but keeps them
            reserved for the assignee &mdash; they get them back on their next
            Pull Next. <strong>Release &amp; unassign</strong> returns rows to
            the general queue (use only when the operator truly isn&apos;t
            coming back).
          </p>
        </div>
        <div className='flex shrink-0 gap-1.5'>
          <Button
            size='sm'
            variant='default'
            disabled={isReleasing}
            onClick={() => {
              void onReleaseAll()
            }}
          >
            {isReleasing ? (
              <Loader2 className='mr-1.5 h-3.5 w-3.5 animate-spin' />
            ) : null}
            Release All
          </Button>
          <Button
            size='sm'
            variant='ghost'
            disabled={isReleasing}
            onClick={() => {
              if (
                window.confirm(
                  'Release AND unassign all stuck rows? This returns them to the general queue — any operator can claim them. Use only when the original assignees are not coming back.'
                )
              ) {
                void onReleaseAll({ hard: true })
              }
            }}
            className='text-amber-700 hover:text-amber-800 dark:text-amber-400'
          >
            + Unassign
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className='space-y-2'>
          {stuckZones.map((z) => (
            <div
              key={`${z.zone}-${z.locked_by}`}
              className='bg-background flex items-start justify-between gap-2 rounded-lg border border-amber-500/30 p-2.5'
            >
              <div className='flex min-w-0 items-start gap-2'>
                <Badge
                  variant='default'
                  className='bg-amber-500/15 font-mono text-amber-800 tabular-nums dark:text-amber-300'
                >
                  <MapPin className='mr-1 h-3 w-3' />
                  {z.zone}
                </Badge>
                <div className='min-w-0'>
                  <p className='truncate text-xs font-medium'>
                    {z.locked_by_name || z.locked_by_email || 'Unknown counter'}
                  </p>
                  <p className='text-muted-foreground text-[10px]'>
                    {z.actively_counting > 0 && (
                      <>
                        {z.actively_counting} in progress
                        {z.reserved_count > 0 && ' · '}
                      </>
                    )}
                    {z.reserved_count > 0 && <>{z.reserved_count} reserved</>}
                    {' · '}
                    last seen{' '}
                    {z.minutes_since_seen != null
                      ? `${Math.round(z.minutes_since_seen)}m ago`
                      : 'never'}
                  </p>
                </div>
              </div>
              <div className='flex shrink-0 flex-col items-end gap-1'>
                {(z.active_ids ?? []).map((id) => (
                  <div key={id} className='flex items-center gap-1'>
                    <Button
                      size='sm'
                      variant='ghost'
                      disabled={isReleasing}
                      onClick={() => {
                        void onReleaseOne(id)
                      }}
                      className='h-6 px-2 text-[10px]'
                      title={`Release count ${id.slice(0, 8)} — keeps it reserved for the assignee`}
                    >
                      Release
                    </Button>
                    <Button
                      size='sm'
                      variant='ghost'
                      disabled={isReleasing}
                      onClick={() => {
                        if (
                          window.confirm(
                            'Release AND unassign this count? It returns to the general queue — any operator can claim it.'
                          )
                        ) {
                          void onReleaseOne(id, { hard: true })
                        }
                      }}
                      className='h-6 px-2 text-[10px] text-amber-700 hover:text-amber-800 dark:text-amber-400'
                      title={`Release count ${id.slice(0, 8)} AND unassign (returns to general queue)`}
                    >
                      + Unassign
                    </Button>
                  </div>
                ))}
                {(z.reserved_ids ?? []).map((id) => (
                  <div key={id} className='flex items-center gap-1'>
                    <Badge
                      variant='outline'
                      className='h-5 border-amber-500/40 px-1.5 text-[9px] font-normal text-amber-700 dark:text-amber-400'
                      title='Already soft-released; only "+ Unassign" returns it to the general queue.'
                    >
                      Reserved
                    </Badge>
                    <Button
                      size='sm'
                      variant='ghost'
                      disabled={isReleasing}
                      onClick={() => {
                        if (
                          window.confirm(
                            'Unassign this reserved count? The original assignee loses priority and the row returns to the general queue.'
                          )
                        ) {
                          void onReleaseOne(id, { hard: true })
                        }
                      }}
                      className='h-6 px-2 text-[10px] text-amber-700 hover:text-amber-800 dark:text-amber-400'
                      title={`Unassign count ${id.slice(0, 8)} (returns to general queue)`}
                    >
                      + Unassign
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Zone Assignments Card
// ---------------------------------------------------------------------------

function ZoneAssignmentsCard() {
  const { assignments, isLoading, isMutating, save, remove } =
    useZoneAssignments()
  const { users } = useOrgUsersForZoneAssignment()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingZone, setEditingZone] = useState<string | null>(null)
  const [zone, setZone] = useState('')
  const [userId, setUserId] = useState<string>('')
  const [assignmentNotes, setAssignmentNotes] = useState('')

  const resetForm = () => {
    setEditingZone(null)
    setZone('')
    setUserId('')
    setAssignmentNotes('')
  }

  const openNew = () => {
    resetForm()
    setDialogOpen(true)
  }

  const openEdit = (assignmentZone: string) => {
    const existing = assignments.find((a) => a.zone === assignmentZone)
    if (!existing) return
    setEditingZone(existing.zone)
    setZone(existing.zone)
    setUserId(existing.user_id)
    setAssignmentNotes(existing.notes ?? '')
    setDialogOpen(true)
  }

  const handleSave = async () => {
    const trimmedZone = zone.trim().toUpperCase()
    if (!trimmedZone) {
      toast.error('Zone is required.')
      return
    }
    if (!userId) {
      toast.error('Pick an operator.')
      return
    }
    try {
      await save({
        zone: trimmedZone,
        user_id: userId,
        notes: assignmentNotes.trim() || null,
      })
      toast.success(
        editingZone
          ? `Zone ${trimmedZone} reassigned.`
          : `Zone ${trimmedZone} assigned.`
      )
      setDialogOpen(false)
      resetForm()
    } catch {
      // toast already emitted in hook
    }
  }

  const handleDelete = async (assignmentZone: string) => {
    try {
      await remove(assignmentZone)
      toast.success(`Removed assignment for ${assignmentZone}.`)
    } catch {
      // toast emitted in hook
    }
  }

  return (
    <>
      <Card>
        <CardHeader className='flex flex-row items-start justify-between gap-3 space-y-0'>
          <div>
            <CardTitle className='text-base'>Zone Assignments</CardTitle>
            <p className='text-muted-foreground mt-1 text-xs'>
              Dedicate specific zones to specific counters. Only the assigned
              user can pull or be assigned counts in that zone.
            </p>
          </div>
          <Button size='sm' onClick={openNew}>
            <Plus className='mr-1 h-3.5 w-3.5' />
            Add
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className='flex h-24 items-center justify-center'>
              <Loader2 className='text-muted-foreground h-5 w-5 animate-spin' />
            </div>
          ) : assignments.length === 0 ? (
            <div className='text-muted-foreground flex flex-col items-center gap-2 py-6 text-center text-xs'>
              <User className='h-6 w-6 opacity-40' />
              <p>No dedicated zones yet.</p>
              <p className='text-[11px]'>
                Without assignments, any qualifying operator may work a zone
                (subject to the one-counter-per-zone policy).
              </p>
            </div>
          ) : (
            <div className='space-y-2'>
              {assignments.map((a) => (
                <div
                  key={`${a.zone}-${a.user_id}`}
                  className='bg-muted/30 flex items-start justify-between gap-2 rounded-lg border p-2.5'
                >
                  <div className='flex min-w-0 items-start gap-2'>
                    <Badge variant='default' className='font-mono tabular-nums'>
                      <MapPin className='mr-1 h-3 w-3' />
                      {a.zone}
                    </Badge>
                    <div className='min-w-0'>
                      <p className='truncate text-xs font-medium'>
                        {a.user_name || a.user_email || 'Unknown user'}
                      </p>
                      {a.notes && (
                        <p className='text-muted-foreground mt-0.5 line-clamp-2 text-[10px] leading-snug'>
                          {a.notes}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className='flex shrink-0 items-center gap-1'>
                    <Button
                      size='sm'
                      variant='ghost'
                      onClick={() => openEdit(a.zone)}
                      title='Edit'
                      className='h-7 px-2 text-[11px]'
                    >
                      Edit
                    </Button>
                    <Button
                      size='sm'
                      variant='ghost'
                      onClick={() => handleDelete(a.zone)}
                      title='Remove'
                      className='h-7 w-7 p-0'
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

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open)
          if (!open) resetForm()
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingZone
                ? `Edit Assignment: ${editingZone}`
                : 'New Zone Assignment'}
            </DialogTitle>
            <DialogDescription>
              {editingZone
                ? 'Change the operator assigned to this zone.'
                : 'Dedicate a zone to a specific operator. Only they can work counts in that zone (supervisors can override).'}
            </DialogDescription>
          </DialogHeader>

          <div className='space-y-4 py-2'>
            <div className='space-y-1.5'>
              <Label
                htmlFor='assignment-zone'
                className='text-xs font-semibold'
              >
                Zone
              </Label>
              <Input
                id='assignment-zone'
                placeholder='e.g. K1'
                value={zone}
                onChange={(e) => setZone(e.target.value.toUpperCase())}
                disabled={!!editingZone}
                className='font-mono uppercase'
                maxLength={32}
              />
              <p className='text-muted-foreground text-[11px]'>
                Normalized to uppercase. Must match the derived-zone format
                (e.g. K1 for locations like K1-08-02-2).
              </p>
            </div>

            <div className='space-y-1.5'>
              <Label
                htmlFor='assignment-user'
                className='text-xs font-semibold'
              >
                Assign to
              </Label>
              <Select value={userId} onValueChange={setUserId}>
                <SelectTrigger id='assignment-user'>
                  <SelectValue placeholder='Pick an operator…' />
                </SelectTrigger>
                <SelectContent>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      <span className='flex items-center gap-2'>
                        <User className='h-3.5 w-3.5 opacity-60' />
                        <span className='font-medium'>
                          {u.full_name ?? u.email ?? 'Unnamed'}
                        </span>
                        {u.role && (
                          <span className='text-muted-foreground text-[10px]'>
                            · {u.role}
                          </span>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className='space-y-1.5'>
              <Label
                htmlFor='assignment-notes'
                className='text-xs font-semibold'
              >
                Notes (optional)
              </Label>
              <Textarea
                id='assignment-notes'
                placeholder='e.g. High-value zone, dedicated counter.'
                rows={2}
                value={assignmentNotes}
                onChange={(e) => setAssignmentNotes(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant='ghost'
              onClick={() => setDialogOpen(false)}
              disabled={isMutating}
            >
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isMutating}>
              {isMutating ? (
                <Loader2 className='mr-1.5 h-3.5 w-3.5 animate-spin' />
              ) : (
                <Save className='mr-1.5 h-3.5 w-3.5' />
              )}
              {editingZone ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// Created and developed by Jai Singh
