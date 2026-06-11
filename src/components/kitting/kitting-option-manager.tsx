// Created and developed by Jai Singh
'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  ClipboardCheck,
  Edit,
  Loader2,
  MoreHorizontal,
  Plus,
  Settings2,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { normaliseBinPatterns } from '@/lib/kitting/non-warehouse-bins'
import { normalizePlantLocations } from '@/lib/kitting/plant-locations'
import {
  KITTING_OPTION_GROUPS,
  type KittingDropdownOption,
  type KittingOptionGroup,
} from '@/lib/supabase/kitting-options.service'
import { logger } from '@/lib/utils/logger'
import { useKittingOptions } from '@/hooks/use-kitting-options'
import { useKittingWorkflowSettings } from '@/hooks/use-kitting-workflow-settings'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
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

interface OptionFormState {
  option_group: KittingOptionGroup
  option_value: string
  option_label: string
  description: string
  is_active: boolean
}

const DEFAULT_FORM: OptionFormState = {
  option_group: 'engine_program',
  option_value: '',
  option_label: '',
  description: '',
  is_active: true,
}

export function KittingOptionManager() {
  const {
    organizationId,
    optionsByGroup,
    isLoading,
    createOption,
    updateOption,
    deleteOption,
    seedDefaults,
  } = useKittingOptions()

  const {
    kitInspectionRequired,
    blackHatShipShortPolicy,
    nonWarehouseBinPatterns,
    isLoading: isLoadingWorkflow,
    isUpdating: isUpdatingWorkflow,
    setKitInspectionRequired,
    setBlackHatShipShortAuthorizationEnabled,
    setBlackHatShipShortRequireJustification,
    setBlackHatShipShortRequireLineByLineApproval,
    setNonWarehouseBinPatternsAsync,
    deliverToPlantLocations,
    setDeliverToPlantLocationsAsync,
  } = useKittingWorkflowSettings()

  const workflowControlsDisabled =
    isLoadingWorkflow || isUpdatingWorkflow || !organizationId
  const blackHatChildControlsDisabled =
    workflowControlsDisabled || !blackHatShipShortPolicy.enabled

  // Local draft for the non-warehouse-bin patterns input — the
  // operator's typing buffer. Committed to the server via "Add" /
  // "Remove" actions so the saved list stays canonical (trimmed,
  // uppercased, deduped — see `normaliseBinPatterns`).
  const [newBinPattern, setNewBinPattern] = useState('')
  const [isMutatingBinPatterns, setIsMutatingBinPatterns] = useState(false)

  const handleAddBinPattern = async () => {
    const candidate = newBinPattern.trim().toUpperCase()
    if (!candidate) return
    if (nonWarehouseBinPatterns.includes(candidate)) {
      toast.info('Pattern already configured')
      setNewBinPattern('')
      return
    }
    setIsMutatingBinPatterns(true)
    try {
      const next = normaliseBinPatterns([...nonWarehouseBinPatterns, candidate])
      await setNonWarehouseBinPatternsAsync(next)
      setNewBinPattern('')
    } catch (error) {
      logger.error('Failed to add non-warehouse bin pattern:', error)
    } finally {
      setIsMutatingBinPatterns(false)
    }
  }

  const handleRemoveBinPattern = async (pattern: string) => {
    setIsMutatingBinPatterns(true)
    try {
      const next = nonWarehouseBinPatterns.filter((p) => p !== pattern)
      await setNonWarehouseBinPatternsAsync(next)
    } catch (error) {
      logger.error('Failed to remove non-warehouse bin pattern:', error)
    } finally {
      setIsMutatingBinPatterns(false)
    }
  }

  // Local draft for the Deliver-To-Plant locations input — the
  // operator's typing buffer. Committed to the server via "Add" /
  // "Remove" actions so the saved list stays canonical (trimmed,
  // case-insensitively deduped — see `normalizePlantLocations`). Unlike
  // bin patterns these are user-facing labels, so we do NOT
  // auto-uppercase the input.
  const [newPlantLocation, setNewPlantLocation] = useState('')
  const [isMutatingPlantLocations, setIsMutatingPlantLocations] =
    useState(false)

  const handleAddPlantLocation = async () => {
    const candidate = newPlantLocation.trim()
    if (!candidate) return
    if (
      deliverToPlantLocations.some(
        (loc) => loc.toLowerCase() === candidate.toLowerCase()
      )
    ) {
      toast.info('Plant destination already configured')
      setNewPlantLocation('')
      return
    }
    setIsMutatingPlantLocations(true)
    try {
      const next = normalizePlantLocations([
        ...deliverToPlantLocations,
        candidate,
      ])
      await setDeliverToPlantLocationsAsync(next)
      setNewPlantLocation('')
    } catch (error) {
      logger.error('Failed to add Deliver-To-Plant location:', error)
    } finally {
      setIsMutatingPlantLocations(false)
    }
  }

  const handleRemovePlantLocation = async (location: string) => {
    setIsMutatingPlantLocations(true)
    try {
      const next = deliverToPlantLocations.filter((p) => p !== location)
      await setDeliverToPlantLocationsAsync(next)
    } catch (error) {
      logger.error('Failed to remove Deliver-To-Plant location:', error)
    } finally {
      setIsMutatingPlantLocations(false)
    }
  }

  const [dialogOpen, setDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<KittingDropdownOption | null>(null)
  const [form, setForm] = useState<OptionFormState>(DEFAULT_FORM)

  useEffect(() => {
    if (!dialogOpen) {
      setEditing(null)
      setForm(DEFAULT_FORM)
      return
    }

    if (editing) {
      setForm({
        option_group: editing.option_group,
        option_value: editing.option_value,
        option_label: editing.option_label,
        description: editing.description ?? '',
        is_active: editing.is_active,
      })
    }
  }, [dialogOpen, editing])

  const hasAnyOptions = useMemo(
    () =>
      Object.values(optionsByGroup).some(
        (groupOptions) => groupOptions.length > 0
      ),
    [optionsByGroup]
  )

  const handleSave = async () => {
    if (!form.option_value.trim() || !form.option_label.trim()) {
      return
    }

    try {
      setSaving(true)
      if (editing) {
        await updateOption({
          id: editing.id,
          updates: {
            option_label: form.option_label.trim(),
            description: form.description.trim() || null,
            is_active: form.is_active,
          },
        })
      } else {
        const currentGroupOptions = optionsByGroup[form.option_group] ?? []
        await createOption({
          organization_id: organizationId,
          option_group: form.option_group,
          option_value: form.option_value.trim(),
          option_label: form.option_label.trim(),
          description: form.description.trim() || null,
          display_order: currentGroupOptions.length,
          is_active: form.is_active,
        })
      }
      setDialogOpen(false)
    } catch (error) {
      logger.error('Error saving kitting dropdown option:', error)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (option: KittingDropdownOption) => {
    const shouldDelete = window.confirm(
      `Delete "${option.option_label}" from ${KITTING_OPTION_GROUPS.find((group) => group.value === option.option_group)?.label}?`
    )
    if (!shouldDelete) return

    try {
      await deleteOption(option.id)
    } catch (error) {
      logger.error('Error deleting kitting dropdown option:', error)
    }
  }

  const handleSeedDefaults = async () => {
    try {
      await seedDefaults()
    } catch (error) {
      logger.error('Error seeding kitting dropdown defaults:', error)
    }
  }

  return (
    <div className='space-y-6'>
      <div className='flex flex-wrap items-center justify-between gap-4'>
        <div>
          <h3 className='text-lg font-semibold'>Dropdown Management</h3>
          <p className='text-muted-foreground text-sm'>
            Manage the kitting dropdown lists used by kit definitions, BOM
            lines, build plans, and build sheets.
          </p>
        </div>
        <Button
          variant='outline'
          onClick={handleSeedDefaults}
          disabled={isLoading}
        >
          Seed Defaults
        </Button>
      </div>

      {isLoading ? (
        <Alert>
          <AlertDescription>
            Loading kitting dropdown options...
          </AlertDescription>
        </Alert>
      ) : (
        <div className='space-y-6'>
          {!hasAnyOptions && (
            <Alert>
              <AlertDescription>
                No kitting dropdown options found yet. Use "Seed Defaults" to
                load the standard lists, then edit them here.
              </AlertDescription>
            </Alert>
          )}

          {KITTING_OPTION_GROUPS.map((group) => {
            const groupOptions = optionsByGroup[group.value] ?? []
            return (
              <Card
                key={group.value}
                data-testid={`kitting-option-group-${group.value}`}
              >
                <CardHeader>
                  <div className='flex items-center justify-between gap-4'>
                    <div className='flex items-center gap-3'>
                      <div className='rounded-lg bg-blue-500/10 p-2'>
                        <Settings2 className='h-5 w-5 text-blue-500' />
                      </div>
                      <div>
                        <CardTitle>{group.label}</CardTitle>
                        <CardDescription>{group.description}</CardDescription>
                      </div>
                    </div>
                    <Button
                      onClick={() => {
                        setEditing(null)
                        setForm({
                          ...DEFAULT_FORM,
                          option_group: group.value,
                        })
                        setDialogOpen(true)
                      }}
                    >
                      <Plus className='mr-2 h-4 w-4' />
                      Add Option
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {groupOptions.length === 0 ? (
                    <div className='text-muted-foreground flex items-center justify-center rounded-md border border-dashed py-8 text-sm'>
                      No options defined for this group yet.
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Value</TableHead>
                          <TableHead>Label</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className='w-[70px]'>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {groupOptions.map((option) => (
                          <TableRow key={option.id}>
                            <TableCell className='font-mono text-sm'>
                              {option.option_value}
                            </TableCell>
                            <TableCell className='font-medium'>
                              {option.option_label}
                            </TableCell>
                            <TableCell className='text-muted-foreground text-sm'>
                              {option.description || '—'}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={
                                  option.is_active ? 'default' : 'secondary'
                                }
                              >
                                {option.is_active ? 'Active' : 'Inactive'}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant='ghost' size='sm'>
                                    <MoreHorizontal className='h-4 w-4' />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align='end'>
                                  <DropdownMenuItem
                                    onClick={() => {
                                      setEditing(option)
                                      setDialogOpen(true)
                                    }}
                                  >
                                    <Edit className='mr-2 h-4 w-4' />
                                    Edit
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => handleDelete(option)}
                                    className='text-destructive'
                                  >
                                    <Trash2 className='mr-2 h-4 w-4' />
                                    Delete
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            )
          })}

          <Card data-testid='kitting-workflow-settings-card'>
            <CardHeader>
              <div className='flex items-center gap-3'>
                <div className='rounded-lg bg-orange-500/10 p-2'>
                  <ClipboardCheck className='h-5 w-5 text-orange-500' />
                </div>
                <div>
                  <CardTitle>Workflow Settings</CardTitle>
                  <CardDescription>
                    Toggle org-wide kitting workflow stages. Changes apply to
                    new kits; in-flight kits keep their current stage.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className='space-y-4'>
              <div className='flex items-start justify-between gap-4 rounded-lg border p-4'>
                <div className='space-y-1'>
                  <p className='text-sm font-medium'>Require Kit Inspection</p>
                  <p className='text-muted-foreground text-xs'>
                    When on, finished kits move from Build Kit → Inspection → On
                    Dock. When off, the Inspection stage is bypassed: kits move
                    straight to On Dock, the Quality Check kanban column is
                    hidden, and the RF Inspect Kit tile is removed from the
                    operator menu.
                  </p>
                </div>
                <Switch
                  checked={kitInspectionRequired}
                  onCheckedChange={(checked) =>
                    setKitInspectionRequired(checked)
                  }
                  disabled={workflowControlsDisabled}
                  aria-label='Require Kit Inspection'
                />
              </div>

              {/* Black-Hat ship-short authorization policy
                  (see migration 312 + [[Black-Hat-Ship-Short-Authorization-Panel]]). */}
              <div
                className='space-y-3 rounded-lg border p-4'
                data-testid='black-hat-ship-short-policy-section'
              >
                <div className='space-y-1'>
                  <p className='text-sm font-semibold'>
                    Black Hat Ship-Short Authorization
                  </p>
                  <p className='text-muted-foreground text-xs'>
                    Controls how operators may authorize partial shipments (Ship
                    Short) on the Kit Build Audit Trail (Quick View) when a kit
                    is blocked by a Black Hat. Authorizing a missing BOM line
                    auto-clears the Black Hat once every blocked component has
                    been covered.
                  </p>
                </div>

                <div className='bg-muted/40 flex items-start justify-between gap-4 rounded-md border p-3'>
                  <div className='space-y-1'>
                    <p className='text-sm font-medium'>
                      Enable Inline Authorization Panel
                    </p>
                    <p className='text-muted-foreground text-xs'>
                      Show the per-line authorization panel inside the Kit Build
                      Audit Trail for Black-Hat-flagged kits. Operators see one
                      row per missing BOM component with a checkbox and
                      justification field. When off, only the legacy "Edit Ship
                      Short" power-user button at the top of the dialog remains.
                    </p>
                  </div>
                  <Switch
                    checked={blackHatShipShortPolicy.enabled}
                    onCheckedChange={(checked) =>
                      setBlackHatShipShortAuthorizationEnabled(checked)
                    }
                    disabled={workflowControlsDisabled}
                    aria-label='Enable Black Hat ship-short authorization panel'
                  />
                </div>

                <div className='bg-muted/40 flex items-start justify-between gap-4 rounded-md border p-3'>
                  <div className='space-y-1'>
                    <p className='text-sm font-medium'>
                      Require Justification Per Line
                    </p>
                    <p className='text-muted-foreground text-xs'>
                      When on, every authorized line must include a description
                      (e.g. "expedite ETA 2026-05-21", "customer concession
                      #1234"). Saves are blocked until every selected line has
                      text. When off, justification is optional.
                    </p>
                  </div>
                  <Switch
                    checked={blackHatShipShortPolicy.requireJustification}
                    onCheckedChange={(checked) =>
                      setBlackHatShipShortRequireJustification(checked)
                    }
                    disabled={blackHatChildControlsDisabled}
                    aria-label='Require justification for each Black Hat ship-short authorization'
                  />
                </div>

                <div className='bg-muted/40 flex items-start justify-between gap-4 rounded-md border p-3'>
                  <div className='space-y-1'>
                    <p className='text-sm font-medium'>
                      Require Line-by-Line Approval
                    </p>
                    <p className='text-muted-foreground text-xs'>
                      When on, every missing BOM line must be individually
                      ticked by the operator — no bulk-authorize shortcut. When
                      off, an "Authorize All Missing" button is exposed that
                      pre-selects every missing line in a single click.
                    </p>
                  </div>
                  <Switch
                    checked={blackHatShipShortPolicy.requireLineByLineApproval}
                    onCheckedChange={(checked) =>
                      setBlackHatShipShortRequireLineByLineApproval(checked)
                    }
                    disabled={blackHatChildControlsDisabled}
                    aria-label='Require line-by-line approval for Black Hat ship-short authorizations'
                  />
                </div>
              </div>

              {/* Non-Warehouse Bin Patterns
                  (see migration 314 + [[Non-Warehouse-Bin-Acknowledgment]]). */}
              <div
                className='space-y-3 rounded-lg border p-4'
                data-testid='non-warehouse-bin-patterns-section'
              >
                <div className='space-y-1'>
                  <p className='text-sm font-semibold'>
                    Non-Warehouse Bin Patterns
                  </p>
                  <p className='text-muted-foreground text-xs'>
                    Source-bin substrings (case-insensitive) that mark a
                    Transfer Order as "lives at the plant". When a kit build
                    plan is being created or appended to, any TO referencing one
                    of these bins surfaces an External-Plant-Bins
                    acknowledgement card that the operator must tick before
                    saving. The default
                    <span className='mx-1 font-mono'>NEEDBIN</span>
                    matches <span className='font-mono'>112NEEDBIN</span>,
                    <span className='mx-1 font-mono'>R0NEEDBIN</span>, and any
                    other bin containing the substring.
                  </p>
                </div>

                <div className='flex flex-wrap gap-2'>
                  {nonWarehouseBinPatterns.length === 0 ? (
                    <div className='text-muted-foreground bg-muted/30 rounded-md border border-dashed px-3 py-2 text-xs italic'>
                      No patterns configured — the acknowledgement card will
                      never surface.
                    </div>
                  ) : (
                    nonWarehouseBinPatterns.map((pattern) => (
                      <Badge
                        key={pattern}
                        variant='outline'
                        className='flex items-center gap-1.5 border-amber-500/40 bg-amber-500/10 py-1 pr-1 pl-2.5 font-mono text-xs text-amber-800 dark:text-amber-200'
                      >
                        {pattern}
                        <Button
                          type='button'
                          variant='ghost'
                          size='icon'
                          className='h-5 w-5 hover:bg-amber-500/20'
                          onClick={() => handleRemoveBinPattern(pattern)}
                          disabled={
                            workflowControlsDisabled || isMutatingBinPatterns
                          }
                          aria-label={`Remove ${pattern}`}
                        >
                          <X className='h-3 w-3' />
                        </Button>
                      </Badge>
                    ))
                  )}
                </div>

                <div className='flex flex-wrap items-center gap-2'>
                  <Input
                    value={newBinPattern}
                    onChange={(e) =>
                      setNewBinPattern(e.target.value.toUpperCase())
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        void handleAddBinPattern()
                      }
                    }}
                    placeholder='e.g. NEEDBIN, PLANTA, OFFSITE'
                    disabled={workflowControlsDisabled || isMutatingBinPatterns}
                    className='h-9 max-w-xs flex-1 font-mono uppercase'
                  />
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    onClick={handleAddBinPattern}
                    disabled={
                      workflowControlsDisabled ||
                      isMutatingBinPatterns ||
                      !newBinPattern.trim()
                    }
                  >
                    {isMutatingBinPatterns ? (
                      <Loader2 className='mr-2 h-3.5 w-3.5 animate-spin' />
                    ) : (
                      <Plus className='mr-2 h-3.5 w-3.5' />
                    )}
                    Add Pattern
                  </Button>
                </div>
              </div>

              {/* Deliver To Plant Locations
                  (see migration 324 + [[Configurable-Deliver-To-Plant-Locations]]).
                  Operator-editable list rendered in the "Deliver To
                  Plant" dropdown of the Add Kit Build Plan dialog.
                  Stored verbatim as the chosen value on the kit row, so
                  the labels here are exactly what shows up on the
                  kanban / audit trail downstream. */}
              <div
                className='space-y-3 rounded-lg border p-4'
                data-testid='deliver-to-plant-locations-section'
              >
                <div className='space-y-1'>
                  <p className='text-sm font-semibold'>
                    Deliver To Plant Locations
                  </p>
                  <p className='text-muted-foreground text-xs'>
                    Destinations rendered in the{' '}
                    <span className='font-medium'>Deliver To Plant</span>{' '}
                    dropdown of the Add Kit Build Plan dialog. Each entry is
                    stored verbatim as the chosen value on the kit row, so the
                    label you type here is exactly what shows up on the kanban
                    card and the Kit Build Audit Trail downstream.
                  </p>
                </div>

                <div className='flex flex-wrap gap-2'>
                  {deliverToPlantLocations.length === 0 ? (
                    <div className='text-muted-foreground bg-muted/30 rounded-md border border-dashed px-3 py-2 text-xs italic'>
                      No plant destinations configured — the Add Kit Build Plan
                      dialog's dropdown will be empty.
                    </div>
                  ) : (
                    deliverToPlantLocations.map((location) => (
                      <Badge
                        key={location}
                        variant='outline'
                        className='flex items-center gap-1.5 border-sky-500/40 bg-sky-500/10 py-1 pr-1 pl-2.5 text-xs text-sky-800 dark:text-sky-200'
                      >
                        {location}
                        <Button
                          type='button'
                          variant='ghost'
                          size='icon'
                          className='h-5 w-5 hover:bg-sky-500/20'
                          onClick={() => handleRemovePlantLocation(location)}
                          disabled={
                            workflowControlsDisabled || isMutatingPlantLocations
                          }
                          aria-label={`Remove ${location}`}
                        >
                          <X className='h-3 w-3' />
                        </Button>
                      </Badge>
                    ))
                  )}
                </div>

                <div className='flex flex-wrap items-center gap-2'>
                  <Input
                    value={newPlantLocation}
                    onChange={(e) => setNewPlantLocation(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        void handleAddPlantLocation()
                      }
                    }}
                    placeholder='e.g. Plant F - Final Pack, Outbound Yard'
                    disabled={
                      workflowControlsDisabled || isMutatingPlantLocations
                    }
                    className='h-9 max-w-sm flex-1'
                  />
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    onClick={handleAddPlantLocation}
                    disabled={
                      workflowControlsDisabled ||
                      isMutatingPlantLocations ||
                      !newPlantLocation.trim()
                    }
                  >
                    {isMutatingPlantLocations ? (
                      <Loader2 className='mr-2 h-3.5 w-3.5 animate-spin' />
                    ) : (
                      <Plus className='mr-2 h-3.5 w-3.5' />
                    )}
                    Add Destination
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className='max-w-lg'>
          <DialogHeader>
            <DialogTitle>
              {editing ? 'Edit Kitting Option' : 'Add Kitting Option'}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? 'Update the selected kitting dropdown option.'
                : 'Create a new dropdown option for kitting settings.'}
            </DialogDescription>
          </DialogHeader>

          <div className='space-y-4'>
            <div className='space-y-1.5'>
              <label className='text-sm font-medium'>Option Group</label>
              <Input
                value={
                  KITTING_OPTION_GROUPS.find(
                    (group) => group.value === form.option_group
                  )?.label ?? form.option_group
                }
                disabled
              />
            </div>

            <div className='space-y-1.5'>
              <label className='text-sm font-medium'>Option Value</label>
              <Input
                value={form.option_value}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    option_value: e.target.value,
                  }))
                }
                disabled={saving || !!editing}
                placeholder='Internal value'
              />
            </div>

            <div className='space-y-1.5'>
              <label className='text-sm font-medium'>Display Label</label>
              <Input
                value={form.option_label}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    option_label: e.target.value,
                  }))
                }
                disabled={saving}
                placeholder='Human-readable label'
              />
            </div>

            <div className='space-y-1.5'>
              <label className='text-sm font-medium'>Description</label>
              <Textarea
                value={form.description}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    description: e.target.value,
                  }))
                }
                disabled={saving}
                placeholder='Optional description'
                rows={3}
              />
            </div>

            <div className='flex items-center justify-between rounded-lg border p-3'>
              <div>
                <p className='text-sm font-medium'>Active</p>
                <p className='text-muted-foreground text-xs'>
                  Inactive options remain on existing records but are hidden
                  from new selections.
                </p>
              </div>
              <Switch
                checked={form.is_active}
                onCheckedChange={(checked) =>
                  setForm((prev) => ({ ...prev, is_active: checked }))
                }
                disabled={saving}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => setDialogOpen(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={
                saving || !form.option_value.trim() || !form.option_label.trim()
              }
            >
              {saving && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
              {editing ? 'Save Changes' : 'Create Option'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// Created and developed by Jai Singh
