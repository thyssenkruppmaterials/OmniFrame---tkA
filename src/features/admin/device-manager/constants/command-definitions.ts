import type { MdmCommandType } from '../types/device-manager.types'

export interface CommandDefinition {
  type: MdmCommandType
  label: string
  description: string
  category: 'security' | 'power' | 'management' | 'apps' | 'info'
  destructive: boolean
  requiresApproval: boolean
  permission: string
  defaultPayload: Record<string, unknown> | null
}

export const MDM_COMMAND_DEFINITIONS: CommandDefinition[] = [
  {
    type: 'DeviceLock',
    label: 'Lock Device',
    description: 'Lock the device screen immediately',
    category: 'security',
    destructive: false,
    requiresApproval: false,
    permission: 'device_manager.command',
    defaultPayload: null,
  },
  {
    type: 'EraseDevice',
    label: 'Erase Device',
    description: 'Factory reset and wipe all data',
    category: 'security',
    destructive: true,
    requiresApproval: true,
    permission: 'device_manager.wipe',
    defaultPayload: null,
  },
  {
    type: 'ClearPasscode',
    label: 'Clear Passcode',
    description: 'Remove the device passcode',
    category: 'security',
    destructive: true,
    requiresApproval: true,
    permission: 'device_manager.wipe',
    defaultPayload: null,
  },
  {
    type: 'EnableLostMode',
    label: 'Enable Lost Mode',
    description: 'Lock device and display a message',
    category: 'security',
    destructive: true,
    requiresApproval: true,
    permission: 'device_manager.wipe',
    defaultPayload: { message: '', phone_number: '' },
  },
  {
    type: 'DisableLostMode',
    label: 'Disable Lost Mode',
    description: 'Turn off Lost Mode',
    category: 'security',
    destructive: false,
    requiresApproval: false,
    permission: 'device_manager.command',
    defaultPayload: null,
  },
  {
    type: 'RestartDevice',
    label: 'Restart Device',
    description: 'Restart the device',
    category: 'power',
    destructive: false,
    requiresApproval: false,
    permission: 'device_manager.command',
    defaultPayload: null,
  },
  {
    type: 'ShutDownDevice',
    label: 'Shut Down',
    description: 'Power off the device',
    category: 'power',
    destructive: false,
    requiresApproval: false,
    permission: 'device_manager.command',
    defaultPayload: null,
  },
  {
    type: 'ScheduleOSUpdate',
    label: 'Schedule OS Update',
    description: 'Schedule an iOS update',
    category: 'power',
    destructive: false,
    requiresApproval: false,
    permission: 'device_manager.command',
    defaultPayload: { install_action: 'Default' },
  },
  {
    type: 'DeviceInformation',
    label: 'Device Information',
    description: 'Query device hardware and software details',
    category: 'info',
    destructive: false,
    requiresApproval: false,
    permission: 'device_manager.command',
    defaultPayload: null,
  },
  {
    type: 'SecurityInfo',
    label: 'Security Info',
    description: 'Query encryption, firewall, and passcode status',
    category: 'info',
    destructive: false,
    requiresApproval: false,
    permission: 'device_manager.command',
    defaultPayload: null,
  },
  {
    type: 'CertificateList',
    label: 'Certificate List',
    description: 'List installed certificates',
    category: 'info',
    destructive: false,
    requiresApproval: false,
    permission: 'device_manager.command',
    defaultPayload: null,
  },
  {
    type: 'InstalledApplicationList',
    label: 'Installed Apps',
    description: 'List all installed applications',
    category: 'info',
    destructive: false,
    requiresApproval: false,
    permission: 'device_manager.command',
    defaultPayload: null,
  },
  {
    type: 'InstallProfile',
    label: 'Install Profile',
    description: 'Push a configuration profile',
    category: 'management',
    destructive: false,
    requiresApproval: false,
    permission: 'device_manager.profile',
    defaultPayload: { profile_id: '' },
  },
  {
    type: 'RemoveProfile',
    label: 'Remove Profile',
    description: 'Remove a configuration profile',
    category: 'management',
    destructive: false,
    requiresApproval: false,
    permission: 'device_manager.profile',
    defaultPayload: { identifier: '' },
  },
  {
    type: 'InstallApplication',
    label: 'Install App',
    description: 'Install a managed application',
    category: 'apps',
    destructive: false,
    requiresApproval: false,
    permission: 'device_manager.app',
    defaultPayload: { itunes_store_id: '' },
  },
  {
    type: 'RemoveApplication',
    label: 'Remove App',
    description: 'Remove a managed application',
    category: 'apps',
    destructive: false,
    requiresApproval: false,
    permission: 'device_manager.app',
    defaultPayload: { identifier: '' },
  },
  {
    type: 'DeviceLocation',
    label: 'Request Location',
    description: 'Request current GPS location',
    category: 'info',
    destructive: false,
    requiresApproval: false,
    permission: 'device_manager.locate',
    defaultPayload: null,
  },
  {
    type: 'SetDeviceName',
    label: 'Set Device Name',
    description: 'Change the device display name',
    category: 'management',
    destructive: false,
    requiresApproval: false,
    permission: 'device_manager.command',
    defaultPayload: { device_name: '' },
  },
  {
    type: 'SetWallpaper',
    label: 'Set Wallpaper',
    description: 'Set lock or home screen wallpaper',
    category: 'management',
    destructive: false,
    requiresApproval: false,
    permission: 'device_manager.command',
    defaultPayload: { where: 1 },
  },
]

export const COMMAND_CATEGORIES = [
  { id: 'security', label: 'Security' },
  { id: 'power', label: 'Power' },
  { id: 'management', label: 'Management' },
  { id: 'apps', label: 'Apps' },
  { id: 'info', label: 'Information' },
] as const

export function getCommandsByCategory(category: string): CommandDefinition[] {
  return MDM_COMMAND_DEFINITIONS.filter((c) => c.category === category)
}

export function getCommandDefinition(
  type: MdmCommandType
): CommandDefinition | undefined {
  return MDM_COMMAND_DEFINITIONS.find((c) => c.type === type)
}
