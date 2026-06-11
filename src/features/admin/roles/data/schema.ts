// Created and developed by Jai Singh
import { z } from 'zod'

export const roleSchema = z.object({
  id: z.string(),
  name: z.string(),
  displayName: z.string(),
  description: z.string().optional(),
  isSystem: z.boolean(),
  isActive: z.boolean(),
  permissions: z.array(z.string()).optional(),
  userCount: z.number().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
})

export type Role = z.infer<typeof roleSchema>

export const roleListSchema = z.array(roleSchema)

export const permissionSchema = z.object({
  id: z.string(),
  name: z.string(),
  resource: z.string(),
  action: z.string(),
  description: z.string().optional(),
  createdAt: z.coerce.date(),
})

export type Permission = z.infer<typeof permissionSchema>

export const permissionListSchema = z.array(permissionSchema)

export const rolePermissionSchema = z.object({
  role: z.string(),
  permissionId: z.string(),
  createdAt: z.coerce.date(),
})

export type RolePermission = z.infer<typeof rolePermissionSchema>

export const userPermissionSchema = z.object({
  userId: z.string(),
  permissionId: z.string(),
  granted: z.boolean(),
  expiresAt: z.coerce.date().optional(),
  createdAt: z.coerce.date(),
})

export type UserPermission = z.infer<typeof userPermissionSchema>

// Created and developed by Jai Singh
