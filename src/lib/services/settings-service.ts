import { supabase } from '@/lib/supabase/client'
import { logger } from '@/lib/utils/logger'

export interface ToastPrioritySettings {
  enabled: boolean
  duration: number
  sound: boolean
  // Visual Styling
  backgroundColor: string
  textColor: string
  borderColor: string
  borderWidth: number
  borderRadius: number
  // Typography
  fontSize: number
  fontWeight: string
  fontFamily: string
  textAlign: string
  // Icon Styling
  iconSize: number
  iconColor: string
  showIcon: boolean
  // Advanced
  shadow: string
  opacity: number
  blur: number
}

export interface ToastNotificationSettings {
  globalEnabled: boolean
  defaultDuration: number
  maxConcurrent: number
  position: string
  soundEnabled: boolean
  showIcons: boolean
  animation: string
  closeButton: boolean
  autoClose: boolean
  pauseOnHover: boolean
  theme: string
  priorities: {
    info: ToastPrioritySettings
    success: ToastPrioritySettings
    warning: ToastPrioritySettings
    error: ToastPrioritySettings
  }
}

export const DEFAULT_TOAST_SETTINGS: ToastNotificationSettings = {
  globalEnabled: true,
  defaultDuration: 5000,
  maxConcurrent: 5,
  position: 'bottom-right',
  soundEnabled: true,
  showIcons: true,
  animation: 'slide',
  closeButton: true,
  autoClose: true,
  pauseOnHover: true,
  theme: 'system',
  priorities: {
    info: {
      enabled: true,
      duration: 3000,
      sound: false,
      // Visual Styling - Alert-style Card with Blue Text
      backgroundColor: 'var(--card)',
      textColor: 'var(--card-foreground)',
      borderColor: 'var(--border)',
      borderWidth: 1,
      borderRadius: 8,
      // Typography
      fontSize: 14,
      fontWeight: '400',
      fontFamily: 'inherit',
      textAlign: 'left',
      // Icon Styling
      iconSize: 16,
      iconColor: '#3b82f6', // Blue for info
      showIcon: true,
      // Advanced
      shadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
      opacity: 1,
      blur: 0,
    },
    success: {
      enabled: true,
      duration: 4000,
      sound: true,
      // Visual Styling - Alert-style Card with Green Text
      backgroundColor: 'var(--card)',
      textColor: 'var(--card-foreground)',
      borderColor: 'var(--border)',
      borderWidth: 1,
      borderRadius: 8,
      // Typography
      fontSize: 14,
      fontWeight: '500',
      fontFamily: 'inherit',
      textAlign: 'left',
      // Icon Styling
      iconSize: 16,
      iconColor: '#10b981', // Green for success
      showIcon: true,
      // Advanced
      shadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
      opacity: 1,
      blur: 0,
    },
    warning: {
      enabled: true,
      duration: 6000,
      sound: true,
      // Visual Styling - Alert-style Card with Amber Text
      backgroundColor: 'var(--card)',
      textColor: 'var(--card-foreground)',
      borderColor: 'var(--border)',
      borderWidth: 1,
      borderRadius: 8,
      // Typography
      fontSize: 14,
      fontWeight: '500',
      fontFamily: 'inherit',
      textAlign: 'left',
      // Icon Styling
      iconSize: 16,
      iconColor: '#f59e0b', // Amber for warning
      showIcon: true,
      // Advanced
      shadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
      opacity: 1,
      blur: 0,
    },
    error: {
      enabled: true,
      duration: 8000,
      sound: true,
      // Visual Styling - Alert-style Card with Destructive Red Text
      backgroundColor: 'var(--card)',
      textColor: 'var(--destructive)',
      borderColor: 'var(--border)',
      borderWidth: 1,
      borderRadius: 8,
      // Typography
      fontSize: 14,
      fontWeight: '500',
      fontFamily: 'inherit',
      textAlign: 'left',
      // Icon Styling
      iconSize: 16,
      iconColor: 'var(--destructive)', // Destructive red for errors
      showIcon: true,
      // Advanced
      shadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
      opacity: 1,
      blur: 0,
    },
  },
}

export class SettingsService {
  private static readonly TOAST_SETTINGS_KEY = 'system.toast_notifications'

  /**
   * Get system-wide toast notification settings
   */
  static async getToastSettings(): Promise<ToastNotificationSettings> {
    try {
      const { data: session } = await supabase.auth.getSession()
      if (!session.session?.user) {
        // Fallback to localStorage if not authenticated
        const stored = localStorage.getItem('toast-notification-settings')
        return stored ? JSON.parse(stored) : DEFAULT_TOAST_SETTINGS
      }

      const { data, error } = await supabase
        .from('settings')
        .select('value')
        .eq('key', this.TOAST_SETTINGS_KEY)
        .is('user_id', null) // System-wide settings have null user_id
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (error) {
        logger.error('Error fetching toast settings:', error)
        // Fallback to localStorage
        const stored = localStorage.getItem('toast-notification-settings')
        return stored ? JSON.parse(stored) : DEFAULT_TOAST_SETTINGS
      }

      if (!data) {
        return DEFAULT_TOAST_SETTINGS
      }

      return data.value as unknown as ToastNotificationSettings
    } catch (error) {
      logger.error('Error in getToastSettings:', error)
      // Fallback to localStorage
      const stored = localStorage.getItem('toast-notification-settings')
      return stored ? JSON.parse(stored) : DEFAULT_TOAST_SETTINGS
    }
  }

  /**
   * Save system-wide toast notification settings
   */
  static async saveToastSettings(
    settings: ToastNotificationSettings
  ): Promise<boolean> {
    try {
      const { data: session } = await supabase.auth.getSession()
      if (!session.session?.user) {
        // Fallback to localStorage if not authenticated
        localStorage.setItem(
          'toast-notification-settings',
          JSON.stringify(settings)
        )
        return true
      }

      // Get user's organization_id for system settings
      const { data: profileData, error: profileError } = await supabase
        .from('user_profiles')
        .select('organization_id')
        .eq('id', session.session.user.id)
        .single()

      if (profileError) {
        logger.error('Error fetching user profile:', profileError)
        return false
      }

      // Check if setting already exists
      const { data: existingSetting } = await supabase
        .from('settings')
        .select('id')
        .eq('key', this.TOAST_SETTINGS_KEY)
        .is('user_id', null) // System-wide settings
        .eq('organization_id', profileData.organization_id ?? '')
        .maybeSingle()

      if (existingSetting) {
        // Update existing setting
        const { error } = await supabase
          .from('settings')
          .update({
            value: settings as any, // eslint-disable-line @typescript-eslint/no-explicit-any -- Supabase Json column accepts dynamic shape
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingSetting.id)

        if (error) {
          logger.error('Error updating toast settings:', error)
          return false
        }
      } else {
        // Insert new setting
        const { error } = await supabase.from('settings').insert({
          key: this.TOAST_SETTINGS_KEY,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          value: settings as any,
          organization_id: profileData.organization_id ?? '',
          user_id: undefined, // System-wide settings have null user_id
        })

        if (error) {
          logger.error('Error inserting toast settings:', error)
          return false
        }
      }

      // Also save to localStorage as backup
      localStorage.setItem(
        'toast-notification-settings',
        JSON.stringify(settings)
      )
      return true
    } catch (error) {
      logger.error('Error in saveToastSettings:', error)
      return false
    }
  }

  /**
   * Reset toast notification settings to defaults
   */
  static async resetToastSettings(): Promise<boolean> {
    return await this.saveToastSettings(DEFAULT_TOAST_SETTINGS)
  }

  /**
   * Get a specific setting value by key
   */
  static async getSetting<T>(
    key: string,
    defaultValue: T,
    systemWide = false
  ): Promise<T> {
    try {
      const { data: session } = await supabase.auth.getSession()
      if (!session.session?.user) {
        return defaultValue
      }

      const query = supabase.from('settings').select('value').eq('key', key)

      if (systemWide) {
        query.is('user_id', null)
      } else {
        query.eq('user_id', session.session.user.id)
      }

      const { data, error } = await query.maybeSingle()

      if (error || !data) {
        return defaultValue
      }

      return data.value as T
    } catch (error) {
      logger.error('Error getting setting:', error)
      return defaultValue
    }
  }

  /**
   * Save a specific setting value by key
   */
  static async saveSetting<T>(
    key: string,
    value: T,
    systemWide = false
  ): Promise<boolean> {
    try {
      const { data: session } = await supabase.auth.getSession()
      if (!session.session?.user) {
        return false
      }

      // Get user's organization_id
      const { data: profileData, error: profileError } = await supabase
        .from('user_profiles')
        .select('organization_id')
        .eq('id', session.session.user.id)
        .single()

      if (profileError) {
        logger.error('Error fetching user profile:', profileError)
        return false
      }

      const userId = systemWide ? null : session.session.user.id

      // Check if setting exists
      const query = supabase
        .from('settings')
        .select('id')
        .eq('key', key)
        .eq('organization_id', profileData.organization_id ?? '')

      if (userId === null) {
        query.is('user_id', null)
      } else {
        query.eq('user_id', userId)
      }

      const { data: existingSetting } = await query.maybeSingle()

      if (existingSetting) {
        // Update existing
        const { error } = await supabase
          .from('settings')
          .update({
            value: value as any, // eslint-disable-line @typescript-eslint/no-explicit-any -- Supabase Json column accepts dynamic shape
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingSetting.id)

        return !error
      } else {
        // Insert new
        const { error } = await supabase.from('settings').insert({
          key,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          value: value as any,
          organization_id: profileData.organization_id ?? '',
          user_id: userId ?? undefined,
        })

        return !error
      }
    } catch (error) {
      logger.error('Error saving setting:', error)
      return false
    }
  }
}
