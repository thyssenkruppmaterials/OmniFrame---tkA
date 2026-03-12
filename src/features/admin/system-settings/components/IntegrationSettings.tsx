import { useState } from 'react'
import {
  IconBrandGithub,
  IconBrandGoogle,
  IconBrandSlack,
  IconPlugConnected,
  IconWebhook,
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

export function IntegrationSettings() {
  const [integrations, setIntegrations] = useState({
    slack: {
      enabled: false,
      webhookUrl: '',
      channels: '#general,#alerts',
      status: 'disconnected',
    },
    github: {
      enabled: false,
      token: '',
      organization: '',
      status: 'disconnected',
    },
    googleWorkspace: {
      enabled: false,
      clientId: '',
      domain: '',
      status: 'disconnected',
    },
    webhooks: {
      enabled: true,
      endpoints: [
        {
          name: 'User Registration',
          url: 'https://api.company.com/webhooks/user-register',
          active: true,
        },
        {
          name: 'Order Status',
          url: 'https://api.company.com/webhooks/order-status',
          active: false,
        },
      ],
    },
  })

  const handleIntegrationChange = (
    integration: keyof typeof integrations,
    field: string,
    value: string | number | boolean | Record<string, unknown>[]
  ) => {
    setIntegrations((prev) => ({
      ...prev,
      [integration]: { ...prev[integration], [field]: value },
    }))
  }

  const testConnection = (integration: keyof typeof integrations) => {
    toast.loading(`Testing ${integration} connection...`, {
      id: `test-${integration}`,
    })

    setTimeout(() => {
      const success = Math.random() > 0.3
      if (success) {
        setIntegrations((prev) => ({
          ...prev,
          [integration]: { ...prev[integration], status: 'connected' },
        }))
        toast.success(`${integration} connection successful!`, {
          id: `test-${integration}`,
        })
      } else {
        toast.error(`${integration} connection failed. Check your settings.`, {
          id: `test-${integration}`,
        })
      }
    }, 2000)
  }

  const saveSettings = () => {
    localStorage.setItem('integration-settings', JSON.stringify(integrations))
    toast.success('Integration settings saved successfully!')
  }

  return (
    <div className='space-y-6'>
      {/* Slack Integration */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <IconBrandSlack size={20} />
            Slack Integration
            <Badge
              variant={
                integrations.slack.status === 'connected'
                  ? 'default'
                  : 'secondary'
              }
            >
              {integrations.slack.status}
            </Badge>
          </CardTitle>
          <CardDescription>
            Connect with Slack for notifications and alerts.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='flex items-center justify-between'>
            <Label className='text-sm font-medium'>
              Enable Slack Integration
            </Label>
            <Switch
              checked={integrations.slack.enabled}
              onCheckedChange={(checked) =>
                handleIntegrationChange('slack', 'enabled', checked)
              }
            />
          </div>

          {integrations.slack.enabled && (
            <>
              <Separator />
              <div className='space-y-4'>
                <div className='space-y-2'>
                  <Label>Webhook URL</Label>
                  <Input
                    type='password'
                    value={integrations.slack.webhookUrl}
                    onChange={(e) =>
                      handleIntegrationChange(
                        'slack',
                        'webhookUrl',
                        e.target.value
                      )
                    }
                    placeholder='https://hooks.slack.com/services/...'
                  />
                </div>

                <div className='space-y-2'>
                  <Label>Notification Channels</Label>
                  <Input
                    value={integrations.slack.channels}
                    onChange={(e) =>
                      handleIntegrationChange(
                        'slack',
                        'channels',
                        e.target.value
                      )
                    }
                    placeholder='#general,#alerts,#system'
                  />
                  <p className='text-muted-foreground text-xs'>
                    Comma-separated list of channels
                  </p>
                </div>

                <Button
                  variant='outline'
                  onClick={() => testConnection('slack')}
                >
                  Test Connection
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* GitHub Integration */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <IconBrandGithub size={20} />
            GitHub Integration
            <Badge
              variant={
                integrations.github.status === 'connected'
                  ? 'default'
                  : 'secondary'
              }
            >
              {integrations.github.status}
            </Badge>
          </CardTitle>
          <CardDescription>
            Connect with GitHub for deployment tracking and issue management.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='flex items-center justify-between'>
            <Label className='text-sm font-medium'>
              Enable GitHub Integration
            </Label>
            <Switch
              checked={integrations.github.enabled}
              onCheckedChange={(checked) =>
                handleIntegrationChange('github', 'enabled', checked)
              }
            />
          </div>

          {integrations.github.enabled && (
            <>
              <Separator />
              <div className='space-y-4'>
                <div className='space-y-2'>
                  <Label>Personal Access Token</Label>
                  <Input
                    type='password'
                    value={integrations.github.token}
                    onChange={(e) =>
                      handleIntegrationChange('github', 'token', e.target.value)
                    }
                    placeholder='ghp_xxxxxxxxxxxxxxxxxxxx'
                  />
                  <p className='text-muted-foreground text-xs'>
                    Token should have repo and workflow permissions
                  </p>
                </div>

                <div className='space-y-2'>
                  <Label>Organization/Username</Label>
                  <Input
                    value={integrations.github.organization}
                    onChange={(e) =>
                      handleIntegrationChange(
                        'github',
                        'organization',
                        e.target.value
                      )
                    }
                    placeholder='your-org-name'
                  />
                </div>

                <Button
                  variant='outline'
                  onClick={() => testConnection('github')}
                >
                  Test Connection
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Google Workspace Integration */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <IconBrandGoogle size={20} />
            Google Workspace Integration
            <Badge
              variant={
                integrations.googleWorkspace.status === 'connected'
                  ? 'default'
                  : 'secondary'
              }
            >
              {integrations.googleWorkspace.status}
            </Badge>
          </CardTitle>
          <CardDescription>
            Connect with Google Workspace for SSO and calendar integration.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='flex items-center justify-between'>
            <Label className='text-sm font-medium'>
              Enable Google Workspace
            </Label>
            <Switch
              checked={integrations.googleWorkspace.enabled}
              onCheckedChange={(checked) =>
                handleIntegrationChange('googleWorkspace', 'enabled', checked)
              }
            />
          </div>

          {integrations.googleWorkspace.enabled && (
            <>
              <Separator />
              <div className='space-y-4'>
                <div className='space-y-2'>
                  <Label>OAuth Client ID</Label>
                  <Input
                    value={integrations.googleWorkspace.clientId}
                    onChange={(e) =>
                      handleIntegrationChange(
                        'googleWorkspace',
                        'clientId',
                        e.target.value
                      )
                    }
                    placeholder='123456789-xxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com'
                  />
                </div>

                <div className='space-y-2'>
                  <Label>G Suite Domain</Label>
                  <Input
                    value={integrations.googleWorkspace.domain}
                    onChange={(e) =>
                      handleIntegrationChange(
                        'googleWorkspace',
                        'domain',
                        e.target.value
                      )
                    }
                    placeholder='company.com'
                  />
                </div>

                <Button
                  variant='outline'
                  onClick={() => testConnection('googleWorkspace')}
                >
                  Test Connection
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Webhooks */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <IconWebhook size={20} />
            Webhook Endpoints
          </CardTitle>
          <CardDescription>
            Configure outgoing webhooks for system events.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='flex items-center justify-between'>
            <Label className='text-sm font-medium'>Enable Webhooks</Label>
            <Switch
              checked={integrations.webhooks.enabled}
              onCheckedChange={(checked) =>
                handleIntegrationChange('webhooks', 'enabled', checked)
              }
            />
          </div>

          {integrations.webhooks.enabled && (
            <>
              <Separator />
              <div className='space-y-4'>
                <div className='flex items-center justify-between'>
                  <Label className='text-sm font-medium'>
                    Configured Endpoints
                  </Label>
                  <Button variant='outline' size='sm'>
                    Add Webhook
                  </Button>
                </div>

                <div className='space-y-3'>
                  {integrations.webhooks.endpoints.map((endpoint, index) => (
                    <div
                      key={index}
                      className='flex items-center justify-between rounded-lg border p-3'
                    >
                      <div className='space-y-1'>
                        <div className='flex items-center gap-2'>
                          <Label className='text-sm font-medium'>
                            {endpoint.name}
                          </Label>
                          <Badge
                            variant={endpoint.active ? 'default' : 'secondary'}
                          >
                            {endpoint.active ? 'Active' : 'Inactive'}
                          </Badge>
                        </div>
                        <p className='text-muted-foreground text-xs'>
                          {endpoint.url}
                        </p>
                      </div>
                      <div className='flex items-center gap-2'>
                        <Switch
                          checked={endpoint.active}
                          onCheckedChange={(checked) => {
                            const updatedEndpoints = [
                              ...integrations.webhooks.endpoints,
                            ]
                            updatedEndpoints[index] = {
                              ...endpoint,
                              active: checked,
                            }
                            handleIntegrationChange(
                              'webhooks',
                              'endpoints',
                              updatedEndpoints
                            )
                          }}
                        />
                        <Button variant='ghost' size='sm'>
                          Test
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Integration Health */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <IconPlugConnected size={20} />
            Integration Health
          </CardTitle>
          <CardDescription>
            Monitor the status and health of all integrations.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='grid gap-4 md:grid-cols-2'>
            <div className='space-y-2'>
              <Label className='text-sm font-medium'>Active Integrations</Label>
              <div className='text-2xl font-bold text-green-600'>
                {
                  Object.values(integrations).filter(
                    (i) =>
                      i.enabled &&
                      ('status' in i
                        ? (i as { status: string }).status === 'connected'
                        : false)
                  ).length
                }
              </div>
            </div>
            <div className='space-y-2'>
              <Label className='text-sm font-medium'>Failed Connections</Label>
              <div className='text-2xl font-bold text-red-600'>
                {
                  Object.values(integrations).filter(
                    (i) =>
                      i.enabled &&
                      ('status' in i
                        ? (i as { status: string }).status === 'disconnected'
                        : false)
                  ).length
                }
              </div>
            </div>
          </div>

          <Button
            variant='outline'
            onClick={() => toast.info('Integration health check completed')}
          >
            Run Health Check
          </Button>
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
