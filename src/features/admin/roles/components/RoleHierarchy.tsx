// Created and developed by Jai Singh
import { useState, useEffect } from 'react'
import {
  Users,
  Crown,
  Shield,
  ChevronDown,
  ChevronRight,
  Plus,
  Edit,
  Trash2,
} from 'lucide-react'
import type { RoleWithHierarchy } from '@/lib/auth/types'
import { supabase } from '@/lib/supabase/client'
import { logger } from '@/lib/utils/logger'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PermissionGuard } from '@/components/auth/PermissionGuard'

interface RoleHierarchyProps {
  onRoleSelect?: (roleId: string) => void
  selectedRole?: string | null
}

interface RoleNode extends RoleWithHierarchy {
  children: RoleNode[]
  expanded?: boolean
}

export function RoleHierarchy({
  onRoleSelect,
  selectedRole,
}: RoleHierarchyProps) {
  const [hierarchyData, setHierarchyData] = useState<RoleNode[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set())

  useEffect(() => {
    loadHierarchy()
  }, [])

  const loadHierarchy = async () => {
    setIsLoading(true)
    try {
      // Use basic roles query for reliable data loading
      const { data: rolesData, error: rolesError } = await supabase
        .from('roles')
        .select('*')
        .eq('is_active', true)
        .order('name')

      if (rolesError) throw rolesError

      // Convert basic roles to hierarchy format
      const hierarchyNodes: RoleNode[] = (rolesData || []).map((role) => ({
        id: role.id,
        name: role.name,
        display_name: role.display_name,
        description: role.description || undefined,
        priority: 0,
        features: {},
        is_system: role.is_system || false,
        is_active: role.is_active || true,
        level: 0,
        path: [role.id],
        name_path: [role.name],
        depth: 1,
        children: [],
      }))

      setHierarchyData(hierarchyNodes)
      // Expand first level by default
      setExpandedNodes(
        new Set(hierarchyNodes.slice(0, 3).map((node) => node.id))
      )
    } catch (error) {
      logger.error('Error loading role hierarchy:', error)
      // Show fallback error state
      setHierarchyData([])
    } finally {
      setIsLoading(false)
    }
  }

  const toggleExpanded = (nodeId: string) => {
    const newExpanded = new Set(expandedNodes)
    if (newExpanded.has(nodeId)) {
      newExpanded.delete(nodeId)
    } else {
      newExpanded.add(nodeId)
    }
    setExpandedNodes(newExpanded)
  }

  const getRoleIcon = (role: RoleNode) => {
    if (role.is_system && role.level === 0)
      return <Crown className='h-4 w-4 text-yellow-500' />
    if (role.is_system) return <Shield className='h-4 w-4 text-blue-500' />
    return <Users className='h-4 w-4 text-gray-500' />
  }

  const renderRoleNode = (role: RoleNode, depth: number = 0) => {
    const isExpanded = expandedNodes.has(role.id)
    const hasChildren = role.children && role.children.length > 0
    const isSelected = selectedRole === role.id

    return (
      <div key={role.id} className='space-y-2'>
        <div
          className={`flex cursor-pointer items-center gap-2 rounded-lg border p-3 transition-all ${
            isSelected
              ? 'border-primary bg-primary/10 ring-primary/20 ring-1'
              : 'border-border hover:bg-muted/50'
          } `}
          style={{ marginLeft: `${depth * 20}px` }}
          onClick={() => onRoleSelect?.(role.id)}
        >
          {/* Expansion toggle */}
          <div className='flex h-5 w-5 items-center justify-center'>
            {hasChildren ? (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  toggleExpanded(role.id)
                }}
                className='hover:bg-muted rounded p-0.5'
              >
                {isExpanded ? (
                  <ChevronDown className='h-3 w-3' />
                ) : (
                  <ChevronRight className='h-3 w-3' />
                )}
              </button>
            ) : (
              <div className='h-3 w-3' />
            )}
          </div>

          {/* Role icon */}
          {getRoleIcon(role)}

          {/* Role info */}
          <div className='min-w-0 flex-1'>
            <div className='flex items-center gap-2'>
              <span className='truncate font-medium'>{role.display_name}</span>
              <div className='flex gap-1'>
                {role.is_system && (
                  <Badge variant='secondary' className='text-xs'>
                    System
                  </Badge>
                )}
                {(role.level ?? 0) > 0 && (
                  <Badge variant='outline' className='text-xs'>
                    L{role.level}
                  </Badge>
                )}
                {role.max_users && (
                  <Badge variant='destructive' className='text-xs'>
                    Max: {role.max_users}
                  </Badge>
                )}
              </div>
            </div>
            {role.description && (
              <p className='text-muted-foreground truncate text-sm'>
                {role.description}
              </p>
            )}
          </div>

          {/* Actions */}
          <div className='flex items-center gap-1'>
            {hasChildren && (
              <Badge variant='outline' className='text-xs'>
                {role.children.length} child
                {role.children.length !== 1 ? 'ren' : ''}
              </Badge>
            )}
            <PermissionGuard resource='roles' action='update'>
              <Button
                variant='ghost'
                size='icon'
                className='h-7 w-7'
                onClick={(e) => {
                  e.stopPropagation()
                  // Handle edit role
                }}
              >
                <Edit className='h-3 w-3' />
              </Button>
            </PermissionGuard>
            {!role.is_system && (
              <PermissionGuard resource='roles' action='delete'>
                <Button
                  variant='ghost'
                  size='icon'
                  className='text-destructive h-7 w-7'
                  onClick={(e) => {
                    e.stopPropagation()
                    // Handle delete role
                  }}
                >
                  <Trash2 className='h-3 w-3' />
                </Button>
              </PermissionGuard>
            )}
          </div>
        </div>

        {/* Render children if expanded */}
        {hasChildren && isExpanded && (
          <div className='space-y-2'>
            {role.children.map((child) => renderRoleNode(child, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className='flex items-center justify-center py-8'>
          <div className='border-primary h-8 w-8 animate-spin rounded-full border-b-2'></div>
          <span className='ml-3'>Loading role hierarchy...</span>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className='flex items-center justify-between'>
          <CardTitle className='flex items-center gap-2'>
            <Users className='h-5 w-5' />
            Role Hierarchy
          </CardTitle>
          <PermissionGuard resource='roles' action='create'>
            <Button size='sm'>
              <Plus className='mr-2 h-4 w-4' />
              Add Child Role
            </Button>
          </PermissionGuard>
        </div>
      </CardHeader>
      <CardContent>
        <div className='space-y-2'>
          {hierarchyData.length === 0 ? (
            <div className='text-muted-foreground py-8 text-center'>
              No roles found in the hierarchy
            </div>
          ) : (
            hierarchyData.map((role) => renderRoleNode(role))
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// Created and developed by Jai Singh
