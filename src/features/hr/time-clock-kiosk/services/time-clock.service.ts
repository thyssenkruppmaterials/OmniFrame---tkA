import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase/client'
import { logger } from '@/lib/utils/logger'

export interface EmployeeLookupResult {
  user_id: string
  first_name: string
  last_name: string
  full_name: string
  avatar_url: string | null
  badge_number: string
  shift_assignment_id: string
  position_name: string | null
  organization_id: string
}

export interface ClockEntry {
  id: string
  clock_in: string
  clock_out: string | null
  status: string
  clock_in_photo_url: string | null
}

export interface ClockResult {
  success: boolean
  action: 'clock_in' | 'clock_out'
  timestamp: string
  entry_id: string
  error?: string
}

interface UserProfileJoin {
  id: string
  first_name: string | null
  last_name: string | null
  full_name: string | null
  avatar_url: string | null
}

interface ShiftPositionJoin {
  position_title: string | null
}

// The time_clock_entries table was created after types were generated.
// Use the untyped client accessor until types are regenerated.
const untypedClient = supabase as unknown as SupabaseClient
const timeClockTable = () => untypedClient.from('time_clock_entries')

/**
 * Look up an employee by their badge number
 */
export async function lookupEmployeeByBadge(
  badgeNumber: string
): Promise<EmployeeLookupResult | null> {
  const { data, error } = await supabase
    .from('shift_assignments')
    .select(
      `
      id,
      badge_number,
      organization_id,
      user_id,
      user_profiles!shift_assignments_user_id_fkey (
        id,
        first_name,
        last_name,
        full_name,
        avatar_url
      ),
      shift_positions (
        position_title
      )
    `
    )
    .eq('badge_number', badgeNumber)
    .eq('status', 'active')
    .limit(1)
    .single()

  if (error || !data) {
    return null
  }
  const profile = data.user_profiles as unknown as UserProfileJoin | null
  if (!profile) return null

  return {
    user_id: data.user_id as string,
    first_name: profile.first_name || '',
    last_name: profile.last_name || '',
    full_name:
      profile.full_name ||
      `${profile.first_name || ''} ${profile.last_name || ''}`.trim(),
    avatar_url: profile.avatar_url,
    badge_number: data.badge_number as string,
    shift_assignment_id: data.id,
    position_name:
      (data.shift_positions as unknown as ShiftPositionJoin | null)
        ?.position_title || null,
    organization_id: data.organization_id as string,
  }
}

/**
 * Get the current active (open) clock entry for a user
 */
export async function getActiveClockEntry(
  userId: string
): Promise<ClockEntry | null> {
  const { data, error } = await timeClockTable()
    .select('id, clock_in, clock_out, status, clock_in_photo_url')
    .eq('user_id', userId)
    .eq('status', 'active')
    .is('clock_out', null)
    .order('clock_in', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !data) return null
  return data as ClockEntry
}

/**
 * Get recent clock entries for an employee (last 3)
 */
export async function getRecentEntries(userId: string): Promise<ClockEntry[]> {
  const { data, error } = await timeClockTable()
    .select('id, clock_in, clock_out, status, clock_in_photo_url')
    .eq('user_id', userId)
    .in('status', ['active', 'completed'])
    .order('clock_in', { ascending: false })
    .limit(3)

  if (error || !data) return []
  return data as ClockEntry[]
}

/**
 * Upload a photo to Supabase Storage
 */
export async function uploadClockPhoto(
  photoBlob: Blob,
  userId: string,
  type: 'clock_in' | 'clock_out'
): Promise<string | null> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const filePath = `${userId}/${type}_${timestamp}.jpg`

  const { error } = await supabase.storage
    .from('time-clock-photos')
    .upload(filePath, photoBlob, {
      contentType: 'image/jpeg',
      upsert: false,
    })

  if (error) {
    logger.error('Failed to upload clock photo:', error)
    return null
  }

  return filePath
}

/**
 * Clock in an employee
 */
export async function clockIn(
  employee: EmployeeLookupResult,
  photoUrl: string | null,
  deviceInfo?: string
): Promise<ClockResult> {
  const now = new Date().toISOString()

  const { data, error } = await timeClockTable()
    .insert({
      organization_id: employee.organization_id,
      user_id: employee.user_id,
      shift_assignment_id: employee.shift_assignment_id,
      badge_number: employee.badge_number,
      clock_in: now,
      clock_in_photo_url: photoUrl,
      clock_in_method: 'badge',
      status: 'active',
      device_info: deviceInfo || 'Time Clock Kiosk',
      is_manual_entry: false,
    })
    .select('id')
    .single()

  if (error || !data) {
    return {
      success: false,
      action: 'clock_in',
      timestamp: now,
      entry_id: '',
      error: error?.message || 'Failed to clock in',
    }
  }

  return {
    success: true,
    action: 'clock_in',
    timestamp: now,
    entry_id: (data as { id: string }).id,
  }
}

/**
 * Clock out an employee
 */
export async function clockOut(
  entryId: string,
  photoUrl: string | null
): Promise<ClockResult> {
  const now = new Date().toISOString()

  const { error } = await timeClockTable()
    .update({
      clock_out: now,
      clock_out_photo_url: photoUrl,
      status: 'completed',
    })
    .eq('id', entryId)

  if (error) {
    return {
      success: false,
      action: 'clock_out',
      timestamp: now,
      entry_id: entryId,
      error: error.message,
    }
  }

  return {
    success: true,
    action: 'clock_out',
    timestamp: now,
    entry_id: entryId,
  }
}
