import { useState, useEffect } from 'react'
import { Plus, Trash2, Loader2, Edit2, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import {
  deliveryStatusService,
  type DeliveryDisposition,
} from '@/lib/supabase/delivery-status.service'
import { logger } from '@/lib/utils/logger'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface DispositionEditorDialogProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  onDispositionsChange?: () => void
}

const PRESET_COLORS = [
  { name: 'Gray', value: 'gray' },
  { name: 'Red', value: 'red' },
  { name: 'Orange', value: 'orange' },
  { name: 'Yellow', value: 'yellow' },
  { name: 'Green', value: 'green' },
  { name: 'Blue', value: 'blue' },
  { name: 'Purple', value: 'purple' },
  { name: 'Pink', value: 'pink' },
]

export function DispositionEditorDialog({
  isOpen,
  onOpenChange,
  onDispositionsChange,
}: DispositionEditorDialogProps) {
  const { authState } = useUnifiedAuth()
  const organizationId = authState.profile?.organization_id

  const [dispositions, setDispositions] = useState<DeliveryDisposition[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [newDisposition, setNewDisposition] = useState({
    name: '',
    color: 'gray',
  })
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [editingColor, setEditingColor] = useState('gray')

  // Load dispositions when dialog opens
  useEffect(() => {
    if (isOpen && organizationId) {
      loadDispositions()
    }
  }, [isOpen, organizationId])

  const loadDispositions = async () => {
    if (!organizationId) return

    setIsLoading(true)
    try {
      const data = await deliveryStatusService.getDispositions(organizationId)
      setDispositions(data)
    } catch (error) {
      logger.error('Failed to load dispositions:', error)
      toast.error('Failed to load dispositions')
    } finally {
      setIsLoading(false)
    }
  }

  const handleCreate = async () => {
    if (!organizationId || !newDisposition.name.trim()) {
      toast.error('Please enter a disposition name')
      return
    }

    try {
      await deliveryStatusService.createDisposition({
        organization_id: organizationId,
        name: newDisposition.name.trim(),
        color: newDisposition.color,
      })

      setNewDisposition({ name: '', color: 'gray' })
      await loadDispositions()
      onDispositionsChange?.()
    } catch (error) {
      logger.error('Failed to create disposition:', error)
    }
  }

  const handleUpdate = async (id: string) => {
    if (!editingName.trim()) {
      toast.error('Please enter a disposition name')
      return
    }

    try {
      await deliveryStatusService.updateDisposition(id, {
        name: editingName.trim(),
        color: editingColor,
      })

      setEditingId(null)
      setEditingName('')
      setEditingColor('gray')
      await loadDispositions()
      onDispositionsChange?.()
    } catch (error) {
      logger.error('Failed to update disposition:', error)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this disposition?')) {
      return
    }

    try {
      await deliveryStatusService.deleteDisposition(id)
      await loadDispositions()
      onDispositionsChange?.()
    } catch (error) {
      logger.error('Failed to delete disposition:', error)
    }
  }

  const startEdit = (disposition: DeliveryDisposition) => {
    setEditingId(disposition.id)
    setEditingName(disposition.name)
    setEditingColor(disposition.color ?? 'gray')
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditingName('')
    setEditingColor('gray')
  }

  const getColorClass = (color: string) => {
    const colorMap: Record<string, string> = {
      gray: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300',
      red: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
      orange:
        'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300',
      yellow:
        'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
      green:
        'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
      blue: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
      purple:
        'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300',
      pink: 'bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-300',
    }
    return colorMap[color] || colorMap.gray
  }

  // Color Dropdown Component
  const ColorDropdown = ({
    value,
    onChange,
    id,
  }: {
    value: string
    onChange: (color: string) => void
    id?: string
  }) => {
    const selectedColor =
      PRESET_COLORS.find((c) => c.value === value) || PRESET_COLORS[0]

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant='outline' className='w-full justify-between' id={id}>
            <div className='flex items-center gap-2'>
              <Badge
                variant='outline'
                className={`${getColorClass(selectedColor.value)} border-0`}
              >
                {selectedColor.name}
              </Badge>
            </div>
            <ChevronDown className='h-4 w-4 opacity-50' />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className='w-56' align='start'>
          {PRESET_COLORS.map((color) => (
            <DropdownMenuItem
              key={color.value}
              onClick={() => onChange(color.value)}
              className='cursor-pointer'
            >
              <Badge
                variant='outline'
                className={`${getColorClass(color.value)} mr-2 border-0`}
              >
                {color.name}
              </Badge>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[80vh] max-w-2xl overflow-y-auto'>
        <DialogHeader>
          <DialogTitle>Manage Dispositions</DialogTitle>
          <DialogDescription>
            Add, edit, or remove secondary status dispositions for deliveries.
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-6'>
          {/* Add New Disposition */}
          <div className='border-border bg-muted/50 space-y-4 rounded-lg border p-4'>
            <h3 className='text-sm font-semibold'>Add New Disposition</h3>
            <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
              <div className='space-y-2'>
                <Label htmlFor='new-name'>Name</Label>
                <Input
                  id='new-name'
                  placeholder='Enter disposition name'
                  value={newDisposition.name}
                  onChange={(e) =>
                    setNewDisposition({
                      ...newDisposition,
                      name: e.target.value,
                    })
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleCreate()
                    }
                  }}
                />
              </div>
              <div className='space-y-2'>
                <Label htmlFor='new-color'>Color</Label>
                <ColorDropdown
                  id='new-color'
                  value={newDisposition.color}
                  onChange={(color) =>
                    setNewDisposition({ ...newDisposition, color })
                  }
                />
              </div>
            </div>
            <Button onClick={handleCreate} className='w-full'>
              <Plus className='mr-2 h-4 w-4' />
              Add Disposition
            </Button>
          </div>

          {/* Existing Dispositions */}
          <div className='space-y-4'>
            <h3 className='text-sm font-semibold'>Existing Dispositions</h3>
            {isLoading ? (
              <div className='flex items-center justify-center py-8'>
                <Loader2 className='h-6 w-6 animate-spin' />
                <span className='ml-2'>Loading dispositions...</span>
              </div>
            ) : dispositions.length === 0 ? (
              <p className='text-muted-foreground py-8 text-center text-sm'>
                No dispositions yet. Add your first one above.
              </p>
            ) : (
              <div className='space-y-2'>
                {dispositions.map((disposition) => (
                  <div
                    key={disposition.id}
                    className='border-border hover:bg-muted/50 flex items-center gap-2 rounded-lg border p-3 transition-colors'
                  >
                    {editingId === disposition.id ? (
                      <>
                        <Input
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          className='flex-1'
                          placeholder='Disposition name'
                        />
                        <ColorDropdown
                          value={editingColor}
                          onChange={(color) => setEditingColor(color)}
                        />
                        <Button
                          size='sm'
                          onClick={() => handleUpdate(disposition.id)}
                        >
                          Save
                        </Button>
                        <Button
                          size='sm'
                          variant='outline'
                          onClick={cancelEdit}
                        >
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <>
                        <div
                          className={`flex-1 rounded-md px-3 py-1 text-sm font-medium ${getColorClass(disposition.color ?? 'gray')}`}
                        >
                          {disposition.name}
                        </div>
                        <Button
                          size='sm'
                          variant='ghost'
                          onClick={() => startEdit(disposition)}
                        >
                          <Edit2 className='h-4 w-4' />
                        </Button>
                        <Button
                          size='sm'
                          variant='ghost'
                          onClick={() => handleDelete(disposition.id)}
                        >
                          <Trash2 className='text-destructive h-4 w-4' />
                        </Button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
