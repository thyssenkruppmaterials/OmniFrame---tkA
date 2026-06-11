// Created and developed by Jai Singh
import type {
  MdmDevice,
  MdmDeviceGroup,
  MdmCommand,
  MdmCommandType,
  DeviceLocation,
  MdmProfile,
  MdmApp,
  CompliancePolicy,
  ComplianceViolation,
  Geofence,
  AutomationWorkflow,
  MdmIncident,
  CommandTemplate,
  FleetStatistics,
  MdmCommandApproval,
} from '@/features/admin/device-manager/types/device-manager.types'
import { supabase } from './client'

const db = supabase as any

export class DeviceManagerService {
  static async getFleetStatistics(): Promise<FleetStatistics> {
    const { data, error } = await db.rpc('get_mdm_fleet_statistics')
    if (error) throw error
    return data as FleetStatistics
  }

  static async getCommandMetrics(days = 7) {
    const { data, error } = await db.rpc('get_mdm_command_metrics', {
      p_days: days,
    })
    if (error) throw error
    return data
  }

  static async searchDevices(params: {
    search?: string
    status?: string
    groupId?: string
    limit?: number
    offset?: number
  }) {
    const { data, error } = await db.rpc('search_mdm_devices', {
      p_search: params.search || null,
      p_status: params.status || null,
      p_group_id: params.groupId || null,
      p_limit: params.limit || 25,
      p_offset: params.offset || 0,
    })
    if (error) throw error
    return data as Array<{ device: MdmDevice; total_count: number }>
  }

  static async getDevice(deviceId: string): Promise<MdmDevice | null> {
    const { data, error } = await db
      .from('mdm_devices')
      .select('*')
      .eq('id', deviceId)
      .single()
    if (error) throw error
    return data as MdmDevice | null
  }

  static async updateDevice(deviceId: string, updates: Partial<MdmDevice>) {
    const { data, error } = await db
      .from('mdm_devices')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', deviceId)
      .select()
      .single()
    if (error) throw error
    return data as MdmDevice
  }

  static async getDeviceGroups(): Promise<MdmDeviceGroup[]> {
    const { data, error } = await db
      .from('mdm_device_groups')
      .select('*')
      .order('name')
    if (error) throw error
    return (data || []) as MdmDeviceGroup[]
  }

  static async queueCommand(params: {
    deviceId: string
    commandType: MdmCommandType
    payload?: Record<string, unknown>
    priority?: number
    scheduledAt?: string
  }): Promise<MdmCommand> {
    const { data, error } = await db
      .from('mdm_commands')
      .insert({
        device_id: params.deviceId,
        command_type: params.commandType,
        payload: params.payload || null,
        priority: params.priority || 5,
        scheduled_at: params.scheduledAt || null,
        status: 'Queued',
      })
      .select()
      .single()
    if (error) throw error
    return data as MdmCommand
  }

  static async getCommands(params: {
    deviceId?: string
    status?: string
    limit?: number
    offset?: number
  }): Promise<{ commands: MdmCommand[]; total: number }> {
    let query = db
      .from('mdm_commands')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .limit(params.limit || 25)

    if (params.deviceId) query = query.eq('device_id', params.deviceId)
    if (params.status) query = query.eq('status', params.status)
    if (params.offset)
      query = query.range(
        params.offset,
        params.offset + (params.limit || 25) - 1
      )

    const { data, error, count } = await query
    if (error) throw error
    return { commands: (data || []) as MdmCommand[], total: count || 0 }
  }

  static async getCommandApprovals(
    status = 'Pending'
  ): Promise<MdmCommandApproval[]> {
    const { data, error } = await db
      .from('mdm_command_approvals')
      .select('*')
      .eq('status', status)
      .order('requested_at', { ascending: false })
    if (error) throw error
    return (data || []) as MdmCommandApproval[]
  }

  static async approveCommand(
    approvalId: string,
    approved: boolean,
    reason?: string
  ) {
    const { error } = await db
      .from('mdm_command_approvals')
      .update({
        status: approved ? 'Approved' : 'Rejected',
        reason,
        resolved_at: new Date().toISOString(),
      })
      .eq('id', approvalId)
    if (error) throw error
  }

  static async getLocationHistory(params: {
    deviceId: string
    startDate?: string
    endDate?: string
    limit?: number
  }): Promise<DeviceLocation[]> {
    let query = db
      .from('mdm_device_locations')
      .select('*')
      .eq('device_id', params.deviceId)
      .order('timestamp', { ascending: false })
      .limit(params.limit || 100)

    if (params.startDate) query = query.gte('timestamp', params.startDate)
    if (params.endDate) query = query.lte('timestamp', params.endDate)

    const { data, error } = await query
    if (error) throw error
    return (data || []) as DeviceLocation[]
  }

  static async getLatestLocations(): Promise<DeviceLocation[]> {
    const { data, error } = await db
      .from('mdm_device_locations')
      .select('*')
      .order('timestamp', { ascending: false })
    if (error) throw error

    const latest = new Map<string, DeviceLocation>()
    for (const loc of (data || []) as DeviceLocation[]) {
      if (!latest.has(loc.device_id)) {
        latest.set(loc.device_id, loc)
      }
    }
    return Array.from(latest.values())
  }

  static async getProfiles(): Promise<MdmProfile[]> {
    const { data, error } = await db
      .from('mdm_profiles')
      .select('*')
      .order('name')
    if (error) throw error
    return (data || []) as MdmProfile[]
  }

  static async createProfile(
    profile: Partial<MdmProfile>
  ): Promise<MdmProfile> {
    const { data, error } = await db
      .from('mdm_profiles')
      .insert(profile)
      .select()
      .single()
    if (error) throw error
    return data as MdmProfile
  }

  static async getApps(): Promise<MdmApp[]> {
    const { data, error } = await db.from('mdm_apps').select('*').order('name')
    if (error) throw error
    return (data || []) as MdmApp[]
  }

  static async getCompliancePolicies(): Promise<CompliancePolicy[]> {
    const { data, error } = await db
      .from('mdm_compliance_policies')
      .select('*')
      .order('name')
    if (error) throw error
    return (data || []) as CompliancePolicy[]
  }

  static async getViolations(params: {
    status?: string
    limit?: number
  }): Promise<ComplianceViolation[]> {
    let query = db
      .from('mdm_compliance_violations')
      .select('*')
      .order('detected_at', { ascending: false })
      .limit(params.limit || 50)

    if (params.status) query = query.eq('remediation_status', params.status)

    const { data, error } = await query
    if (error) throw error
    return (data || []) as ComplianceViolation[]
  }

  static async getGeofences(): Promise<Geofence[]> {
    const { data, error } = await db
      .from('mdm_geofences')
      .select('*')
      .order('name')
    if (error) throw error
    return (data || []) as Geofence[]
  }

  static async createGeofence(geofence: Partial<Geofence>): Promise<Geofence> {
    const { data, error } = await db
      .from('mdm_geofences')
      .insert(geofence)
      .select()
      .single()
    if (error) throw error
    return data as Geofence
  }

  static async getWorkflows(): Promise<AutomationWorkflow[]> {
    const { data, error } = await db
      .from('mdm_workflows')
      .select('*')
      .order('name')
    if (error) throw error
    return (data || []) as AutomationWorkflow[]
  }

  static async createWorkflow(
    workflow: Partial<AutomationWorkflow>
  ): Promise<AutomationWorkflow> {
    const { data, error } = await db
      .from('mdm_workflows')
      .insert(workflow)
      .select()
      .single()
    if (error) throw error
    return data as AutomationWorkflow
  }

  static async getIncidents(params: {
    status?: string
    limit?: number
  }): Promise<MdmIncident[]> {
    let query = db
      .from('mdm_incidents')
      .select('*')
      .order('opened_at', { ascending: false })
      .limit(params.limit || 50)

    if (params.status) query = query.eq('status', params.status)

    const { data, error } = await query
    if (error) throw error
    return (data || []) as MdmIncident[]
  }

  static async getCommandTemplates(): Promise<CommandTemplate[]> {
    const { data, error } = await db
      .from('mdm_command_templates')
      .select('*')
      .order('name')
    if (error) throw error
    return (data || []) as CommandTemplate[]
  }

  static async getProfileAssignments(profileId?: string): Promise<unknown[]> {
    let query = db
      .from('mdm_profile_assignments')
      .select('*')
      .order('created_at', { ascending: false })
    if (profileId) query = query.eq('profile_id', profileId)
    const { data, error } = await query
    if (error) throw error
    return data || []
  }

  static async getInstalledApps(
    params: { deviceId?: string; appId?: string } = {}
  ): Promise<unknown[]> {
    let query = db
      .from('mdm_installed_apps')
      .select('*')
      .order('discovered_at', { ascending: false })
    if (params.deviceId) query = query.eq('device_id', params.deviceId)
    if (params.appId) query = query.eq('app_id', params.appId)
    const { data, error } = await query
    if (error) throw error
    return data || []
  }

  static async getWorkflowExecutions(workflowId?: string): Promise<unknown[]> {
    let query = db
      .from('mdm_workflow_executions')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(50)
    if (workflowId) query = query.eq('workflow_id', workflowId)
    const { data, error } = await query
    if (error) throw error
    return data || []
  }

  static async getGeofenceEvents(
    params: { geofenceId?: string; deviceId?: string; limit?: number } = {}
  ): Promise<unknown[]> {
    let query = db
      .from('mdm_geofence_events')
      .select('*')
      .order('triggered_at', { ascending: false })
      .limit(params.limit || 50)
    if (params.geofenceId) query = query.eq('geofence_id', params.geofenceId)
    if (params.deviceId) query = query.eq('device_id', params.deviceId)
    const { data, error } = await query
    if (error) throw error
    return data || []
  }

  static async getCommandEvents(commandId: string): Promise<unknown[]> {
    const { data, error } = await db
      .from('mdm_command_events')
      .select('*')
      .eq('command_id', commandId)
      .order('created_at', { ascending: true })
    if (error) throw error
    return data || []
  }

  // Removed 2026-05-06 (Phase 1 of rust-work-service integration plan):
  // static subscribeToDeviceChanges / subscribeToCommandChanges /
  // subscribeToLocationChanges had no live consumers. use-mdm-commands.ts
  // is pure polling and use-device-locations.ts uses the dedicated
  // mdm-service WebSocket on port 8040 (NOT Supabase Realtime). Removing
  // the dead code here also removes three unfiltered postgres_changes
  // channels that would have leaked cross-tenant if ever wired up.
  // See memorybank/OmniFrame/Implementations/Migrate-Tier1-Deferred-Channels-To-Rust-WS.md.
}

// Created and developed by Jai Singh
