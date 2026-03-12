/**
 * Device Registration Service
 * Manages device registrations in Supabase database
 * Syncs localStorage device data to database for session management visibility
 */
import { supabase } from '@/lib/supabase/client'
import {
  getDeviceRegistration,
  createDeviceFingerprint,
} from '@/lib/utils/device-fingerprint'
import { logger } from '@/lib/utils/logger'

// Types will be available after migration is applied and types are regenerated
interface DeviceRegistration {
  id: string
  fingerprint_id: string
  device_name: string
  device_type: string
  os_name: string | null
  os_version: string | null
  browser: string | null
  user_agent: string | null
  user_id: string | null
  organization_id: string | null
  is_active: boolean
  last_seen: string
  created_at: string
}

export class DeviceRegistrationService {
  /**
   * Sync device registration from localStorage to database
   * Called after user logs in to make device visible to admins
   */
  static async syncDeviceToDatabase(
    userId: string,
    organizationId: string
  ): Promise<void> {
    try {
      // Get device registration from localStorage
      const localDevice = await getDeviceRegistration()

      if (!localDevice) {
        logger.log('📱 No device registration found in localStorage')
        return
      }

      logger.log('📱 Syncing device to database:', localDevice.device_name)

      // Get full device fingerprint for complete data
      const fingerprint = await createDeviceFingerprint()

      // Upsert to database using RPC function
      const { error } = await (supabase as any).rpc(
        'upsert_device_registration',
        {
          p_fingerprint_id: localDevice.fingerprint_id,
          p_device_name: localDevice.device_name,
          p_device_type: localDevice.device_type,
          p_os_name: localDevice.os_name || 'Unknown',
          p_os_version: localDevice.os_version || 'Unknown',
          p_browser: localDevice.browser || 'Unknown',
          p_user_agent: fingerprint.userAgent,
          p_screen_resolution: fingerprint.screenResolution,
          p_color_depth: fingerprint.colorDepth,
          p_timezone: fingerprint.timezone,
          p_language: fingerprint.language,
          p_touch_points: fingerprint.touchPoints,
          p_hardware_concurrency: fingerprint.hardwareConcurrency,
          p_user_id: userId,
          p_organization_id: organizationId,
        }
      )

      if (error) {
        logger.error('❌ Error syncing device to database:', error)
      } else {
        logger.log('✅ Device synced to database successfully')
      }
    } catch (error) {
      logger.error('❌ Error in syncDeviceToDatabase:', error)
    }
  }

  /**
   * Get device name by user ID
   * Used by session management to show device names
   */
  static async getDeviceNameByUserId(userId: string): Promise<string | null> {
    try {
      const { data, error } = await (supabase as any)
        .from('device_registrations')
        .select('device_name, last_seen')
        .eq('user_id', userId)
        .eq('is_active', true)
        .order('last_seen', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (error) {
        logger.error('Error fetching device name:', error)
        return null
      }

      return data?.device_name || null
    } catch (error) {
      logger.error('Error in getDeviceNameByUserId:', error)
      return null
    }
  }

  /**
   * Get all device registrations for current organization
   * Used by admin to view all registered devices
   */
  static async getOrganizationDevices(
    organizationId?: string
  ): Promise<DeviceRegistration[]> {
    try {
      // If organization ID not provided, try to get it from user
      let orgId = organizationId

      if (!orgId) {
        const {
          data: { user },
        } = await supabase.auth.getUser()

        if (!user) {
          logger.warn('No authenticated user for device registration query')
          return []
        }

        // Get user's organization_id from auth metadata or user_profiles
        const { data: profile, error: profileError } = await supabase
          .from('user_profiles')
          .select('organization_id')
          .eq('id', user.id)
          .maybeSingle()

        if (profileError) {
          logger.warn('Error fetching user profile:', profileError)
          return []
        }

        if (!profile?.organization_id) {
          logger.warn('No organization found for user')
          return []
        }

        orgId = profile.organization_id
      }

      logger.log('📱 Fetching devices for organization:', orgId)

      const { data, error } = await (supabase as any)
        .from('device_registrations')
        .select('*')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .order('last_seen', { ascending: false })

      if (error) {
        logger.error('❌ Error fetching organization devices:', error)
        return []
      }

      logger.log('✅ Fetched', (data || []).length, 'device registrations')
      return (data || []) as DeviceRegistration[]
    } catch (error) {
      logger.error('❌ Error in getOrganizationDevices:', error)
      return []
    }
  }

  /**
   * Update device last seen timestamp
   * Called periodically to keep device registration fresh
   */
  static async updateDeviceLastSeen(fingerprintId: string): Promise<void> {
    try {
      await (supabase as any)
        .from('device_registrations')
        .update({ last_seen: new Date().toISOString() })
        .eq('fingerprint_id', fingerprintId)
    } catch (error) {
      logger.error('Error updating device last seen:', error)
    }
  }
}
// Developer and Creator: Jai Singh
