import { useMemo, useState } from 'react'
import { format, toZonedTime } from 'date-fns-tz'
import {
  Loader2,
  Pencil,
  Plus,
  Search,
  ShoppingCart,
  Trash2,
  X,
} from 'lucide-react'
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

const formatTimestamp = (ts: string | null) => {
  if (!ts) return 'N/A'
  try {
    return format(
      toZonedTime(new Date(ts), 'America/New_York'),
      'MM/dd h:mm a',
      {
        timeZone: 'America/New_York',
      }
    )
  } catch {
    return 'Invalid'
  }
}

const statusColors: Record<string, string> = {
  Empty:
    'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
  Loading: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  Full: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  InPutaway:
    'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  Cleared: 'bg-gray-100 text-gray-800 dark:bg-gray-800/30 dark:text-gray-400',
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string
  value: number
  color: string
}) {
  return (
    <div className='bg-card rounded-lg border p-3 text-center'>
      <p className={cn('text-2xl font-bold', color)}>{value}</p>
      <p className='text-muted-foreground text-xs'>{label}</p>
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
          <DialogTitle>Create New Cart</DialogTitle>
        </DialogHeader>
        <div className='space-y-4 pt-2'>
          <div>
            <label className='mb-1 block text-sm font-medium'>
              Cart Number *
            </label>
            <Input
              value={cartNumber}
              onChange={(e) => setCartNumber(e.target.value)}
              placeholder='e.g., CART-001'
            />
          </div>
          <div className='grid grid-cols-2 gap-3'>
            <div>
              <label className='mb-1 block text-sm font-medium'>
                Max Capacity
              </label>
              <Input
                type='number'
                min='1'
                value={maxCapacity}
                onChange={(e) => setMaxCapacity(e.target.value)}
              />
            </div>
            <div>
              <label className='mb-1 block text-sm font-medium'>
                Warehouse
              </label>
              <Input
                value={warehouse}
                onChange={(e) => setWarehouse(e.target.value)}
                placeholder='e.g., IPDC'
              />
            </div>
          </div>
          <div>
            <label className='mb-1 block text-sm font-medium'>
              Warehouse Zone
            </label>
            <Input
              value={zone}
              onChange={(e) => setZone(e.target.value)}
              placeholder='e.g., Zone A, Dock 3'
            />
          </div>
          <div>
            <label className='mb-1 block text-sm font-medium'>Notes</label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder='Optional notes'
            />
          </div>
          <Button
            onClick={handleSubmit}
            disabled={createMutation.isPending}
            className='w-full'
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
          <DialogTitle>Edit Cart</DialogTitle>
        </DialogHeader>
        <div className='space-y-4 pt-2'>
          <div>
            <label className='mb-1 block text-sm font-medium'>
              Cart Number *
            </label>
            <Input
              value={cartNumber}
              onChange={(e) => setCartNumber(e.target.value)}
              placeholder='e.g., CART-001'
            />
          </div>
          <div className='grid grid-cols-2 gap-3'>
            <div>
              <label className='mb-1 block text-sm font-medium'>
                Max Capacity
              </label>
              <Input
                type='number'
                min='1'
                value={maxCapacity}
                onChange={(e) => setMaxCapacity(e.target.value)}
              />
            </div>
            <div>
              <label className='mb-1 block text-sm font-medium'>
                Warehouse
              </label>
              <Input
                value={warehouse}
                onChange={(e) => setWarehouse(e.target.value)}
                placeholder='e.g., IPDC'
              />
            </div>
          </div>
          <div>
            <label className='mb-1 block text-sm font-medium'>
              Warehouse Zone
            </label>
            <Input
              value={zone}
              onChange={(e) => setZone(e.target.value)}
              placeholder='e.g., Zone A, Dock 3'
            />
          </div>
          <div>
            <label className='mb-1 block text-sm font-medium'>Notes</label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder='Optional notes'
            />
          </div>
          <Button
            onClick={handleSubmit}
            disabled={updateMutation.isPending}
            className='w-full'
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-3xl'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <ShoppingCart className='h-5 w-5' />
            {cart?.cart_number || 'Cart Details'}
            {cart && (
              <Badge className={cn('ml-2', statusColors[cart.status])}>
                {cart.status}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className='flex items-center justify-center py-8'>
            <Loader2 className='text-muted-foreground h-6 w-6 animate-spin' />
          </div>
        ) : cart ? (
          <div className='space-y-4'>
            {/* Cart Info */}
            <div className='bg-muted/50 grid grid-cols-2 gap-3 rounded-lg p-3 text-sm sm:grid-cols-4'>
              <div>
                <p className='text-muted-foreground text-xs'>Zone</p>
                <p className='font-medium'>
                  {cart.warehouse_zone || 'Not set'}
                </p>
              </div>
              <div>
                <p className='text-muted-foreground text-xs'>Warehouse</p>
                <p className='font-medium'>{cart.warehouse || 'Not set'}</p>
              </div>
              <div>
                <p className='text-muted-foreground text-xs'>Capacity</p>
                <p className='font-medium'>
                  {cart.active_count} / {cart.max_capacity}
                </p>
              </div>
              <div>
                <p className='text-muted-foreground text-xs'>Created</p>
                <p className='font-medium'>
                  {formatTimestamp(cart.created_at)}
                </p>
              </div>
            </div>
            {cart.notes && (
              <div className='bg-muted/30 rounded-lg px-3 py-2 text-sm'>
                <p className='text-muted-foreground text-xs'>Notes</p>
                <p>{cart.notes}</p>
              </div>
            )}

            {/* Active T.O.s */}
            {onCartAssignments.length > 0 && (
              <div>
                <h4 className='mb-2 text-sm font-medium'>
                  Active T.O.s ({onCartAssignments.length})
                </h4>
                <div className='max-h-48 overflow-y-auto rounded-md border'>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>T.O.</TableHead>
                        <TableHead>Material</TableHead>
                        <TableHead>Stowed By</TableHead>
                        <TableHead>Stowed At</TableHead>
                        <TableHead className='w-10'></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {onCartAssignments.map((a) => (
                        <TableRow key={a.id}>
                          <TableCell className='font-medium'>
                            {a.to_number}
                          </TableCell>
                          <TableCell>{a.material_number}</TableCell>
                          <TableCell>
                            {a.stowed_by_user?.full_name || 'Unknown'}
                          </TableCell>
                          <TableCell>{formatTimestamp(a.stowed_at)}</TableCell>
                          <TableCell>
                            <Button
                              variant='ghost'
                              size='icon'
                              className='h-7 w-7'
                              onClick={() =>
                                removeMutation.mutate({
                                  assignmentId: a.id,
                                })
                              }
                              disabled={removeMutation.isPending}
                            >
                              <X className='h-3 w-3' />
                            </Button>
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
                <h4 className='mb-2 text-sm font-medium'>
                  History ({historicalAssignments.length})
                </h4>
                <div className='max-h-36 overflow-y-auto rounded-md border'>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>T.O.</TableHead>
                        <TableHead>Material</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Cleared At</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {historicalAssignments.map((a) => (
                        <TableRow key={a.id}>
                          <TableCell>{a.to_number}</TableCell>
                          <TableCell>{a.material_number}</TableCell>
                          <TableCell>
                            <Badge variant='secondary' className='text-xs'>
                              {a.status}
                            </Badge>
                          </TableCell>
                          <TableCell>{formatTimestamp(a.cleared_at)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className='flex flex-wrap gap-2 border-t pt-3'>
              <Button
                variant='outline'
                size='sm'
                onClick={() => setEditOpen(true)}
              >
                <Pencil className='mr-1 h-3 w-3' />
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
                  >
                    <Trash2 className='mr-1 h-3 w-3' />
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
                  className='border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-950'
                >
                  {reactivateMutation.isPending ? (
                    <Loader2 className='mr-1 h-3 w-3 animate-spin' />
                  ) : null}
                  Reactivate
                </Button>
              )}

              <div className='ml-auto'>
                {!confirmDelete ? (
                  <Button
                    variant='ghost'
                    size='sm'
                    onClick={() => setConfirmDelete(true)}
                    disabled={cart.active_count > 0}
                    className='text-red-500 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950'
                  >
                    <Trash2 className='mr-1 h-3 w-3' />
                    Delete Permanently
                  </Button>
                ) : (
                  <div className='flex items-center gap-2'>
                    <span className='text-xs text-red-600'>Are you sure?</span>
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
                      Yes, Delete
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
    <div className='space-y-6'>
      {/* Stats Bar */}
      <div className='grid grid-cols-3 gap-3 sm:grid-cols-6'>
        <StatCard
          label='Total'
          value={stats?.total || 0}
          color='text-foreground'
        />
        <StatCard
          label='Empty'
          value={stats?.empty || 0}
          color='text-emerald-600'
        />
        <StatCard
          label='Loading'
          value={stats?.loading || 0}
          color='text-blue-600'
        />
        <StatCard
          label='Full'
          value={stats?.full || 0}
          color='text-amber-600'
        />
        <StatCard
          label='In Putaway'
          value={stats?.inPutaway || 0}
          color='text-purple-600'
        />
        <StatCard
          label='Cleared'
          value={stats?.cleared || 0}
          color='text-gray-500'
        />
      </div>

      {/* Toolbar */}
      <div className='flex flex-wrap items-center gap-3'>
        <div className='relative flex-1'>
          <Search className='text-muted-foreground absolute top-2.5 left-3 h-4 w-4' />
          <Input
            placeholder='Search by cart number or T.O...'
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className='pl-9'
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className='w-36'>
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
        >
          {showDeactivated ? 'Hide' : 'Show'} Deactivated
        </Button>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className='mr-2 h-4 w-4' />
          Create Cart
        </Button>
      </div>

      {/* Cart Grid */}
      {isLoading ? (
        <div className='flex items-center justify-center py-12'>
          <Loader2 className='text-muted-foreground h-6 w-6 animate-spin' />
        </div>
      ) : filteredCarts.length === 0 ? (
        <div className='text-muted-foreground flex flex-col items-center gap-3 py-12'>
          <ShoppingCart className='h-10 w-10 opacity-40' />
          <p>
            {carts?.length === 0
              ? 'No carts created yet'
              : 'No carts match your filters'}
          </p>
          {carts?.length === 0 && (
            <Button variant='outline' onClick={() => setCreateOpen(true)}>
              <Plus className='mr-2 h-4 w-4' />
              Create First Cart
            </Button>
          )}
        </div>
      ) : (
        <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
          {filteredCarts.map((cart) => (
            <Card
              key={cart.id}
              className={cn(
                'cursor-pointer transition-shadow hover:shadow-md',
                !cart.is_active && 'opacity-60'
              )}
              onClick={() => handleCartClick(cart.id)}
            >
              <CardContent className='p-4'>
                <div className='mb-3 flex items-start justify-between'>
                  <div className='flex items-center gap-2'>
                    <h3 className='text-lg font-bold'>{cart.cart_number}</h3>
                    {!cart.is_active && (
                      <Badge
                        variant='outline'
                        className='border-red-300 text-xs text-red-500'
                      >
                        Inactive
                      </Badge>
                    )}
                  </div>
                  <Badge className={cn('text-xs', statusColors[cart.status])}>
                    {cart.status}
                  </Badge>
                </div>

                {/* Capacity bar */}
                <div className='mb-3'>
                  <div className='mb-1 flex justify-between text-xs'>
                    <span className='text-muted-foreground'>Load</span>
                    <span className='font-medium'>
                      {cart.active_count} / {cart.max_capacity}
                    </span>
                  </div>
                  <div className='bg-secondary h-2 overflow-hidden rounded-full'>
                    <div
                      className={cn(
                        'h-full rounded-full transition-all',
                        cart.active_count >= cart.max_capacity
                          ? 'bg-amber-500'
                          : cart.active_count > 0
                            ? 'bg-blue-500'
                            : 'bg-emerald-500'
                      )}
                      style={{
                        width: `${Math.min(100, (cart.active_count / cart.max_capacity) * 100)}%`,
                      }}
                    />
                  </div>
                </div>

                <div className='text-muted-foreground space-y-1 text-xs'>
                  {cart.warehouse_zone && <p>Zone: {cart.warehouse_zone}</p>}
                  {cart.warehouse && <p>Warehouse: {cart.warehouse}</p>}
                  <p>Updated: {formatTimestamp(cart.updated_at)}</p>
                </div>
              </CardContent>
            </Card>
          ))}
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
