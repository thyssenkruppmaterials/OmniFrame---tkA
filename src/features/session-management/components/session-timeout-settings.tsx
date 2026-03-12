import { useState, useEffect } from 'react'
import {
  IconPlus,
  IconTrash,
  IconEdit,
  IconGlobe,
  IconUsers,
} from '@tabler/icons-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase/client'
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
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { PermissionGuard } from '@/components/auth/PermissionGuard'
import { SessionManagementService } from '../services/session-management.service'
import type { SessionTimeoutConfig } from '../types'

interface RoleOption {
  name: string
  display_name: string
}

export function SessionTimeoutSettings() {
  const [configs, setConfigs] = useState<SessionTimeoutConfig[]>([])
  const [availableRoles, setAvailableRoles] = useState<RoleOption[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [editingConfig, setEditingConfig] =
    useState<SessionTimeoutConfig | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [deleteConfigId, setDeleteConfigId] = useState<string | null>(null)

  // Form state for creating/editing
  const [formData, setFormData] = useState({
    role: '',
    session_timeout_minutes: 120,
    auto_logout_timeout_minutes: 15,
    warning_time_minutes: 5,
    is_global: false,
    remember_me_duration_hours: 168,
    enable_fullscreen_expiry_warning: true,
  })

  useEffect(() => {
    loadConfigs()
    loadAvailableRoles()
  }, [])

  const loadConfigs = async () => {
    try {
      setIsLoading(true)
      const data = await SessionManagementService.getTimeoutConfigs()
      setConfigs(data)
    } catch (error) {
      logger.error('Error loading timeout configs:', error)
      toast.error('Failed to load timeout configurations')
    } finally {
      setIsLoading(false)
    }
  }

  const loadAvailableRoles = async () => {
    try {
      const { data: roles, error } = await supabase
        .from('roles')
        .select('name, display_name')
        .eq('is_active', true)
        .order('priority', { ascending: true })
        .order('name', { ascending: true })

      if (error) {
        logger.warn('Error loading roles:', error.message)
        return
      }

      setAvailableRoles(
        (roles || []).map((r) => ({
          name: r.name as string,
          display_name: (r.display_name as string) || (r.name as string),
        }))
      )
    } catch (error) {
      logger.error('Error loading available roles:', error)
    }
  }

  const handleSave = async () => {
    try {
      if (editingConfig) {
        await SessionManagementService.updateTimeoutConfig({
          ...editingConfig,
          ...formData,
        })
        toast.success('Timeout configuration updated successfully')
      } else {
        await SessionManagementService.createTimeoutConfig(formData)
        toast.success('Timeout configuration created successfully')
      }

      await loadConfigs()
      resetForm()
    } catch (error) {
      logger.error('Error saving timeout config:', error)
      toast.error('Failed to save timeout configuration')
    }
  }

  const handleEdit = (config: SessionTimeoutConfig) => {
    setEditingConfig(config)
    setFormData({
      role: config.role,
      session_timeout_minutes: config.session_timeout_minutes,
      auto_logout_timeout_minutes: config.auto_logout_timeout_minutes,
      warning_time_minutes: config.warning_time_minutes,
      is_global: config.is_global,
      remember_me_duration_hours: config.remember_me_duration_hours ?? 168,
      enable_fullscreen_expiry_warning:
        config.enable_fullscreen_expiry_warning ?? true,
    })
    setShowCreateForm(true)
  }

  const handleDelete = async () => {
    if (!deleteConfigId) return

    try {
      await SessionManagementService.deleteTimeoutConfig(deleteConfigId)
      await loadConfigs()
      toast.success('Timeout configuration deleted successfully')
    } catch (error) {
      logger.error('Error deleting timeout config:', error)
      toast.error('Failed to delete timeout configuration')
    } finally {
      setDeleteConfigId(null)
    }
  }

  const resetForm = () => {
    setEditingConfig(null)
    setShowCreateForm(false)
    setFormData({
      role: '',
      session_timeout_minutes: 120,
      auto_logout_timeout_minutes: 15,
      warning_time_minutes: 5,
      is_global: false,
      remember_me_duration_hours: 168,
      enable_fullscreen_expiry_warning: true,
    })
  }

  const formatDuration = (minutes: number) => {
    const hours = Math.floor(minutes / 60)
    const mins = minutes % 60
    if (hours > 0) {
      return `${hours}h ${mins}m`
    }
    return `${mins}m`
  }

  if (isLoading) {
    return <div>Loading timeout configurations...</div>
  }

  return (
    <div className='space-y-6'>
      {/* Global Settings Overview */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center space-x-2'>
            <IconGlobe className='h-5 w-5' />
            <span>Global Timeout Settings</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className='grid gap-4 md:grid-cols-3'>
            <div className='space-y-2'>
              <Label className='text-sm font-medium'>
                Default Session Timeout
              </Label>
              <div className='text-2xl font-bold'>2h 0m</div>
              <p className='text-muted-foreground text-xs'>
                Maximum session duration before forced logout
              </p>
            </div>
            <div className='space-y-2'>
              <Label className='text-sm font-medium'>Auto Logout Warning</Label>
              <div className='text-2xl font-bold'>15m</div>
              <p className='text-muted-foreground text-xs'>
                Inactivity timeout before auto logout
              </p>
            </div>
            <div className='space-y-2'>
              <Label className='text-sm font-medium'>Warning Time</Label>
              <div className='text-2xl font-bold'>5m</div>
              <p className='text-muted-foreground text-xs'>
                Warning time before logout
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Role-Based Configurations */}
      <Card>
        <CardHeader className='flex flex-row items-center justify-between'>
          <div>
            <CardTitle className='flex items-center space-x-2'>
              <IconUsers className='h-5 w-5' />
              <span>Role-Based Timeout Configurations</span>
            </CardTitle>
            <p className='text-muted-foreground mt-1 text-sm'>
              Configure different timeout settings for each user role
            </p>
          </div>
          <PermissionGuard resource='sessions' action='manage'>
            <Button onClick={() => setShowCreateForm(true)} size='sm'>
              <IconPlus className='mr-2 h-4 w-4' />
              Add Configuration
            </Button>
          </PermissionGuard>
        </CardHeader>
        <CardContent>
          <div className='space-y-4'>
            {configs.map((config) => (
              <div
                key={config.id}
                className='flex items-center justify-between rounded-lg border p-4'
              >
                <div className='flex items-center space-x-4'>
                  <Badge variant={config.is_global ? 'default' : 'secondary'}>
                    {config.is_global ? 'Global' : config.role}
                  </Badge>
                  <div className='grid grid-cols-3 gap-x-4 gap-y-1 text-sm'>
                    <div>
                      <span className='text-muted-foreground'>Session:</span>
                      <span className='ml-2 font-medium'>
                        {formatDuration(config.session_timeout_minutes)}
                      </span>
                    </div>
                    <div>
                      <span className='text-muted-foreground'>
                        Auto Logout:
                      </span>
                      <span className='ml-2 font-medium'>
                        {formatDuration(config.auto_logout_timeout_minutes)}
                      </span>
                    </div>
                    <div>
                      <span className='text-muted-foreground'>Warning:</span>
                      <span className='ml-2 font-medium'>
                        {formatDuration(config.warning_time_minutes)}
                      </span>
                    </div>
                    <div>
                      <span className='text-muted-foreground'>
                        Remember Me:
                      </span>
                      <span className='ml-2 font-medium'>
                        {config.remember_me_duration_hours ?? 168}h
                      </span>
                    </div>
                    <div>
                      <span className='text-muted-foreground'>
                        Fullscreen Warning:
                      </span>
                      <span className='ml-2 font-medium'>
                        {(config.enable_fullscreen_expiry_warning ?? true)
                          ? 'On'
                          : 'Off'}
                      </span>
                    </div>
                  </div>
                </div>
                <PermissionGuard resource='sessions' action='manage'>
                  <div className='flex items-center space-x-2'>
                    <Button
                      variant='ghost'
                      size='sm'
                      onClick={() => handleEdit(config)}
                    >
                      <IconEdit className='h-4 w-4' />
                    </Button>
                    <Button
                      variant='ghost'
                      size='sm'
                      onClick={() => setDeleteConfigId(config.id!)}
                    >
                      <IconTrash className='h-4 w-4' />
                    </Button>
                  </div>
                </PermissionGuard>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Create/Edit Form Dialog */}
      {showCreateForm && (
        <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/50'>
          <Card className='w-full max-w-md'>
            <CardHeader>
              <CardTitle>
                {editingConfig ? 'Edit' : 'Create'} Timeout Configuration
              </CardTitle>
            </CardHeader>
            <CardContent className='space-y-4'>
              <div className='space-y-2'>
                <Label htmlFor='role'>Role</Label>
                <Select
                  value={formData.role}
                  onValueChange={(value) =>
                    setFormData({ ...formData, role: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder='Select role' />
                  </SelectTrigger>
                  <SelectContent>
                    {availableRoles.map((role) => (
                      <SelectItem key={role.name} value={role.name}>
                        {role.display_name}
                      </SelectItem>
                    ))}
                    {availableRoles.length === 0 && (
                      <SelectItem value='' disabled>
                        Loading roles...
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>

              <div className='space-y-2'>
                <Label htmlFor='session_timeout'>
                  Session Timeout (minutes)
                </Label>
                <Input
                  id='session_timeout'
                  type='number'
                  value={formData.session_timeout_minutes}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      session_timeout_minutes: parseInt(e.target.value) || 0,
                    })
                  }
                />
              </div>

              <div className='space-y-2'>
                <Label htmlFor='auto_logout'>
                  Auto Logout Timeout (minutes)
                </Label>
                <Input
                  id='auto_logout'
                  type='number'
                  value={formData.auto_logout_timeout_minutes}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      auto_logout_timeout_minutes:
                        parseInt(e.target.value) || 0,
                    })
                  }
                />
              </div>

              <div className='space-y-2'>
                <Label htmlFor='warning_time'>Warning Time (minutes)</Label>
                <Input
                  id='warning_time'
                  type='number'
                  value={formData.warning_time_minutes}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      warning_time_minutes: parseInt(e.target.value) || 0,
                    })
                  }
                />
              </div>

              <div className='space-y-2'>
                <Label htmlFor='remember_me_duration'>
                  Remember Me Duration (hours)
                </Label>
                <Input
                  id='remember_me_duration'
                  type='number'
                  min={1}
                  value={formData.remember_me_duration_hours}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      remember_me_duration_hours:
                        parseInt(e.target.value) || 168,
                    })
                  }
                />
                <p className='text-muted-foreground text-xs'>
                  How long a "Remember Me" session stays active (default 168h =
                  7 days)
                </p>
              </div>

              <div className='flex items-center space-x-2'>
                <Switch
                  id='enable_fullscreen_expiry_warning'
                  checked={formData.enable_fullscreen_expiry_warning}
                  onCheckedChange={(checked) =>
                    setFormData({
                      ...formData,
                      enable_fullscreen_expiry_warning: checked,
                    })
                  }
                />
                <Label htmlFor='enable_fullscreen_expiry_warning'>
                  Full-Screen Expiry Warning
                </Label>
                <p className='text-muted-foreground ml-2 text-xs'>
                  Show a full-screen modal when session is about to expire
                </p>
              </div>

              <div className='flex items-center space-x-2'>
                <Switch
                  id='is_global'
                  checked={formData.is_global}
                  onCheckedChange={(checked) =>
                    setFormData({ ...formData, is_global: checked })
                  }
                />
                <Label htmlFor='is_global'>Global Configuration</Label>
              </div>

              <div className='flex justify-end space-x-2 pt-4'>
                <Button variant='outline' onClick={resetForm}>
                  Cancel
                </Button>
                <Button onClick={handleSave}>
                  {editingConfig ? 'Update' : 'Create'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={!!deleteConfigId}
        onOpenChange={() => setDeleteConfigId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Timeout Configuration</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this timeout configuration? This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
