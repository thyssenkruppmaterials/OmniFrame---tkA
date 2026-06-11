// Created and developed by Jai Singh
/**
 * KitNotesService — persistent audit-trail chat thread for the Kit Build
 * Audit Trail dialog (Quick View).
 *
 * Backed by `public.kit_notes` (see migration 313). Same table holds both
 * user-typed messages and system messages stamped from in-dialog actions
 * (flag added/removed, ship-short authorized, kit deleted, etc.) —
 * `sender_type` distinguishes them.
 *
 * Append-only — there is no update/delete method on this service and no
 * UPDATE/DELETE RLS policy on the table. Operators cannot edit or redact
 * a typed message (audit-trail invariant).
 *
 * Org scoping: the org id stamped on each row is resolved from the
 * caller's `user_profiles.organization_id`, so a misbehaving client
 * cannot impersonate another org. The SELECT RLS policy ALSO checks
 * that the reading user is in the same org, so even a leaked row id
 * can't cross-tenant.
 *
 * Realtime: NOT subscribed via Supabase Realtime channels (see
 * [[Master Rule]] § Realtime Policy). The hook reads via TanStack
 * Query, invalidates on its own mutations, and a `refetchInterval`
 * on the hook drives cross-user updates while the dialog is open.
 */
import { logger } from '@/lib/utils/logger'
import { supabase } from './client'

export interface KitNote {
  id: string
  kit_serial_number: string
  organization_id: string
  sender_type: 'user' | 'system'
  sender_user_id: string | null
  sender_name: string | null
  body: string
  event_kind: string | null
  created_at: string
}

interface UserProfileRow {
  organization_id: string | null
  full_name: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
}

function resolveDisplayName(profile: UserProfileRow): string | null {
  return (
    profile.full_name?.trim() ||
    `${profile.first_name?.trim() || ''} ${profile.last_name?.trim() || ''}`.trim() ||
    profile.email?.split('@')[0] ||
    null
  )
}

class KitNotesService {
  private static instance: KitNotesService

  static getInstance() {
    if (!KitNotesService.instance) {
      KitNotesService.instance = new KitNotesService()
    }
    return KitNotesService.instance
  }

  /**
   * Fetch every note attached to a kit, oldest first. The chat UI
   * renders top-to-bottom so the natural sort order matches.
   *
   * Returns an empty array (never throws) for empty / blank serials so
   * the hook can stay quiet when no kit is selected yet.
   */
  async getNotes(kitSerialNumber: string | null): Promise<KitNote[]> {
    if (!kitSerialNumber?.trim()) return []
    try {
      const { data, error } = await (supabase as any)
        .from('kit_notes')
        .select('*')
        .eq('kit_serial_number', kitSerialNumber)
        .order('created_at', { ascending: true })

      if (error) {
        logger.error('[KitNotesService] getNotes error:', error)
        throw error
      }

      return (data ?? []) as KitNote[]
    } catch (err) {
      logger.error('[KitNotesService] getNotes unexpected error:', err)
      throw err
    }
  }

  /**
   * Append a user-typed message. Resolves the caller's
   * `organization_id` + display name from `user_profiles` so the row
   * passes RLS and carries a sender_name snapshot for the chat UI.
   *
   * Throws on missing auth / missing profile / DB error — the caller's
   * mutation toast surfaces the error.
   */
  async addUserNote(kitSerialNumber: string, body: string): Promise<KitNote> {
    const trimmed = body?.trim() ?? ''
    if (!kitSerialNumber.trim()) {
      throw new Error('Kit serial number is required')
    }
    if (!trimmed) {
      throw new Error('Message body is required')
    }
    if (trimmed.length > 4000) {
      throw new Error('Message is too long (4000 character maximum)')
    }

    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      throw new Error('Not authenticated — sign in to post a kit note')
    }

    const { data: profile, error: profileErr } = await supabase
      .from('user_profiles')
      .select('organization_id, full_name, first_name, last_name, email')
      .eq('id', user.id)
      .single()

    if (profileErr || !profile?.organization_id) {
      logger.error(
        '[KitNotesService] addUserNote: failed to resolve user profile',
        profileErr
      )
      throw new Error('Failed to resolve user profile')
    }

    const senderName = resolveDisplayName(profile)

    const { data, error } = await (supabase as any)
      .from('kit_notes')
      .insert({
        kit_serial_number: kitSerialNumber,
        organization_id: profile.organization_id,
        sender_type: 'user',
        sender_user_id: user.id,
        sender_name: senderName,
        body: trimmed,
        event_kind: 'note',
      })
      .select()
      .single()

    if (error) {
      logger.error('[KitNotesService] addUserNote insert error:', error)
      throw error
    }
    return data as KitNote
  }

  /**
   * Append a system-stamped message. Same RLS path as `addUserNote`
   * (organization_id must match the caller's), but `sender_user_id` is
   * NULL and `sender_name` defaults to 'System'.
   *
   * Returns `null` rather than throwing when the write fails — system
   * notes are non-blocking metadata; the primary action (flag write,
   * ship-short update, etc.) has already happened by the time we get
   * here, and we don't want a notes-table outage to roll the user's
   * action back.
   */
  async addSystemNote(
    kitSerialNumber: string,
    body: string,
    eventKind: string | null = null
  ): Promise<KitNote | null> {
    const trimmed = body?.trim() ?? ''
    if (!kitSerialNumber.trim() || !trimmed) {
      logger.warn(
        '[KitNotesService] addSystemNote called with blank kit serial or body — skipping'
      )
      return null
    }

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        logger.warn('[KitNotesService] addSystemNote: no auth user — skipping')
        return null
      }

      const { data: profile, error: profileErr } = await supabase
        .from('user_profiles')
        .select('organization_id')
        .eq('id', user.id)
        .single()

      if (profileErr || !profile?.organization_id) {
        logger.warn(
          '[KitNotesService] addSystemNote: missing org for user — skipping',
          profileErr
        )
        return null
      }

      const { data, error } = await (supabase as any)
        .from('kit_notes')
        .insert({
          kit_serial_number: kitSerialNumber,
          organization_id: profile.organization_id,
          sender_type: 'system',
          sender_user_id: null,
          sender_name: 'System',
          body: trimmed.slice(0, 4000),
          event_kind: eventKind,
        })
        .select()
        .single()

      if (error) {
        logger.error('[KitNotesService] addSystemNote insert error:', error)
        return null
      }
      return data as KitNote
    } catch (err) {
      logger.error('[KitNotesService] addSystemNote unexpected error:', err)
      return null
    }
  }

  /**
   * Kit serial numbers that have an UNREAD operator note for the current
   * user. Backed by the `kit_notes_unread_serials` RPC (migration 330,
   * SECURITY INVOKER): a kit is unread when another operator posted a
   * `sender_type = 'user'` note after the caller's read watermark. System
   * event stamps and the caller's own notes never count.
   *
   * Never throws — returns [] on any error so the grid indicator fails quiet.
   */
  async getUnreadKitSerials(): Promise<string[]> {
    try {
      const { data, error } = await (supabase as any).rpc(
        'kit_notes_unread_serials'
      )
      if (error) {
        logger.error('[KitNotesService] getUnreadKitSerials error:', error)
        return []
      }
      return ((data ?? []) as Array<{ kit_serial_number: string }>)
        .map((row) => row.kit_serial_number)
        .filter((serial): serial is string => Boolean(serial))
    } catch (err) {
      logger.error(
        '[KitNotesService] getUnreadKitSerials unexpected error:',
        err
      )
      return []
    }
  }

  /**
   * Mark a kit's notes as read for the current user by advancing their
   * read watermark to now(). Upserts on (user_id, kit_serial_number) into
   * `kit_note_reads`. Non-blocking — logs and swallows errors so a failed
   * watermark write never disrupts opening the audit trail.
   */
  async markKitNotesRead(kitSerialNumber: string): Promise<void> {
    if (!kitSerialNumber?.trim()) return
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return

      const { data: profile, error: profileErr } = await supabase
        .from('user_profiles')
        .select('organization_id')
        .eq('id', user.id)
        .single()

      if (profileErr || !profile?.organization_id) {
        logger.warn(
          '[KitNotesService] markKitNotesRead: missing org for user — skipping',
          profileErr
        )
        return
      }

      const nowIso = new Date().toISOString()
      const { error } = await (supabase as any).from('kit_note_reads').upsert(
        {
          user_id: user.id,
          kit_serial_number: kitSerialNumber,
          organization_id: profile.organization_id,
          last_read_at: nowIso,
          updated_at: nowIso,
        },
        { onConflict: 'user_id,kit_serial_number' }
      )

      if (error) {
        logger.error('[KitNotesService] markKitNotesRead upsert error:', error)
      }
    } catch (err) {
      logger.error('[KitNotesService] markKitNotesRead unexpected error:', err)
    }
  }
}

export const kitNotesService = KitNotesService.getInstance()

// Created and developed by Jai Singh
