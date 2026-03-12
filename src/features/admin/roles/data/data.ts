import {
  IconShield,
  IconUsers,
  IconUsersGroup,
  IconUserShield,
  IconSettings,
  IconEye,
  IconEdit,
  IconTrash,
  IconPlus,
  IconFileExport,
} from '@tabler/icons-react'

export const roleTypes = [
  {
    label: 'Superadmin',
    value: 'superadmin',
    icon: IconShield,
    description: 'Full system access with all privileges',
  },
  {
    label: 'Admin',
    value: 'admin',
    icon: IconUserShield,
    description: 'Administrative access with user management',
  },
  {
    label: 'Manager',
    value: 'manager',
    icon: IconUsersGroup,
    description: 'Team management and operational oversight',
  },
  {
    label: 'Cashier',
    value: 'cashier',
    icon: IconUsers,
    description: 'Customer-facing operations and transactions',
  },
  {
    label: 'Viewer',
    value: 'viewer',
    icon: IconEye,
    description: 'Read-only access to assigned resources',
  },
  {
    label: 'TKA Associate',
    value: 'tka_associate',
    icon: IconUsers,
    description: 'Warehouse associate with specialized access',
  },
] as const

export const permissionActions = [
  {
    label: 'Create',
    value: 'create',
    icon: IconPlus,
    description: 'Create new resources',
  },
  {
    label: 'Read',
    value: 'read',
    icon: IconEye,
    description: 'View and access resources',
  },
  {
    label: 'Update',
    value: 'update',
    icon: IconEdit,
    description: 'Modify existing resources',
  },
  {
    label: 'Delete',
    value: 'delete',
    icon: IconTrash,
    description: 'Remove resources',
  },
  {
    label: 'Export',
    value: 'export',
    icon: IconFileExport,
    description: 'Export data and reports',
  },
  {
    label: 'Manage',
    value: 'manage',
    icon: IconSettings,
    description: 'Administrative management privileges',
  },
] as const

export const resourceTypes = [
  {
    label: 'Users',
    value: 'users',
    description: 'User accounts and profiles',
  },
  {
    label: 'Tasks',
    value: 'tasks',
    description: 'Task management and workflows',
  },
  {
    label: 'Applications',
    value: 'applications',
    description: 'Application and service management',
  },
  {
    label: 'Organizations',
    value: 'organizations',
    description: 'Organization settings and configuration',
  },
  {
    label: 'Roles',
    value: 'roles',
    description: 'Role and permission management',
  },
  {
    label: 'Files',
    value: 'files',
    description: 'File storage and management',
  },
  {
    label: 'Chats',
    value: 'chats',
    description: 'Chat and messaging system',
  },
  {
    label: 'Settings',
    value: 'settings',
    description: 'System and user settings',
  },
  {
    label: 'All',
    value: '*',
    description: 'All system resources',
  },
] as const

// Sample role data for initial display
export const sampleRoles = [
  {
    id: '1',
    name: 'superadmin',
    description: 'Full system access with all privileges',
    permissions: ['*:*'],
    userCount: 1,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  },
  {
    id: '2',
    name: 'admin',
    description: 'Administrative access with user management',
    permissions: ['users:*', 'roles:*', 'organizations:*'],
    userCount: 3,
    createdAt: new Date('2024-01-15'),
    updatedAt: new Date('2024-01-15'),
  },
  {
    id: '3',
    name: 'manager',
    description: 'Team management and operational oversight',
    permissions: ['users:read', 'tasks:*', 'applications:read'],
    userCount: 5,
    createdAt: new Date('2024-02-01'),
    updatedAt: new Date('2024-02-01'),
  },
  {
    id: '4',
    name: 'cashier',
    description: 'Customer-facing operations and transactions',
    permissions: ['tasks:read', 'tasks:update', 'files:read'],
    userCount: 12,
    createdAt: new Date('2024-02-15'),
    updatedAt: new Date('2024-02-15'),
  },
  {
    id: '5',
    name: 'viewer',
    description: 'Read-only access to assigned resources',
    permissions: ['tasks:read', 'files:read'],
    userCount: 8,
    createdAt: new Date('2024-03-01'),
    updatedAt: new Date('2024-03-01'),
  },
]

// Sample permission data
export const samplePermissions = [
  {
    id: '1',
    name: 'users:create',
    resource: 'users',
    action: 'create',
    description: 'Create new user accounts',
    createdAt: new Date('2024-01-01'),
  },
  {
    id: '2',
    name: 'users:read',
    resource: 'users',
    action: 'read',
    description: 'View user information',
    createdAt: new Date('2024-01-01'),
  },
  {
    id: '3',
    name: 'users:update',
    resource: 'users',
    action: 'update',
    description: 'Modify user accounts',
    createdAt: new Date('2024-01-01'),
  },
  {
    id: '4',
    name: 'users:delete',
    resource: 'users',
    action: 'delete',
    description: 'Delete user accounts',
    createdAt: new Date('2024-01-01'),
  },
  {
    id: '5',
    name: 'tasks:create',
    resource: 'tasks',
    action: 'create',
    description: 'Create new tasks',
    createdAt: new Date('2024-01-01'),
  },
  {
    id: '6',
    name: 'tasks:read',
    resource: 'tasks',
    action: 'read',
    description: 'View tasks and task details',
    createdAt: new Date('2024-01-01'),
  },
  {
    id: '7',
    name: 'tasks:update',
    resource: 'tasks',
    action: 'update',
    description: 'Modify task information',
    createdAt: new Date('2024-01-01'),
  },
  {
    id: '8',
    name: 'tasks:delete',
    resource: 'tasks',
    action: 'delete',
    description: 'Delete tasks',
    createdAt: new Date('2024-01-01'),
  },
]
