import { useState } from 'react'
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Server,
  User,
  Globe,
  Shield,
} from 'lucide-react'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { sapFetch } from '../utils/auth-fetch'

interface ConnectionResult {
  success: boolean
  message?: string
  error?: string
  data?: {
    connection_status: string
    echo_text: string
    response_text: string
    system_type: string
    host: string
    client: string
    user_info?: {
      username: string
      first_name: string
      last_name: string
    }
  }
}

const DEFAULT_CONFIG = {
  user: 'STUDENT119',
  ashost: '172.21.72.22',
  sysnr: '00',
  client: '100',
  lang: 'EN',
  saprouter: '/H/161.38.17.212',
  system_type: 'S4HANA',
}

export function ConnectionTestTab() {
  const [isLoading, setIsLoading] = useState(false)
  const [result, setResult] = useState<ConnectionResult | null>(null)
  const [useCustomConfig, setUseCustomConfig] = useState(false)
  const [config, setConfig] = useState(DEFAULT_CONFIG)

  const testConnection = async () => {
    setIsLoading(true)
    setResult(null)

    try {
      const response = await sapFetch('/api/sap/test-connection', {
        method: 'POST',
        body: JSON.stringify({
          use_custom_config: useCustomConfig,
          ...config,
        }),
      })

      const data = await response.json()
      setResult(data)

      if (data.success) {
        toast.success('Connection Successful', {
          description: 'SAP RFC connection established successfully',
        })
      } else {
        toast.error('Connection Failed', {
          description: data.error || 'Failed to connect to SAP system',
        })
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error'
      setResult({
        success: false,
        error: errorMessage,
      })
      toast.error('Request Failed', {
        description: errorMessage,
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className='space-y-6'>
      {/* Connection Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <Server className='h-5 w-5' />
            SAP Connection Configuration
          </CardTitle>
          <CardDescription>
            Configure and test your SAP RFC connection settings
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-6'>
          <div className='flex items-center space-x-2'>
            <Switch
              id='custom-config'
              checked={useCustomConfig}
              onCheckedChange={setUseCustomConfig}
            />
            <Label htmlFor='custom-config'>Use custom configuration</Label>
          </div>

          {useCustomConfig && (
            <div className='grid gap-4 md:grid-cols-2'>
              <div className='space-y-2'>
                <Label htmlFor='ashost' className='flex items-center gap-2'>
                  <Globe className='h-4 w-4' />
                  Application Server Host
                </Label>
                <Input
                  id='ashost'
                  value={config.ashost}
                  onChange={(e) =>
                    setConfig({ ...config, ashost: e.target.value })
                  }
                  placeholder='172.21.72.22'
                />
              </div>

              <div className='space-y-2'>
                <Label htmlFor='saprouter' className='flex items-center gap-2'>
                  <Shield className='h-4 w-4' />
                  SAP Router
                </Label>
                <Input
                  id='saprouter'
                  value={config.saprouter}
                  onChange={(e) =>
                    setConfig({ ...config, saprouter: e.target.value })
                  }
                  placeholder='/H/161.38.17.212'
                />
              </div>

              <div className='space-y-2'>
                <Label htmlFor='sysnr'>System Number</Label>
                <Input
                  id='sysnr'
                  value={config.sysnr}
                  onChange={(e) =>
                    setConfig({ ...config, sysnr: e.target.value })
                  }
                  placeholder='00'
                />
              </div>

              <div className='space-y-2'>
                <Label htmlFor='client'>Client</Label>
                <Input
                  id='client'
                  value={config.client}
                  onChange={(e) =>
                    setConfig({ ...config, client: e.target.value })
                  }
                  placeholder='100'
                />
              </div>

              <div className='space-y-2'>
                <Label htmlFor='user' className='flex items-center gap-2'>
                  <User className='h-4 w-4' />
                  Username
                </Label>
                <Input
                  id='user'
                  value={config.user}
                  onChange={(e) =>
                    setConfig({ ...config, user: e.target.value })
                  }
                  placeholder='STUDENT119'
                />
              </div>

              <div className='space-y-2'>
                <Label htmlFor='system_type'>System Type</Label>
                <Select
                  value={config.system_type}
                  onValueChange={(value) =>
                    setConfig({ ...config, system_type: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder='Select system type' />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='S4HANA'>S/4 HANA (EWM)</SelectItem>
                    <SelectItem value='ECC'>ECC (Classic WM)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <Button
            onClick={testConnection}
            disabled={isLoading}
            className='w-full md:w-auto'
          >
            {isLoading ? (
              <>
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                Testing Connection...
              </>
            ) : (
              <>
                <Server className='mr-2 h-4 w-4' />
                Test Connection
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Connection Result */}
      {result && (
        <Card
          className={
            result.success ? 'border-green-500/50' : 'border-red-500/50'
          }
        >
          <CardHeader>
            <CardTitle className='flex items-center gap-2'>
              {result.success ? (
                <>
                  <CheckCircle2 className='h-5 w-5 text-green-500' />
                  Connection Successful
                </>
              ) : (
                <>
                  <XCircle className='h-5 w-5 text-red-500' />
                  Connection Failed
                </>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {result.success && result.data ? (
              <div className='space-y-4'>
                <div className='grid gap-4 md:grid-cols-2'>
                  <div className='space-y-2'>
                    <Label className='text-sm font-medium'>
                      Connection Status
                    </Label>
                    <Badge variant='outline' className='text-green-600'>
                      {result.data.connection_status}
                    </Badge>
                  </div>

                  <div className='space-y-2'>
                    <Label className='text-sm font-medium'>System Type</Label>
                    <Badge variant='secondary'>{result.data.system_type}</Badge>
                  </div>

                  <div className='space-y-2'>
                    <Label className='text-sm font-medium'>Host</Label>
                    <p className='text-muted-foreground text-sm'>
                      {result.data.host}
                    </p>
                  </div>

                  <div className='space-y-2'>
                    <Label className='text-sm font-medium'>Client</Label>
                    <p className='text-muted-foreground text-sm'>
                      {result.data.client}
                    </p>
                  </div>
                </div>

                {result.data.user_info && (
                  <div className='space-y-2 border-t pt-4'>
                    <Label className='flex items-center gap-2 text-sm font-medium'>
                      <User className='h-4 w-4' />
                      User Information
                    </Label>
                    <div className='grid gap-2 md:grid-cols-3'>
                      <div>
                        <span className='text-muted-foreground text-xs'>
                          Username:
                        </span>
                        <p className='text-sm font-medium'>
                          {result.data.user_info.username}
                        </p>
                      </div>
                      <div>
                        <span className='text-muted-foreground text-xs'>
                          First Name:
                        </span>
                        <p className='text-sm font-medium'>
                          {result.data.user_info.first_name || '-'}
                        </p>
                      </div>
                      <div>
                        <span className='text-muted-foreground text-xs'>
                          Last Name:
                        </span>
                        <p className='text-sm font-medium'>
                          {result.data.user_info.last_name || '-'}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {result.data.response_text && (
                  <div className='space-y-2 border-t pt-4'>
                    <Label className='text-sm font-medium'>
                      System Response
                    </Label>
                    <p className='text-muted-foreground bg-muted rounded p-2 font-mono text-sm'>
                      {result.data.response_text}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className='space-y-2'>
                <Label className='text-sm font-medium text-red-600'>
                  Error Details
                </Label>
                <p className='rounded bg-red-50 p-3 font-mono text-sm text-red-500 dark:bg-red-950/20'>
                  {result.error || result.message || 'Unknown error occurred'}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
