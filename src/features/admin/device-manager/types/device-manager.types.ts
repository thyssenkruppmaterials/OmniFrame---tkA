// Created and developed by Jai Singh
export interface MdmDevice {
  id: string
  organization_id: string
  serial_number: string | null
  udid: string | null
  device_name: string | null
  model: string | null
  model_identifier: string | null
  os_version: string | null
  os_build: string | null
  product_name: string | null
  imei: string | null
  meid: string | null
  phone_number: string | null
  wifi_mac: string | null
  bluetooth_mac: string | null
  ethernet_mac: string | null
  ip_address: string | null
  carrier: string | null
  cellular_technology: string | null
  is_roaming: boolean
  supervised: boolean
  dep_enrolled: boolean
  mdm_profile_installed: boolean
  activation_lock_enabled: boolean
  enrollment_type: EnrollmentType | null
  enrollment_date: string | null
  last_checkin_at: string | null
  topic: string | null
  assigned_user_id: string | null
  device_group_id: string | null
  tags: string[]
  total_storage_bytes: number | null
  available_storage_bytes: number | null
  battery_level: number | null
  battery_health: string | null
  battery_cycle_count: number | null
  passcode_compliant: boolean | null
  encrypted: boolean | null
  firewall_enabled: boolean | null
  health_score: number | null
  status: DeviceStatus
  retired_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export type DeviceStatus =
  | 'Online'
  | 'Offline'
  | 'Pending'
  | 'Lost'
  | 'Wiped'
  | 'Retired'

export type EnrollmentType = 'DEP' | 'Manual' | 'BYOD' | 'UserInitiated'

export interface MdmDeviceGroup {
  id: string
  organization_id: string
  name: string
  description: string | null
  group_type: 'static' | 'smart'
  smart_filter: Record<string, unknown> | null
  parent_group_id: string | null
  created_at: string
  updated_at: string
}

export type CommandStatus =
  | 'Queued'
  | 'PendingApproval'
  | 'Approved'
  | 'Sent'
  | 'Acknowledged'
  | 'NotNow'
  | 'Completed'
  | 'Failed'
  | 'Cancelled'
  | 'Expired'
  | 'DeadLetter'

export type MdmCommandType =
  | 'DeviceLock'
  | 'EraseDevice'
  | 'ClearPasscode'
  | 'RestartDevice'
  | 'ShutDownDevice'
  | 'EnableLostMode'
  | 'DisableLostMode'
  | 'DeviceInformation'
  | 'SecurityInfo'
  | 'InstalledApplicationList'
  | 'InstallProfile'
  | 'RemoveProfile'
  | 'InstallApplication'
  | 'RemoveApplication'
  | 'ScheduleOSUpdate'
  | 'DeviceLocation'
  | 'CertificateList'
  | 'SetDeviceName'
  | 'SetWallpaper'

export const DESTRUCTIVE_COMMANDS: MdmCommandType[] = [
  'EraseDevice',
  'ClearPasscode',
  'EnableLostMode',
]

export interface MdmCommand {
  id: string
  organization_id: string
  device_id: string
  command_uuid: string
  command_type: MdmCommandType
  payload: Record<string, unknown> | null
  status: CommandStatus
  priority: number
  scheduled_at: string | null
  queued_at: string
  sent_at: string | null
  acknowledged_at: string | null
  completed_at: string | null
  expires_at: string | null
  retry_count: number
  max_retries: number
  error_code: string | null
  error_message: string | null
  response_payload: Record<string, unknown> | null
  pipeline_id: string | null
  pipeline_step: number | null
  initiated_by: string | null
  correlation_id: string
  created_at: string
}

export interface MdmCommandEvent {
  id: string
  command_id: string
  event_type: string
  previous_status: string | null
  new_status: string | null
  payload: Record<string, unknown> | null
  actor_id: string | null
  actor_type: 'user' | 'system' | 'device' | 'automation'
  created_at: string
}

export interface MdmCommandApproval {
  id: string
  command_id: string
  requested_by: string
  approved_by: string | null
  status: 'Pending' | 'Approved' | 'Rejected' | 'Expired'
  reason: string | null
  requested_at: string
  resolved_at: string | null
}

export interface DeviceLocation {
  id: string
  device_id: string
  latitude: number
  longitude: number
  altitude: number | null
  horizontal_accuracy: number | null
  vertical_accuracy: number | null
  speed: number | null
  heading: number | null
  timestamp: string
  source: 'mdm' | 'agent' | 'gps' | 'wifi' | 'cell' | 'manual'
  created_at: string
}

export interface MdmProfile {
  id: string
  organization_id: string
  name: string
  description: string | null
  profile_type: string
  identifier: string
  payload_plist: string | null
  scope: 'device' | 'user'
  version: number
  is_encrypted: boolean
  removal_allowed: boolean
  created_at: string
  updated_at: string
}

export interface MdmApp {
  id: string
  organization_id: string
  bundle_id: string
  name: string
  version: string | null
  icon_url: string | null
  managed: boolean
  vpp_license_count: number | null
  vpp_licenses_used: number
  blacklisted: boolean
  created_at: string
}

export interface InstalledApp {
  id: string
  device_id: string
  app_id: string | null
  bundle_id: string
  name: string | null
  version: string | null
  app_size_bytes: number | null
  is_managed: boolean
  installed_at: string | null
  discovered_at: string
}

export interface CompliancePolicy {
  id: string
  organization_id: string
  name: string
  description: string | null
  rules: ComplianceRule[]
  severity: 'low' | 'medium' | 'high' | 'critical'
  remediation_action: string | null
  enabled: boolean
  created_at: string
}

export interface ComplianceRule {
  field: string
  operator: '>=' | '<=' | '==' | '!=' | 'contains' | 'not_contains'
  value: string | number | boolean
}

export interface ComplianceViolation {
  id: string
  organization_id: string
  device_id: string
  policy_id: string
  violation_details: Record<string, unknown>
  severity: string
  remediation_status:
    | 'Open'
    | 'InProgress'
    | 'Remediated'
    | 'Waived'
    | 'Ignored'
  detected_at: string
  resolved_at: string | null
}

export interface Geofence {
  id: string
  organization_id: string
  name: string
  description: string | null
  geometry_type: 'circle' | 'polygon'
  center_lat: number | null
  center_lng: number | null
  radius_meters: number | null
  polygon_coordinates: Array<[number, number]> | null
  alert_type: 'enter' | 'exit' | 'both'
  trigger_actions: Record<string, unknown> | null
  active_schedule: Record<string, unknown> | null
  enabled: boolean
  created_at: string
}

export interface GeofenceEvent {
  id: string
  geofence_id: string
  device_id: string
  event_type: 'enter' | 'exit'
  latitude: number
  longitude: number
  triggered_at: string
  actions_executed: Record<string, unknown> | null
}

export interface AutomationWorkflow {
  id: string
  organization_id: string
  name: string
  description: string | null
  trigger_type: string
  trigger_config: Record<string, unknown>
  conditions: Record<string, unknown> | null
  actions: Record<string, unknown>[]
  graph_data: Record<string, unknown> | null
  enabled: boolean
  last_triggered_at: string | null
  execution_count: number
  created_at: string
}

export interface WorkflowExecution {
  id: string
  workflow_id: string
  trigger_event: Record<string, unknown> | null
  status: 'Running' | 'Completed' | 'Failed' | 'Cancelled'
  started_at: string
  completed_at: string | null
  result: Record<string, unknown> | null
  error_message: string | null
}

export interface MdmIncident {
  id: string
  organization_id: string
  device_id: string | null
  incident_type: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  title: string
  description: string | null
  status: 'Open' | 'Investigating' | 'Resolved' | 'Closed'
  assigned_to: string | null
  related_command_id: string | null
  opened_at: string
  resolved_at: string | null
}

export interface CommandTemplate {
  id: string
  organization_id: string
  name: string
  description: string | null
  steps: PipelineStep[]
  created_at: string
}

export interface PipelineStep {
  order: number
  command_type: MdmCommandType
  payload: Record<string, unknown> | null
  delay_seconds: number | null
  condition: Record<string, unknown> | null
}

export interface DeviceStatusEvent {
  event_type: string
  device_id: string
  organization_id: string | null
  payload: Record<string, unknown>
  timestamp: string
}

export interface LocationUpdate {
  device_id: string
  latitude: number
  longitude: number
  accuracy: number | null
  speed: number | null
  heading: number | null
  timestamp: string
}

export interface FleetStatistics {
  total_devices: number
  online_devices: number
  offline_devices: number
  pending_devices: number
  lost_devices: number
  supervised_devices: number
  compliance_rate: number
  pending_commands: number
  active_incidents: number
  pending_approvals: number
  average_health_score: number
}

export interface DeviceHealthScore {
  overall: number
  battery: number
  storage: number
  compliance: number
  connectivity: number
  os_currency: number
}

// Created and developed by Jai Singh
