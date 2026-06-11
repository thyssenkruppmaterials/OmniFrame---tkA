// Created and developed by Jai Singh
import React, { useState } from 'react'
import { Briefcase, Shield, Users, Eye, Settings, Zap } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PermissionGuard } from '@/components/auth/PermissionGuard'

interface RoleTemplate {
  id: string
  name: string
  display_name: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  color: string
  permissions: string[]
  features: Record<string, boolean>
  category: 'business' | 'technical' | 'system'
  difficulty: 'beginner' | 'intermediate' | 'advanced'
}

interface RoleTemplatesProps {
  onTemplateApply?: (template: RoleTemplate) => void
}

const ROLE_TEMPLATES: RoleTemplate[] = [
  {
    id: 'business-admin',
    name: 'business_admin',
    display_name: 'Business Administrator',
    description: 'Complete business operations management with user oversight',
    icon: Briefcase,
    color: 'bg-blue-500',
    permissions: [
      'users:*',
      'reports:read',
      'settings:update',
      'billing:manage',
    ],
    features: {
      user_management: true,
      billing_access: true,
      reports_access: true,
    },
    category: 'business',
    difficulty: 'intermediate',
  },
  {
    id: 'security-officer',
    name: 'security_officer',
    display_name: 'Security Officer',
    description: 'Security-focused role with audit and compliance access',
    icon: Shield,
    color: 'bg-red-500',
    permissions: ['audit:*', 'security:*', 'users:read', 'roles:read'],
    features: { audit_access: true, security_management: true },
    category: 'technical',
    difficulty: 'advanced',
  },
  {
    id: 'team-lead',
    name: 'team_lead',
    display_name: 'Team Lead',
    description: 'Team management with limited administrative functions',
    icon: Users,
    color: 'bg-green-500',
    permissions: ['users:read', 'users:update', 'tasks:*', 'reports:read'],
    features: { team_management: true, task_management: true },
    category: 'business',
    difficulty: 'beginner',
  },
  {
    id: 'content-manager',
    name: 'content_manager',
    display_name: 'Content Manager',
    description: 'Content creation and management with publishing rights',
    icon: Settings,
    color: 'bg-purple-500',
    permissions: ['content:*', 'media:*', 'categories:manage'],
    features: { content_management: true, media_management: true },
    category: 'business',
    difficulty: 'beginner',
  },
  {
    id: 'readonly-analyst',
    name: 'readonly_analyst',
    display_name: 'Read-Only Analyst',
    description: 'Analytics and reporting access without modification rights',
    icon: Eye,
    color: 'bg-gray-500',
    permissions: ['reports:read', 'analytics:read', 'data:read'],
    features: { analytics_access: true, export_data: true },
    category: 'business',
    difficulty: 'beginner',
  },
  {
    id: 'system-integrator',
    name: 'system_integrator',
    display_name: 'System Integrator',
    description: 'API and system integration management',
    icon: Zap,
    color: 'bg-orange-500',
    permissions: ['api:*', 'integrations:*', 'webhooks:manage', 'logs:read'],
    features: { api_access: true, integration_management: true },
    category: 'technical',
    difficulty: 'advanced',
  },
]

const CATEGORY_INFO = {
  business: { label: 'Business', color: 'bg-blue-100 text-blue-800' },
  technical: { label: 'Technical', color: 'bg-purple-100 text-purple-800' },
  system: { label: 'System', color: 'bg-gray-100 text-gray-800' },
}

const DIFFICULTY_INFO = {
  beginner: { label: 'Beginner', color: 'bg-green-100 text-green-800' },
  intermediate: {
    label: 'Intermediate',
    color: 'bg-yellow-100 text-yellow-800',
  },
  advanced: { label: 'Advanced', color: 'bg-red-100 text-red-800' },
}

export function RoleTemplates({ onTemplateApply }: RoleTemplatesProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [selectedDifficulty, setSelectedDifficulty] = useState<string>('all')

  const filteredTemplates = ROLE_TEMPLATES.filter((template) => {
    const categoryMatch =
      selectedCategory === 'all' || template.category === selectedCategory
    const difficultyMatch =
      selectedDifficulty === 'all' || template.difficulty === selectedDifficulty
    return categoryMatch && difficultyMatch
  })

  const handleApplyTemplate = (template: RoleTemplate) => {
    onTemplateApply?.(template)
  }

  return (
    <div className='space-y-6'>
      <div className='flex items-center justify-between'>
        <div>
          <h3 className='text-lg font-semibold'>Role Templates</h3>
          <p className='text-muted-foreground text-sm'>
            Pre-configured roles for common use cases
          </p>
        </div>

        <div className='flex gap-2'>
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className='rounded-md border px-3 py-1 text-sm'
          >
            <option value='all'>All Categories</option>
            <option value='business'>Business</option>
            <option value='technical'>Technical</option>
            <option value='system'>System</option>
          </select>

          <select
            value={selectedDifficulty}
            onChange={(e) => setSelectedDifficulty(e.target.value)}
            className='rounded-md border px-3 py-1 text-sm'
          >
            <option value='all'>All Levels</option>
            <option value='beginner'>Beginner</option>
            <option value='intermediate'>Intermediate</option>
            <option value='advanced'>Advanced</option>
          </select>
        </div>
      </div>

      <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3'>
        {filteredTemplates.map((template) => {
          const IconComponent = template.icon
          const categoryInfo = CATEGORY_INFO[template.category]
          const difficultyInfo = DIFFICULTY_INFO[template.difficulty]

          return (
            <Card
              key={template.id}
              className='relative overflow-hidden transition-shadow hover:shadow-lg'
            >
              <div
                className={`absolute top-0 right-0 left-0 h-1 ${template.color}`}
              />

              <CardHeader className='pb-3'>
                <div className='flex items-start justify-between'>
                  <div className='flex items-center gap-3'>
                    <div
                      className={`rounded-lg p-2 ${template.color} text-white`}
                    >
                      <IconComponent className='h-5 w-5' />
                    </div>
                    <div>
                      <CardTitle className='text-base'>
                        {template.display_name}
                      </CardTitle>
                      <div className='mt-1 flex gap-2'>
                        <Badge
                          variant='outline'
                          className={`text-xs ${categoryInfo.color}`}
                        >
                          {categoryInfo.label}
                        </Badge>
                        <Badge
                          variant='outline'
                          className={`text-xs ${difficultyInfo.color}`}
                        >
                          {difficultyInfo.label}
                        </Badge>
                      </div>
                    </div>
                  </div>
                </div>
              </CardHeader>

              <CardContent className='space-y-4'>
                <p className='text-muted-foreground text-sm'>
                  {template.description}
                </p>

                <div>
                  <h4 className='mb-2 text-sm font-medium'>Key Permissions:</h4>
                  <div className='flex flex-wrap gap-1'>
                    {template.permissions.slice(0, 3).map((perm) => (
                      <Badge key={perm} variant='secondary' className='text-xs'>
                        {perm}
                      </Badge>
                    ))}
                    {template.permissions.length > 3 && (
                      <Badge variant='outline' className='text-xs'>
                        +{template.permissions.length - 3} more
                      </Badge>
                    )}
                  </div>
                </div>

                <div>
                  <h4 className='mb-2 text-sm font-medium'>Features:</h4>
                  <div className='text-muted-foreground text-xs'>
                    {Object.entries(template.features)
                      .filter(([_, enabled]) => enabled)
                      .map(([feature]) => feature.replace('_', ' '))
                      .join(', ')}
                  </div>
                </div>

                <div className='flex gap-2 pt-2'>
                  <PermissionGuard resource='roles' action='create'>
                    <Button
                      size='sm'
                      onClick={() => handleApplyTemplate(template)}
                      className='flex-1'
                    >
                      Apply Template
                    </Button>
                  </PermissionGuard>
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={() => {
                      // Preview template details
                    }}
                  >
                    <Eye className='h-4 w-4' />
                  </Button>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {filteredTemplates.length === 0 && (
        <Card>
          <CardContent className='py-8 text-center'>
            <div className='text-muted-foreground'>
              No templates found matching your filters
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// Created and developed by Jai Singh
