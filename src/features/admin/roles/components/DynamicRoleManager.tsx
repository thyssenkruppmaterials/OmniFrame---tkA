// Created and developed by Jai Singh
import { useState, useEffect } from 'react'
import {
  Shield,
  Plus,
  Trash2,
  Edit,
  Users,
  Eye,
  EyeOff,
  Crown,
  Settings,
  AlertTriangle,
} from 'lucide-react'
import { toast } from 'sonner'
import type { RoleWithHierarchy } from '@/lib/auth/types'
import { logger } from '@/lib/utils/logger'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PermissionGuard } from '@/components/auth/PermissionGuard'
import { PermissionMatrix } from './PermissionMatrix'
import { RBACAuditLog } from './RBACAuditLog'
import { RoleHierarchy } from './RoleHierarchy'
import { RoleTemplates } from './RoleTemplates'

interface DynamicRoleManagerProps {
  organizationId?: string
  onRoleChange?: (roleId: string | null) => void
  defaultTab?: string
}

export function DynamicRoleManager({
  organizationId,
  onRoleChange,
  defaultTab = 'permissions',
}: DynamicRoleManagerProps) {
  const [selectedRole, setSelectedRole] = useState<string | null>(null)
  const [roles, setRoles] = useState<RoleWithHierarchy[]>([])
  const [filteredRoles, setFilteredRoles] = useState<RoleWithHierarchy[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [filterLevel, setFilterLevel] = useState<string>('all')
  const [showSystemRoles, setShowSystemRoles] = useState(true)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [roleToDelete, setRoleToDelete] = useState<RoleWithHierarchy | null>(
    null
  )

  // Load roles on component mount
  useEffect(() => {
    loadRoles()
  }, [organizationId])

  // Filter roles based on search and filters
  useEffect(() => {
    let filtered = [...roles]

    // Filter by search term
    if (searchTerm) {
      filtered = filtered.filter(
        (role) =>
          role.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          role.display_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          role.description?.toLowerCase().includes(searchTerm.toLowerCase())
      )
    }

    // Filter by level
    if (filterLevel !== 'all') {
      filtered = filtered.filter(
        (role) => (role.level ?? 0).toString() === filterLevel
      )
    }

    // Filter system roles
    if (!showSystemRoles) {
      filtered = filtered.filter((role) => !role.is_system)
    }

    setFilteredRoles(filtered)
  }, [roles, searchTerm, filterLevel, showSystemRoles])

  const loadRoles = async () => {
    setIsLoading(true)
    try {
      // In a real implementation, this would call a service to get role hierarchy
      // For now, we'll simulate the data structure
      const mockRoles: RoleWithHierarchy[] = [
        {
          id: '1',
          name: 'superadmin',
          display_name: 'Super Administrator',
          description: 'Full system access',
          priority: 100,
          features: {
            system_access: true,
            user_management: true,
            role_management: true,
          },
          is_system: true,
          is_active: true,
          level: 0,
          path: ['1'],
          name_path: ['superadmin'],
          depth: 1,
        },
        {
          id: '2',
          name: 'admin',
          display_name: 'Administrator',
          description: 'Administrative access',
          parent_role_id: '1',
          priority: 80,
          features: { user_management: true, role_management: true },
          is_system: true,
          is_active: true,
          level: 1,
          path: ['1', '2'],
          name_path: ['superadmin', 'admin'],
          depth: 2,
        },
      ]

      setRoles(mockRoles)
    } catch (error) {
      logger.error('Error loading roles:', error)
      toast.error('Failed to load roles')
    } finally {
      setIsLoading(false)
    }
  }

  const handleRoleSelect = (roleId: string | null) => {
    setSelectedRole(roleId)
    onRoleChange?.(roleId)
  }

  const handleDeleteRole = async () => {
    if (!roleToDelete) return

    try {
      // In a real implementation, this would call rbacService.deleteRole
      // await rbacService.deleteRole(roleToDelete.id)

      toast.success(`Role "${roleToDelete.display_name}" deleted successfully`)
      setRoles((prev) => prev.filter((role) => role.id !== roleToDelete.id))

      if (selectedRole === roleToDelete.id) {
        setSelectedRole(null)
        onRoleChange?.(null)
      }
    } catch (error) {
      logger.error('Error deleting role:', error)
      toast.error('Failed to delete role')
    } finally {
      setDeleteDialogOpen(false)
      setRoleToDelete(null)
    }
  }

  const getRoleIcon = (role: RoleWithHierarchy) => {
    if (role.is_system) return <Crown className='h-4 w-4 text-yellow-500' />
    if (role.level === 0) return <Shield className='h-4 w-4 text-blue-500' />
    return <Users className='h-4 w-4 text-gray-500' />
  }

  const getRoleBadges = (role: RoleWithHierarchy) => {
    const badges = []

    if (role.is_system) {
      badges.push(
        <Badge key='system' variant='secondary' className='text-xs'>
          System
        </Badge>
      )
    }

    if ((role.level ?? 0) > 0) {
      badges.push(
        <Badge key='inherited' variant='outline' className='text-xs'>
          L{role.level}
        </Badge>
      )
    }

    if (role.max_users) {
      badges.push(
        <Badge key='limited' variant='destructive' className='text-xs'>
          Max: {role.max_users}
        </Badge>
      )
    }

    if (!role.is_active) {
      badges.push(
        <Badge key='inactive' variant='secondary' className='text-xs'>
          Inactive
        </Badge>
      )
    }

    return badges
  }

  return (
    <PermissionGuard
      resource='roles'
      action='read'
      showError
      fallback={
        <Card>
          <CardContent className='p-6'>
            <div className='text-muted-foreground text-center'>
              You don't have permission to manage roles.
            </div>
          </CardContent>
        </Card>
      }
    >
      <div className='space-y-6'>
        <div className='flex items-center justify-between'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>
              Dynamic Role Management
            </h2>
            <p className='text-muted-foreground'>
              Manage roles, permissions, and hierarchies with advanced features
            </p>
          </div>
          <PermissionGuard resource='roles' action='create'>
            <Button>
              <Plus className='mr-2 h-4 w-4' />
              Create Role
            </Button>
          </PermissionGuard>
        </div>

        <div className='grid grid-cols-1 gap-6 lg:grid-cols-4'>
          {/* Role List Sidebar */}
          <Card className='lg:col-span-1'>
            <CardHeader>
              <CardTitle className='flex items-center gap-2'>
                <Shield className='h-4 w-4' />
                Roles
              </CardTitle>
            </CardHeader>
            <CardContent className='space-y-4'>
              {/* Search and Filters */}
              <div className='space-y-2'>
                <Input
                  placeholder='Search roles...'
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className='h-8'
                />
                <Select value={filterLevel} onValueChange={setFilterLevel}>
                  <SelectTrigger className='h-8'>
                    <SelectValue placeholder='Filter by level' />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='all'>All Levels</SelectItem>
                    <SelectItem value='0'>Root (L0)</SelectItem>
                    <SelectItem value='1'>Level 1</SelectItem>
                    <SelectItem value='2'>Level 2</SelectItem>
                    <SelectItem value='3'>Level 3+</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant='ghost'
                  size='sm'
                  onClick={() => setShowSystemRoles(!showSystemRoles)}
                  className='h-8 w-full justify-start'
                >
                  {showSystemRoles ? (
                    <Eye className='mr-2 h-4 w-4' />
                  ) : (
                    <EyeOff className='mr-2 h-4 w-4' />
                  )}
                  {showSystemRoles ? 'Hide System' : 'Show System'}
                </Button>
              </div>

              {/* Role List */}
              <div className='max-h-96 space-y-2 overflow-y-auto'>
                {isLoading ? (
                  <div className='flex items-center justify-center py-8'>
                    <div className='border-primary h-6 w-6 animate-spin rounded-full border-b-2'></div>
                  </div>
                ) : filteredRoles.length === 0 ? (
                  <div className='text-muted-foreground py-4 text-center text-sm'>
                    No roles found
                  </div>
                ) : (
                  filteredRoles.map((role) => (
                    <div
                      key={role.id}
                      className={`cursor-pointer rounded-lg border p-2 transition-colors ${
                        selectedRole === role.id
                          ? 'border-primary bg-primary/10'
                          : 'border-border hover:bg-muted/50'
                      }`}
                      onClick={() => handleRoleSelect(role.id)}
                    >
                      <div className='flex items-start justify-between'>
                        <div className='min-w-0 flex-1'>
                          <div className='mb-1 flex items-center gap-2'>
                            {getRoleIcon(role)}
                            <span className='truncate text-sm font-medium'>
                              {role.display_name}
                            </span>
                          </div>
                          <div className='mb-1 flex flex-wrap gap-1'>
                            {getRoleBadges(role)}
                          </div>
                          {role.description && (
                            <p className='text-muted-foreground line-clamp-2 text-xs'>
                              {role.description}
                            </p>
                          )}
                        </div>
                        <div className='flex flex-col gap-1'>
                          <PermissionGuard resource='roles' action='update'>
                            <Button
                              variant='ghost'
                              size='icon'
                              className='h-6 w-6'
                              onClick={(e) => {
                                e.stopPropagation()
                                // Handle edit
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
                                className='text-destructive h-6 w-6'
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setRoleToDelete(role)
                                  setDeleteDialogOpen(true)
                                }}
                              >
                                <Trash2 className='h-3 w-3' />
                              </Button>
                            </PermissionGuard>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          {/* Main Content Area */}
          <div className='lg:col-span-3'>
            <Tabs defaultValue={defaultTab} className='space-y-4'>
              <TabsList className='grid w-full grid-cols-4'>
                <TabsTrigger
                  value='permissions'
                  className='flex items-center gap-2'
                >
                  <Shield className='h-4 w-4' />
                  Permissions
                </TabsTrigger>
                <TabsTrigger
                  value='hierarchy'
                  className='flex items-center gap-2'
                >
                  <Users className='h-4 w-4' />
                  Hierarchy
                </TabsTrigger>
                <TabsTrigger
                  value='templates'
                  className='flex items-center gap-2'
                >
                  <Settings className='h-4 w-4' />
                  Templates
                </TabsTrigger>
                <TabsTrigger value='audit' className='flex items-center gap-2'>
                  <Eye className='h-4 w-4' />
                  Audit
                </TabsTrigger>
              </TabsList>

              <TabsContent value='permissions' className='space-y-4'>
                <PermissionMatrix
                  roleId={selectedRole}
                  onRoleChange={handleRoleSelect}
                />
              </TabsContent>

              <TabsContent value='hierarchy' className='space-y-4'>
                <RoleHierarchy
                  onRoleSelect={handleRoleSelect}
                  selectedRole={selectedRole}
                />
              </TabsContent>

              <TabsContent value='templates' className='space-y-4'>
                <RoleTemplates
                  onTemplateApply={(templateData) => {
                    // Handle template application
                    logger.log('Apply template:', templateData)
                  }}
                />
              </TabsContent>

              <TabsContent value='audit' className='space-y-4'>
                <RBACAuditLog roleId={selectedRole} />
              </TabsContent>
            </Tabs>
          </div>
        </div>

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className='flex items-center gap-2'>
                <AlertTriangle className='text-destructive h-5 w-5' />
                Delete Role
              </AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete the role "
                {roleToDelete?.display_name}"? This action cannot be undone and
                will affect all users currently assigned to this role.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDeleteRole}
                className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
              >
                Delete Role
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </PermissionGuard>
  )
}

// Created and developed by Jai Singh
