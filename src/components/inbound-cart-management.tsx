// Created and developed by Jai Singh
import { useMemo, useState } from 'react'
import { format, toZonedTime } from 'date-fns-tz'
import {
  AlertTriangle,
  Archive,
  Box,
  CheckCircle2,
  Clock,
  Loader2,
  PackageCheck,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  ShoppingCart,
  Trash2,
  TrendingUp,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  useCartSummaryStats,
  useCreateCart,
  useDeactivateCart,
  useDeleteCart,
  useInboundCartDetails,
  useInboundCarts,
  useMarkCartFull,
  useReactivateCart,
  useRemoveTOFromCart,
  useUpdateCart,
} from '@/hooks/use-inbound-carts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

const formatTimestamp = (ts: string | null) => {
  if (!ts) return 'N/A'
  try {
    return format(
      toZonedTime(new Date(ts), 'America/New_York'),
      'MM/dd h:mm a',
      { timeZone: 'America/New_York' }
    )
  } catch {
    return 'Invalid'
  }
}

const statusConfig: Record<
  string,
  { color: string; bg: string; icon: LucideIcon; label: string }
> = {
  Empty: {
    color: 'text-emerald-600 dark:text-emerald-400',
    bg: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
    icon: Box,
    label: 'Empty',
  },
  Loading: {
    color: 'text-blue-600 dark:text-blue-400',
    bg: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
    icon: TrendingUp,
    label: 'Loading',
  },
  Full: {
    color: 'text-amber-600 dark:text-amber-400',
    bg: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
    icon: AlertTriangle,
    label: 'Full',
  },
  InPutaway: {
    color: 'text-purple-600 dark:text-purple-400',
    bg: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
    icon: PackageCheck,
    label: 'In Putaway',
  },
  Cleared: {
    color: 'text-gray-500 dark:text-gray-400',
    bg: 'bg-gray-100 text-gray-800 dark:bg-gray-800/30 dark:text-gray-400',
    icon: CheckCircle2,
    label: 'Cleared',
  },
}

function StatCard({
  label,
  value,
  icon: Icon,
  color,
  accent,
}: {
  label: string
  value: number
  icon: LucideIcon
  color: string
  accent: string
}) {
  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-xl border p-4 transition-all hover:shadow-sm',
        accent
      )}
    >
      <div className='flex items-center justify-between'>
        <div>
          <p className={cn('text-3xl font-bold tabular-nums', color)}>
            {value}
          </p>
          <p className='text-muted-foreground mt-0.5 text-xs font-medium'>
            {label}
          </p>
        </div>
        <div
          className={cn(
            'flex h-9 w-9 items-center justify-center rounded-lg bg-current/10',
            color
          )}
        >
          <Icon className='h-4.5 w-4.5 opacity-70' />
        </div>
      </div>
    </div>
  )
}

function CartFormFields({
  cartNumber,
  setCartNumber,
  maxCapacity,
  setMaxCapacity,
  warehouse,
  setWarehouse,
  zone,
  setZone,
  notes,
  setNotes,
}: {
  cartNumber: string
  setCartNumber: (v: string) => void
  maxCapacity: string
  setMaxCapacity: (v: string) => void
  warehouse: string
  setWarehouse: (v: string) => void
  zone: string
  setZone: (v: string) => void
  notes: string
  setNotes: (v: string) => void
}) {
  return (
    <div className='space-y-4'>
      <div className='space-y-1.5'>
        <label className='text-muted-foreground text-[11px] font-medium tracking-wider uppercase'>
          Cart Number <span className='text-destructive'>*</span>
        </label>
        <Input
          value={cartNumber}
          onChange={(e) => setCartNumber(e.target.value)}
          placeholder='e.g., CART-001'
        />
      </div>
      <div className='grid grid-cols-2 gap-3'>
        <div className='space-y-1.5'>
          <label className='text-muted-foreground text-[11px] font-medium tracking-wider uppercase'>
            Max Capacity
          </label>
          <Input
            type='number'
            min='1'
            value={maxCapacity}
            onChange={(e) => setMaxCapacity(e.target.value)}
          />
        </div>
        <div className='space-y-1.5'>
          <label className='text-muted-foreground text-[11px] font-medium tracking-wider uppercase'>
            Warehouse
          </label>
          <Input
            value={warehouse}
            onChange={(e) => setWarehouse(e.target.value)}
            placeholder='e.g., IPDC'
          />
        </div>
      </div>
      <div className='space-y-1.5'>
        <label className='text-muted-foreground text-[11px] font-medium tracking-wider uppercase'>
          Warehouse Zone
        </label>
        <Input
          value={zone}
          onChange={(e) => setZone(e.target.value)}
          placeholder='e.g., Zone A, Dock 3'
        />
      </div>
      <div className='space-y-1.5'>
        <label className='text-muted-foreground text-[11px] font-medium tracking-wider uppercase'>
          Notes
        </label>
        <Input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder='Optional notes'
        />
      </div>
    </div>
  )
}

function CreateCartDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const [cartNumber, setCartNumber] = useState('')
  const [maxCapacity, setMaxCapacity] = useState('10')
  const [warehouse, setWarehouse] = useState('')
  const [zone, setZone] = useState('')
  const [notes, setNotes] = useState('')
  const createMutation = useCreateCart()

  const handleSubmit = () => {
    if (!cartNumber.trim()) {
      toast.error('Cart number is required')
      return
    }
    createMutation.mutate(
      {
        cart_number: cartNumber.trim(),
        max_capacity: parseInt(maxCapacity) || 10,
        warehouse: warehouse || undefined,
        warehouse_zone: zone || undefined,
        notes: notes || undefined,
      },
      {
        onSuccess: (result) => {
          if (!result.error) {
            onOpenChange(false)
            setCartNumber('')
            setMaxCapacity('10')
            setWarehouse('')
            setZone('')
            setNotes('')
          }
        },
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <Plus className='h-4 w-4' />
            Create New Cart
          </DialogTitle>
        </DialogHeader>
        <div className='space-y-5 pt-1'>
          <CartFormFields
            cartNumber={cartNumber}
            setCartNumber={setCartNumber}
            maxCapacity={maxCapacity}
            setMaxCapacity={setMaxCapacity}
            warehouse={warehouse}
            setWarehouse={setWarehouse}
            zone={zone}
            setZone={setZone}
            notes={notes}
            setNotes={setNotes}
          />
          <Button
            onClick={handleSubmit}
            disabled={createMutation.isPending}
            className='w-full'
            size='lg'
          >
            {createMutation.isPending && (
              <Loader2 className='mr-2 h-4 w-4 animate-spin' />
            )}
            Create Cart
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function EditCartDialog({
  cart,
  open,
  onOpenChange,
}: {
  cart: {
    id: string
    cart_number: string
    max_capacity: number
    warehouse: string | null
    warehouse_zone: string | null
    notes: string | null
  } | null
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const [cartNumber, setCartNumber] = useState('')
  const [maxCapacity, setMaxCapacity] = useState('10')
  const [warehouse, setWarehouse] = useState('')
  const [zone, setZone] = useState('')
  const [notes, setNotes] = useState('')
  const updateMutation = useUpdateCart()

  const syncFromCart = (c: typeof cart) => {
    if (c) {
      setCartNumber(c.cart_number)
      setMaxCapacity(String(c.max_capacity))
      setWarehouse(c.warehouse || '')
      setZone(c.warehouse_zone || '')
      setNotes(c.notes || '')
    }
  }

  const handleOpen = (isOpen: boolean) => {
    if (isOpen) syncFromCart(cart)
    onOpenChange(isOpen)
  }

  const handleSubmit = () => {
    if (!cart || !cartNumber.trim()) {
      toast.error('Cart number is required')
      return
    }
    const cap = parseInt(maxCapacity)
    if (!cap || cap < 1) {
      toast.error('Max capacity must be at least 1')
      return
    }
    updateMutation.mutate(
      {
        id: cart.id,
        updates: {
          cart_number: cartNumber.trim().toUpperCase(),
          max_capacity: cap,
          warehouse: warehouse || undefined,
          warehouse_zone: zone || undefined,
          notes: notes || undefined,
        },
      },
      {
        onSuccess: (result) => {
          if (!result.error) {
            handleOpen(false)
          }
        },
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <Pencil className='h-4 w-4' />
            Edit Cart
          </DialogTitle>
        </DialogHeader>
        <div className='space-y-5 pt-1'>
          <CartFormFields
            cartNumber={cartNumber}
            setCartNumber={setCartNumber}
            maxCapacity={maxCapacity}
            setMaxCapacity={setMaxCapacity}
            warehouse={warehouse}
            setWarehouse={setWarehouse}
            zone={zone}
            setZone={setZone}
            notes={notes}
            setNotes={setNotes}
          />
          <Button
            onClick={handleSubmit}
            disabled={updateMutation.isPending}
            className='w-full'
            size='lg'
          >
            {updateMutation.isPending && (
              <Loader2 className='mr-2 h-4 w-4 animate-spin' />
            )}
            Save Changes
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function CartDetailDialog({
  cartId,
  open,
  onOpenChange,
}: {
  cartId: string | null
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const [editOpen, setEditOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const { data: details, isLoading } = useInboundCartDetails(
    open ? cartId : null
  )
  const markFullMutation = useMarkCartFull()
  const removeMutation = useRemoveTOFromCart()
  const deactivateMutation = useDeactivateCart()
  const reactivateMutation = useReactivateCart()
  const deleteMutation = useDeleteCart()

  const cart = details?.cart
  const assignments = details?.assignments || []
  const onCartAssignments = assignments.filter((a) => a.status === 'on_cart')
  const historicalAssignments = assignments.filter(
    (a) => a.status !== 'on_cart'
  )

  const cfg = cart ? statusConfig[cart.status] || statusConfig.Empty : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-3xl'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <ShoppingCart className='h-5 w-5' />
            {cart?.cart_number || 'Cart Details'}
            {cart && cfg && (
              <Badge className={cn('ml-2', cfg.bg)}>{cfg.label}</Badge>
            )}
          </DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className='flex items-center justify-center py-8'>
            <Loader2 className='text-muted-foreground h-6 w-6 animate-spin' />
          </div>
        ) : cart ? (
          <div className='space-y-5'>
            {/* Cart Info Grid */}
            <div className='grid grid-cols-2 gap-3 sm:grid-cols-4'>
              {[
                {
                  label: 'Zone',
                  value: cart.warehouse_zone || 'Not set',
                  icon: Archive,
                },
                {
                  label: 'Warehouse',
                  value: cart.warehouse || 'Not set',
                  icon: Box,
                },
                {
                  label: 'Capacity',
                  value: `${cart.active_count} / ${cart.max_capacity}`,
                  icon: ShoppingCart,
                },
                {
                  label: 'Created',
                  value: formatTimestamp(cart.created_at),
                  icon: Clock,
                },
              ].map((item) => (
                <div
                  key={item.label}
                  className='bg-muted/40 flex items-start gap-2.5 rounded-lg border p-3'
                >
                  <item.icon className='text-muted-foreground mt-0.5 h-3.5 w-3.5 shrink-0' />
                  <div className='min-w-0'>
                    <p className='text-muted-foreground text-[10px] tracking-wider uppercase'>
                      {item.label}
                    </p>
                    <p className='truncate text-sm font-semibold'>
                      {item.value}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {/* Capacity Bar */}
            <div className='space-y-1'>
              <div className='bg-secondary h-2 overflow-hidden rounded-full'>
                <div
                  className={cn(
                    'h-full rounded-full transition-all duration-500',
                    cart.active_count >= cart.max_capacity
                      ? 'bg-linear-to-r from-amber-500 to-amber-400'
                      : cart.active_count > 0
                        ? 'bg-linear-to-r from-blue-600 to-blue-400'
                        : 'bg-emerald-500'
                  )}
                  style={{
                    width: `${Math.min(100, (cart.active_count / cart.max_capacity) * 100)}%`,
                  }}
                />
              </div>
            </div>

            {cart.notes && (
              <div className='bg-muted/30 flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm'>
                <span className='text-muted-foreground text-[10px] tracking-wider uppercase'>
                  Notes:
                </span>
                <p className='text-xs'>{cart.notes}</p>
              </div>
            )}

            {/* Active T.O.s */}
            {onCartAssignments.length > 0 && (
              <div>
                <div className='mb-2 flex items-center gap-2'>
                  <h4 className='text-sm font-semibold'>Active T.O.s</h4>
                  <Badge variant='secondary' className='text-[10px]'>
                    {onCartAssignments.length}
                  </Badge>
                </div>
                <div className='max-h-48 overflow-y-auto rounded-lg border'>
                  <Table>
                    <TableHeader>
                      <TableRow className='bg-muted/30 hover:bg-muted/30'>
                        <TableHead className='text-xs'>T.O.</TableHead>
                        <TableHead className='text-xs'>Material</TableHead>
                        <TableHead className='text-xs'>Stowed By</TableHead>
                        <TableHead className='text-xs'>Stowed At</TableHead>
                        <TableHead className='w-10'></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {onCartAssignments.map((a) => (
                        <TableRow key={a.id}>
                          <TableCell className='font-mono text-xs font-medium'>
                            {a.to_number}
                          </TableCell>
                          <TableCell className='font-mono text-xs'>
                            {a.material_number}
                          </TableCell>
                          <TableCell className='text-xs'>
                            {a.stowed_by_user?.full_name || 'Unknown'}
                          </TableCell>
                          <TableCell className='text-muted-foreground text-xs'>
                            {formatTimestamp(a.stowed_at)}
                          </TableCell>
                          <TableCell>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant='ghost'
                                  size='icon'
                                  className='h-7 w-7 text-red-500 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950'
                                  onClick={() =>
                                    removeMutation.mutate({
                                      assignmentId: a.id,
                                    })
                                  }
                                  disabled={removeMutation.isPending}
                                >
                                  <X className='h-3 w-3' />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Remove from cart</TooltipContent>
                            </Tooltip>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            {/* History */}
            {historicalAssignments.length > 0 && (
              <div>
                <div className='mb-2 flex items-center gap-2'>
                  <h4 className='text-muted-foreground text-sm font-semibold'>
                    History
                  </h4>
                  <Badge variant='outline' className='text-[10px]'>
                    {historicalAssignments.length}
                  </Badge>
                </div>
                <div className='max-h-36 overflow-y-auto rounded-lg border'>
                  <Table>
                    <TableHeader>
                      <TableRow className='bg-muted/30 hover:bg-muted/30'>
                        <TableHead className='text-xs'>T.O.</TableHead>
                        <TableHead className='text-xs'>Material</TableHead>
                        <TableHead className='text-xs'>Status</TableHead>
                        <TableHead className='text-xs'>Cleared At</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {historicalAssignments.map((a) => (
                        <TableRow key={a.id}>
                          <TableCell className='font-mono text-xs'>
                            {a.to_number}
                          </TableCell>
                          <TableCell className='font-mono text-xs'>
                            {a.material_number}
                          </TableCell>
                          <TableCell>
                            <Badge variant='secondary' className='text-[10px]'>
                              {a.status}
                            </Badge>
                          </TableCell>
                          <TableCell className='text-muted-foreground text-xs'>
                            {formatTimestamp(a.cleared_at)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className='flex flex-wrap items-center gap-2 border-t pt-4'>
              <Button
                variant='outline'
                size='sm'
                onClick={() => setEditOpen(true)}
                className='gap-1.5'
              >
                <Pencil className='h-3 w-3' />
                Edit Cart
              </Button>
              {cart.is_active ? (
                <>
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={() => cartId && markFullMutation.mutate(cartId)}
                    disabled={
                      cart.status === 'Full' ||
                      markFullMutation.isPending ||
                      cart.active_count === 0
                    }
                  >
                    Mark Full
                  </Button>
                  <Button
                    variant='destructive'
                    size='sm'
                    onClick={() => {
                      if (cartId) deactivateMutation.mutate(cartId)
                    }}
                    disabled={
                      deactivateMutation.isPending || cart.active_count > 0
                    }
                    className='gap-1.5'
                  >
                    <Archive className='h-3 w-3' />
                    Deactivate
                  </Button>
                </>
              ) : (
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => {
                    if (cartId) reactivateMutation.mutate(cartId)
                  }}
                  disabled={reactivateMutation.isPending}
                  className='gap-1.5 border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-950'
                >
                  {reactivateMutation.isPending ? (
                    <Loader2 className='h-3 w-3 animate-spin' />
                  ) : (
                    <RotateCcw className='h-3 w-3' />
                  )}
                  Reactivate
                </Button>
              )}

              <div className='ml-auto'>
                {!confirmDelete ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant='ghost'
                        size='sm'
                        onClick={() => setConfirmDelete(true)}
                        disabled={cart.active_count > 0}
                        className='gap-1.5 text-red-500 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950'
                      >
                        <Trash2 className='h-3 w-3' />
                        Delete
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      Permanently delete this cart
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <div className='flex items-center gap-2'>
                    <span className='text-xs font-medium text-red-600'>
                      Delete permanently?
                    </span>
                    <Button
                      variant='destructive'
                      size='sm'
                      onClick={() => {
                        if (cartId) {
                          deleteMutation.mutate(cartId, {
                            onSuccess: (result) => {
                              if (result.success) {
                                onOpenChange(false)
                                setConfirmDelete(false)
                              }
                            },
                          })
                        }
                      }}
                      disabled={deleteMutation.isPending}
                    >
                      {deleteMutation.isPending ? (
                        <Loader2 className='mr-1 h-3 w-3 animate-spin' />
                      ) : null}
                      Confirm
                    </Button>
                    <Button
                      variant='ghost'
                      size='sm'
                      onClick={() => setConfirmDelete(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                )}
              </div>
            </div>

            <EditCartDialog
              cart={cart}
              open={editOpen}
              onOpenChange={setEditOpen}
            />
          </div>
        ) : (
          <p className='text-muted-foreground py-4 text-center'>
            Cart not found
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}

export default function InboundCartManagement() {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [showDeactivated, setShowDeactivated] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [detailCartId, setDetailCartId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  const { data: stats } = useCartSummaryStats()
  const { data: carts, isLoading } = useInboundCarts({
    status: statusFilter !== 'all' ? statusFilter : undefined,
    search: search || undefined,
    activeOnly: !showDeactivated,
  })

  const filteredCarts = useMemo(() => {
    if (!carts) return []
    return carts
  }, [carts])

  const handleCartClick = (cartId: string) => {
    setDetailCartId(cartId)
    setDetailOpen(true)
  }

  return (
    <div className='space-y-5'>
      {/* Stats Bar */}
      <div className='grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6'>
        <StatCard
          label='Total'
          value={stats?.total || 0}
          icon={ShoppingCart}
          color='text-foreground'
          accent='bg-card'
        />
        <StatCard
          label='Empty'
          value={stats?.empty || 0}
          icon={Box}
          color='text-emerald-600 dark:text-emerald-400'
          accent='bg-card'
        />
        <StatCard
          label='Loading'
          value={stats?.loading || 0}
          icon={TrendingUp}
          color='text-blue-600 dark:text-blue-400'
          accent='bg-card'
        />
        <StatCard
          label='Full'
          value={stats?.full || 0}
          icon={AlertTriangle}
          color='text-amber-600 dark:text-amber-400'
          accent='bg-card'
        />
        <StatCard
          label='In Putaway'
          value={stats?.inPutaway || 0}
          icon={PackageCheck}
          color='text-purple-600 dark:text-purple-400'
          accent='bg-card'
        />
        <StatCard
          label='Cleared'
          value={stats?.cleared || 0}
          icon={CheckCircle2}
          color='text-gray-500 dark:text-gray-400'
          accent='bg-card'
        />
      </div>

      {/* Toolbar */}
      <Card className='border-0 shadow-sm'>
        <CardContent className='flex flex-wrap items-center gap-3 p-3'>
          <div className='relative min-w-[200px] flex-1'>
            <Search className='text-muted-foreground absolute top-2.5 left-3 h-4 w-4' />
            <Input
              placeholder='Search by cart number or T.O...'
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className='pl-9'
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className='w-[140px]'>
              <SelectValue placeholder='All Statuses' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='all'>All Statuses</SelectItem>
              <SelectItem value='Empty'>Empty</SelectItem>
              <SelectItem value='Loading'>Loading</SelectItem>
              <SelectItem value='Full'>Full</SelectItem>
              <SelectItem value='InPutaway'>In Putaway</SelectItem>
              <SelectItem value='Cleared'>Cleared</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant={showDeactivated ? 'secondary' : 'outline'}
            size='sm'
            onClick={() => setShowDeactivated(!showDeactivated)}
            className='gap-1.5'
          >
            <Archive className='h-3.5 w-3.5' />
            {showDeactivated ? 'Hide' : 'Show'} Deactivated
          </Button>
          <Button onClick={() => setCreateOpen(true)} className='gap-1.5'>
            <Plus className='h-4 w-4' />
            Create Cart
          </Button>
        </CardContent>
      </Card>

      {/* Cart Grid */}
      {isLoading ? (
        <div className='flex items-center justify-center py-16'>
          <Loader2 className='text-muted-foreground h-6 w-6 animate-spin' />
        </div>
      ) : filteredCarts.length === 0 ? (
        <div className='flex flex-col items-center gap-4 py-16'>
          <div className='bg-muted flex h-16 w-16 items-center justify-center rounded-2xl'>
            <ShoppingCart className='text-muted-foreground/50 h-8 w-8' />
          </div>
          <div className='text-center'>
            <p className='font-medium'>
              {carts?.length === 0
                ? 'No carts created yet'
                : 'No carts match your filters'}
            </p>
            <p className='text-muted-foreground mt-1 text-sm'>
              {carts?.length === 0
                ? 'Create your first cart to start managing inbound T.O.s'
                : 'Try adjusting your search or filter criteria'}
            </p>
          </div>
          {carts?.length === 0 && (
            <Button
              onClick={() => setCreateOpen(true)}
              className='mt-2 gap-1.5'
            >
              <Plus className='h-4 w-4' />
              Create First Cart
            </Button>
          )}
        </div>
      ) : (
        <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
          {filteredCarts.map((cart) => {
            const cfg = statusConfig[cart.status] || statusConfig.Empty
            const StatusIcon = cfg.icon
            const pct = Math.min(
              100,
              (cart.active_count / cart.max_capacity) * 100
            )

            return (
              <Card
                key={cart.id}
                className={cn(
                  'group cursor-pointer overflow-hidden border-0 shadow-sm transition-all hover:shadow-md',
                  !cart.is_active && 'opacity-60'
                )}
                onClick={() => handleCartClick(cart.id)}
              >
                <CardContent className='p-0'>
                  {/* Card Header */}
                  <div className='flex items-start justify-between p-4 pb-3'>
                    <div className='flex items-center gap-2.5'>
                      <div
                        className={cn(
                          'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                          cart.active_count >= cart.max_capacity
                            ? 'bg-amber-100 dark:bg-amber-900/30'
                            : cart.active_count > 0
                              ? 'bg-blue-100 dark:bg-blue-900/30'
                              : 'bg-emerald-100 dark:bg-emerald-900/30'
                        )}
                      >
                        <ShoppingCart
                          className={cn(
                            'h-4 w-4',
                            cart.active_count >= cart.max_capacity
                              ? 'text-amber-600 dark:text-amber-400'
                              : cart.active_count > 0
                                ? 'text-blue-600 dark:text-blue-400'
                                : 'text-emerald-600 dark:text-emerald-400'
                          )}
                        />
                      </div>
                      <div>
                        <h3 className='text-sm leading-tight font-bold'>
                          {cart.cart_number}
                        </h3>
                        {!cart.is_active && (
                          <Badge
                            variant='outline'
                            className='mt-0.5 border-red-300 text-[9px] text-red-500'
                          >
                            Inactive
                          </Badge>
                        )}
                      </div>
                    </div>
                    <Badge className={cn('shrink-0 gap-1 text-[10px]', cfg.bg)}>
                      <StatusIcon className='h-2.5 w-2.5' />
                      {cfg.label}
                    </Badge>
                  </div>

                  {/* Capacity */}
                  <div className='px-4 pb-3'>
                    <div className='mb-1.5 flex items-center justify-between text-xs'>
                      <span className='text-muted-foreground'>Load</span>
                      <span className='font-semibold tabular-nums'>
                        {cart.active_count} / {cart.max_capacity}
                      </span>
                    </div>
                    <div className='bg-secondary h-2 overflow-hidden rounded-full'>
                      <div
                        className={cn(
                          'h-full rounded-full transition-all duration-500',
                          pct >= 100
                            ? 'bg-linear-to-r from-amber-500 to-amber-400'
                            : pct > 0
                              ? 'bg-linear-to-r from-blue-600 to-blue-400'
                              : 'bg-emerald-500'
                        )}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>

                  {/* Footer Meta */}
                  <div className='bg-muted/30 text-muted-foreground flex items-center gap-3 border-t px-4 py-2.5 text-[11px]'>
                    {cart.warehouse_zone && (
                      <span className='flex items-center gap-1'>
                        <Archive className='h-3 w-3' />
                        {cart.warehouse_zone}
                      </span>
                    )}
                    <span className='ml-auto flex items-center gap-1'>
                      <Clock className='h-3 w-3' />
                      {formatTimestamp(cart.updated_at)}
                    </span>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Dialogs */}
      <CreateCartDialog open={createOpen} onOpenChange={setCreateOpen} />
      <CartDetailDialog
        cartId={detailCartId}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
    </div>
  )
}

// Created and developed by Jai Singh
