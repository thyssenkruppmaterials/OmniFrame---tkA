// Created and developed by Jai Singh
import { useEffect, useMemo, useState } from 'react'
import {
  Check,
  Copy,
  Edit,
  Loader2,
  Mail,
  MapPin,
  Plus,
  Trash2,
  User,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import type {
  DropOffArea,
  DropOffAreaAssociateWithUser,
  DropOffAreaWithAssociates,
  OrganizationUser,
} from '@/lib/supabase/drop-off-area.service'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/utils/logger'
import { useDropOffAreas } from '@/hooks/use-drop-off-areas'
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
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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

interface DropOffAreaManagerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface AreaFormState {
  name: string
  barcode: string
  description: string
  display_order: number
  is_active: boolean
}

interface AssociateFormState {
  user_id: string
  badge_code: string
  is_active: boolean
}

const DEFAULT_AREA_FORM: AreaFormState = {
  name: '',
  barcode: '',
  description: '',
  display_order: 0,
  is_active: true,
}

const DEFAULT_ASSOCIATE_FORM: AssociateFormState = {
  user_id: '',
  badge_code: '',
  is_active: true,
}

function describeUser(user: OrganizationUser | null | undefined): string {
  if (!user) return 'Unknown user'
  return user.full_name || user.email || 'Unknown user'
}

function copyToClipboard(value: string, label: string) {
  navigator.clipboard
    .writeText(value)
    .then(() => toast.success(`${label} copied`))
    .catch(() => toast.error('Copy failed'))
}

// ─── Area form dialog (create / edit) ─────────────────────────────────────
function AreaFormDialog({
  open,
  onOpenChange,
  editingArea,
  existingAreas,
  onSubmit,
  saving,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  editingArea: DropOffArea | null
  existingAreas: DropOffAreaWithAssociates[]
  onSubmit: (form: AreaFormState) => Promise<void>
  saving: boolean
}) {
  const [form, setForm] = useState<AreaFormState>(DEFAULT_AREA_FORM)

  useEffect(() => {
    if (!open) {
      setForm(DEFAULT_AREA_FORM)
      return
    }
    if (editingArea) {
      setForm({
        name: editingArea.name,
        barcode: editingArea.barcode,
        description: editingArea.description ?? '',
        display_order: editingArea.display_order,
        is_active: editingArea.is_active,
      })
    } else {
      setForm({
        ...DEFAULT_AREA_FORM,
        display_order: existingAreas.length,
      })
    }
  }, [open, editingArea, existingAreas.length])

  const trimmedName = form.name.trim()
  const trimmedBarcode = form.barcode.trim()

  const nameConflict = existingAreas.some(
    (area) =>
      area.id !== editingArea?.id &&
      area.name.toLowerCase() === trimmedName.toLowerCase() &&
      trimmedName.length > 0
  )

  const barcodeConflict = existingAreas.some(
    (area) =>
      area.id !== editingArea?.id &&
      area.barcode.toLowerCase() === trimmedBarcode.toLowerCase() &&
      trimmedBarcode.length > 0
  )

  const canSubmit =
    trimmedName.length > 0 &&
    trimmedBarcode.length > 0 &&
    !nameConflict &&
    !barcodeConflict &&
    !saving

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>
            {editingArea ? 'Edit Drop-off Area' : 'Add Drop-off Area'}
          </DialogTitle>
          <DialogDescription>
            Configure a physical area where inbound TKA batches can be dropped
            off. The barcode below is what RF operators scan during the Inbound
            Part Transfer workflow.
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-4'>
          <div className='space-y-1.5'>
            <label className='text-sm font-medium'>Area Name *</label>
            <Input
              value={form.name}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, name: e.target.value }))
              }
              placeholder='e.g., Kitting Staging, Outbound Dock 3'
              disabled={saving}
            />
            {nameConflict && (
              <p className='text-destructive text-xs'>
                Another drop-off area already uses this name.
              </p>
            )}
          </div>

          <div className='space-y-1.5'>
            <label className='text-sm font-medium'>Scannable Barcode *</label>
            <Input
              value={form.barcode}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  barcode: e.target.value.toUpperCase(),
                }))
              }
              placeholder='e.g., DOA-KITTING-01'
              className='font-mono'
              disabled={saving}
            />
            {barcodeConflict && (
              <p className='text-destructive text-xs'>
                Another area already uses this barcode.
              </p>
            )}
            <p className='text-muted-foreground text-xs'>
              Print this code on a label at the drop-off location. RF operators
              scan it to identify the area.
            </p>
          </div>

          <div className='space-y-1.5'>
            <label className='text-sm font-medium'>Description</label>
            <Textarea
              value={form.description}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, description: e.target.value }))
              }
              placeholder='Optional context (e.g., supervisor, normal working hours)'
              rows={2}
              disabled={saving}
            />
          </div>

          <div className='grid grid-cols-2 gap-4'>
            <div className='space-y-1.5'>
              <label className='text-sm font-medium'>Display Order</label>
              <Input
                type='number'
                value={form.display_order}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    display_order: Number(e.target.value) || 0,
                  }))
                }
                disabled={saving}
              />
            </div>

            <div className='flex items-end justify-between rounded-lg border p-3'>
              <div>
                <p className='text-sm font-medium'>Active</p>
                <p className='text-muted-foreground text-xs'>
                  Inactive areas are hidden from the RF scanner.
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
        </div>

        <DialogFooter>
          <Button
            variant='outline'
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={() => onSubmit(form)} disabled={!canSubmit}>
            {saving && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
            {editingArea ? 'Save Changes' : 'Create Area'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Associate form dialog (create / edit) ─────────────────────────────────
function AssociateFormDialog({
  open,
  onOpenChange,
  area,
  editingAssociate,
  organizationUsers,
  onSubmit,
  saving,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  area: DropOffAreaWithAssociates | null
  editingAssociate: DropOffAreaAssociateWithUser | null
  organizationUsers: OrganizationUser[]
  onSubmit: (form: AssociateFormState) => Promise<void>
  saving: boolean
}) {
  const [form, setForm] = useState<AssociateFormState>(DEFAULT_ASSOCIATE_FORM)

  useEffect(() => {
    if (!open) {
      setForm(DEFAULT_ASSOCIATE_FORM)
      return
    }
    if (editingAssociate) {
      setForm({
        user_id: editingAssociate.user_id,
        badge_code: editingAssociate.badge_code ?? '',
        is_active: editingAssociate.is_active,
      })
    }
  }, [open, editingAssociate])

  // When adding, exclude users already authorized for this area.
  const alreadyAuthorizedIds = useMemo(
    () =>
      new Set(
        (area?.associates ?? [])
          .filter((a) => a.id !== editingAssociate?.id)
          .map((a) => a.user_id)
      ),
    [area?.associates, editingAssociate?.id]
  )

  const selectableUsers = useMemo(() => {
    if (editingAssociate) {
      return organizationUsers.filter((u) => u.id === editingAssociate.user_id)
    }
    return organizationUsers.filter((u) => !alreadyAuthorizedIds.has(u.id))
  }, [organizationUsers, alreadyAuthorizedIds, editingAssociate])

  const selectedUser = useMemo(
    () => organizationUsers.find((u) => u.id === form.user_id) ?? null,
    [organizationUsers, form.user_id]
  )

  const canSubmit = !!form.user_id && !saving

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>
            {editingAssociate ? 'Edit Associate' : 'Add Associate'}
          </DialogTitle>
          <DialogDescription>
            {area?.name
              ? `Authorized to accept drop-offs at "${area.name}".`
              : 'Authorized to accept drop-offs at this area.'}{' '}
            Associates scan their login-email QR code from their lanyard on the
            RF to confirm acceptance.
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-4'>
          <div className='space-y-1.5'>
            <label className='text-sm font-medium'>Associate *</label>
            {editingAssociate ? (
              <div className='bg-muted/40 flex items-center gap-2 rounded-md border p-3'>
                <User className='text-muted-foreground h-4 w-4 shrink-0' />
                <div className='min-w-0 flex-1'>
                  <p className='truncate text-sm font-medium'>
                    {describeUser(editingAssociate.user_profile)}
                  </p>
                  {editingAssociate.user_profile?.email && (
                    <p className='text-muted-foreground truncate text-xs'>
                      {editingAssociate.user_profile.email}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className='rounded-md border'>
                <Command className='**:[[cmdk-input-wrapper]]:border-b'>
                  <CommandInput placeholder='Search by name or email...' />
                  <CommandList className='max-h-[220px]'>
                    <CommandEmpty>
                      {selectableUsers.length === 0
                        ? 'Every user in your organization is already authorized here.'
                        : 'No users match that search.'}
                    </CommandEmpty>
                    <CommandGroup>
                      {selectableUsers.map((userOpt) => {
                        const isSelected = form.user_id === userOpt.id
                        return (
                          <CommandItem
                            key={userOpt.id}
                            value={`${userOpt.full_name ?? ''} ${userOpt.email ?? ''}`}
                            onSelect={() =>
                              setForm((prev) => ({
                                ...prev,
                                user_id: userOpt.id,
                              }))
                            }
                            className='flex items-center gap-2'
                          >
                            <User className='text-muted-foreground h-4 w-4 shrink-0' />
                            <div className='min-w-0 flex-1'>
                              <p className='truncate text-sm font-medium'>
                                {userOpt.full_name || 'Unnamed user'}
                              </p>
                              <p className='text-muted-foreground truncate text-xs'>
                                <Mail className='mr-1 inline h-3 w-3' />
                                {userOpt.email ?? 'no email'}
                              </p>
                            </div>
                            {isSelected && (
                              <Check className='text-primary h-4 w-4' />
                            )}
                          </CommandItem>
                        )
                      })}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </div>
            )}
            {!editingAssociate && selectedUser && (
              <div className='bg-primary/5 border-primary/20 flex items-center gap-2 rounded-md border p-2'>
                <Check className='text-primary h-4 w-4 shrink-0' />
                <div className='min-w-0 flex-1 text-xs'>
                  <span className='font-medium'>
                    {describeUser(selectedUser)}
                  </span>
                  {selectedUser.email && (
                    <span className='text-muted-foreground ml-1'>
                      · {selectedUser.email}
                    </span>
                  )}
                </div>
              </div>
            )}
            <p className='text-muted-foreground text-xs'>
              On the RF, the associate scans the email-encoded QR code printed
              on their lanyard. Only users listed here can accept drop-offs at
              this area.
            </p>
          </div>

          <div className='space-y-1.5'>
            <label className='text-sm font-medium'>
              Badge Label (optional)
            </label>
            <Input
              value={form.badge_code}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  badge_code: e.target.value.toUpperCase(),
                }))
              }
              placeholder='Optional label to print on a physical badge'
              className='font-mono'
              disabled={saving}
            />
            <p className='text-muted-foreground text-xs'>
              Cosmetic only. Not used for RF acceptance.
            </p>
          </div>

          <div className='flex items-center justify-between rounded-lg border p-3'>
            <div>
              <p className='text-sm font-medium'>Active</p>
              <p className='text-muted-foreground text-xs'>
                Inactive associates can't accept drop-offs.
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
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={() => onSubmit(form)} disabled={!canSubmit}>
            {saving && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
            {editingAssociate ? 'Save Changes' : 'Add Associate'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Main dialog ──────────────────────────────────────────────────────────
export function DropOffAreaManagerDialog({
  open,
  onOpenChange,
}: DropOffAreaManagerDialogProps) {
  const {
    areas,
    organizationUsers,
    isLoading,
    createArea,
    updateArea,
    deleteArea,
    createAssociate,
    updateAssociate,
    deleteAssociate,
  } = useDropOffAreas()

  const [areaFormOpen, setAreaFormOpen] = useState(false)
  const [editingArea, setEditingArea] = useState<DropOffArea | null>(null)
  const [savingArea, setSavingArea] = useState(false)

  const [associateFormOpen, setAssociateFormOpen] = useState(false)
  const [activeAreaForAssociate, setActiveAreaForAssociate] =
    useState<DropOffAreaWithAssociates | null>(null)
  const [editingAssociate, setEditingAssociate] =
    useState<DropOffAreaAssociateWithUser | null>(null)
  const [savingAssociate, setSavingAssociate] = useState(false)

  const totals = useMemo(() => {
    const activeAreas = areas.filter((a) => a.is_active).length
    const associates = areas.reduce(
      (sum, area) => sum + area.associates.length,
      0
    )
    return { activeAreas, totalAreas: areas.length, associates }
  }, [areas])

  const handleSaveArea = async (form: AreaFormState) => {
    try {
      setSavingArea(true)
      if (editingArea) {
        await updateArea({
          id: editingArea.id,
          updates: {
            name: form.name.trim(),
            barcode: form.barcode.trim(),
            description: form.description.trim() || null,
            display_order: form.display_order,
            is_active: form.is_active,
          },
        })
      } else {
        await createArea({
          name: form.name.trim(),
          barcode: form.barcode.trim(),
          description: form.description.trim() || null,
          display_order: form.display_order,
          is_active: form.is_active,
        })
      }
      setAreaFormOpen(false)
      setEditingArea(null)
    } catch (error) {
      logger.error('Error saving drop-off area:', error)
    } finally {
      setSavingArea(false)
    }
  }

  const handleDeleteArea = async (area: DropOffAreaWithAssociates) => {
    const confirm = window.confirm(
      `Delete "${area.name}"? This also removes ${area.associates.length} associate(s). Past transfer history is preserved.`
    )
    if (!confirm) return
    try {
      await deleteArea(area.id)
    } catch (error) {
      logger.error('Error deleting drop-off area:', error)
    }
  }

  const handleSaveAssociate = async (form: AssociateFormState) => {
    if (!activeAreaForAssociate) return
    if (!form.user_id) {
      toast.error('Pick an associate first')
      return
    }
    try {
      setSavingAssociate(true)
      const trimmedBadge = form.badge_code.trim()
      if (editingAssociate) {
        await updateAssociate({
          id: editingAssociate.id,
          updates: {
            badge_code: trimmedBadge || null,
            is_active: form.is_active,
          },
        })
      } else {
        await createAssociate({
          drop_off_area_id: activeAreaForAssociate.id,
          user_id: form.user_id,
          badge_code: trimmedBadge || null,
          is_active: form.is_active,
        })
      }
      setAssociateFormOpen(false)
      setEditingAssociate(null)
    } catch (error) {
      logger.error('Error saving associate:', error)
    } finally {
      setSavingAssociate(false)
    }
  }

  const handleDeleteAssociate = async (
    associate: DropOffAreaAssociateWithUser,
    areaName: string
  ) => {
    const label = describeUser(associate.user_profile)
    const confirm = window.confirm(
      `Remove ${label} from "${areaName}"? Past transfers remain.`
    )
    if (!confirm) return
    try {
      await deleteAssociate(associate.id)
    } catch (error) {
      logger.error('Error deleting associate:', error)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className='flex max-h-[85vh] flex-col overflow-hidden sm:max-w-[800px]'>
          <DialogHeader>
            <DialogTitle className='flex items-center gap-2'>
              <MapPin className='h-5 w-5 text-blue-500' />
              Manage Drop-off Areas
            </DialogTitle>
            <DialogDescription>
              Configure drop-off zones used by the RF Inbound Part Transfer
              workflow. Each area has a scannable barcode and a list of
              associates authorized to accept deliveries.
            </DialogDescription>
          </DialogHeader>

          <div className='flex-1 space-y-4 overflow-y-auto py-2'>
            <div className='flex flex-wrap items-center justify-between gap-3'>
              <div className='text-muted-foreground text-sm'>
                {totals.activeAreas} active / {totals.totalAreas} areas •{' '}
                {totals.associates} authorized associates
              </div>
              <Button
                onClick={() => {
                  setEditingArea(null)
                  setAreaFormOpen(true)
                }}
              >
                <Plus className='mr-2 h-4 w-4' />
                Add Drop-off Area
              </Button>
            </div>

            {isLoading ? (
              <div className='flex items-center justify-center py-10'>
                <Loader2 className='h-6 w-6 animate-spin text-blue-500' />
                <span className='text-muted-foreground ml-2 text-sm'>
                  Loading drop-off areas...
                </span>
              </div>
            ) : areas.length === 0 ? (
              <div className='text-muted-foreground py-10 text-center'>
                <MapPin className='mx-auto mb-2 h-10 w-10 text-blue-300' />
                <p className='font-medium'>No drop-off areas configured</p>
                <p className='mt-1 text-sm'>
                  Add an area to enable the RF Inbound Part Transfer workflow.
                </p>
              </div>
            ) : (
              <div className='space-y-4'>
                {areas.map((area) => (
                  <Card
                    key={area.id}
                    className={cn(
                      !area.is_active && 'border-muted bg-muted/30 opacity-70'
                    )}
                  >
                    <CardHeader className='pb-3'>
                      <div className='flex flex-wrap items-start justify-between gap-3'>
                        <div className='min-w-0 flex-1'>
                          <CardTitle className='flex flex-wrap items-center gap-2 text-base'>
                            <span className='truncate'>{area.name}</span>
                            <Badge
                              variant={area.is_active ? 'default' : 'secondary'}
                            >
                              {area.is_active ? 'Active' : 'Inactive'}
                            </Badge>
                          </CardTitle>
                          {area.description && (
                            <CardDescription className='mt-1'>
                              {area.description}
                            </CardDescription>
                          )}
                          <div className='mt-2 flex flex-wrap items-center gap-2'>
                            <code className='rounded bg-blue-50 px-2 py-0.5 font-mono text-xs dark:bg-blue-900/30'>
                              {area.barcode}
                            </code>
                            <Button
                              variant='ghost'
                              size='sm'
                              className='h-6 px-2'
                              onClick={() =>
                                copyToClipboard(area.barcode, 'Barcode')
                              }
                            >
                              <Copy className='mr-1 h-3 w-3' />
                              Copy
                            </Button>
                            <span className='text-muted-foreground text-xs'>
                              Order #{area.display_order}
                            </span>
                          </div>
                        </div>
                        <div className='flex shrink-0 items-center gap-2'>
                          <Button
                            variant='outline'
                            size='sm'
                            onClick={() => {
                              setEditingArea(area)
                              setAreaFormOpen(true)
                            }}
                          >
                            <Edit className='mr-1 h-3 w-3' />
                            Edit
                          </Button>
                          <Button
                            variant='ghost'
                            size='sm'
                            className='text-destructive hover:text-destructive hover:bg-destructive/10'
                            onClick={() => handleDeleteArea(area)}
                          >
                            <Trash2 className='h-4 w-4' />
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className='pt-0'>
                      <div className='mb-2 flex items-center justify-between'>
                        <div className='text-muted-foreground flex items-center gap-1 text-sm'>
                          <Users className='h-4 w-4' />
                          <span className='font-medium'>
                            Authorized Associates
                          </span>
                          <span>({area.associates.length})</span>
                        </div>
                        <Button
                          variant='outline'
                          size='sm'
                          onClick={() => {
                            setActiveAreaForAssociate(area)
                            setEditingAssociate(null)
                            setAssociateFormOpen(true)
                          }}
                        >
                          <Plus className='mr-1 h-3 w-3' />
                          Add Associate
                        </Button>
                      </div>

                      {area.associates.length === 0 ? (
                        <div className='text-muted-foreground flex items-center justify-center rounded-md border border-dashed py-6 text-xs'>
                          No associates configured. Add at least one so the RF
                          can accept drop-offs at this area.
                        </div>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Associate</TableHead>
                              <TableHead>Login Email (QR)</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead className='w-[120px] text-right'>
                                Actions
                              </TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {area.associates.map((assoc) => {
                              const name = describeUser(assoc.user_profile)
                              const email = assoc.user_profile?.email ?? null
                              return (
                                <TableRow key={assoc.id}>
                                  <TableCell>
                                    <div className='flex items-center gap-2'>
                                      <User className='text-muted-foreground h-4 w-4' />
                                      <div className='min-w-0'>
                                        <p className='truncate font-medium'>
                                          {name}
                                        </p>
                                        {assoc.badge_code && (
                                          <code className='text-muted-foreground font-mono text-[10px]'>
                                            Label: {assoc.badge_code}
                                          </code>
                                        )}
                                      </div>
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    {email ? (
                                      <div className='flex items-center gap-1'>
                                        <code className='bg-muted truncate rounded px-1.5 py-0.5 font-mono text-xs'>
                                          {email}
                                        </code>
                                        <Button
                                          variant='ghost'
                                          size='sm'
                                          className='h-6 w-6 p-0'
                                          onClick={() =>
                                            copyToClipboard(email, 'Email')
                                          }
                                        >
                                          <Copy className='h-3 w-3' />
                                        </Button>
                                      </div>
                                    ) : (
                                      <span className='text-muted-foreground text-xs'>
                                        User missing email
                                      </span>
                                    )}
                                  </TableCell>
                                  <TableCell>
                                    <Badge
                                      variant={
                                        assoc.is_active
                                          ? 'default'
                                          : 'secondary'
                                      }
                                    >
                                      {assoc.is_active ? 'Active' : 'Inactive'}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className='text-right'>
                                    <Button
                                      variant='ghost'
                                      size='sm'
                                      onClick={() => {
                                        setActiveAreaForAssociate(area)
                                        setEditingAssociate(assoc)
                                        setAssociateFormOpen(true)
                                      }}
                                    >
                                      <Edit className='h-4 w-4' />
                                    </Button>
                                    <Button
                                      variant='ghost'
                                      size='sm'
                                      className='text-destructive hover:text-destructive hover:bg-destructive/10'
                                      onClick={() =>
                                        handleDeleteAssociate(assoc, area.name)
                                      }
                                    >
                                      <Trash2 className='h-4 w-4' />
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              )
                            })}
                          </TableBody>
                        </Table>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>

          <DialogFooter className='border-t pt-2'>
            <Button variant='outline' onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AreaFormDialog
        open={areaFormOpen}
        onOpenChange={(next) => {
          setAreaFormOpen(next)
          if (!next) setEditingArea(null)
        }}
        editingArea={editingArea}
        existingAreas={areas}
        onSubmit={handleSaveArea}
        saving={savingArea}
      />

      <AssociateFormDialog
        open={associateFormOpen}
        onOpenChange={(next) => {
          setAssociateFormOpen(next)
          if (!next) setEditingAssociate(null)
        }}
        area={activeAreaForAssociate}
        editingAssociate={editingAssociate}
        organizationUsers={organizationUsers}
        onSubmit={handleSaveAssociate}
        saving={savingAssociate}
      />
    </>
  )
}

// Created and developed by Jai Singh
