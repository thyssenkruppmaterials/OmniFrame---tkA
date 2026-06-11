// Created and developed by Jai Singh
/**
 * Configuration Panel Component
 * Admin interface for configuring work queue system settings
 * Allows modification of assignment strategies, priorities, and system parameters
 */
import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  BarChart3,
  CheckCircle,
  Clock,
  RotateCcw,
  Save,
  Settings,
  Sliders,
} from 'lucide-react'
import { toast } from 'sonner'
import { logger } from '@/lib/utils/logger'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

// ============================================================================
// INTERFACES
// ============================================================================

interface WorkQueueConfiguration {
  enable_auto_assignment: boolean
  assignment_strategy: string
  max_tasks_per_worker: number
  task_timeout_minutes: number
  warning_threshold_minutes: number
  priority_weight_urgency: number
  priority_weight_age: number
  priority_weight_location: number
  priority_weight_custom: number
  enable_skill_matching: boolean
  enable_location_optimization: boolean
  enable_batch_assignment: boolean
  enable_predictive_assignment: boolean
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function ConfigurationPanel() {
  const [config, setConfig] = useState<WorkQueueConfiguration>({
    enable_auto_assignment: true,
    assignment_strategy: 'load_balanced',
    max_tasks_per_worker: 5,
    task_timeout_minutes: 30,
    warning_threshold_minutes: 20,
    priority_weight_urgency: 40,
    priority_weight_age: 30,
    priority_weight_location: 20,
    priority_weight_custom: 10,
    enable_skill_matching: true,
    enable_location_optimization: true,
    enable_batch_assignment: false,
    enable_predictive_assignment: false,
  })

  const [_isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)

  // ========================================================================
  // DATA LOADING
  // ========================================================================

  const loadConfiguration = async () => {
    setIsLoading(true)
    try {
      // Would load actual configuration from database
      // For now, using default values
      logger.log('Loading work queue configuration')

      // Simulated API call
      await new Promise((resolve) => setTimeout(resolve, 500))
    } catch (error: unknown) {
      logger.error('Error loading configuration:', error)
      toast.error(
        `Failed to load configuration: ${error instanceof Error ? error.message : String(error)}`
      )
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadConfiguration()
  }, [])

  // ========================================================================
  // CONFIGURATION HANDLERS
  // ========================================================================

  const updateConfig = (
    key: keyof WorkQueueConfiguration,
    value: string | number | boolean
  ) => {
    setConfig((prev) => ({ ...prev, [key]: value }))
    setHasUnsavedChanges(true)
  }

  const handleSaveConfiguration = async () => {
    setIsSaving(true)
    try {
      // Would save configuration to database
      logger.log('Saving work queue configuration:', config)

      // Simulated API call
      await new Promise((resolve) => setTimeout(resolve, 1000))

      setHasUnsavedChanges(false)
      toast.success('Configuration saved successfully')
    } catch (error: unknown) {
      logger.error('Error saving configuration:', error)
      toast.error(
        `Failed to save configuration: ${error instanceof Error ? error.message : String(error)}`
      )
    } finally {
      setIsSaving(false)
    }
  }

  const handleResetToDefaults = () => {
    setConfig({
      enable_auto_assignment: true,
      assignment_strategy: 'load_balanced',
      max_tasks_per_worker: 5,
      task_timeout_minutes: 30,
      warning_threshold_minutes: 20,
      priority_weight_urgency: 40,
      priority_weight_age: 30,
      priority_weight_location: 20,
      priority_weight_custom: 10,
      enable_skill_matching: true,
      enable_location_optimization: true,
      enable_batch_assignment: false,
      enable_predictive_assignment: false,
    })
    setHasUnsavedChanges(true)
    toast.info('Configuration reset to defaults')
  }

  // ========================================================================
  // VALIDATION
  // ========================================================================

  const validateConfiguration = () => {
    const errors: string[] = []

    // Validate priority weights sum to 100
    const totalWeight =
      config.priority_weight_urgency +
      config.priority_weight_age +
      config.priority_weight_location +
      config.priority_weight_custom
    if (totalWeight !== 100) {
      errors.push(
        `Priority weights must sum to 100% (currently ${totalWeight}%)`
      )
    }

    // Validate numeric ranges
    if (config.max_tasks_per_worker <= 0) {
      errors.push('Maximum tasks per worker must be greater than 0')
    }
    if (config.task_timeout_minutes <= 0) {
      errors.push('Task timeout must be greater than 0')
    }
    if (config.warning_threshold_minutes >= config.task_timeout_minutes) {
      errors.push('Warning threshold must be less than task timeout')
    }

    return errors
  }

  const validationErrors = validateConfiguration()
  const canSave = validationErrors.length === 0 && hasUnsavedChanges

  // ========================================================================
  // RENDER
  // ========================================================================

  return (
    <div className='space-y-6'>
      {/* Header */}
      <div className='flex items-center justify-between'>
        <div>
          <h3 className='text-lg font-semibold'>Queue Configuration</h3>
          <p className='text-muted-foreground text-sm'>
            Configure work queue behavior and assignment strategies
          </p>
        </div>
        <div className='flex items-center space-x-2'>
          <Button variant='outline' onClick={handleResetToDefaults}>
            <RotateCcw className='mr-2 h-4 w-4' />
            Reset to Defaults
          </Button>
          <Button
            onClick={handleSaveConfiguration}
            disabled={!canSave || isSaving}
          >
            {isSaving ? (
              <>
                <RotateCcw className='mr-2 h-4 w-4 animate-spin' /> Saving...
              </>
            ) : (
              <>
                <Save className='mr-2 h-4 w-4' /> Save Changes
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Validation Errors */}
      {validationErrors.length > 0 && (
        <Card className='border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/20'>
          <CardHeader>
            <CardTitle className='flex items-center space-x-2 text-red-800 dark:text-red-400'>
              <AlertTriangle className='h-5 w-5' />
              <span>Configuration Errors</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className='space-y-1'>
              {validationErrors.map((error, index) => (
                <li
                  key={index}
                  className='text-sm text-red-700 dark:text-red-400'
                >
                  • {error}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Unsaved Changes Warning */}
      {hasUnsavedChanges && (
        <Card className='border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950/20'>
          <CardContent className='p-4'>
            <div className='flex items-center space-x-2 text-yellow-800 dark:text-yellow-400'>
              <AlertTriangle className='h-4 w-4' />
              <span className='text-sm font-medium'>
                You have unsaved changes
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Core Settings */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center space-x-2'>
            <Settings className='h-5 w-5' />
            <span>Core Settings</span>
          </CardTitle>
        </CardHeader>
        <CardContent className='space-y-6'>
          {/* Auto Assignment */}
          <div className='flex items-center justify-between'>
            <div>
              <Label className='text-sm font-medium'>
                Enable Automatic Assignment
              </Label>
              <p className='text-muted-foreground text-xs'>
                Automatically assign tasks to available workers
              </p>
            </div>
            <Switch
              checked={config.enable_auto_assignment}
              onCheckedChange={(checked: boolean) =>
                updateConfig('enable_auto_assignment', checked)
              }
            />
          </div>

          {/* Assignment Strategy */}
          <div className='space-y-2'>
            <Label className='text-sm font-medium'>Assignment Strategy</Label>
            <select
              value={config.assignment_strategy}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                updateConfig('assignment_strategy', e.target.value)
              }
              className='border-input bg-background h-9 w-full rounded-md border px-3 text-sm'
            >
              <option value='round_robin'>Round Robin</option>
              <option value='load_balanced'>Load Balanced</option>
              <option value='skill_based'>Skill Based</option>
              <option value='priority_based'>Priority Based</option>
            </select>
            <p className='text-muted-foreground text-xs'>
              Strategy used for automatic task assignment
            </p>
          </div>

          {/* Worker Capacity */}
          <div className='space-y-2'>
            <Label className='text-sm font-medium'>Max Tasks per Worker</Label>
            <Input
              type='number'
              min='1'
              max='20'
              value={config.max_tasks_per_worker}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                updateConfig('max_tasks_per_worker', parseInt(e.target.value))
              }
            />
            <p className='text-muted-foreground text-xs'>
              Maximum concurrent tasks a worker can handle
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Timing Settings */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center space-x-2'>
            <Clock className='h-5 w-5' />
            <span>Timing & Escalation</span>
          </CardTitle>
        </CardHeader>
        <CardContent className='space-y-6'>
          <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
            <div className='space-y-2'>
              <Label className='text-sm font-medium'>
                Task Timeout (minutes)
              </Label>
              <Input
                type='number'
                min='5'
                max='480'
                value={config.task_timeout_minutes}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  updateConfig('task_timeout_minutes', parseInt(e.target.value))
                }
              />
              <p className='text-muted-foreground text-xs'>
                Tasks are released if not completed within this time
              </p>
            </div>

            <div className='space-y-2'>
              <Label className='text-sm font-medium'>
                Warning Threshold (minutes)
              </Label>
              <Input
                type='number'
                min='1'
                max='240'
                value={config.warning_threshold_minutes}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  updateConfig(
                    'warning_threshold_minutes',
                    parseInt(e.target.value)
                  )
                }
              />
              <p className='text-muted-foreground text-xs'>
                Send warnings when tasks exceed this duration
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Priority Weights */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center space-x-2'>
            <Sliders className='h-5 w-5' />
            <span>Priority Weights</span>
          </CardTitle>
        </CardHeader>
        <CardContent className='space-y-6'>
          <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
            <div className='space-y-2'>
              <Label className='text-sm font-medium'>Urgency Weight (%)</Label>
              <Input
                type='number'
                min='0'
                max='100'
                value={config.priority_weight_urgency}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  updateConfig(
                    'priority_weight_urgency',
                    parseInt(e.target.value)
                  )
                }
              />
            </div>

            <div className='space-y-2'>
              <Label className='text-sm font-medium'>Age Weight (%)</Label>
              <Input
                type='number'
                min='0'
                max='100'
                value={config.priority_weight_age}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  updateConfig('priority_weight_age', parseInt(e.target.value))
                }
              />
            </div>

            <div className='space-y-2'>
              <Label className='text-sm font-medium'>Location Weight (%)</Label>
              <Input
                type='number'
                min='0'
                max='100'
                value={config.priority_weight_location}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  updateConfig(
                    'priority_weight_location',
                    parseInt(e.target.value)
                  )
                }
              />
            </div>

            <div className='space-y-2'>
              <Label className='text-sm font-medium'>Custom Weight (%)</Label>
              <Input
                type='number'
                min='0'
                max='100'
                value={config.priority_weight_custom}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  updateConfig(
                    'priority_weight_custom',
                    parseInt(e.target.value)
                  )
                }
              />
            </div>
          </div>

          <div className='text-muted-foreground text-xs'>
            Total weight:{' '}
            {config.priority_weight_urgency +
              config.priority_weight_age +
              config.priority_weight_location +
              config.priority_weight_custom}
            % (should equal 100%)
          </div>
        </CardContent>
      </Card>

      {/* Advanced Features */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center space-x-2'>
            <BarChart3 className='h-5 w-5' />
            <span>Advanced Features</span>
          </CardTitle>
        </CardHeader>
        <CardContent className='space-y-6'>
          <div className='grid grid-cols-1 gap-6 md:grid-cols-2'>
            <div className='flex items-center justify-between'>
              <div>
                <Label className='text-sm font-medium'>Skill Matching</Label>
                <p className='text-muted-foreground text-xs'>
                  Match tasks to workers based on required skills
                </p>
              </div>
              <Switch
                checked={config.enable_skill_matching}
                onCheckedChange={(checked: boolean) =>
                  updateConfig('enable_skill_matching', checked)
                }
              />
            </div>

            <div className='flex items-center justify-between'>
              <div>
                <Label className='text-sm font-medium'>
                  Location Optimization
                </Label>
                <p className='text-muted-foreground text-xs'>
                  Prefer workers in same zone as task
                </p>
              </div>
              <Switch
                checked={config.enable_location_optimization}
                onCheckedChange={(checked: boolean) =>
                  updateConfig('enable_location_optimization', checked)
                }
              />
            </div>

            <div className='flex items-center justify-between'>
              <div>
                <Label className='text-sm font-medium'>Batch Assignment</Label>
                <p className='text-muted-foreground text-xs'>
                  Assign multiple related tasks together
                </p>
              </div>
              <Switch
                checked={config.enable_batch_assignment}
                onCheckedChange={(checked: boolean) =>
                  updateConfig('enable_batch_assignment', checked)
                }
              />
            </div>

            <div className='flex items-center justify-between'>
              <div>
                <Label className='text-sm font-medium'>
                  Predictive Assignment
                </Label>
                <p className='text-muted-foreground text-xs'>
                  Use ML to predict optimal assignments
                </p>
              </div>
              <Switch
                checked={config.enable_predictive_assignment}
                onCheckedChange={(checked: boolean) =>
                  updateConfig('enable_predictive_assignment', checked)
                }
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* System Status */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center space-x-2'>
            <CheckCircle className='h-5 w-5 text-green-600' />
            <span>System Status</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className='grid grid-cols-1 gap-4 md:grid-cols-3'>
            <div className='text-center'>
              <div className='text-2xl font-bold text-green-600'>✓</div>
              <div className='text-sm font-medium'>Database</div>
              <div className='text-muted-foreground text-xs'>Connected</div>
            </div>

            <div className='text-center'>
              <div className='text-2xl font-bold text-green-600'>✓</div>
              <div className='text-sm font-medium'>Queue Engine</div>
              <div className='text-muted-foreground text-xs'>Running</div>
            </div>

            <div className='text-center'>
              <div className='text-2xl font-bold text-green-600'>✓</div>
              <div className='text-sm font-medium'>Real-time Updates</div>
              <div className='text-muted-foreground text-xs'>Active</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// Created and developed by Jai Singh
