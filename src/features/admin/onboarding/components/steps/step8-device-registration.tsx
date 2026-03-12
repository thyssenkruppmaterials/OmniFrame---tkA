/**
 * Step 8: Device Registration
 * Assign equipment and devices to the employee
 */
import { useState } from 'react'
import {
  Smartphone,
  Plus,
  Edit2,
  Trash2,
  Scan,
  Monitor,
  Truck,
} from 'lucide-react'
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
  DialogTrigger,
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
import { Textarea } from '@/components/ui/textarea'
import { useOnboarding } from '../../context/onboarding-context'
import type { DeviceData } from '../../types/onboarding.types'

const DEVICE_TYPES = [
  { value: 'rf_terminal', label: 'RF Terminal', icon: Scan },
  { value: 'barcode_scanner', label: 'Barcode Scanner', icon: Scan },
  { value: 'tablet', label: 'Tablet', icon: Monitor },
  { value: 'mobile', label: 'Mobile Phone', icon: Smartphone },
  { value: 'forklift', label: 'Forklift', icon: Truck },
  { value: 'pallet_jack', label: 'Pallet Jack', icon: Truck },
  { value: 'reach_truck', label: 'Reach Truck', icon: Truck },
  { value: 'order_picker', label: 'Order Picker', icon: Truck },
]

const CONDITIONS = [
  { value: 'new', label: 'New' },
  { value: 'good', label: 'Good' },
  { value: 'fair', label: 'Fair' },
  { value: 'poor', label: 'Poor' },
]

const getEmptyDevice = (): DeviceData => ({
  device_type: '',
  device_name: '',
  device_id: '',
  serial_number: '',
  asset_tag: '',
  manufacturer: '',
  model: '',
  condition: 'good',
  notes: '',
})

export function Step8DeviceRegistration() {
  const { state, addDevice, updateDevice, removeDevice } = useOnboarding()
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [formData, setFormData] = useState<DeviceData>(getEmptyDevice())

  const devices = state.devices || []

  const handleOpenDialog = (index?: number) => {
    if (index !== undefined && devices[index]) {
      setEditingIndex(index)
      setFormData(devices[index])
    } else {
      setEditingIndex(null)
      setFormData(getEmptyDevice())
    }
    setIsDialogOpen(true)
  }

  const handleSave = () => {
    if (!formData.device_type) return

    if (editingIndex !== null) {
      updateDevice(editingIndex, formData)
    } else {
      addDevice(formData)
    }
    setIsDialogOpen(false)
    setFormData(getEmptyDevice())
    setEditingIndex(null)
  }

  const handleDelete = (index: number) => {
    removeDevice(index)
  }

  const getDeviceIcon = (type: string) => {
    const deviceType = DEVICE_TYPES.find((t) => t.value === type)
    const IconComponent = deviceType?.icon || Smartphone
    return <IconComponent className='h-5 w-5' />
  }

  const getConditionColor = (condition: string) => {
    switch (condition) {
      case 'new':
        return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
      case 'good':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
      case 'fair':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
      case 'poor':
        return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
      default:
        return ''
    }
  }

  return (
    <div className='space-y-6'>
      <Card>
        <CardHeader>
          <div className='flex items-center justify-between'>
            <div>
              <CardTitle className='flex items-center gap-2'>
                <Smartphone className='h-5 w-5' />
                Device Registration
              </CardTitle>
              <CardDescription>
                Assign equipment and devices to the employee
              </CardDescription>
            </div>
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button onClick={() => handleOpenDialog()}>
                  <Plus className='mr-2 h-4 w-4' />
                  Add Device
                </Button>
              </DialogTrigger>
              <DialogContent className='max-w-md'>
                <DialogHeader>
                  <DialogTitle>
                    {editingIndex !== null ? 'Edit Device' : 'Add Device'}
                  </DialogTitle>
                  <DialogDescription>
                    Enter the device details below
                  </DialogDescription>
                </DialogHeader>

                <div className='space-y-4 py-4'>
                  <div className='space-y-2'>
                    <Label>Device Type *</Label>
                    <Select
                      value={formData.device_type}
                      onValueChange={(value) =>
                        setFormData({ ...formData, device_type: value })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder='Select device type...' />
                      </SelectTrigger>
                      <SelectContent>
                        {DEVICE_TYPES.map((type) => (
                          <SelectItem key={type.value} value={type.value}>
                            <div className='flex items-center gap-2'>
                              <type.icon className='h-4 w-4' />
                              {type.label}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className='space-y-2'>
                    <Label>Device Name</Label>
                    <Input
                      placeholder='e.g., Warehouse Scanner #5'
                      value={formData.device_name || ''}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          device_name: e.target.value,
                        })
                      }
                    />
                  </div>

                  <div className='grid grid-cols-2 gap-4'>
                    <div className='space-y-2'>
                      <Label>Device ID</Label>
                      <Input
                        placeholder='DEV-001'
                        value={formData.device_id || ''}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            device_id: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className='space-y-2'>
                      <Label>Asset Tag</Label>
                      <Input
                        placeholder='ASSET-001'
                        value={formData.asset_tag || ''}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            asset_tag: e.target.value,
                          })
                        }
                      />
                    </div>
                  </div>

                  <div className='space-y-2'>
                    <Label>Serial Number</Label>
                    <Input
                      placeholder='SN-XXXXX-XXXXX'
                      value={formData.serial_number || ''}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          serial_number: e.target.value,
                        })
                      }
                    />
                  </div>

                  <div className='grid grid-cols-2 gap-4'>
                    <div className='space-y-2'>
                      <Label>Manufacturer</Label>
                      <Input
                        placeholder='e.g., Zebra'
                        value={formData.manufacturer || ''}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            manufacturer: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className='space-y-2'>
                      <Label>Model</Label>
                      <Input
                        placeholder='e.g., TC52'
                        value={formData.model || ''}
                        onChange={(e) =>
                          setFormData({ ...formData, model: e.target.value })
                        }
                      />
                    </div>
                  </div>

                  <div className='space-y-2'>
                    <Label>Condition</Label>
                    <Select
                      value={formData.condition}
                      onValueChange={(value) =>
                        setFormData({
                          ...formData,
                          condition: value as 'new' | 'good' | 'fair' | 'poor',
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CONDITIONS.map((cond) => (
                          <SelectItem key={cond.value} value={cond.value}>
                            {cond.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className='space-y-2'>
                    <Label>Notes</Label>
                    <Textarea
                      placeholder='Additional notes...'
                      value={formData.notes || ''}
                      onChange={(e) =>
                        setFormData({ ...formData, notes: e.target.value })
                      }
                      rows={2}
                    />
                  </div>
                </div>

                <DialogFooter>
                  <Button
                    variant='outline'
                    onClick={() => setIsDialogOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button onClick={handleSave} disabled={!formData.device_type}>
                    {editingIndex !== null ? 'Update' : 'Add'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {devices.length === 0 ? (
            <div className='text-muted-foreground py-8 text-center'>
              <Smartphone className='mx-auto mb-4 h-12 w-12 opacity-50' />
              <p>No devices assigned yet</p>
              <p className='text-sm'>Click "Add Device" to assign equipment</p>
            </div>
          ) : (
            <div className='space-y-3'>
              {devices.map((device, index) => (
                <div
                  key={device.id || index}
                  className='flex items-center justify-between rounded-lg border p-4'
                >
                  <div className='flex items-start gap-4'>
                    <div className='bg-primary/10 text-primary flex h-10 w-10 items-center justify-center rounded-full'>
                      {getDeviceIcon(device.device_type)}
                    </div>
                    <div>
                      <div className='flex items-center gap-2'>
                        <h4 className='font-medium'>
                          {device.device_name ||
                            DEVICE_TYPES.find(
                              (t) => t.value === device.device_type
                            )?.label}
                        </h4>
                        <Badge variant='outline'>
                          {
                            DEVICE_TYPES.find(
                              (t) => t.value === device.device_type
                            )?.label
                          }
                        </Badge>
                        <Badge
                          variant='outline'
                          className={getConditionColor(device.condition)}
                        >
                          {
                            CONDITIONS.find((c) => c.value === device.condition)
                              ?.label
                          }
                        </Badge>
                      </div>
                      <div className='text-muted-foreground mt-1 flex items-center gap-4 text-sm'>
                        {device.serial_number && (
                          <span>SN: {device.serial_number}</span>
                        )}
                        {device.asset_tag && (
                          <span>Asset: {device.asset_tag}</span>
                        )}
                        {device.manufacturer && device.model && (
                          <span>
                            {device.manufacturer} {device.model}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className='flex items-center gap-2'>
                    <Button
                      variant='ghost'
                      size='icon'
                      onClick={() => handleOpenDialog(index)}
                    >
                      <Edit2 className='h-4 w-4' />
                    </Button>
                    <Button
                      variant='ghost'
                      size='icon'
                      onClick={() => handleDelete(index)}
                    >
                      <Trash2 className='text-destructive h-4 w-4' />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Alert>
        <Scan className='h-4 w-4' />
        <AlertDescription>
          Device assignments will be tracked in the employee profile. You can
          update device status (returned, lost, damaged) and reassign devices
          later.
        </AlertDescription>
      </Alert>
    </div>
  )
}

export default Step8DeviceRegistration
