import { Toaster as Sonner, ToasterProps } from 'sonner'
import { useTheme } from '@/context/theme-context'
import { useToastSettings } from '@/context/toast-settings-context'

const Toaster = ({ ...props }: ToasterProps) => {
  const { resolvedTheme } = useTheme()
  const { settings: toastSettings, isLoading } = useToastSettings()

  // Don't render until settings are loaded
  if (isLoading) {
    return null
  }

  // Map position from settings to Sonner format
  const getPosition = (position: string) => {
    switch (position) {
      case 'top-left':
        return 'top-left'
      case 'top-right':
        return 'top-right'
      case 'top-center':
        return 'top-center'
      case 'bottom-left':
        return 'bottom-left'
      case 'bottom-right':
        return 'bottom-right'
      case 'bottom-center':
        return 'bottom-center'
      default:
        return 'bottom-right'
    }
  }

  // Create a unique key based on critical settings to force remount when they change
  const toasterKey = `${toastSettings.maxConcurrent}-${toastSettings.position}-${toastSettings.defaultDuration}`

  return (
    <Sonner
      key={toasterKey}
      theme={resolvedTheme}
      className='toaster group [&_div[data-content]]:w-full'
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
        } as React.CSSProperties
      }
      // Apply settings from SettingsService
      duration={toastSettings.defaultDuration}
      position={getPosition(toastSettings.position)}
      visibleToasts={toastSettings.maxConcurrent}
      closeButton={toastSettings.closeButton}
      pauseWhenPageIsHidden={toastSettings.pauseOnHover}
      richColors={true}
      expand={false}
      {...props}
    />
  )
}

export { Toaster }
