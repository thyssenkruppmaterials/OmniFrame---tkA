import { useState } from 'react'
import {
  IconApi,
  IconCode,
  IconGlobe,
  IconKey,
  IconShield,
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
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

export function APIConfigurationSettings() {
  const [settings, setSettings] = useState({
    apiEnabled: true,
    rateLimit: 1000,
    rateLimitWindow: 60,
    maxRequestSize: 10,
    timeoutDuration: 30,
    authenticationRequired: true,
    corsEnabled: true,
    allowedOrigins: 'https://app.company.com,https://admin.company.com',
    versioning: true,
    currentVersion: 'v1',
    deprecationWarnings: true,
    compressionEnabled: true,
    cacheResponses: true,
    cacheTTL: 300,
    loggingEnabled: true,
    webhooksEnabled: true,
    maxWebhooks: 50,
  })

  const [apiKeys, setApiKeys] = useState([
    {
      id: '1',
      name: 'Frontend App',
      key: 'ak_prod_...',
      permissions: ['read', 'write'],
      lastUsed: '2024-09-26',
      status: 'active',
    },
    {
      id: '2',
      name: 'Mobile App',
      key: 'ak_prod_...',
      permissions: ['read'],
      lastUsed: '2024-09-25',
      status: 'active',
    },
    {
      id: '3',
      name: 'Analytics Service',
      key: 'ak_prod_...',
      permissions: ['read'],
      lastUsed: '2024-09-20',
      status: 'inactive',
    },
  ])

  const [endpoints, setEndpoints] = useState([
    {
      path: '/api/v1/users',
      method: 'GET',
      enabled: true,
      rateLimit: 100,
      cached: true,
    },
    {
      path: '/api/v1/users',
      method: 'POST',
      enabled: true,
      rateLimit: 10,
      cached: false,
    },
    {
      path: '/api/v1/orders',
      method: 'GET',
      enabled: true,
      rateLimit: 200,
      cached: true,
    },
    {
      path: '/api/v1/analytics',
      method: 'GET',
      enabled: false,
      rateLimit: 50,
      cached: true,
    },
  ])

  const [apiMetrics] = useState({
    totalRequests: 45234,
    todayRequests: 1543,
    errorRate: 2.1,
    avgResponseTime: 245,
    activeKeys: 3,
    blockedRequests: 42,
  })

  const handleSettingChange = (
    key: string,
    value: string | number | boolean
  ) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
  }

  const generateApiKey = () => {
    const newKey = {
      id: Date.now().toString(),
      name: 'New API Key',
      key: `ak_prod_${Math.random().toString(36).substring(7)}`,
      permissions: ['read'],
      lastUsed: 'Never',
      status: 'active',
    }
    setApiKeys((prev) => [newKey, ...prev])
    toast.success('New API key generated successfully!')
  }

  const revokeApiKey = (id: string) => {
    setApiKeys((prev) => prev.filter((key) => key.id !== id))
    toast.success('API key revoked successfully!')
  }

  const testEndpoint = (endpoint: { method: string; path: string }) => {
    toast.loading(`Testing ${endpoint.method} ${endpoint.path}...`, {
      id: 'test-endpoint',
    })

    setTimeout(() => {
      const success = Math.random() > 0.2
      if (success) {
        toast.success('Endpoint test successful!', { id: 'test-endpoint' })
      } else {
        toast.error('Endpoint test failed. Check configuration.', {
          id: 'test-endpoint',
        })
      }
    }, 2000)
  }

  const saveSettings = () => {
    localStorage.setItem(
      'api-settings',
      JSON.stringify({ settings, endpoints })
    )
    toast.success('API settings saved successfully!')
  }

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case 'active':
        return 'default'
      case 'inactive':
        return 'secondary'
      case 'revoked':
        return 'destructive'
      default:
        return 'secondary'
    }
  }

  return (
    <div className='space-y-6'>
      {/* API Overview */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <IconApi size={20} />
            API Overview
          </CardTitle>
          <CardDescription>
            Current API usage statistics and system health.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='grid gap-4 md:grid-cols-4'>
            <div className='space-y-1 text-center'>
              <Label className='text-muted-foreground text-xs'>
                Total Requests
              </Label>
              <div className='text-lg font-semibold'>
                {apiMetrics.totalRequests.toLocaleString()}
              </div>
            </div>
            <div className='space-y-1 text-center'>
              <Label className='text-muted-foreground text-xs'>Today</Label>
              <div className='text-lg font-semibold text-blue-600'>
                {apiMetrics.todayRequests.toLocaleString()}
              </div>
            </div>
            <div className='space-y-1 text-center'>
              <Label className='text-muted-foreground text-xs'>
                Error Rate
              </Label>
              <div className='text-lg font-semibold text-red-600'>
                {apiMetrics.errorRate}%
              </div>
            </div>
            <div className='space-y-1 text-center'>
              <Label className='text-muted-foreground text-xs'>
                Avg Response
              </Label>
              <div className='text-lg font-semibold text-green-600'>
                {apiMetrics.avgResponseTime}ms
              </div>
            </div>
          </div>

          <div className='space-y-2'>
            <div className='flex justify-between text-sm'>
              <span>Rate Limit Usage</span>
              <span>
                {(
                  (apiMetrics.todayRequests / settings.rateLimit) *
                  100
                ).toFixed(1)}
                %
              </span>
            </div>
            <Progress
              value={(apiMetrics.todayRequests / settings.rateLimit) * 100}
            />
          </div>
        </CardContent>
      </Card>

      {/* General API Settings */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <IconGlobe size={20} />
            General API Configuration
          </CardTitle>
          <CardDescription>
            Configure basic API behavior and global settings.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='flex items-center justify-between'>
            <div className='space-y-1'>
              <Label className='text-sm font-medium'>Enable API Access</Label>
              <p className='text-muted-foreground text-xs'>
                Master switch for all API endpoints
              </p>
            </div>
            <Switch
              checked={settings.apiEnabled}
              onCheckedChange={(checked) =>
                handleSettingChange('apiEnabled', checked)
              }
            />
          </div>

          <Separator />

          <div className='grid gap-4 md:grid-cols-2'>
            <div className='space-y-2'>
              <Label>Rate Limit (requests per window)</Label>
              <Input
                type='number'
                value={settings.rateLimit}
                onChange={(e) =>
                  handleSettingChange('rateLimit', parseInt(e.target.value))
                }
                min={10}
                max={10000}
              />
            </div>

            <div className='space-y-2'>
              <Label>Rate Limit Window (seconds)</Label>
              <Input
                type='number'
                value={settings.rateLimitWindow}
                onChange={(e) =>
                  handleSettingChange(
                    'rateLimitWindow',
                    parseInt(e.target.value)
                  )
                }
                min={1}
                max={3600}
              />
            </div>
          </div>

          <div className='grid gap-4 md:grid-cols-2'>
            <div className='space-y-2'>
              <Label>Max Request Size (MB)</Label>
              <Input
                type='number'
                value={settings.maxRequestSize}
                onChange={(e) =>
                  handleSettingChange(
                    'maxRequestSize',
                    parseInt(e.target.value)
                  )
                }
                min={1}
                max={100}
              />
            </div>

            <div className='space-y-2'>
              <Label>Timeout Duration (seconds)</Label>
              <Input
                type='number'
                value={settings.timeoutDuration}
                onChange={(e) =>
                  handleSettingChange(
                    'timeoutDuration',
                    parseInt(e.target.value)
                  )
                }
                min={5}
                max={300}
              />
            </div>
          </div>

          <div className='grid gap-4 md:grid-cols-2'>
            {[
              {
                key: 'authenticationRequired',
                label: 'Require Authentication',
              },
              { key: 'corsEnabled', label: 'Enable CORS' },
              { key: 'compressionEnabled', label: 'Enable Compression' },
              { key: 'loggingEnabled', label: 'Log API Requests' },
            ].map((option) => (
              <div
                key={option.key}
                className='flex items-center justify-between'
              >
                <Label className='text-sm font-medium'>{option.label}</Label>
                <Switch
                  checked={
                    settings[option.key as keyof typeof settings] as boolean
                  }
                  onCheckedChange={(checked) =>
                    handleSettingChange(
                      option.key as keyof typeof settings,
                      checked
                    )
                  }
                />
              </div>
            ))}
          </div>

          {settings.corsEnabled && (
            <div className='space-y-2'>
              <Label>Allowed Origins</Label>
              <Textarea
                value={settings.allowedOrigins}
                onChange={(e) =>
                  handleSettingChange('allowedOrigins', e.target.value)
                }
                placeholder='https://app.company.com,https://admin.company.com'
                rows={2}
              />
              <p className='text-muted-foreground text-xs'>
                Comma-separated list of allowed origins
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* API Keys Management */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <IconKey size={20} />
            API Keys Management
          </CardTitle>
          <CardDescription>
            Manage API keys and their permissions.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='flex items-center justify-between'>
            <div>
              <Label className='text-sm font-medium'>
                Active API Keys: {apiKeys.length}
              </Label>
              <p className='text-muted-foreground text-xs'>
                Total requests today: {apiMetrics.todayRequests}
              </p>
            </div>
            <Button onClick={generateApiKey}>Generate New Key</Button>
          </div>

          <Separator />

          <div className='space-y-3'>
            {apiKeys.map((key) => (
              <div
                key={key.id}
                className='flex items-center justify-between rounded-lg border p-3'
              >
                <div className='space-y-1'>
                  <div className='flex items-center gap-2'>
                    <Label className='text-sm font-medium'>{key.name}</Label>
                    <Badge variant={getStatusBadgeVariant(key.status)}>
                      {key.status}
                    </Badge>
                  </div>
                  <div className='text-muted-foreground flex items-center gap-4 text-xs'>
                    <span>Key: {key.key}</span>
                    <span>Last used: {key.lastUsed}</span>
                    <span>Permissions: {key.permissions.join(', ')}</span>
                  </div>
                </div>
                <div className='flex items-center gap-2'>
                  <Button variant='ghost' size='sm'>
                    Edit
                  </Button>
                  <Button
                    variant='ghost'
                    size='sm'
                    onClick={() => revokeApiKey(key.id)}
                  >
                    Revoke
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Endpoint Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <IconCode size={20} />
            Endpoint Configuration
          </CardTitle>
          <CardDescription>
            Configure individual API endpoints and their settings.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='space-y-3'>
            {endpoints.map((endpoint, index) => (
              <div
                key={index}
                className='flex items-center justify-between rounded-lg border p-3'
              >
                <div className='space-y-1'>
                  <div className='flex items-center gap-2'>
                    <Badge variant='outline'>{endpoint.method}</Badge>
                    <Label className='text-sm font-medium'>
                      {endpoint.path}
                    </Label>
                    <Badge variant={endpoint.enabled ? 'default' : 'secondary'}>
                      {endpoint.enabled ? 'Enabled' : 'Disabled'}
                    </Badge>
                    {endpoint.cached && <Badge variant='outline'>Cached</Badge>}
                  </div>
                  <p className='text-muted-foreground text-xs'>
                    Rate limit: {endpoint.rateLimit} requests/min
                  </p>
                </div>
                <div className='flex items-center gap-2'>
                  <Button
                    variant='ghost'
                    size='sm'
                    onClick={() => testEndpoint(endpoint)}
                  >
                    Test
                  </Button>
                  <Switch
                    checked={endpoint.enabled}
                    onCheckedChange={(checked) => {
                      const updatedEndpoints = [...endpoints]
                      updatedEndpoints[index] = {
                        ...endpoint,
                        enabled: checked,
                      }
                      setEndpoints(updatedEndpoints)
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Caching & Performance */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <IconShield size={20} />
            Caching & Performance
          </CardTitle>
          <CardDescription>
            Configure API response caching and performance optimization.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='flex items-center justify-between'>
            <div className='space-y-1'>
              <Label className='text-sm font-medium'>
                Enable Response Caching
              </Label>
              <p className='text-muted-foreground text-xs'>
                Cache GET responses to improve performance
              </p>
            </div>
            <Switch
              checked={settings.cacheResponses}
              onCheckedChange={(checked) =>
                handleSettingChange('cacheResponses', checked)
              }
            />
          </div>

          {settings.cacheResponses && (
            <>
              <Separator />

              <div className='space-y-2'>
                <Label>Cache TTL (seconds)</Label>
                <Input
                  type='number'
                  value={settings.cacheTTL}
                  onChange={(e) =>
                    handleSettingChange('cacheTTL', parseInt(e.target.value))
                  }
                  min={60}
                  max={3600}
                />
              </div>
            </>
          )}

          <div className='grid gap-4 md:grid-cols-2'>
            <div className='flex items-center justify-between'>
              <Label className='text-sm font-medium'>API Versioning</Label>
              <Switch
                checked={settings.versioning}
                onCheckedChange={(checked) =>
                  handleSettingChange('versioning', checked)
                }
              />
            </div>

            <div className='flex items-center justify-between'>
              <Label className='text-sm font-medium'>
                Deprecation Warnings
              </Label>
              <Switch
                checked={settings.deprecationWarnings}
                onCheckedChange={(checked) =>
                  handleSettingChange('deprecationWarnings', checked)
                }
              />
            </div>
          </div>

          {settings.versioning && (
            <div className='space-y-2'>
              <Label>Current API Version</Label>
              <Input
                value={settings.currentVersion}
                onChange={(e) =>
                  handleSettingChange('currentVersion', e.target.value)
                }
                placeholder='v1'
              />
            </div>
          )}
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
