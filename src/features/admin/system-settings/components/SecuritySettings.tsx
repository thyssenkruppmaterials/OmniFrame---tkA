import { useState } from 'react'
import { IconEye, IconKey, IconLock, IconShield } from '@tabler/icons-react'
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
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'

export function SecuritySettings() {
  const [settings, setSettings] = useState({
    twoFactorRequired: false,
    passwordMinLength: 8,
    passwordRequireNumbers: true,
    passwordRequireSymbols: true,
    passwordRequireUppercase: true,
    sessionTimeout: 30,
    maxLoginAttempts: 5,
    lockoutDuration: 15,
    ipWhitelist: [],
    auditLogging: true,
    encryptionLevel: 'AES-256',
    sslRequired: true,
    corsEnabled: true,
    allowedOrigins: 'https://app.company.com',
    rateLimiting: true,
    maxRequestsPerMinute: 100,
  })

  const handleSettingChange = (
    key: string,
    value: string | number | boolean
  ) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
  }

  const saveSettings = () => {
    localStorage.setItem('security-settings', JSON.stringify(settings))
    toast.success('Security settings saved successfully!')
  }

  const generateSecurityReport = () => {
    toast.loading('Generating security report...', { id: 'security-report' })

    setTimeout(() => {
      toast.success('Security report generated and saved', {
        id: 'security-report',
      })
    }, 2000)
  }

  const getSecurityScore = () => {
    let score = 0
    if (settings.twoFactorRequired) score += 20
    if (settings.passwordMinLength >= 8) score += 15
    if (settings.passwordRequireNumbers) score += 10
    if (settings.passwordRequireSymbols) score += 10
    if (settings.passwordRequireUppercase) score += 10
    if (settings.sessionTimeout <= 60) score += 10
    if (settings.maxLoginAttempts <= 5) score += 10
    if (settings.auditLogging) score += 15

    return Math.min(100, score)
  }

  const securityScore = getSecurityScore()

  return (
    <div className='space-y-6'>
      {/* Security Overview */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <IconShield size={20} />
            Security Overview
          </CardTitle>
          <CardDescription>
            Current system security status and score.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='flex items-center justify-between'>
            <Label className='text-sm font-medium'>Security Score</Label>
            <Badge
              variant={
                securityScore >= 80
                  ? 'default'
                  : securityScore >= 60
                    ? 'secondary'
                    : 'destructive'
              }
            >
              {securityScore}/100
            </Badge>
          </div>

          <div className='space-y-2'>
            <div className='bg-secondary h-2 w-full rounded-full'>
              <div
                className={`h-2 rounded-full transition-all duration-300 ${
                  securityScore >= 80
                    ? 'bg-green-500'
                    : securityScore >= 60
                      ? 'bg-yellow-500'
                      : 'bg-red-500'
                }`}
                style={{ width: `${securityScore}%` }}
              />
            </div>
            <p className='text-muted-foreground text-xs'>
              {securityScore >= 80
                ? 'Excellent security posture'
                : securityScore >= 60
                  ? 'Good security - some improvements needed'
                  : 'Security improvements required'}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Authentication Settings */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <IconKey size={20} />
            Authentication & Access
          </CardTitle>
          <CardDescription>
            Configure authentication requirements and access controls.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='flex items-center justify-between'>
            <div className='space-y-1'>
              <Label className='text-sm font-medium'>
                Require Two-Factor Authentication
              </Label>
              <p className='text-muted-foreground text-xs'>
                Force 2FA for all user accounts
              </p>
            </div>
            <Switch
              checked={settings.twoFactorRequired}
              onCheckedChange={(checked) =>
                handleSettingChange('twoFactorRequired', checked)
              }
            />
          </div>

          <Separator />

          <div className='space-y-4'>
            <Label className='text-sm font-medium'>Password Requirements</Label>

            <div className='space-y-2'>
              <Label className='text-muted-foreground text-xs'>
                Minimum Length: {settings.passwordMinLength}
              </Label>
              <Slider
                value={[settings.passwordMinLength]}
                onValueChange={(value: number[]) =>
                  handleSettingChange('passwordMinLength', value[0])
                }
                max={20}
                min={6}
                step={1}
              />
            </div>

            <div className='grid gap-4 md:grid-cols-2'>
              {[
                { key: 'passwordRequireNumbers', label: 'Require Numbers' },
                { key: 'passwordRequireSymbols', label: 'Require Symbols' },
                { key: 'passwordRequireUppercase', label: 'Require Uppercase' },
                { key: 'sslRequired', label: 'Require SSL/HTTPS' },
              ].map((option) => (
                <div key={option.key} className='flex items-center space-x-2'>
                  <Switch
                    checked={
                      settings[option.key as keyof typeof settings] as boolean
                    }
                    onCheckedChange={(checked) =>
                      handleSettingChange(option.key, checked)
                    }
                  />
                  <Label className='text-sm'>{option.label}</Label>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Session Management */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <IconLock size={20} />
            Session & Login Security
          </CardTitle>
          <CardDescription>
            Configure session timeouts and login attempt policies.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='grid gap-4 md:grid-cols-2'>
            <div className='space-y-2'>
              <Label>Session Timeout (minutes)</Label>
              <Input
                type='number'
                value={settings.sessionTimeout}
                onChange={(e) =>
                  handleSettingChange(
                    'sessionTimeout',
                    parseInt(e.target.value)
                  )
                }
                min={5}
                max={1440}
              />
            </div>
            <div className='space-y-2'>
              <Label>Max Login Attempts</Label>
              <Input
                type='number'
                value={settings.maxLoginAttempts}
                onChange={(e) =>
                  handleSettingChange(
                    'maxLoginAttempts',
                    parseInt(e.target.value)
                  )
                }
                min={1}
                max={20}
              />
            </div>
          </div>

          <div className='space-y-2'>
            <Label>Account Lockout Duration (minutes)</Label>
            <Input
              type='number'
              value={settings.lockoutDuration}
              onChange={(e) =>
                handleSettingChange('lockoutDuration', parseInt(e.target.value))
              }
              min={1}
              max={1440}
            />
          </div>
        </CardContent>
      </Card>

      {/* Network Security */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <IconEye size={20} />
            Network & API Security
          </CardTitle>
          <CardDescription>
            Configure network access controls and API security settings.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='flex items-center justify-between'>
            <div className='space-y-1'>
              <Label className='text-sm font-medium'>
                Enable CORS Protection
              </Label>
              <p className='text-muted-foreground text-xs'>
                Control cross-origin resource sharing
              </p>
            </div>
            <Switch
              checked={settings.corsEnabled}
              onCheckedChange={(checked) =>
                handleSettingChange('corsEnabled', checked)
              }
            />
          </div>

          <div className='space-y-2'>
            <Label>Allowed Origins</Label>
            <Input
              value={settings.allowedOrigins}
              onChange={(e) =>
                handleSettingChange('allowedOrigins', e.target.value)
              }
              placeholder='https://app.company.com, https://admin.company.com'
            />
          </div>

          <div className='flex items-center justify-between'>
            <div className='space-y-1'>
              <Label className='text-sm font-medium'>
                Enable Rate Limiting
              </Label>
              <p className='text-muted-foreground text-xs'>
                Limit API requests per client
              </p>
            </div>
            <Switch
              checked={settings.rateLimiting}
              onCheckedChange={(checked) =>
                handleSettingChange('rateLimiting', checked)
              }
            />
          </div>

          {settings.rateLimiting && (
            <div className='space-y-2'>
              <Label>Max Requests per Minute</Label>
              <Input
                type='number'
                value={settings.maxRequestsPerMinute}
                onChange={(e) =>
                  handleSettingChange(
                    'maxRequestsPerMinute',
                    parseInt(e.target.value)
                  )
                }
                min={10}
                max={1000}
              />
            </div>
          )}

          <div className='flex items-center space-x-2'>
            <Switch
              checked={settings.auditLogging}
              onCheckedChange={(checked) =>
                handleSettingChange('auditLogging', checked)
              }
            />
            <Label className='text-sm'>Enable Security Audit Logging</Label>
          </div>
        </CardContent>
      </Card>

      {/* Security Actions */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <IconShield size={20} />
            Security Actions
          </CardTitle>
          <CardDescription>
            Generate reports and perform security-related actions.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='grid gap-2 md:grid-cols-3'>
            <Button variant='outline' onClick={generateSecurityReport}>
              Generate Security Report
            </Button>
            <Button
              variant='outline'
              onClick={() => toast.info('Security scan initiated')}
            >
              Run Security Scan
            </Button>
            <Button
              variant='outline'
              onClick={() => toast.info('Active sessions reviewed')}
            >
              Review Active Sessions
            </Button>
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
