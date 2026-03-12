/**
 * Kit Definitions Service
 * CRUD operations for kit_definitions (BOM master data).
 * Created: March 2026
 */
import { logger } from '@/lib/utils/logger'
import { supabase } from './client'

const db = supabase as ReturnType<(typeof supabase)['from']> & {
  from: (table: string) => ReturnType<(typeof supabase)['from']>
}

// Normalized BOM component shape stored in required_components JSONB
export interface BomComponent {
  materialNumber: string
  materialDescription: string
  requiredQuantity: number
}

export interface KitDefinitionRecord {
  id: string
  organization_id: string
  kit_number: string
  kit_name: string
  kit_description: string | null
  kit_version: string | null
  kit_type: string | null
  kit_category: string | null
  engine_program: string | null
  required_components: BomComponent[]
  total_components_count: number
  assembly_instructions: string | null
  work_instructions_url: string | null
  estimated_assembly_time_minutes: number | null
  status: string | null
  effective_date: string | null
  obsolete_date: string | null
  created_at: string | null
  created_by: string | null
  updated_at: string | null
  updated_by: string | null
}

export interface CreateKitDefinitionInput {
  kitNumber: string
  kitName: string
  kitDescription?: string
  kitType?: string
  engineProgram?: string
  requiredComponents: BomComponent[]
  assemblyInstructions?: string
  estimatedAssemblyTimeMinutes?: number
}

export interface UpdateKitDefinitionInput extends Partial<CreateKitDefinitionInput> {
  id: string
}

function validateBom(components: BomComponent[]): string | null {
  for (const c of components) {
    if (!c.materialNumber.trim()) return 'Material number cannot be blank'
    if (c.requiredQuantity <= 0)
      return `Quantity for ${c.materialNumber} must be positive`
  }
  const materialNumbers = components.map((c) =>
    c.materialNumber.trim().toUpperCase()
  )
  const dupes = materialNumbers.filter(
    (m, i) => materialNumbers.indexOf(m) !== i
  )
  if (dupes.length > 0) return `Duplicate material number: ${dupes[0]}`
  return null
}

export class KitDefinitionsService {
  private static readonly TABLE = 'kit_definitions'

  private static async getOrganizationId(): Promise<string | null> {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return null
    const { data } = await supabase
      .from('user_profiles')
      .select('organization_id')
      .eq('id', user.id)
      .single()
    return (data as { organization_id: string } | null)?.organization_id ?? null
  }

  static async list(opts?: {
    status?: string
    search?: string
  }): Promise<KitDefinitionRecord[]> {
    try {
      const orgId = await this.getOrganizationId()
      if (!orgId) return []

      let query = (db.from(this.TABLE) as ReturnType<(typeof supabase)['from']>)
        .select('*')
        .eq('organization_id', orgId)
        .order('kit_number', { ascending: true })

      if (opts?.status) {
        query = query.eq('status', opts.status)
      }

      const { data, error } = await query
      if (error) {
        logger.error('[KitDefinitionsService] list error:', error)
        return []
      }

      let records = (data as unknown as KitDefinitionRecord[]) || []

      if (opts?.search) {
        const s = opts.search.toLowerCase()
        records = records.filter(
          (r) =>
            r.kit_number.toLowerCase().includes(s) ||
            r.kit_name.toLowerCase().includes(s) ||
            (r.engine_program ?? '').toLowerCase().includes(s)
        )
      }

      return records
    } catch (err) {
      logger.error('[KitDefinitionsService] list error:', err)
      return []
    }
  }

  static async listActive(): Promise<KitDefinitionRecord[]> {
    return this.list({ status: 'active' })
  }

  static async getById(id: string): Promise<KitDefinitionRecord | null> {
    const { data, error } = await (
      db.from(this.TABLE) as ReturnType<(typeof supabase)['from']>
    )
      .select('*')
      .eq('id', id)
      .single()
    if (error) {
      logger.error('[KitDefinitionsService] getById error:', error)
      return null
    }
    return data as unknown as KitDefinitionRecord
  }

  static async create(
    input: CreateKitDefinitionInput
  ): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      const validationError = validateBom(input.requiredComponents)
      if (validationError) return { success: false, error: validationError }

      const orgId = await this.getOrganizationId()
      if (!orgId)
        return { success: false, error: 'Could not determine organization' }

      const {
        data: { user },
      } = await supabase.auth.getUser()

      const { data, error } = await (
        db.from(this.TABLE) as ReturnType<(typeof supabase)['from']>
      )
        .insert({
          organization_id: orgId,
          kit_number: input.kitNumber.trim(),
          kit_name: input.kitName.trim(),
          kit_description: input.kitDescription?.trim() || null,
          kit_type: input.kitType || 'standard',
          engine_program: input.engineProgram || null,
          required_components: input.requiredComponents,
          total_components_count: input.requiredComponents.length,
          assembly_instructions: input.assemblyInstructions?.trim() || null,
          estimated_assembly_time_minutes:
            input.estimatedAssemblyTimeMinutes || null,
          status: 'active',
          created_by: user?.id || null,
          updated_by: user?.id || null,
        } as unknown)
        .select('id')
        .single()

      if (error) {
        if (error.code === '23505') {
          return {
            success: false,
            error: `Kit number "${input.kitNumber}" already exists`,
          }
        }
        logger.error('[KitDefinitionsService] create error:', error)
        return { success: false, error: error.message }
      }

      return { success: true, id: (data as { id: string }).id }
    } catch (err) {
      logger.error('[KitDefinitionsService] create error:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      }
    }
  }

  static async update(
    input: UpdateKitDefinitionInput
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const updates: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      }

      const {
        data: { user },
      } = await supabase.auth.getUser()
      updates.updated_by = user?.id || null

      if (input.kitNumber !== undefined)
        updates.kit_number = input.kitNumber.trim()
      if (input.kitName !== undefined) updates.kit_name = input.kitName.trim()
      if (input.kitDescription !== undefined)
        updates.kit_description = input.kitDescription?.trim() || null
      if (input.kitType !== undefined) updates.kit_type = input.kitType
      if (input.engineProgram !== undefined)
        updates.engine_program = input.engineProgram || null
      if (input.assemblyInstructions !== undefined)
        updates.assembly_instructions =
          input.assemblyInstructions?.trim() || null
      if (input.estimatedAssemblyTimeMinutes !== undefined)
        updates.estimated_assembly_time_minutes =
          input.estimatedAssemblyTimeMinutes || null

      if (input.requiredComponents !== undefined) {
        const validationError = validateBom(input.requiredComponents)
        if (validationError) return { success: false, error: validationError }
        updates.required_components = input.requiredComponents
        updates.total_components_count = input.requiredComponents.length
      }

      const { error } = await (
        db.from(this.TABLE) as ReturnType<(typeof supabase)['from']>
      )
        .update(updates)
        .eq('id', input.id)

      if (error) {
        if (error.code === '23505') {
          return { success: false, error: `Kit number already exists` }
        }
        logger.error('[KitDefinitionsService] update error:', error)
        return { success: false, error: error.message }
      }

      return { success: true }
    } catch (err) {
      logger.error('[KitDefinitionsService] update error:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      }
    }
  }

  static async archive(
    id: string
  ): Promise<{ success: boolean; error?: string }> {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    const { error } = await (
      db.from(this.TABLE) as ReturnType<(typeof supabase)['from']>
    )
      .update({
        status: 'archived',
        updated_at: new Date().toISOString(),
        updated_by: user?.id || null,
      } as Record<string, unknown>)
      .eq('id', id)

    if (error) {
      logger.error('[KitDefinitionsService] archive error:', error)
      return { success: false, error: error.message }
    }
    return { success: true }
  }

  static async activate(
    id: string
  ): Promise<{ success: boolean; error?: string }> {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    const { error } = await (
      db.from(this.TABLE) as ReturnType<(typeof supabase)['from']>
    )
      .update({
        status: 'active',
        updated_at: new Date().toISOString(),
        updated_by: user?.id || null,
      } as Record<string, unknown>)
      .eq('id', id)

    if (error) {
      logger.error('[KitDefinitionsService] activate error:', error)
      return { success: false, error: error.message }
    }
    return { success: true }
  }

  static subscribeToChanges(callback: () => void) {
    return supabase
      .channel('kit_definitions_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: this.TABLE },
        () => callback()
      )
      .subscribe()
  }
}
// Developer and Creator: Jai Singh
