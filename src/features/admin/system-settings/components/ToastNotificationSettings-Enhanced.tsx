import { useEffect, useState } from 'react'
import {
  IconAdjustments,
  IconAlertCircle,
  IconAlertTriangle,
  IconBell,
  IconBrush,
  IconCheck,
  IconCircleCheck,
  IconClock,
  IconInfoCircle,
  IconLoader2,
  IconPalette,
  IconPhoto,
  IconSettings,
  IconTypography,
  IconVolume,
  IconX,
} from '@tabler/icons-react'
import { toast } from 'sonner'
import {
  DEFAULT_TOAST_SETTINGS,
  SettingsService,
  type ToastNotificationSettings,
  type ToastPrioritySettings,
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
import { CustomToast } from '@/components/ui/custom-toast'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

const PRIORITY_ICONS = {
  info: IconInfoCircle,
  success: IconCircleCheck,
  warning: IconAlertTriangle,
  error: IconAlertCircle,
}

const FONT_WEIGHTS = [
  { value: '300', label: 'Light' },
  { value: '400', label: 'Normal' },
  { value: '500', label: 'Medium' },
  { value: '600', label: 'Semi Bold' },
  { value: '700', label: 'Bold' },
  { value: '800', label: 'Extra Bold' },
]

const TEXT_ALIGN_OPTIONS = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Center' },
  { value: 'right', label: 'Right' },
]

export function ToastNotificationSettingsEnhanced() {
  const { settings: contextSettings, refreshSettings } = useToastSettings()
  const [settings, setSettings] = useState<ToastNotificationSettings>(
    DEFAULT_TOAST_SETTINGS
  )
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [selectedPriority, setSelectedPriority] =
    useState<keyof typeof settings.priorities>('info')

  const handleSettingChange = (
    key: string,
    value: string | number | boolean
  ) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
  }

  const handlePriorityChange = (
    priority: keyof typeof settings.priorities,
    key: keyof ToastPrioritySettings,
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
      info: 'This is an informational notification with custom styling',
      success: 'Operation completed successfully with enhanced appearance!',
      warning: 'Please review this warning message with custom formatting',
      error: 'An error occurred - notice the distinctive styling',
    }

    // Get the priority configuration for this notification type
    const priorityConfig =
      settings.priorities[type as keyof typeof settings.priorities]
    const duration = priorityConfig?.duration || settings.defaultDuration

    // Get the icon for this type
    const Icon = PRIORITY_ICONS[type as keyof typeof PRIORITY_ICONS]

    // If max concurrent is set to 1, dismiss all existing toasts before showing new one
    if (settings.maxConcurrent === 1) {
      toast.dismiss()
    }

    // Create custom styled toast
    const toastContent = (
      <CustomToast
        type={type as 'info' | 'success' | 'warning' | 'error'}
        settings={priorityConfig}
        icon={Icon && <Icon size={priorityConfig.iconSize} />}
      >
        {messages[type]}
      </CustomToast>
    )

    switch (type) {
      case 'success':
        toast.success(toastContent, { duration, unstyled: true })
        break
      case 'warning':
        toast.warning(toastContent, { duration, unstyled: true })
        break
      case 'error':
        toast.error(toastContent, { duration, unstyled: true })
        break
      default:
        toast(toastContent, { duration, unstyled: true })
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

      {/* Enhanced Priority Settings */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <IconBell size={20} />
            Priority-Based Customization
          </CardTitle>
          <CardDescription>
            Customize appearance, typography, and behavior for each notification
            priority level.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Priority Selector Tabs */}
          <Tabs
            value={selectedPriority}
            onValueChange={(value) =>
              setSelectedPriority(value as keyof typeof settings.priorities)
            }
            className='w-full'
          >
            <TabsList className='grid w-full grid-cols-4'>
              {Object.keys(settings.priorities).map((priority) => (
                <TabsTrigger
                  key={priority}
                  value={priority}
                  className='capitalize'
                >
                  {priority}
                </TabsTrigger>
              ))}
            </TabsList>

            {Object.entries(settings.priorities).map(([priority, config]) => (
              <TabsContent
                key={priority}
                value={priority}
                className='mt-6 space-y-6'
              >
                {/* Basic Settings */}
                <div className='space-y-4'>
                  <div className='flex items-center justify-between'>
                    <div className='flex items-center gap-3'>
                      <Badge
                        variant={
                          priority === 'error'
                            ? 'destructive'
                            : priority === 'warning'
                              ? 'default'
                              : 'secondary'
                        }
                        className='capitalize'
                      >
                        {priority}
                      </Badge>
                      <Label className='text-base font-semibold capitalize'>
                        {priority} Notifications
                      </Label>
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
                    <>
                      {/* Behavior Settings */}
                      <Card className='border-muted'>
                        <CardHeader className='pb-3'>
                          <CardTitle className='flex items-center gap-2 text-sm'>
                            <IconClock size={16} />
                            Behavior Settings
                          </CardTitle>
                        </CardHeader>
                        <CardContent className='grid gap-4 md:grid-cols-2'>
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
                          <div className='flex items-center space-x-2 pt-6'>
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
                            <Label className='text-sm'>Play Sound</Label>
                          </div>
                        </CardContent>
                      </Card>

                      {/* Visual Styling */}
                      <Card className='border-muted'>
                        <CardHeader className='pb-3'>
                          <CardTitle className='flex items-center gap-2 text-sm'>
                            <IconBrush size={16} />
                            Visual Styling
                          </CardTitle>
                        </CardHeader>
                        <CardContent className='space-y-4'>
                          <div className='grid gap-4 md:grid-cols-3'>
                            <div className='space-y-2'>
                              <Label className='text-muted-foreground text-xs'>
                                Background Color
                              </Label>
                              <div className='flex gap-2'>
                                <Input
                                  type='color'
                                  value={config.backgroundColor}
                                  onChange={(e) =>
                                    handlePriorityChange(
                                      priority as keyof typeof settings.priorities,
                                      'backgroundColor',
                                      e.target.value
                                    )
                                  }
                                  className='h-10 w-16 cursor-pointer p-1'
                                />
                                <Input
                                  type='text'
                                  value={config.backgroundColor}
                                  onChange={(e) =>
                                    handlePriorityChange(
                                      priority as keyof typeof settings.priorities,
                                      'backgroundColor',
                                      e.target.value
                                    )
                                  }
                                  className='flex-1'
                                  placeholder='#3b82f6'
                                />
                              </div>
                            </div>

                            <div className='space-y-2'>
                              <Label className='text-muted-foreground text-xs'>
                                Text Color
                              </Label>
                              <div className='flex gap-2'>
                                <Input
                                  type='color'
                                  value={config.textColor}
                                  onChange={(e) =>
                                    handlePriorityChange(
                                      priority as keyof typeof settings.priorities,
                                      'textColor',
                                      e.target.value
                                    )
                                  }
                                  className='h-10 w-16 cursor-pointer p-1'
                                />
                                <Input
                                  type='text'
                                  value={config.textColor}
                                  onChange={(e) =>
                                    handlePriorityChange(
                                      priority as keyof typeof settings.priorities,
                                      'textColor',
                                      e.target.value
                                    )
                                  }
                                  className='flex-1'
                                  placeholder='#ffffff'
                                />
                              </div>
                            </div>

                            <div className='space-y-2'>
                              <Label className='text-muted-foreground text-xs'>
                                Border Color
                              </Label>
                              <div className='flex gap-2'>
                                <Input
                                  type='color'
                                  value={config.borderColor}
                                  onChange={(e) =>
                                    handlePriorityChange(
                                      priority as keyof typeof settings.priorities,
                                      'borderColor',
                                      e.target.value
                                    )
                                  }
                                  className='h-10 w-16 cursor-pointer p-1'
                                />
                                <Input
                                  type='text'
                                  value={config.borderColor}
                                  onChange={(e) =>
                                    handlePriorityChange(
                                      priority as keyof typeof settings.priorities,
                                      'borderColor',
                                      e.target.value
                                    )
                                  }
                                  className='flex-1'
                                  placeholder='#2563eb'
                                />
                              </div>
                            </div>
                          </div>

                          <div className='grid gap-4 md:grid-cols-2'>
                            <div className='space-y-2'>
                              <Label className='text-muted-foreground text-xs'>
                                Border Width (px)
                              </Label>
                              <Input
                                type='number'
                                value={config.borderWidth}
                                onChange={(e) =>
                                  handlePriorityChange(
                                    priority as keyof typeof settings.priorities,
                                    'borderWidth',
                                    parseInt(e.target.value)
                                  )
                                }
                                min={0}
                                max={10}
                                step={1}
                              />
                            </div>

                            <div className='space-y-2'>
                              <Label className='text-muted-foreground text-xs'>
                                Border Radius (px)
                              </Label>
                              <Input
                                type='number'
                                value={config.borderRadius}
                                onChange={(e) =>
                                  handlePriorityChange(
                                    priority as keyof typeof settings.priorities,
                                    'borderRadius',
                                    parseInt(e.target.value)
                                  )
                                }
                                min={0}
                                max={50}
                                step={1}
                              />
                            </div>
                          </div>
                        </CardContent>
                      </Card>

                      {/* Typography */}
                      <Card className='border-muted'>
                        <CardHeader className='pb-3'>
                          <CardTitle className='flex items-center gap-2 text-sm'>
                            <IconTypography size={16} />
                            Typography
                          </CardTitle>
                        </CardHeader>
                        <CardContent className='space-y-4'>
                          <div className='grid gap-4 md:grid-cols-3'>
                            <div className='space-y-2'>
                              <Label className='text-muted-foreground text-xs'>
                                Font Size (px)
                              </Label>
                              <Input
                                type='number'
                                value={config.fontSize}
                                onChange={(e) =>
                                  handlePriorityChange(
                                    priority as keyof typeof settings.priorities,
                                    'fontSize',
                                    parseInt(e.target.value)
                                  )
                                }
                                min={10}
                                max={24}
                                step={1}
                              />
                            </div>

                            <div className='space-y-2'>
                              <Label className='text-muted-foreground text-xs'>
                                Font Weight
                              </Label>
                              <Select
                                value={config.fontWeight}
                                onValueChange={(value) =>
                                  handlePriorityChange(
                                    priority as keyof typeof settings.priorities,
                                    'fontWeight',
                                    value
                                  )
                                }
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {FONT_WEIGHTS.map((fw) => (
                                    <SelectItem key={fw.value} value={fw.value}>
                                      {fw.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>

                            <div className='space-y-2'>
                              <Label className='text-muted-foreground text-xs'>
                                Text Align
                              </Label>
                              <Select
                                value={config.textAlign}
                                onValueChange={(value) =>
                                  handlePriorityChange(
                                    priority as keyof typeof settings.priorities,
                                    'textAlign',
                                    value
                                  )
                                }
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {TEXT_ALIGN_OPTIONS.map((ta) => (
                                    <SelectItem key={ta.value} value={ta.value}>
                                      {ta.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>

                          <div className='space-y-2'>
                            <Label className='text-muted-foreground text-xs'>
                              Font Family
                            </Label>
                            <Input
                              type='text'
                              value={config.fontFamily}
                              onChange={(e) =>
                                handlePriorityChange(
                                  priority as keyof typeof settings.priorities,
                                  'fontFamily',
                                  e.target.value
                                )
                              }
                              placeholder='inherit, Arial, sans-serif'
                            />
                          </div>
                        </CardContent>
                      </Card>

                      {/* Icon Styling */}
                      <Card className='border-muted'>
                        <CardHeader className='pb-3'>
                          <CardTitle className='flex items-center gap-2 text-sm'>
                            <IconPhoto size={16} />
                            Icon Styling
                          </CardTitle>
                        </CardHeader>
                        <CardContent className='space-y-4'>
                          <div className='flex items-center space-x-2'>
                            <Switch
                              checked={config.showIcon}
                              onCheckedChange={(checked) =>
                                handlePriorityChange(
                                  priority as keyof typeof settings.priorities,
                                  'showIcon',
                                  checked
                                )
                              }
                            />
                            <Label className='text-sm'>Show Icon</Label>
                          </div>

                          {config.showIcon && (
                            <div className='grid gap-4 md:grid-cols-2'>
                              <div className='space-y-2'>
                                <Label className='text-muted-foreground text-xs'>
                                  Icon Size (px)
                                </Label>
                                <Input
                                  type='number'
                                  value={config.iconSize}
                                  onChange={(e) =>
                                    handlePriorityChange(
                                      priority as keyof typeof settings.priorities,
                                      'iconSize',
                                      parseInt(e.target.value)
                                    )
                                  }
                                  min={12}
                                  max={48}
                                  step={2}
                                />
                              </div>

                              <div className='space-y-2'>
                                <Label className='text-muted-foreground text-xs'>
                                  Icon Color
                                </Label>
                                <div className='flex gap-2'>
                                  <Input
                                    type='color'
                                    value={config.iconColor}
                                    onChange={(e) =>
                                      handlePriorityChange(
                                        priority as keyof typeof settings.priorities,
                                        'iconColor',
                                        e.target.value
                                      )
                                    }
                                    className='h-10 w-16 cursor-pointer p-1'
                                  />
                                  <Input
                                    type='text'
                                    value={config.iconColor}
                                    onChange={(e) =>
                                      handlePriorityChange(
                                        priority as keyof typeof settings.priorities,
                                        'iconColor',
                                        e.target.value
                                      )
                                    }
                                    className='flex-1'
                                    placeholder='#ffffff'
                                  />
                                </div>
                              </div>
                            </div>
                          )}
                        </CardContent>
                      </Card>

                      {/* Advanced Styling */}
                      <Card className='border-muted'>
                        <CardHeader className='pb-3'>
                          <CardTitle className='flex items-center gap-2 text-sm'>
                            <IconAdjustments size={16} />
                            Advanced Styling
                          </CardTitle>
                        </CardHeader>
                        <CardContent className='space-y-4'>
                          <div className='grid gap-4 md:grid-cols-2'>
                            <div className='space-y-2'>
                              <Label className='text-muted-foreground text-xs'>
                                Opacity
                              </Label>
                              <div className='px-3'>
                                <Slider
                                  value={[config.opacity * 100]}
                                  onValueChange={(value: number[]) =>
                                    handlePriorityChange(
                                      priority as keyof typeof settings.priorities,
                                      'opacity',
                                      value[0] / 100
                                    )
                                  }
                                  max={100}
                                  min={10}
                                  step={5}
                                  className='w-full'
                                />
                                <div className='text-muted-foreground mt-1 flex justify-between text-xs'>
                                  <span>10%</span>
                                  <span>
                                    {Math.round(config.opacity * 100)}%
                                  </span>
                                  <span>100%</span>
                                </div>
                              </div>
                            </div>

                            <div className='space-y-2'>
                              <Label className='text-muted-foreground text-xs'>
                                Blur (px)
                              </Label>
                              <Input
                                type='number'
                                value={config.blur}
                                onChange={(e) =>
                                  handlePriorityChange(
                                    priority as keyof typeof settings.priorities,
                                    'blur',
                                    parseInt(e.target.value)
                                  )
                                }
                                min={0}
                                max={20}
                                step={1}
                              />
                            </div>
                          </div>

                          <div className='space-y-2'>
                            <Label className='text-muted-foreground text-xs'>
                              Box Shadow (CSS)
                            </Label>
                            <Input
                              type='text'
                              value={config.shadow}
                              onChange={(e) =>
                                handlePriorityChange(
                                  priority as keyof typeof settings.priorities,
                                  'shadow',
                                  e.target.value
                                )
                              }
                              placeholder='0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                              className='font-mono text-xs'
                            />
                          </div>
                        </CardContent>
                      </Card>

                      {/* Live Preview */}
                      <Card className='border-muted bg-muted/20'>
                        <CardHeader className='pb-3'>
                          <CardTitle className='flex items-center gap-2 text-sm'>
                            <IconPalette size={16} />
                            Live Preview
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className='bg-background flex items-center justify-center rounded-lg border p-6'>
                            <CustomToast
                              type={
                                priority as
                                  | 'info'
                                  | 'success'
                                  | 'warning'
                                  | 'error'
                              }
                              settings={config}
                              icon={(() => {
                                const Icon =
                                  PRIORITY_ICONS[
                                    priority as keyof typeof PRIORITY_ICONS
                                  ]
                                return Icon ? (
                                  <Icon size={config.iconSize} />
                                ) : null
                              })()}
                            >
                              This is a preview of your {priority} notification
                              styling
                            </CustomToast>
                          </div>
                        </CardContent>
                      </Card>
                    </>
                  )}
                </div>
              </TabsContent>
            ))}
          </Tabs>
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
            Test different notification types with your custom settings.
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
