import { useState, useEffect, useMemo } from 'react'
import {
  Search,
  Shield,
  Menu,
  Layout,
  Sparkles,
  Check,
  Loader2,
  Save,
  Star,
  BookTemplate,
} from 'lucide-react'
import { toast } from 'sonner'
import { logger } from '@/lib/utils/logger'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import type { RoleTemplate } from './types'

export interface RoleTemplateSelectorProps {
  onTemplateSelect: (template: RoleTemplate) => void
  currentPermissions?: string[]
  currentNavigationItems?: string[]
  currentTabPermissions?: string[]
  showSaveAsTemplate?: boolean
  onSaveAsTemplate?: (template: Omit<RoleTemplate, 'id'>) => void
}

// Default templates - these could be loaded from database in the future
const DEFAULT_TEMPLATES: RoleTemplate[] = [
  {
    id: 'template-read-only',
    name: 'read_only',
    displayName: 'Read-Only User',
    description:
      'View-only access to most resources without modification privileges',
    permissions: [], // Will be populated with read permissions
    navigationItems: [], // Basic navigation
    tabPermissions: [], // View tabs only
    category: 'system',
  },
  {
    id: 'template-standard-user',
    name: 'standard_user',
    displayName: 'Standard User',
    description:
      'Regular user with create, read, and update access to assigned resources',
    permissions: [], // CRUD except delete
    navigationItems: [],
    tabPermissions: [],
    category: 'system',
  },
  {
    id: 'template-team-lead',
    name: 'team_lead',
    displayName: 'Team Lead',
    description:
      'Team management with oversight capabilities and reporting access',
    permissions: [],
    navigationItems: [],
    tabPermissions: [],
    category: 'system',
  },
  {
    id: 'template-warehouse-associate',
    name: 'warehouse_associate',
    displayName: 'Warehouse Associate',
    description: 'Inventory and logistics operations with limited admin access',
    permissions: [],
    navigationItems: [],
    tabPermissions: [],
    category: 'system',
  },
  {
    id: 'template-department-manager',
    name: 'department_manager',
    displayName: 'Department Manager',
    description: 'Full department oversight with user management and reporting',
    permissions: [],
    navigationItems: [],
    tabPermissions: [],
    category: 'system',
  },
  {
    id: 'template-admin',
    name: 'admin_template',
    displayName: 'Administrator',
    description: 'Full administrative access with user and role management',
    permissions: [], // Full CRUD + manage
    navigationItems: [],
    tabPermissions: [],
    category: 'system',
  },
]

export function RoleTemplateSelector({
  onTemplateSelect,
  currentPermissions = [],
  currentNavigationItems = [],
  currentTabPermissions = [],
  showSaveAsTemplate = false,
  onSaveAsTemplate,
}: RoleTemplateSelectorProps) {
  const [templates, _setTemplates] = useState<RoleTemplate[]>(DEFAULT_TEMPLATES)
  const [customTemplates, setCustomTemplates] = useState<RoleTemplate[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState<RoleTemplate | null>(
    null
  )
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [saveTemplateName, setSaveTemplateName] = useState('')
  const [saveTemplateDescription, setSaveTemplateDescription] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  // Load custom templates from localStorage (could be database in future)
  useEffect(() => {
    try {
      const stored = localStorage.getItem('roleTemplates')
      if (stored) {
        const parsed = JSON.parse(stored) as RoleTemplate[]
        setCustomTemplates(parsed)
      }
    } catch (error) {
      logger.error('Error loading custom templates:', error)
    }
  }, [])

  // All templates combined
  const allTemplates = useMemo(() => {
    return [...templates, ...customTemplates]
  }, [templates, customTemplates])

  // Filter templates based on search
  const filteredTemplates = useMemo(() => {
    if (!searchQuery.trim()) return allTemplates

    const query = searchQuery.toLowerCase()
    return allTemplates.filter(
      (template) =>
        template.name.toLowerCase().includes(query) ||
        template.displayName.toLowerCase().includes(query) ||
        template.description.toLowerCase().includes(query)
    )
  }, [allTemplates, searchQuery])

  // Group templates by category
  const groupedTemplates = useMemo(() => {
    return {
      system: filteredTemplates.filter((t) => t.category === 'system'),
      custom: filteredTemplates.filter((t) => t.category === 'custom'),
    }
  }, [filteredTemplates])

  // Handle template selection
  const handleSelectTemplate = (template: RoleTemplate) => {
    setSelectedTemplate(template)
  }

  // Apply selected template
  const handleApplyTemplate = () => {
    if (selectedTemplate) {
      onTemplateSelect(selectedTemplate)
      toast.success(`Applied "${selectedTemplate.displayName}" template`)
    }
  }

  // Save current configuration as template
  const handleSaveAsTemplate = async () => {
    if (!saveTemplateName.trim()) {
      toast.error('Please enter a template name')
      return
    }

    setIsLoading(true)
    try {
      const newTemplate: RoleTemplate = {
        id: `custom-${Date.now()}`,
        name: saveTemplateName.toLowerCase().replace(/\s+/g, '_'),
        displayName: saveTemplateName,
        description: saveTemplateDescription,
        permissions: currentPermissions,
        navigationItems: currentNavigationItems,
        tabPermissions: currentTabPermissions,
        category: 'custom',
      }

      // Save to localStorage (or database in future)
      const updatedCustomTemplates = [...customTemplates, newTemplate]
      localStorage.setItem(
        'roleTemplates',
        JSON.stringify(updatedCustomTemplates)
      )
      setCustomTemplates(updatedCustomTemplates)

      // Call optional callback
      if (onSaveAsTemplate) {
        onSaveAsTemplate(newTemplate)
      }

      toast.success(`Template "${saveTemplateName}" saved successfully`)
      setShowSaveDialog(false)
      setSaveTemplateName('')
      setSaveTemplateDescription('')
    } catch (error) {
      logger.error('Error saving template:', error)
      toast.error('Failed to save template')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className='space-y-4'>
      {/* Header with search and save button */}
      <div className='flex flex-col gap-3 sm:flex-row'>
        <div className='relative flex-1'>
          <Search className='text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2' />
          <Input
            placeholder='Search templates...'
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className='pl-9'
          />
        </div>

        {showSaveAsTemplate && (
          <Button variant='outline' onClick={() => setShowSaveDialog(true)}>
            <Save className='mr-2 h-4 w-4' />
            Save as Template
          </Button>
        )}
      </div>

      {/* Templates List */}
      <ScrollArea className='h-[400px] pr-4'>
        <div className='space-y-6'>
          {/* System Templates */}
          {groupedTemplates.system.length > 0 && (
            <div className='space-y-3'>
              <div className='flex items-center gap-2'>
                <BookTemplate className='text-muted-foreground h-4 w-4' />
                <h3 className='text-sm font-medium'>System Templates</h3>
                <Badge variant='outline' className='text-xs'>
                  {groupedTemplates.system.length}
                </Badge>
              </div>

              <div className='grid grid-cols-1 gap-3 md:grid-cols-2'>
                {groupedTemplates.system.map((template) => (
                  <TemplateCard
                    key={template.id}
                    template={template}
                    isSelected={selectedTemplate?.id === template.id}
                    onSelect={() => handleSelectTemplate(template)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Custom Templates */}
          {groupedTemplates.custom.length > 0 && (
            <div className='space-y-3'>
              <div className='flex items-center gap-2'>
                <Star className='h-4 w-4 text-yellow-500' />
                <h3 className='text-sm font-medium'>Custom Templates</h3>
                <Badge variant='outline' className='text-xs'>
                  {groupedTemplates.custom.length}
                </Badge>
              </div>

              <div className='grid grid-cols-1 gap-3 md:grid-cols-2'>
                {groupedTemplates.custom.map((template) => (
                  <TemplateCard
                    key={template.id}
                    template={template}
                    isSelected={selectedTemplate?.id === template.id}
                    onSelect={() => handleSelectTemplate(template)}
                    isCustom
                  />
                ))}
              </div>
            </div>
          )}

          {filteredTemplates.length === 0 && (
            <div className='text-muted-foreground py-12 text-center'>
              <Search className='mx-auto mb-2 h-8 w-8 opacity-50' />
              <p>No templates match your search</p>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Selected Template Actions */}
      {selectedTemplate && (
        <Card className='bg-primary/5 border-primary/20'>
          <CardContent className='flex items-center justify-between py-3'>
            <div className='flex items-center gap-3'>
              <Sparkles className='text-primary h-5 w-5' />
              <div>
                <p className='font-medium'>{selectedTemplate.displayName}</p>
                <p className='text-muted-foreground text-sm'>Ready to apply</p>
              </div>
            </div>
            <Button onClick={handleApplyTemplate}>
              <Check className='mr-2 h-4 w-4' />
              Apply Template
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Save as Template Dialog */}
      <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save as Template</DialogTitle>
            <DialogDescription>
              Save the current configuration as a reusable template for future
              roles.
            </DialogDescription>
          </DialogHeader>

          <div className='space-y-4'>
            <div className='space-y-2'>
              <Label htmlFor='templateName'>Template Name</Label>
              <Input
                id='templateName'
                placeholder='e.g., Customer Service Representative'
                value={saveTemplateName}
                onChange={(e) => setSaveTemplateName(e.target.value)}
              />
            </div>

            <div className='space-y-2'>
              <Label htmlFor='templateDescription'>Description</Label>
              <Textarea
                id='templateDescription'
                placeholder='Describe what this template is for...'
                value={saveTemplateDescription}
                onChange={(e) => setSaveTemplateDescription(e.target.value)}
              />
            </div>

            <div className='text-muted-foreground flex items-center gap-4 text-sm'>
              <div className='flex items-center gap-1'>
                <Shield className='h-4 w-4' />
                <span>{currentPermissions.length} permissions</span>
              </div>
              <div className='flex items-center gap-1'>
                <Menu className='h-4 w-4' />
                <span>{currentNavigationItems.length} nav items</span>
              </div>
              <div className='flex items-center gap-1'>
                <Layout className='h-4 w-4' />
                <span>{currentTabPermissions.length} tabs</span>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant='outline' onClick={() => setShowSaveDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveAsTemplate} disabled={isLoading}>
              {isLoading && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
              Save Template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// Template Card Component
interface TemplateCardProps {
  template: RoleTemplate
  isSelected: boolean
  onSelect: () => void
  isCustom?: boolean
}

function TemplateCard({
  template,
  isSelected,
  onSelect,
  isCustom,
}: TemplateCardProps) {
  return (
    <Card
      className={`cursor-pointer transition-all ${
        isSelected
          ? 'ring-primary border-primary ring-2'
          : 'hover:border-muted-foreground/50'
      } `}
      onClick={onSelect}
    >
      <CardHeader className='pb-2'>
        <div className='flex items-start justify-between'>
          <div>
            <CardTitle className='flex items-center gap-2 text-sm'>
              {template.displayName}
              {isCustom && (
                <Star className='h-3 w-3 fill-yellow-500 text-yellow-500' />
              )}
            </CardTitle>
            <CardDescription className='mt-1 text-xs'>
              {template.description}
            </CardDescription>
          </div>
          {isSelected && (
            <div className='bg-primary text-primary-foreground flex h-5 w-5 items-center justify-center rounded-full'>
              <Check className='h-3 w-3' />
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className='pt-0'>
        <div className='text-muted-foreground flex items-center gap-3 text-xs'>
          <div className='flex items-center gap-1'>
            <Shield className='h-3 w-3' />
            <span>{template.permissions.length || 'Varies'}</span>
          </div>
          <div className='flex items-center gap-1'>
            <Menu className='h-3 w-3' />
            <span>{template.navigationItems.length || 'Varies'}</span>
          </div>
          <div className='flex items-center gap-1'>
            <Layout className='h-3 w-3' />
            <span>{template.tabPermissions.length || 'Varies'}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
