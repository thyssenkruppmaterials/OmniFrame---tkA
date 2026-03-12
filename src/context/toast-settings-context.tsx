import {
  ReactNode,
  createContext,
  useContext,
  useEffect,
  useState,
} from 'react'
import {
  DEFAULT_TOAST_SETTINGS,
  SettingsService,
  type ToastNotificationSettings,
} from '@/lib/services/settings-service'
import { logger } from '@/lib/utils/logger'

interface ToastSettingsContextType {
  settings: ToastNotificationSettings
  isLoading: boolean
  refreshSettings: () => Promise<void>
  updateSettings: (newSettings: ToastNotificationSettings) => void
}

const ToastSettingsContext = createContext<
  ToastSettingsContextType | undefined
>(undefined)

export function ToastSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<ToastNotificationSettings>(
    DEFAULT_TOAST_SETTINGS
  )
  const [isLoading, setIsLoading] = useState(true)

  const loadSettings = async () => {
    try {
      setIsLoading(true)
      const loadedSettings = await SettingsService.getToastSettings()
      setSettings(loadedSettings)
    } catch (error) {
      logger.error('Failed to load toast settings:', error)
      setSettings(DEFAULT_TOAST_SETTINGS)
    } finally {
      setIsLoading(false)
    }
  }

  const refreshSettings = async () => {
    await loadSettings()
  }

  const updateSettings = (newSettings: ToastNotificationSettings) => {
    setSettings(newSettings)
  }

  useEffect(() => {
    loadSettings()
  }, [])

  return (
    <ToastSettingsContext.Provider
      value={{
        settings,
        isLoading,
        refreshSettings,
        updateSettings,
      }}
    >
      {children}
    </ToastSettingsContext.Provider>
  )
}

export function useToastSettings() {
  const context = useContext(ToastSettingsContext)
  if (context === undefined) {
    throw new Error(
      'useToastSettings must be used within a ToastSettingsProvider'
    )
  }
  return context
}
