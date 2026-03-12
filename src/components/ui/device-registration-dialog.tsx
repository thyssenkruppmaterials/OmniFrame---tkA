/**
 * Device Registration Dialog
 * Prompts users to name their RF Terminal device on first login
 * Provides a friendly way to identify physical devices in session management
 */
import { useState, useEffect } from 'react'
import { Smartphone, Info } from 'lucide-react'
import { toast } from 'sonner'
import {
  getDeviceRegistration,
  registerDevice,
  parseDeviceInfo,
  generateSuggestedDeviceName,
} from '@/lib/utils/device-fingerprint'
import { logger } from '@/lib/utils/logger'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
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

interface DeviceRegistrationDialogProps {
  open: boolean
  onComplete: (deviceName: string) => void
  userName?: string
  userId?: string
}

export function DeviceRegistrationDialog({
  open,
  onComplete,
  userName,
  userId,
}: DeviceRegistrationDialogProps) {
  const [deviceName, setDeviceName] = useState('')
  const [isRegistering, setIsRegistering] = useState(false)
  const [deviceInfo, setDeviceInfo] = useState<Awaited<
    ReturnType<typeof parseDeviceInfo>
  > | null>(null)

  useEffect(() => {
    // Load device info and generate suggested name when dialog opens
    if (open) {
      const loadDeviceInfo = async () => {
        const info = await parseDeviceInfo()
        setDeviceInfo(info)
        const suggested = await generateSuggestedDeviceName(userName)
        setDeviceName(suggested)
      }
      loadDeviceInfo()
    }
  }, [open, userName])

  const handleRegister = async () => {
    if (!deviceName.trim()) {
      toast.error('Please enter a device name')
      return
    }

    setIsRegistering(true)
    try {
      // Register device in localStorage
      await registerDevice(deviceName.trim(), userId)

      // Sync to database if user is logged in
      let syncedToDatabase = false
      if (userId) {
        try {
          const { DeviceRegistrationService } =
            await import('@/lib/supabase/device-registration.service')
          const { supabase } = await import('@/lib/supabase/client')

          logger.log(
            '🔄 Attempting to sync device to database for user:',
            userId
          )

          // Get user's organization ID
          const { data: profile, error: profileError } = await supabase
            .from('user_profiles')
            .select('organization_id')
            .eq('id', userId)
            .maybeSingle()

          if (profileError) {
            logger.error(
              '❌ Error fetching user profile for device sync:',
              profileError
            )
            throw profileError
          }

          if (!profile) {
            logger.warn('⚠️ No profile found for user:', userId)
            throw new Error('User profile not found')
          }

          if (!profile.organization_id) {
            logger.warn('⚠️ No organization_id found for user:', userId)
            throw new Error('Organization ID not found')
          }

          logger.log(
            '📤 Syncing device to database - Org ID:',
            profile.organization_id
          )
          await DeviceRegistrationService.syncDeviceToDatabase(
            userId,
            profile.organization_id
          )
          logger.log('✅ Device successfully synced to database!')
          syncedToDatabase = true
        } catch (syncError) {
          logger.error('❌ Failed to sync device to database:', syncError)
          // Don't fail the registration - device is still saved locally
          toast.warning(
            'Device registered locally, but sync to database failed. Please refresh the RF Interface.'
          )
        }
      } else {
        logger.warn('⚠️ No userId provided - device will not sync to database')
      }

      if (syncedToDatabase) {
        toast.success(
          `Device registered as "${deviceName}" and synced to database!`
        )
      } else {
        toast.success(
          `Device registered as "${deviceName}" (local only - please refresh RF Interface to sync)`
        )
      }
      onComplete(deviceName.trim())
    } catch (error) {
      logger.error('Error registering device:', error)
      toast.error('Failed to register device')
    } finally {
      setIsRegistering(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        className='sm:max-w-[500px]'
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <Smartphone className='h-5 w-5' />
            Name Your RF Terminal
          </DialogTitle>
          <DialogDescription>
            Help us identify this device in session management and activity
            logs.
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-4 py-4'>
          {/* Device Information */}
          <Alert>
            <Info className='h-4 w-4' />
            <AlertDescription className='text-sm'>
              <div className='space-y-1'>
                <div>
                  <strong>Device Type:</strong>{' '}
                  {deviceInfo?.deviceType || 'Loading...'}
                </div>
                {deviceInfo?.model && (
                  <div>
                    <strong>Model:</strong> {deviceInfo.model}
                  </div>
                )}
                {deviceInfo?.manufacturer && (
                  <div>
                    <strong>Manufacturer:</strong> {deviceInfo.manufacturer}
                  </div>
                )}
                <div>
                  <strong>Operating System:</strong>{' '}
                  {deviceInfo?.osName || 'Loading...'}{' '}
                  {deviceInfo?.osVersion || ''}
                </div>
                <div>
                  <strong>Browser:</strong>{' '}
                  {deviceInfo?.browser || 'Loading...'}
                </div>
                {/* Device ID (UUID) - Alternative to IMEI which is not available on iOS */}
                {deviceInfo?.deviceId && (
                  <div className='border-border/30 border-t pt-1'>
                    <strong>Device ID:</strong>{' '}
                    <span className='font-mono text-xs'>
                      {deviceInfo.deviceId.length > 24
                        ? `${deviceInfo.deviceId.substring(0, 12)}...${deviceInfo.deviceId.substring(deviceInfo.deviceId.length - 8)}`
                        : deviceInfo.deviceId}
                    </span>
                  </div>
                )}
              </div>
            </AlertDescription>
          </Alert>

          {/* Device Name Input */}
          <div className='space-y-2'>
            <Label htmlFor='device-name'>Device Name *</Label>
            <Input
              id='device-name'
              placeholder="e.g., Warehouse Scanner 1, Jai's iPhone, Dock 3 Terminal"
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              maxLength={50}
              autoFocus
            />
            <p className='text-muted-foreground text-xs'>
              Choose a name that helps you identify this specific device. This
              will be shown in your profile and session logs.
            </p>
          </div>

          {/* Example Names */}
          <div className='space-y-1'>
            <p className='text-xs font-medium'>Suggested Examples:</p>
            <div className='flex flex-wrap gap-2'>
              <Button
                type='button'
                variant='outline'
                size='sm'
                className='h-7 text-xs'
                onClick={() => setDeviceName('Warehouse Scanner 1')}
              >
                Warehouse Scanner 1
              </Button>
              <Button
                type='button'
                variant='outline'
                size='sm'
                className='h-7 text-xs'
                onClick={() => setDeviceName(`${userName || 'My'}'s iPhone`)}
              >
                {userName || 'My'}'s iPhone
              </Button>
              <Button
                type='button'
                variant='outline'
                size='sm'
                className='h-7 text-xs'
                onClick={() => setDeviceName('Receiving Dock Terminal')}
              >
                Receiving Dock Terminal
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={handleRegister}
            disabled={!deviceName.trim() || isRegistering}
            className='w-full'
          >
            {isRegistering ? 'Registering...' : 'Register Device'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Hook to check if device needs registration
 */
export function useDeviceRegistration() {
  const [needsRegistration, setNeedsRegistration] = useState(false)
  const [registeredDevice, setRegisteredDevice] = useState<any>(null)

  useEffect(() => {
    const checkRegistration = async () => {
      const device = await getDeviceRegistration()

      if (device) {
        setRegisteredDevice(device)
        setNeedsRegistration(false)
      } else {
        setNeedsRegistration(true)
      }
    }

    checkRegistration()
  }, [])

  return { needsRegistration, registeredDevice, setNeedsRegistration }
}
