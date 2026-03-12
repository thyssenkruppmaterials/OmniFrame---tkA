import { useState } from 'react'
import {
  IconMail,
  IconSend,
  IconServer,
  IconTemplate,
} from '@tabler/icons-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
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
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'

export function EmailSettings() {
  const [settings, setSettings] = useState({
    enabled: true,
    provider: 'smtp',
    smtpHost: 'smtp.gmail.com',
    smtpPort: 587,
    smtpSecure: true,
    username: '',
    password: '',
    fromEmail: 'noreply@company.com',
    fromName: 'OmniFrame System',
    replyTo: 'support@company.com',
    maxRetries: 3,
    retryDelay: 5000,
    rateLimit: 100,
    templates: {
      welcome: { enabled: true, subject: 'Welcome to OmniFrame' },
      passwordReset: { enabled: true, subject: 'Password Reset Request' },
      notification: { enabled: true, subject: 'System Notification' },
      invoice: { enabled: true, subject: 'Invoice Generated' },
    },
  })

  const handleSettingChange = (
    key: string,
    value: string | number | boolean
  ) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
  }

  const handleTemplateChange = (
    template: keyof typeof settings.templates,
    key: string,
    value: string | number | boolean
  ) => {
    setSettings((prev) => ({
      ...prev,
      templates: {
        ...prev.templates,
        [template]: { ...prev.templates[template], [key]: value },
      },
    }))
  }

  const testEmailConnection = () => {
    toast.loading('Testing email connection...', { id: 'email-test' })

    // Simulate API call
    setTimeout(() => {
      const success = Math.random() > 0.3 // 70% success rate for demo
      if (success) {
        toast.success('Email connection test successful!', { id: 'email-test' })
      } else {
        toast.error('Email connection test failed. Check your settings.', {
          id: 'email-test',
        })
      }
    }, 2000)
  }

  const sendTestEmail = () => {
    toast.loading('Sending test email...', { id: 'email-send' })

    // Simulate API call
    setTimeout(() => {
      toast.success('Test email sent successfully!', { id: 'email-send' })
    }, 1500)
  }

  const saveSettings = () => {
    localStorage.setItem('email-settings', JSON.stringify(settings))
    toast.success('Email settings saved successfully!')
  }

  return (
    <div className='space-y-6'>
      {/* SMTP Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <IconServer size={20} />
            SMTP Configuration
          </CardTitle>
          <CardDescription>
            Configure SMTP server settings for outgoing emails.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='flex items-center justify-between'>
            <div className='space-y-1'>
              <Label className='text-sm font-medium'>
                Enable Email Service
              </Label>
              <p className='text-muted-foreground text-xs'>
                Master switch for all email functionality
              </p>
            </div>
            <Switch
              checked={settings.enabled}
              onCheckedChange={(checked) =>
                handleSettingChange('enabled', checked)
              }
            />
          </div>

          <Separator />

          <div className='grid gap-4 md:grid-cols-2'>
            <div className='space-y-2'>
              <Label>SMTP Host</Label>
              <Input
                value={settings.smtpHost}
                onChange={(e) =>
                  handleSettingChange('smtpHost', e.target.value)
                }
                placeholder='smtp.gmail.com'
              />
            </div>
            <div className='space-y-2'>
              <Label>SMTP Port</Label>
              <Input
                type='number'
                value={settings.smtpPort}
                onChange={(e) =>
                  handleSettingChange('smtpPort', parseInt(e.target.value))
                }
                placeholder='587'
              />
            </div>
          </div>

          <div className='grid gap-4 md:grid-cols-2'>
            <div className='space-y-2'>
              <Label>Username</Label>
              <Input
                value={settings.username}
                onChange={(e) =>
                  handleSettingChange('username', e.target.value)
                }
                placeholder='your-email@domain.com'
              />
            </div>
            <div className='space-y-2'>
              <Label>Password</Label>
              <Input
                type='password'
                value={settings.password}
                onChange={(e) =>
                  handleSettingChange('password', e.target.value)
                }
                placeholder='••••••••'
              />
            </div>
          </div>

          <div className='flex items-center space-x-2'>
            <Switch
              checked={settings.smtpSecure}
              onCheckedChange={(checked) =>
                handleSettingChange('smtpSecure', checked)
              }
            />
            <Label className='text-sm'>Use TLS/SSL encryption</Label>
          </div>
        </CardContent>
      </Card>

      {/* Sender Settings */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <IconMail size={20} />
            Sender Configuration
          </CardTitle>
          <CardDescription>
            Configure default sender information and email behavior.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='grid gap-4 md:grid-cols-2'>
            <div className='space-y-2'>
              <Label>From Email</Label>
              <Input
                value={settings.fromEmail}
                onChange={(e) =>
                  handleSettingChange('fromEmail', e.target.value)
                }
                placeholder='noreply@company.com'
              />
            </div>
            <div className='space-y-2'>
              <Label>From Name</Label>
              <Input
                value={settings.fromName}
                onChange={(e) =>
                  handleSettingChange('fromName', e.target.value)
                }
                placeholder='OmniFrame System'
              />
            </div>
          </div>

          <div className='space-y-2'>
            <Label>Reply-To Email</Label>
            <Input
              value={settings.replyTo}
              onChange={(e) => handleSettingChange('replyTo', e.target.value)}
              placeholder='support@company.com'
            />
          </div>

          <div className='grid gap-4 md:grid-cols-3'>
            <div className='space-y-2'>
              <Label>Max Retries</Label>
              <Input
                type='number'
                value={settings.maxRetries}
                onChange={(e) =>
                  handleSettingChange('maxRetries', parseInt(e.target.value))
                }
                min={0}
                max={10}
              />
            </div>
            <div className='space-y-2'>
              <Label>Retry Delay (ms)</Label>
              <Input
                type='number'
                value={settings.retryDelay}
                onChange={(e) =>
                  handleSettingChange('retryDelay', parseInt(e.target.value))
                }
                min={1000}
                step={1000}
              />
            </div>
            <div className='space-y-2'>
              <Label>Rate Limit (per hour)</Label>
              <Input
                type='number'
                value={settings.rateLimit}
                onChange={(e) =>
                  handleSettingChange('rateLimit', parseInt(e.target.value))
                }
                min={1}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Email Templates */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <IconTemplate size={20} />
            Email Templates
          </CardTitle>
          <CardDescription>
            Configure email templates for automated messages.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          {Object.entries(settings.templates).map(([templateKey, template]) => (
            <div key={templateKey} className='space-y-3'>
              <div className='flex items-center justify-between'>
                <div className='flex items-center gap-3'>
                  <Badge variant='outline' className='capitalize'>
                    {templateKey.replace(/([A-Z])/g, ' $1').trim()}
                  </Badge>
                  <Label className='text-sm font-medium'>Subject Line</Label>
                </div>
                <Switch
                  checked={template.enabled}
                  onCheckedChange={(checked) =>
                    handleTemplateChange(
                      templateKey as keyof typeof settings.templates,
                      'enabled',
                      checked
                    )
                  }
                />
              </div>

              {template.enabled && (
                <Input
                  value={template.subject}
                  onChange={(e) =>
                    handleTemplateChange(
                      templateKey as keyof typeof settings.templates,
                      'subject',
                      e.target.value
                    )
                  }
                  placeholder={`Enter subject for ${templateKey} emails`}
                  className='ml-4'
                />
              )}

              <Separator />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Testing */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <IconSend size={20} />
            Email Testing
          </CardTitle>
          <CardDescription>
            Test email configuration and send test messages.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='flex gap-2'>
            <Button
              variant='outline'
              onClick={testEmailConnection}
              disabled={!settings.enabled}
            >
              Test Connection
            </Button>
            <Button
              variant='outline'
              onClick={sendTestEmail}
              disabled={!settings.enabled}
            >
              Send Test Email
            </Button>
          </div>

          <div className='space-y-2'>
            <Label>Test Email Recipient</Label>
            <Input placeholder='test@example.com' />
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
