import { useState } from 'react'
import {
  IconBell,
  IconLanguage,
  IconPalette,
  IconSettings,
  IconUser,
} from '@tabler/icons-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

export function UserDefaultsSettings() {
  const [defaults, setDefaults] = useState({
    theme: 'system',
    language: 'en',
    timezone: 'America/New_York',
    dateFormat: 'MM/dd/yyyy',
    timeFormat: '12-hour',
    currency: 'USD',
    defaultRole: 'user',
    emailNotifications: true,
    pushNotifications: false,
    smsNotifications: false,
    autoSave: true,
    sessionTimeout: 30,
    itemsPerPage: 20,
    defaultDashboard: 'overview',
    welcomeEmail: true,
    requirePasswordChange: false,
    twoFactorAuth: false,
    privacyMode: false,
  })

  const [welcomeEmailTemplate, setWelcomeEmailTemplate] = useState({
    subject: 'Welcome to OmniFrame..',
    content: `Hi {{firstName}},

Welcome to OmniFrame! We're excited to have you on board.

Your account has been successfully created. You can now access all the features and tools available to you.

If you have any questions, don't hesitate to reach out to our support team.

Best regards,
The OmniFrame Team`,
  })

  const handleDefaultChange = (
    key: keyof typeof defaults,
    value: string | number | boolean
  ) => {
    setDefaults((prev) => ({ ...prev, [key]: value }))
  }

  const handleTemplateChange = (key: string, value: string) => {
    setWelcomeEmailTemplate((prev) => ({ ...prev, [key]: value }))
  }

  const previewWelcomeEmail = () => {
    const preview = welcomeEmailTemplate.content.replace(
      '{{firstName}}',
      'John'
    )
    toast.info(`Preview: ${preview.substring(0, 100)}...`)
  }

  const saveSettings = () => {
    localStorage.setItem(
      'user-defaults',
      JSON.stringify({ defaults, welcomeEmailTemplate })
    )
    toast.success('User defaults saved successfully!')
  }

  const applyToExistingUsers = () => {
    toast.loading('Applying defaults to existing users...', {
      id: 'apply-defaults',
    })

    setTimeout(() => {
      toast.success('Defaults applied to 245 existing users', {
        id: 'apply-defaults',
      })
    }, 2000)
  }

  return (
    <div className='space-y-6'>
      {/* User Interface Defaults */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <IconPalette size={20} />
            Interface Defaults
          </CardTitle>
          <CardDescription>
            Set default interface preferences for new users.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='grid gap-4 md:grid-cols-2'>
            <div className='space-y-2'>
              <Label>Default Theme</Label>
              <Select
                value={defaults.theme}
                onValueChange={(value) => handleDefaultChange('theme', value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='light'>Light</SelectItem>
                  <SelectItem value='dark'>Dark</SelectItem>
                  <SelectItem value='system'>System</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className='space-y-2'>
              <Label>Default Language</Label>
              <Select
                value={defaults.language}
                onValueChange={(value) =>
                  handleDefaultChange('language', value)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='en'>English</SelectItem>
                  <SelectItem value='es'>Spanish</SelectItem>
                  <SelectItem value='fr'>French</SelectItem>
                  <SelectItem value='de'>German</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className='grid gap-4 md:grid-cols-2'>
            <div className='space-y-2'>
              <Label>Default Timezone</Label>
              <Select
                value={defaults.timezone}
                onValueChange={(value) =>
                  handleDefaultChange('timezone', value)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='America/New_York'>Eastern Time</SelectItem>
                  <SelectItem value='America/Chicago'>Central Time</SelectItem>
                  <SelectItem value='America/Denver'>Mountain Time</SelectItem>
                  <SelectItem value='America/Los_Angeles'>
                    Pacific Time
                  </SelectItem>
                  <SelectItem value='UTC'>UTC</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className='space-y-2'>
              <Label>Default Dashboard</Label>
              <Select
                value={defaults.defaultDashboard}
                onValueChange={(value) =>
                  handleDefaultChange('defaultDashboard', value)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='overview'>Overview</SelectItem>
                  <SelectItem value='analytics'>Analytics</SelectItem>
                  <SelectItem value='tasks'>Tasks</SelectItem>
                  <SelectItem value='reports'>Reports</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className='grid gap-4 md:grid-cols-3'>
            <div className='space-y-2'>
              <Label>Date Format</Label>
              <Select
                value={defaults.dateFormat}
                onValueChange={(value) =>
                  handleDefaultChange('dateFormat', value)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='MM/dd/yyyy'>MM/dd/yyyy</SelectItem>
                  <SelectItem value='dd/MM/yyyy'>dd/MM/yyyy</SelectItem>
                  <SelectItem value='yyyy-MM-dd'>yyyy-MM-dd</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className='space-y-2'>
              <Label>Time Format</Label>
              <Select
                value={defaults.timeFormat}
                onValueChange={(value) =>
                  handleDefaultChange('timeFormat', value)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='12-hour'>12-hour</SelectItem>
                  <SelectItem value='24-hour'>24-hour</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className='space-y-2'>
              <Label>Items Per Page</Label>
              <Input
                type='number'
                value={defaults.itemsPerPage}
                onChange={(e) =>
                  handleDefaultChange('itemsPerPage', parseInt(e.target.value))
                }
                min={10}
                max={100}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Account Defaults */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <IconUser size={20} />
            Account Defaults
          </CardTitle>
          <CardDescription>
            Configure default account settings and security options.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='grid gap-4 md:grid-cols-2'>
            <div className='space-y-2'>
              <Label>Default User Role</Label>
              <Select
                value={defaults.defaultRole}
                onValueChange={(value) =>
                  handleDefaultChange('defaultRole', value)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='user'>User</SelectItem>
                  <SelectItem value='moderator'>Moderator</SelectItem>
                  <SelectItem value='admin'>Admin</SelectItem>
                  <SelectItem value='viewer'>Viewer</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className='space-y-2'>
              <Label>Session Timeout (minutes)</Label>
              <Input
                type='number'
                value={defaults.sessionTimeout}
                onChange={(e) =>
                  handleDefaultChange(
                    'sessionTimeout',
                    parseInt(e.target.value)
                  )
                }
                min={5}
                max={480}
              />
            </div>
          </div>

          <div className='grid gap-4 md:grid-cols-2'>
            {[
              { key: 'welcomeEmail', label: 'Send Welcome Email' },
              {
                key: 'requirePasswordChange',
                label: 'Require Password Change on First Login',
              },
              {
                key: 'twoFactorAuth',
                label: 'Enable Two-Factor Authentication by Default',
              },
              { key: 'privacyMode', label: 'Enable Privacy Mode by Default' },
            ].map((option) => (
              <div
                key={option.key}
                className='flex items-center justify-between'
              >
                <Label className='text-sm font-medium'>{option.label}</Label>
                <Switch
                  checked={
                    defaults[option.key as keyof typeof defaults] as boolean
                  }
                  onCheckedChange={(checked) =>
                    handleDefaultChange(
                      option.key as keyof typeof defaults,
                      checked
                    )
                  }
                />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Notification Defaults */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <IconBell size={20} />
            Notification Defaults
          </CardTitle>
          <CardDescription>
            Set default notification preferences for new users.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='grid gap-4 md:grid-cols-3'>
            {[
              {
                key: 'emailNotifications',
                label: 'Email Notifications',
                description: 'System emails and alerts',
              },
              {
                key: 'pushNotifications',
                label: 'Push Notifications',
                description: 'Browser push notifications',
              },
              {
                key: 'smsNotifications',
                label: 'SMS Notifications',
                description: 'Text message alerts',
              },
            ].map((option) => (
              <div key={option.key} className='space-y-3 rounded-lg border p-4'>
                <div className='flex items-center justify-between'>
                  <Label className='text-sm font-medium'>{option.label}</Label>
                  <Switch
                    checked={
                      defaults[option.key as keyof typeof defaults] as boolean
                    }
                    onCheckedChange={(checked) =>
                      handleDefaultChange(
                        option.key as keyof typeof defaults,
                        checked
                      )
                    }
                  />
                </div>
                <p className='text-muted-foreground text-xs'>
                  {option.description}
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Welcome Email Template */}
      {defaults.welcomeEmail && (
        <Card>
          <CardHeader>
            <CardTitle className='flex items-center gap-2'>
              <IconLanguage size={20} />
              Welcome Email Template
            </CardTitle>
            <CardDescription>
              Customize the welcome email sent to new users.
            </CardDescription>
          </CardHeader>
          <CardContent className='space-y-4'>
            <div className='space-y-2'>
              <Label>Email Subject</Label>
              <Input
                value={welcomeEmailTemplate.subject}
                onChange={(e) =>
                  handleTemplateChange('subject', e.target.value)
                }
                placeholder='Welcome to OmniFrame'
              />
            </div>

            <div className='space-y-2'>
              <Label>Email Content</Label>
              <Textarea
                value={welcomeEmailTemplate.content}
                onChange={(e) =>
                  handleTemplateChange('content', e.target.value)
                }
                rows={8}
                placeholder='Enter welcome email content...'
              />
              <p className='text-muted-foreground text-xs'>
                Use {'{'}firstName{'}'} and {'{'}lastName{'}'} for
                personalization
              </p>
            </div>

            <Button variant='outline' onClick={previewWelcomeEmail}>
              Preview Email
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Application Defaults */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <IconSettings size={20} />
            Application Defaults
          </CardTitle>
          <CardDescription>
            Configure default application behavior and features.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='flex items-center justify-between'>
            <div className='space-y-1'>
              <Label className='text-sm font-medium'>
                Auto-save User Input
              </Label>
              <p className='text-muted-foreground text-xs'>
                Automatically save form input as users type
              </p>
            </div>
            <Switch
              checked={defaults.autoSave}
              onCheckedChange={(checked) =>
                handleDefaultChange('autoSave', checked)
              }
            />
          </div>

          <Separator />

          <div className='space-y-2'>
            <Label>Default Currency</Label>
            <Select
              value={defaults.currency}
              onValueChange={(value) => handleDefaultChange('currency', value)}
            >
              <SelectTrigger className='w-40'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='USD'>USD ($)</SelectItem>
                <SelectItem value='EUR'>EUR (€)</SelectItem>
                <SelectItem value='GBP'>GBP (£)</SelectItem>
                <SelectItem value='JPY'>JPY (¥)</SelectItem>
                <SelectItem value='CAD'>CAD (C$)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Apply Defaults</CardTitle>
          <CardDescription>
            Manage how defaults are applied to user accounts.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='flex items-center gap-4'>
            <Button onClick={applyToExistingUsers} variant='outline'>
              Apply to Existing Users
            </Button>
            <div className='text-muted-foreground text-sm'>
              This will update preferences for users who haven't customized
              their settings
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className='flex justify-end space-x-2'>
        <Button variant='outline'>Reset to Defaults</Button>
        <Button onClick={saveSettings}>Save Settings</Button>
      </div>
    </div>
  )
}
