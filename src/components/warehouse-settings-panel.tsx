// Created and developed by Jai Singh
'use client'

import { useMemo, useState } from 'react'
import { Info, Loader2, Plus, Save, Trash2, Warehouse } from 'lucide-react'
import { toast } from 'sonner'
import type {
  Warehouse as WarehouseRow,
  WarehouseUpsert,
} from '@/lib/supabase/warehouses.service'
import { cn } from '@/lib/utils'
import { useWarehouses } from '@/hooks/use-warehouses'
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
import { Switch } from '@/components/ui/switch'

// Codes are matched against the trailing 3 chars the RF scanner emits
// (`parseTONumber` does `slice(-3)`), so a valid code MUST be exactly 3
// alphanumeric characters — anything else could never match a real scan.
const CODE_REGEX = /^[A-Z0-9]{3}$/

interface Draft {
  id?: string
  code: string
  name: string
  is_active: boolean
  sort_order: number
}

const EMPTY_DRAFT: Draft = {
  code: '',
  name: '',
  is_active: true,
  sort_order: 100,
}

export default function WarehouseSettingsPanel() {
  const { warehouses, isLoading, isMutating, save, remove } = useWarehouses()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)

  const activeCount = useMemo(
    () => warehouses.filter((w) => w.is_active).length,
    [warehouses]
  )

  const codeError = useMemo<string | null>(() => {
    const code = draft.code.trim().toUpperCase()
    if (!code) return null
    if (!CODE_REGEX.test(code)) {
      return 'Code must be exactly 3 letters/digits (e.g. WH5).'
    }
    const clash = warehouses.some(
      (w) => w.code.toUpperCase() === code && w.id !== editingId
    )
    if (clash) return 'A warehouse with this code already exists.'
    return null
  }, [draft.code, warehouses, editingId])

  const openNew = () => {
    setEditingId(null)
    setDraft({ ...EMPTY_DRAFT, sort_order: (warehouses.length + 1) * 10 })
    setDialogOpen(true)
  }

  const openEdit = (warehouse: WarehouseRow) => {
    setEditingId(warehouse.id)
    setDraft({
      id: warehouse.id,
      code: warehouse.code,
      name: warehouse.name ?? '',
      is_active: warehouse.is_active,
      sort_order: warehouse.sort_order,
    })
    setDialogOpen(true)
  }

  const handleSave = async () => {
    const code = draft.code.trim().toUpperCase()
    if (codeError || !code) {
      toast.error(codeError ?? 'Warehouse code is required.')
      return
    }
    try {
      const payload: WarehouseUpsert = {
        id: draft.id,
        code,
        name: draft.name.trim() || null,
        is_active: draft.is_active,
        sort_order: draft.sort_order,
      }
      await save(payload)
      toast.success(editingId ? 'Warehouse updated.' : 'Warehouse added.')
      setDialogOpen(false)
    } catch {
      // toast surfaced in the hook
    }
  }

  const handleDelete = async (id: string, code: string) => {
    if (
      !window.confirm(
        `Delete warehouse "${code}"? Scans that resolve to this code will be blocked until it is re-added.`
      )
    ) {
      return
    }
    try {
      await remove(id)
      toast.success('Warehouse deleted.')
    } catch {
      // toast surfaced in the hook
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
            <div className='rounded-xl bg-sky-500/10 p-2 text-sky-600 dark:text-sky-400'>
              <Warehouse className='h-5 w-5' />
            </div>
            <div>
              <CardTitle className='text-lg'>Warehouses</CardTitle>
              <p className='text-muted-foreground mt-1 text-xs'>
                The allowlist of valid warehouse codes. RF put-away scans whose
                parsed warehouse isn&rsquo;t on this list are rejected, so a
                mis-read scanner code never persists. Codes are 3 characters
                (e.g. <span className='font-mono'>WH5</span>).
              </p>
            </div>
          </div>
          <div className='flex shrink-0 items-center gap-2'>
            <Badge variant='outline' className='text-[10px]'>
              {activeCount} active
            </Badge>
            <Button size='sm' variant='default' onClick={openNew}>
              <Plus className='mr-1.5 h-3.5 w-3.5' />
              New Warehouse
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {warehouses.length === 0 ? (
            <div className='text-muted-foreground flex flex-col items-center gap-2 py-10 text-center text-sm'>
              <Info className='h-8 w-8 opacity-40' />
              <p>No warehouses configured.</p>
              <p className='text-xs'>
                Add the valid codes for your site so RF scans validate against
                them.
              </p>
            </div>
          ) : (
            <div className='space-y-2'>
              {warehouses.map((warehouse) => (
                <div
                  key={warehouse.id}
                  className={cn(
                    'flex items-center justify-between gap-2 rounded-lg border p-3',
                    !warehouse.is_active && 'bg-muted/30 opacity-70'
                  )}
                >
                  <div className='flex min-w-0 items-center gap-3'>
                    <span
                      className='text-muted-foreground font-mono text-[10px] tabular-nums'
                      title='Sort order'
                    >
                      #{warehouse.sort_order}
                    </span>
                    <Badge className='border-sky-500/30 bg-sky-500/15 font-mono text-[11px] text-sky-700 dark:text-sky-400'>
                      {warehouse.code}
                    </Badge>
                    <div className='min-w-0'>
                      <span className='truncate text-sm font-medium'>
                        {warehouse.name || (
                          <span className='text-muted-foreground italic'>
                            no name
                          </span>
                        )}
                      </span>
                      {!warehouse.is_active && (
                        <Badge variant='outline' className='ml-2 text-[10px]'>
                          disabled
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className='flex shrink-0 items-center gap-1'>
                    <Button
                      size='sm'
                      variant='ghost'
                      onClick={() => openEdit(warehouse)}
                      className='h-7 px-2 text-[11px]'
                    >
                      Edit
                    </Button>
                    <Button
                      size='sm'
                      variant='ghost'
                      onClick={() => handleDelete(warehouse.id, warehouse.code)}
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
        <DialogContent className='max-w-md'>
          <DialogHeader>
            <DialogTitle>
              {editingId ? 'Edit Warehouse' : 'New Warehouse'}
            </DialogTitle>
            <DialogDescription>
              The code is matched against the warehouse segment of the scanned
              T.O. label. It must be exactly 3 characters.
            </DialogDescription>
          </DialogHeader>

          <div className='grid gap-3 py-2'>
            <div className='space-y-1.5'>
              <Label className='text-xs font-semibold'>Code (required)</Label>
              <Input
                value={draft.code}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    code: e.target.value
                      .toUpperCase()
                      .replace(/[^A-Z0-9]/g, '')
                      .slice(0, 3),
                  })
                }
                placeholder='e.g. WH5'
                className={cn(
                  'font-mono uppercase',
                  codeError && 'border-destructive'
                )}
                maxLength={3}
                autoFocus
              />
              <p
                className={cn(
                  'text-[11px]',
                  codeError ? 'text-destructive' : 'text-muted-foreground'
                )}
              >
                {codeError ?? '3 letters or digits, stored uppercase.'}
              </p>
            </div>

            <div className='space-y-1.5'>
              <Label className='text-xs font-semibold'>
                Name{' '}
                <span className='text-muted-foreground font-normal'>
                  (optional)
                </span>
              </Label>
              <Input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder='e.g. Primary Distribution Center'
                maxLength={120}
              />
            </div>

            <div className='space-y-1.5'>
              <Label className='text-xs font-semibold'>
                Sort order (lower shows first)
              </Label>
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
            </div>

            <div className='space-y-1.5'>
              <Label className='text-xs font-semibold'>Active</Label>
              <div className='flex h-9 items-center'>
                <Switch
                  checked={draft.is_active}
                  onCheckedChange={(v) => setDraft({ ...draft, is_active: v })}
                />
                <span className='text-muted-foreground ml-2 text-xs'>
                  {draft.is_active
                    ? 'Accepted on RF scans'
                    : 'Paused — scans with this code are blocked'}
                </span>
              </div>
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
            <Button
              onClick={handleSave}
              disabled={isMutating || !draft.code.trim() || !!codeError}
            >
              {isMutating ? (
                <Loader2 className='mr-1.5 h-3.5 w-3.5 animate-spin' />
              ) : (
                <Save className='mr-1.5 h-3.5 w-3.5' />
              )}
              {editingId ? 'Save' : 'Add'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// Created and developed by Jai Singh
