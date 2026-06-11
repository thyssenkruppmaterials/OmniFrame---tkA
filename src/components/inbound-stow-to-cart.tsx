// Created and developed by Jai Singh
import { useCallback, useEffect, useRef, useState } from 'react'
import { format, toZonedTime } from 'date-fns-tz'
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Loader2,
  Package,
  ScanLine,
  Search,
  ShoppingCart,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  useInboundCartDetails,
  useInboundCarts,
  useMarkCartFull,
  useStowToCart,
} from '@/hooks/use-inbound-carts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
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
    const date = new Date(ts)
    return format(toZonedTime(date, 'America/New_York'), 'MM/dd/yyyy h:mm a', {
      timeZone: 'America/New_York',
    })
  } catch {
    return 'Invalid'
  }
}

function parseTOBarcode(raw: string): {
  toNumber: string
  warehouse: string
  isValid: boolean
} {
  const trimmed = raw.trim()
  if (trimmed.includes('$')) {
    const parts = trimmed.split('$')
    if (parts.length >= 3) {
      return {
        toNumber: parts[0],
        warehouse: parts[parts.length - 1].slice(-3).toUpperCase(),
        isValid: true,
      }
    }
  }
  if (/^\d{5,}$/.test(trimmed)) {
    return { toNumber: trimmed, warehouse: '', isValid: true }
  }
  return { toNumber: trimmed, warehouse: '', isValid: false }
}

function CartCapacityRing({
  current,
  max,
  size = 36,
}: {
  current: number
  max: number
  size?: number
}) {
  const pct = Math.min(100, (current / max) * 100)
  const radius = (size - 6) / 2
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = circumference - (pct / 100) * circumference

  const color =
    current >= max
      ? 'text-amber-500'
      : current > max * 0.7
        ? 'text-yellow-500'
        : 'text-blue-500'

  return (
    <div className='relative' style={{ width: size, height: size }}>
      <svg width={size} height={size} className='-rotate-90'>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill='none'
          strokeWidth={3}
          className='stroke-muted'
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill='none'
          strokeWidth={3}
          strokeLinecap='round'
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          className={cn('transition-all duration-500', color)}
          style={{ stroke: 'currentColor' }}
        />
      </svg>
      <span className='absolute inset-0 flex items-center justify-center text-[9px] font-bold'>
        {current}
      </span>
    </div>
  )
}

export default function InboundStowToCart() {
  const [selectedCartId, setSelectedCartId] = useState<string | null>(null)
  const [cartSearch, setCartSearch] = useState('')
  const [toBarcode, setToBarcode] = useState('')
  const [materialNumber, setMaterialNumber] = useState('')
  const [lastStowed, setLastStowed] = useState<string | null>(null)
  const toInputRef = useRef<HTMLInputElement>(null)
  const materialInputRef = useRef<HTMLInputElement>(null)

  const { data: carts } = useInboundCarts({ activeOnly: true })
  const { data: cartDetails, refetch: refetchDetails } =
    useInboundCartDetails(selectedCartId)
  const stowMutation = useStowToCart()
  const markFullMutation = useMarkCartFull()

  const selectedCart = cartDetails?.cart || null
  const activeAssignments = (cartDetails?.assignments || []).filter(
    (a) => a.status === 'on_cart'
  )

  useEffect(() => {
    if (selectedCartId) refetchDetails()
  }, [selectedCartId, refetchDetails])

  const handleSelectCart = useCallback((cartId: string) => {
    setSelectedCartId(cartId)
    setToBarcode('')
    setMaterialNumber('')
    setLastStowed(null)
    setTimeout(() => materialInputRef.current?.focus(), 100)
  }, [])

  const handleStow = useCallback(async () => {
    if (!selectedCartId || !toBarcode.trim() || !materialNumber.trim()) return

    const parsed = parseTOBarcode(toBarcode.trim())

    stowMutation.mutate(
      {
        rawToNumber: toBarcode.trim(),
        toNumber: parsed.toNumber,
        materialNumber: materialNumber.trim(),
        warehouse: parsed.warehouse || undefined,
        cartId: selectedCartId,
      },
      {
        onSuccess: (result) => {
          if (!result.error) {
            setLastStowed(parsed.toNumber)
            setToBarcode('')
            setMaterialNumber('')
            materialInputRef.current?.focus()
            refetchDetails()
            setTimeout(() => setLastStowed(null), 3000)
          }
        },
      }
    )
  }, [selectedCartId, toBarcode, materialNumber, stowMutation, refetchDetails])

  const handleMaterialKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && materialNumber.trim()) {
      e.preventDefault()
      toInputRef.current?.focus()
    }
  }

  const handleTOKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && toBarcode.trim()) {
      e.preventDefault()
      handleStow()
    }
  }

  const filteredCarts = (carts || []).filter(
    (c) =>
      !cartSearch ||
      c.cart_number.toLowerCase().includes(cartSearch.toLowerCase())
  )

  const isFull = selectedCart?.status === 'Full'

  return (
    <div className='flex flex-col gap-5'>
      <div className='grid grid-cols-1 gap-5 lg:grid-cols-12'>
        {/* Cart Selector Panel */}
        <div className='lg:col-span-4 xl:col-span-3'>
          <Card className='overflow-hidden border-0 shadow-sm'>
            <div className='bg-muted/40 border-b px-4 py-3'>
              <div className='flex items-center gap-2'>
                <ShoppingCart className='text-muted-foreground h-4 w-4' />
                <h3 className='text-sm font-semibold'>Select Cart</h3>
                <Badge variant='secondary' className='ml-auto text-[10px]'>
                  {filteredCarts.length}
                </Badge>
              </div>
              <div className='relative mt-2.5'>
                <Search className='text-muted-foreground absolute top-2 left-2.5 h-3.5 w-3.5' />
                <Input
                  placeholder='Search carts...'
                  value={cartSearch}
                  onChange={(e) => setCartSearch(e.target.value)}
                  className='h-8 pl-8 text-xs'
                />
              </div>
            </div>
            <CardContent className='p-0'>
              <div className='max-h-[340px] overflow-y-auto'>
                {filteredCarts.length === 0 ? (
                  <div className='text-muted-foreground flex flex-col items-center gap-1.5 py-8 text-center'>
                    <ShoppingCart className='h-6 w-6 opacity-30' />
                    <p className='text-xs'>No active carts found</p>
                  </div>
                ) : (
                  filteredCarts.map((cart) => {
                    const isSelected = selectedCartId === cart.id
                    const pct = Math.round(
                      (cart.active_count / cart.max_capacity) * 100
                    )
                    return (
                      <button
                        key={cart.id}
                        onClick={() => handleSelectCart(cart.id)}
                        className={cn(
                          'group flex w-full items-center gap-3 border-b px-4 py-3 text-left transition-all last:border-b-0',
                          isSelected
                            ? 'bg-primary/5 border-l-primary border-l-2'
                            : 'hover:bg-muted/50 border-l-2 border-l-transparent'
                        )}
                      >
                        <CartCapacityRing
                          current={cart.active_count}
                          max={cart.max_capacity}
                        />
                        <div className='min-w-0 flex-1'>
                          <p
                            className={cn(
                              'truncate text-sm font-semibold',
                              isSelected && 'text-primary'
                            )}
                          >
                            {cart.cart_number}
                          </p>
                          <p className='text-muted-foreground text-[11px]'>
                            {cart.active_count}/{cart.max_capacity} loaded
                            {cart.warehouse_zone && ` · ${cart.warehouse_zone}`}
                          </p>
                        </div>
                        <div className='flex items-center gap-1.5'>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div
                                className={cn(
                                  'h-2 w-2 rounded-full',
                                  pct >= 100
                                    ? 'bg-amber-500'
                                    : pct > 0
                                      ? 'bg-blue-500'
                                      : 'bg-emerald-500'
                                )}
                              />
                            </TooltipTrigger>
                            <TooltipContent>
                              {pct >= 100
                                ? 'Full'
                                : pct > 0
                                  ? `${pct}% loaded`
                                  : 'Empty'}
                            </TooltipContent>
                          </Tooltip>
                          <ChevronRight
                            className={cn(
                              'h-3.5 w-3.5 transition-transform',
                              isSelected
                                ? 'text-primary translate-x-0'
                                : 'text-muted-foreground/40 -translate-x-1 opacity-0 group-hover:translate-x-0 group-hover:opacity-100'
                            )}
                          />
                        </div>
                      </button>
                    )
                  })
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Scanner & Cart Content */}
        <div className='flex flex-col gap-5 lg:col-span-8 xl:col-span-9'>
          {/* Scanner Card */}
          <Card className='overflow-hidden border-0 shadow-sm'>
            <div className='bg-muted/40 flex items-center justify-between border-b px-4 py-3'>
              <div className='flex items-center gap-2'>
                <ScanLine className='text-muted-foreground h-4 w-4' />
                <h3 className='text-sm font-semibold'>Scan T.O. to Cart</h3>
              </div>
              {selectedCart && (
                <div className='flex items-center gap-2'>
                  <Badge
                    variant='outline'
                    className='bg-background gap-1 text-xs font-semibold'
                  >
                    <ShoppingCart className='h-3 w-3' />
                    {selectedCart.cart_number}
                  </Badge>
                  <Badge
                    variant={isFull ? 'destructive' : 'secondary'}
                    className='text-[10px]'
                  >
                    {selectedCart.active_count}/{selectedCart.max_capacity}
                  </Badge>
                </div>
              )}
            </div>
            <CardContent className='p-4'>
              {!selectedCartId ? (
                <div className='flex flex-col items-center gap-3 py-10'>
                  <div className='bg-muted flex h-16 w-16 items-center justify-center rounded-2xl'>
                    <ShoppingCart className='text-muted-foreground/60 h-8 w-8' />
                  </div>
                  <div className='text-center'>
                    <p className='text-sm font-medium'>No cart selected</p>
                    <p className='text-muted-foreground mt-0.5 text-xs'>
                      Select a cart from the list to begin stowing T.O.s
                    </p>
                  </div>
                  <div className='text-muted-foreground/50 mt-1 flex items-center gap-1.5 text-[11px]'>
                    <ArrowRight className='h-3 w-3' />
                    Choose a cart, then scan items
                  </div>
                </div>
              ) : (
                <div className='space-y-4'>
                  {/* Capacity Progress */}
                  {selectedCart && (
                    <div className='space-y-1.5'>
                      <div className='flex items-center justify-between text-xs'>
                        <span className='text-muted-foreground'>
                          Cart capacity
                          {selectedCart.warehouse_zone &&
                            ` · ${selectedCart.warehouse_zone}`}
                        </span>
                        <span className='font-semibold'>
                          {selectedCart.active_count} /{' '}
                          {selectedCart.max_capacity}
                        </span>
                      </div>
                      <div className='bg-secondary h-2.5 overflow-hidden rounded-full'>
                        <div
                          className={cn(
                            'h-full rounded-full transition-all duration-500',
                            selectedCart.active_count >=
                              selectedCart.max_capacity
                              ? 'bg-linear-to-r from-amber-500 to-amber-400'
                              : selectedCart.active_count >
                                  selectedCart.max_capacity * 0.7
                                ? 'bg-linear-to-r from-yellow-500 to-yellow-400'
                                : 'bg-linear-to-r from-blue-600 to-blue-400'
                          )}
                          style={{
                            width: `${Math.min(100, (selectedCart.active_count / selectedCart.max_capacity) * 100)}%`,
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Success Flash */}
                  {lastStowed && (
                    <div className='animate-in fade-in slide-in-from-top-2 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 dark:border-emerald-800 dark:bg-emerald-950/30'>
                      <CheckCircle2 className='h-4 w-4 text-emerald-600 dark:text-emerald-400' />
                      <span className='text-xs font-medium text-emerald-700 dark:text-emerald-300'>
                        T.O. {lastStowed} stowed successfully
                      </span>
                    </div>
                  )}

                  {/* Full Warning */}
                  {isFull && (
                    <div className='flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-800 dark:bg-amber-950/30'>
                      <AlertCircle className='h-4 w-4 text-amber-600 dark:text-amber-400' />
                      <span className='text-xs font-medium text-amber-700 dark:text-amber-300'>
                        Cart is full — mark another cart or clear items
                      </span>
                    </div>
                  )}

                  {/* Scanner Inputs */}
                  <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
                    <div className='space-y-1'>
                      <label className='text-muted-foreground text-[11px] font-medium tracking-wider uppercase'>
                        Material Number
                      </label>
                      <Input
                        ref={materialInputRef}
                        placeholder='Scan material...'
                        value={materialNumber}
                        onChange={(e) => setMaterialNumber(e.target.value)}
                        onKeyDown={handleMaterialKeyDown}
                        disabled={isFull || stowMutation.isPending}
                        className='h-10 font-mono text-sm'
                      />
                    </div>
                    <div className='space-y-1'>
                      <label className='text-muted-foreground text-[11px] font-medium tracking-wider uppercase'>
                        T.O. Number
                      </label>
                      <Input
                        ref={toInputRef}
                        placeholder='Scan T.O. barcode...'
                        value={toBarcode}
                        onChange={(e) => setToBarcode(e.target.value)}
                        onKeyDown={handleTOKeyDown}
                        disabled={isFull || stowMutation.isPending}
                        className='h-10 font-mono text-sm'
                      />
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className='flex gap-2'>
                    <Button
                      onClick={handleStow}
                      disabled={
                        !materialNumber.trim() ||
                        !toBarcode.trim() ||
                        stowMutation.isPending
                      }
                      className='flex-1'
                      size='lg'
                    >
                      {stowMutation.isPending ? (
                        <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                      ) : (
                        <Package className='mr-2 h-4 w-4' />
                      )}
                      Stow to Cart
                    </Button>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant='outline'
                          size='lg'
                          onClick={() => {
                            if (selectedCartId)
                              markFullMutation.mutate(selectedCartId)
                          }}
                          disabled={
                            isFull ||
                            markFullMutation.isPending ||
                            (selectedCart?.active_count || 0) === 0
                          }
                        >
                          {markFullMutation.isPending ? (
                            <Loader2 className='h-4 w-4 animate-spin' />
                          ) : (
                            'Mark Full'
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        Mark this cart as full so no more T.O.s can be added
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Cart Contents Table */}
          {selectedCartId && activeAssignments.length > 0 && (
            <Card className='overflow-hidden border-0 shadow-sm'>
              <div className='bg-muted/40 flex items-center justify-between border-b px-4 py-3'>
                <h3 className='text-sm font-semibold'>T.O.s on Cart</h3>
                <Badge variant='secondary' className='text-[10px]'>
                  {activeAssignments.length} item
                  {activeAssignments.length !== 1 && 's'}
                </Badge>
              </div>
              <CardContent className='p-0'>
                <div className='max-h-[280px] overflow-y-auto'>
                  <Table>
                    <TableHeader>
                      <TableRow className='bg-muted/30 hover:bg-muted/30'>
                        <TableHead className='text-xs'>T.O. Number</TableHead>
                        <TableHead className='text-xs'>Material</TableHead>
                        <TableHead className='text-xs'>Location</TableHead>
                        <TableHead className='text-xs'>Stowed By</TableHead>
                        <TableHead className='text-xs'>Stowed At</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {activeAssignments.map((a, idx) => (
                        <TableRow
                          key={a.id}
                          className={cn(
                            idx === 0 && lastStowed === a.to_number
                              ? 'animate-in fade-in bg-emerald-50/50 dark:bg-emerald-950/20'
                              : ''
                          )}
                        >
                          <TableCell className='font-mono text-xs font-medium'>
                            {a.to_number}
                          </TableCell>
                          <TableCell className='font-mono text-xs'>
                            {a.material_number}
                          </TableCell>
                          <TableCell className='text-muted-foreground text-xs'>
                            {a.to_location || '—'}
                          </TableCell>
                          <TableCell className='text-xs'>
                            {a.stowed_by_user?.full_name || 'Unknown'}
                          </TableCell>
                          <TableCell className='text-muted-foreground text-xs'>
                            {formatTimestamp(a.stowed_at)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

// Created and developed by Jai Singh
