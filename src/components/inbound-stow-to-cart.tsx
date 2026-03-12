import { useCallback, useEffect, useRef, useState } from 'react'
import { format, toZonedTime } from 'date-fns-tz'
import { Loader2, Package, ScanLine, ShoppingCart } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  useInboundCartDetails,
  useInboundCarts,
  useMarkCartFull,
  useStowToCart,
} from '@/hooks/use-inbound-carts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
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

export default function InboundStowToCart() {
  const [selectedCartId, setSelectedCartId] = useState<string | null>(null)
  const [cartSearch, setCartSearch] = useState('')
  const [toBarcode, setToBarcode] = useState('')
  const [materialNumber, setMaterialNumber] = useState('')
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
            setToBarcode('')
            setMaterialNumber('')
            materialInputRef.current?.focus()
            refetchDetails()
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

  return (
    <div className='space-y-6'>
      <div className='grid grid-cols-1 gap-6 lg:grid-cols-3'>
        {/* Cart Selection */}
        <Card>
          <CardHeader className='pb-3'>
            <CardTitle className='flex items-center gap-2 text-base'>
              <ShoppingCart className='h-4 w-4' />
              Select Cart
            </CardTitle>
          </CardHeader>
          <CardContent className='space-y-3'>
            <Input
              placeholder='Search carts...'
              value={cartSearch}
              onChange={(e) => setCartSearch(e.target.value)}
            />
            <div className='max-h-48 space-y-1 overflow-y-auto'>
              {filteredCarts.map((cart) => (
                <button
                  key={cart.id}
                  onClick={() => handleSelectCart(cart.id)}
                  className={cn(
                    'flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors',
                    selectedCartId === cart.id
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-muted'
                  )}
                >
                  <span className='font-medium'>{cart.cart_number}</span>
                  <span className='text-xs opacity-75'>
                    {cart.active_count}/{cart.max_capacity}
                  </span>
                </button>
              ))}
              {filteredCarts.length === 0 && (
                <p className='text-muted-foreground py-4 text-center text-sm'>
                  No carts found
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Scanner Inputs */}
        <Card className='lg:col-span-2'>
          <CardHeader className='pb-3'>
            <CardTitle className='flex items-center gap-2 text-base'>
              <ScanLine className='h-4 w-4' />
              Scan T.O. to Cart
              {selectedCart && (
                <Badge variant='outline' className='ml-2'>
                  {selectedCart.cart_number}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!selectedCartId ? (
              <div className='text-muted-foreground flex flex-col items-center gap-2 py-8 text-center'>
                <ShoppingCart className='h-8 w-8 opacity-50' />
                <p>Select a cart to begin stowing T.O.s</p>
              </div>
            ) : (
              <div className='space-y-4'>
                {/* Cart Status */}
                {selectedCart && (
                  <div className='bg-muted/50 flex items-center justify-between rounded-lg p-3'>
                    <div className='space-y-1'>
                      <p className='text-sm font-medium'>
                        {selectedCart.cart_number}
                        {selectedCart.warehouse_zone && (
                          <span className='text-muted-foreground ml-2'>
                            {selectedCart.warehouse_zone}
                          </span>
                        )}
                      </p>
                      <p className='text-muted-foreground text-xs'>
                        {selectedCart.active_count} /{' '}
                        {selectedCart.max_capacity} T.O.s loaded
                      </p>
                    </div>
                    <div className='flex items-center gap-2'>
                      <div className='bg-secondary h-2 w-24 overflow-hidden rounded-full'>
                        <div
                          className={cn(
                            'h-full rounded-full transition-all',
                            selectedCart.active_count >=
                              selectedCart.max_capacity
                              ? 'bg-amber-500'
                              : 'bg-blue-500'
                          )}
                          style={{
                            width: `${Math.min(100, (selectedCart.active_count / selectedCart.max_capacity) * 100)}%`,
                          }}
                        />
                      </div>
                      <Badge
                        variant={
                          selectedCart.status === 'Full'
                            ? 'destructive'
                            : 'secondary'
                        }
                      >
                        {selectedCart.status}
                      </Badge>
                    </div>
                  </div>
                )}

                {/* Input Fields */}
                <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
                  <div>
                    <label className='mb-1 block text-xs font-medium'>
                      Material Number
                    </label>
                    <Input
                      ref={materialInputRef}
                      placeholder='Scan material...'
                      value={materialNumber}
                      onChange={(e) => setMaterialNumber(e.target.value)}
                      onKeyDown={handleMaterialKeyDown}
                      disabled={
                        selectedCart?.status === 'Full' ||
                        stowMutation.isPending
                      }
                    />
                  </div>
                  <div>
                    <label className='mb-1 block text-xs font-medium'>
                      T.O. Number
                    </label>
                    <Input
                      ref={toInputRef}
                      placeholder='Scan T.O. barcode...'
                      value={toBarcode}
                      onChange={(e) => setToBarcode(e.target.value)}
                      onKeyDown={handleTOKeyDown}
                      disabled={
                        selectedCart?.status === 'Full' ||
                        stowMutation.isPending
                      }
                    />
                  </div>
                </div>

                <div className='flex gap-2'>
                  <Button
                    onClick={handleStow}
                    disabled={
                      !materialNumber.trim() ||
                      !toBarcode.trim() ||
                      stowMutation.isPending
                    }
                    className='flex-1'
                  >
                    {stowMutation.isPending ? (
                      <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                    ) : (
                      <Package className='mr-2 h-4 w-4' />
                    )}
                    Stow to Cart
                  </Button>
                  <Button
                    variant='outline'
                    onClick={() => {
                      if (selectedCartId)
                        markFullMutation.mutate(selectedCartId)
                    }}
                    disabled={
                      selectedCart?.status === 'Full' ||
                      markFullMutation.isPending ||
                      (selectedCart?.active_count || 0) === 0
                    }
                  >
                    Mark Full
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Current Cart Load */}
      {selectedCartId && activeAssignments.length > 0 && (
        <Card>
          <CardHeader className='pb-3'>
            <CardTitle className='text-base'>
              T.O.s on Cart ({activeAssignments.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>T.O. Number</TableHead>
                  <TableHead>Material</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Stowed By</TableHead>
                  <TableHead>Stowed At</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeAssignments.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className='font-medium'>{a.to_number}</TableCell>
                    <TableCell>{a.material_number}</TableCell>
                    <TableCell>{a.to_location || 'N/A'}</TableCell>
                    <TableCell>
                      {a.stowed_by_user?.full_name || 'Unknown'}
                    </TableCell>
                    <TableCell>{formatTimestamp(a.stowed_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
