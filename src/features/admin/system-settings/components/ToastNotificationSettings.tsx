import { useEffect, useState } from 'react'
import {
  IconBell,
  IconCheck,
  IconClock,
  IconLoader2,
  IconPalette,
  IconSettings,
  IconVolume,
  IconX,
} from '@tabler/icons-react'
import { toast } from 'sonner'
import {
  DEFAULT_TOAST_SETTINGS,
  SettingsService,
  type ToastNotificationSettings,
} from '@/lib/services/settings-service'
import { logger } from '@/lib/utils/logger'
import { useToastSettings } from '@/context/toast-settings-context'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'

export function ToastNotificationSettings() {
  const { settings: contextSettings, refreshSettings } = useToastSettings()
  const [settings, setSettings] = useState<ToastNotificationSettings>(
    DEFAULT_TOAST_SETTINGS
  )
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const handleSettingChange = (
    key: string,
    value: string | number | boolean
  ) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
  }

  const handlePriorityChange = (
    priority: keyof typeof settings.priorities,
    key: string,
    value: string | number | boolean
  ) => {
    setSettings((prev) => ({
      ...prev,
      priorities: {
        ...prev.priorities,
        [priority]: { ...prev.priorities[priority], [key]: value },
      },
    }))
  }

  // Load settings on component mount and sync with context
  useEffect(() => {
    const loadSettings = async () => {
      try {
        setLoading(true)
        const loadedSettings = await SettingsService.getToastSettings()
        setSettings(loadedSettings)
      } catch (error) {
        logger.error('Failed to load toast settings:', error)
        toast.error('Failed to load toast notification settings')
      } finally {
        setLoading(false)
      }
    }

    loadSettings()
  }, [])

  // Sync with context settings when they change
  useEffect(() => {
    if (contextSettings && !loading) {
      setSettings(contextSettings)
    }
  }, [contextSettings, loading])

  const testNotification = (type: string) => {
    const messages: Record<string, string> = {
      info: 'This is an informational notification',
      success: 'Operation completed successfully!',
      warning: 'Please review this warning message',
      error: 'An error occurred during processing',
    }

    // Get the duration for this specific notification type
    const priorityConfig =
      settings.priorities[type as keyof typeof settings.priorities]
    const duration = priorityConfig?.duration || settings.defaultDuration

    // If max concurrent is set to 1, dismiss all existing toasts before showing new one
    if (settings.maxConcurrent === 1) {
      toast.dismiss()
    }

    switch (type) {
      case 'success':
        toast.success(messages[type], { duration })
        break
      case 'warning':
        toast.warning(messages[type], { duration })
        break
      case 'error':
        toast.error(messages[type], { duration })
        break
      default:
        toast(messages[type], { duration })
    }
  }

  const saveSettings = async () => {
    try {
      setSaving(true)
      const success = await SettingsService.saveToastSettings(settings)
      if (success) {
        // Refresh the context settings so Toaster updates immediately
        await refreshSettings()
        toast.success('Toast notification settings saved successfully!')
      } else {
        toast.error('Failed to save toast notification settings')
      }
    } catch (error) {
      logger.error('Failed to save toast settings:', error)
      toast.error('Failed to save toast notification settings')
    } finally {
      setSaving(false)
    }
  }

  const resetSettings = async () => {
    try {
      setSaving(true)
      const success = await SettingsService.resetToastSettings()
      if (success) {
        setSettings(DEFAULT_TOAST_SETTINGS)
        // Refresh the context settings so Toaster updates immediately
        await refreshSettings()
        toast.info('Settings reset to defaults')
      } else {
        toast.error('Failed to reset toast notification settings')
      }
    } catch (error) {
      logger.error('Failed to reset toast settings:', error)
      toast.error('Failed to reset toast notification settings')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className='space-y-6'>
        <Card>
          <CardContent className='flex items-center justify-center py-8'>
            <div className='flex flex-col items-center space-y-2'>
              <IconLoader2
                size={24}
                className='text-muted-foreground animate-spin'
              />
              <p className='text-muted-foreground text-sm'>
                Loading toast notification settings...
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className='space-y-6'>
      {/* Global Settings */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <IconSettings size={20} />
            Global Toast Settings
          </CardTitle>
          <CardDescription>
            Configure system-wide toast notification behavior and appearance.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-6'>
          <div className='flex items-center justify-between'>
            <div className='space-y-1'>
              <Label className='text-sm font-medium'>
                Enable Toast Notifications
              </Label>
              <p className='text-muted-foreground text-xs'>
                Master switch for all toast notifications
              </p>
            </div>
            <Switch
              checked={settings.globalEnabled}
              onCheckedChange={(checked) =>
                handleSettingChange('globalEnabled', checked)
              }
            />
          </div>

          <Separator />

          <div className='grid gap-4 md:grid-cols-2'>
            <div className='space-y-2'>
              <Label className='text-sm font-medium'>
                Default Duration (ms)
              </Label>
              <div className='px-3'>
                <Slider
                  value={[settings.defaultDuration]}
                  onValueChange={(value: number[]) =>
                    handleSettingChange('defaultDuration', value[0])
                  }
                  max={15000}
                  min={1000}
                  step={500}
                  className='w-full'
                />
                <div className='text-muted-foreground mt-1 flex justify-between text-xs'>
                  <span>1s</span>
                  <span>{settings.defaultDuration}ms</span>
                  <span>15s</span>
                </div>
              </div>
            </div>

            <div className='space-y-2'>
              <Label className='text-sm font-medium'>
                Max Concurrent Toasts
              </Label>
              <Input
                type='number'
                value={settings.maxConcurrent}
                onChange={(e) =>
                  handleSettingChange('maxConcurrent', parseInt(e.target.value))
                }
                min={1}
                max={10}
                className='w-full'
              />
            </div>
          </div>

          <div className='grid gap-4 md:grid-cols-2'>
            <div className='space-y-2'>
              <Label className='text-sm font-medium'>Position</Label>
              <Select
                value={settings.position}
                onValueChange={(value) =>
                  handleSettingChange('position', value)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='top-left'>Top Left</SelectItem>
                  <SelectItem value='top-right'>Top Right</SelectItem>
                  <SelectItem value='bottom-left'>Bottom Left</SelectItem>
                  <SelectItem value='bottom-right'>Bottom Right</SelectItem>
                  <SelectItem value='top-center'>Top Center</SelectItem>
                  <SelectItem value='bottom-center'>Bottom Center</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className='space-y-2'>
              <Label className='text-sm font-medium'>Animation</Label>
              <Select
                value={settings.animation}
                onValueChange={(value) =>
                  handleSettingChange('animation', value)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='slide'>Slide</SelectItem>
                  <SelectItem value='fade'>Fade</SelectItem>
                  <SelectItem value='scale'>Scale</SelectItem>
                  <SelectItem value='flip'>Flip</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className='grid gap-4 md:grid-cols-2 lg:grid-cols-4'>
            {[
              { key: 'soundEnabled', label: 'Sound Effects', icon: IconVolume },
              { key: 'showIcons', label: 'Show Icons', icon: IconPalette },
              { key: 'closeButton', label: 'Close Button', icon: IconX },
              { key: 'autoClose', label: 'Auto Close', icon: IconClock },
            ].map((option) => (
              <div key={option.key} className='flex items-center space-x-3'>
                <option.icon size={16} className='text-muted-foreground' />
                <div className='flex items-center space-x-2'>
                  <Switch
                    checked={
                      settings[option.key as keyof typeof settings] as boolean
                    }
                    onCheckedChange={(checked) =>
                      handleSettingChange(option.key, checked)
                    }
                  />
                  <Label className='text-sm'>{option.label}</Label>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Priority Settings */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <IconBell size={20} />
            Notification Priority Settings
          </CardTitle>
          <CardDescription>
            Configure behavior for different notification types and priorities.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-6'>
          {Object.entries(settings.priorities).map(([priority, config]) => (
            <div key={priority} className='space-y-4'>
              <div className='flex items-center justify-between'>
                <div className='flex items-center gap-3'>
                  <Badge
                    variant={
                      priority === 'error'
                        ? 'destructive'
                        : priority === 'warning'
                          ? 'default'
                          : priority === 'success'
                            ? 'default'
                            : 'secondary'
                    }
                    className='capitalize'
                  >
                    {priority}
                  </Badge>
                  <div>
                    <Label className='text-sm font-medium capitalize'>
                      {priority} Notifications
                    </Label>
                  </div>
                </div>
                <Switch
                  checked={config.enabled}
                  onCheckedChange={(checked) =>
                    handlePriorityChange(
                      priority as keyof typeof settings.priorities,
                      'enabled',
                      checked
                    )
                  }
                />
              </div>

              {config.enabled && (
                <div className='ml-4 grid gap-4 md:grid-cols-2'>
                  <div className='space-y-2'>
                    <Label className='text-muted-foreground text-xs'>
                      Duration (ms)
                    </Label>
                    <Input
                      type='number'
                      value={config.duration}
                      onChange={(e) =>
                        handlePriorityChange(
                          priority as keyof typeof settings.priorities,
                          'duration',
                          parseInt(e.target.value)
                        )
                      }
                      min={1000}
                      max={15000}
                      step={500}
                    />
                  </div>
                  <div className='flex items-center space-x-2'>
                    <Switch
                      checked={config.sound}
                      onCheckedChange={(checked) =>
                        handlePriorityChange(
                          priority as keyof typeof settings.priorities,
                          'sound',
                          checked
                        )
                      }
                    />
                    <Label className='text-muted-foreground text-xs'>
                      Play Sound
                    </Label>
                  </div>
                </div>
              )}

              <Separator className='mt-4' />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Test Section */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <IconCheck size={20} />
            Test Notifications
          </CardTitle>
          <CardDescription>
            Test different notification types with current settings.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className='grid gap-2 md:grid-cols-4'>
            <Button
              variant='outline'
              onClick={() => testNotification('info')}
              disabled={
                loading ||
                saving ||
                !settings.globalEnabled ||
                !settings.priorities.info.enabled
              }
              className='w-full'
            >
              Test Info
            </Button>
            <Button
              variant='outline'
              onClick={() => testNotification('success')}
              disabled={
                loading ||
                saving ||
                !settings.globalEnabled ||
                !settings.priorities.success.enabled
              }
              className='w-full'
            >
              Test Success
            </Button>
            <Button
              variant='outline'
              onClick={() => testNotification('warning')}
              disabled={
                loading ||
                saving ||
                !settings.globalEnabled ||
                !settings.priorities.warning.enabled
              }
              className='w-full'
            >
              Test Warning
            </Button>
            <Button
              variant='outline'
              onClick={() => testNotification('error')}
              disabled={
                loading ||
                saving ||
                !settings.globalEnabled ||
                !settings.priorities.error.enabled
              }
              className='w-full'
            >
              Test Error
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <div className='flex justify-end space-x-2'>
        <Button
          variant='outline'
          onClick={resetSettings}
          disabled={loading || saving}
        >
          {saving ? (
            <>
              <IconLoader2 size={16} className='mr-2 animate-spin' />
              Resetting...
            </>
          ) : (
            'Reset to Defaults'
          )}
        </Button>
        <Button
          onClick={saveSettings}
          className='min-w-[120px]'
          disabled={loading || saving}
        >
          {saving ? (
            <>
              <IconLoader2 size={16} className='mr-2 animate-spin' />
              Saving...
            </>
          ) : (
            'Save Settings'
          )}
        </Button>
      </div>
    </div>
  )
}
