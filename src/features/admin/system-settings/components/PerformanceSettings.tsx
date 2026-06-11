// Created and developed by Jai Singh
import { useState } from 'react'
import {
  IconBrain,
  IconCpu,
  IconDatabase,
  IconGauge,
  IconRocket,
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
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'

export function PerformanceSettings() {
  const [settings, setSettings] = useState({
    cacheEnabled: true,
    cacheSize: 128,
    cacheTTL: 3600,
    compressionEnabled: true,
    compressionLevel: 6,
    minifyAssets: true,
    lazyLoading: true,
    imageOptimization: true,
    cdnEnabled: false,
    cdnUrl: '',
    connectionPooling: true,
    maxConnections: 100,
    queryTimeout: 30000,
    batchSize: 1000,
    indexOptimization: true,
    performanceMonitoring: true,
    alertThreshold: 5000,
  })

  const [metrics, setMetrics] = useState({
    avgResponseTime: 245,
    requestsPerSecond: 156,
    cacheHitRate: 87,
    errorRate: 0.2,
    cpuUsage: 34,
    memoryUsage: 62,
  })

  const handleSettingChange = (
    key: string,
    value: string | number | boolean
  ) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
  }

  const optimizePerformance = () => {
    toast.loading('Running performance optimization...', { id: 'optimize' })

    setTimeout(() => {
      setMetrics((prev) => ({
        ...prev,
        avgResponseTime: Math.max(prev.avgResponseTime - 50, 100),
        cacheHitRate: Math.min(prev.cacheHitRate + 10, 98),
        cpuUsage: Math.max(prev.cpuUsage - 10, 15),
        memoryUsage: Math.max(prev.memoryUsage - 15, 30),
      }))
      toast.success('Performance optimization completed!', { id: 'optimize' })
    }, 3000)
  }

  const runBenchmark = () => {
    toast.loading('Running performance benchmark...', { id: 'benchmark' })

    setTimeout(() => {
      toast.success('Benchmark completed. Results saved to reports.', {
        id: 'benchmark',
      })
    }, 5000)
  }

  const saveSettings = () => {
    localStorage.setItem('performance-settings', JSON.stringify(settings))
    toast.success('Performance settings saved successfully!')
  }

  const getPerformanceScore = () => {
    let score = 0
    if (settings.cacheEnabled) score += 20
    if (settings.compressionEnabled) score += 15
    if (settings.minifyAssets) score += 10
    if (settings.lazyLoading) score += 10
    if (settings.imageOptimization) score += 10
    if (settings.connectionPooling) score += 15
    if (settings.indexOptimization) score += 10
    if (settings.performanceMonitoring) score += 10

    return Math.min(100, score)
  }

  const performanceScore = getPerformanceScore()

  return (
    <div className='space-y-6'>
      {/* Performance Overview */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <IconGauge size={20} />
            Performance Overview
          </CardTitle>
          <CardDescription>
            Current system performance metrics and optimization score.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='flex items-center justify-between'>
            <Label className='text-sm font-medium'>Performance Score</Label>
            <Badge
              variant={
                performanceScore >= 80
                  ? 'default'
                  : performanceScore >= 60
                    ? 'secondary'
                    : 'destructive'
              }
            >
              {performanceScore}/100
            </Badge>
          </div>

          <div className='bg-secondary h-3 w-full rounded-full'>
            <div
              className={`h-3 rounded-full transition-all duration-300 ${
                performanceScore >= 80
                  ? 'bg-green-500'
                  : performanceScore >= 60
                    ? 'bg-yellow-500'
                    : 'bg-red-500'
              }`}
              style={{ width: `${performanceScore}%` }}
            />
          </div>

          <div className='grid gap-4 md:grid-cols-3'>
            <div className='space-y-1 text-center'>
              <Label className='text-muted-foreground text-xs'>
                Avg Response Time
              </Label>
              <div className='text-lg font-semibold'>
                {metrics.avgResponseTime}ms
              </div>
            </div>
            <div className='space-y-1 text-center'>
              <Label className='text-muted-foreground text-xs'>
                Cache Hit Rate
              </Label>
              <div className='text-lg font-semibold'>
                {metrics.cacheHitRate}%
              </div>
            </div>
            <div className='space-y-1 text-center'>
              <Label className='text-muted-foreground text-xs'>
                Error Rate
              </Label>
              <div className='text-lg font-semibold'>{metrics.errorRate}%</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Caching Settings */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <IconDatabase size={20} />
            Caching Configuration
          </CardTitle>
          <CardDescription>
            Configure application caching behavior and settings.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='flex items-center justify-between'>
            <div className='space-y-1'>
              <Label className='text-sm font-medium'>
                Enable Application Cache
              </Label>
              <p className='text-muted-foreground text-xs'>
                Improve response times with intelligent caching
              </p>
            </div>
            <Switch
              checked={settings.cacheEnabled}
              onCheckedChange={(checked) =>
                handleSettingChange('cacheEnabled', checked)
              }
            />
          </div>

          {settings.cacheEnabled && (
            <>
              <Separator />

              <div className='grid gap-4 md:grid-cols-2'>
                <div className='space-y-2'>
                  <Label className='text-sm font-medium'>
                    Cache Size (MB): {settings.cacheSize}
                  </Label>
                  <Slider
                    value={[settings.cacheSize]}
                    onValueChange={(value: number[]) =>
                      handleSettingChange('cacheSize', value[0])
                    }
                    max={1024}
                    min={32}
                    step={32}
                  />
                  <div className='text-muted-foreground flex justify-between text-xs'>
                    <span>32MB</span>
                    <span>1GB</span>
                  </div>
                </div>

                <div className='space-y-2'>
                  <Label>Cache TTL (seconds)</Label>
                  <Input
                    type='number'
                    value={settings.cacheTTL}
                    onChange={(e) =>
                      handleSettingChange('cacheTTL', parseInt(e.target.value))
                    }
                    min={60}
                    max={86400}
                  />
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Asset Optimization */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <IconRocket size={20} />
            Asset Optimization
          </CardTitle>
          <CardDescription>
            Configure asset compression and optimization settings.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='grid gap-4 md:grid-cols-2'>
            {[
              { key: 'compressionEnabled', label: 'Enable Compression' },
              { key: 'minifyAssets', label: 'Minify CSS/JS Assets' },
              { key: 'lazyLoading', label: 'Lazy Load Images' },
              { key: 'imageOptimization', label: 'Image Optimization' },
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
                    handleSettingChange(option.key, checked)
                  }
                />
              </div>
            ))}
          </div>

          {settings.compressionEnabled && (
            <>
              <Separator />
              <div className='space-y-2'>
                <Label className='text-sm font-medium'>
                  Compression Level: {settings.compressionLevel}
                </Label>
                <Slider
                  value={[settings.compressionLevel]}
                  onValueChange={(value: number[]) =>
                    handleSettingChange('compressionLevel', value[0])
                  }
                  max={9}
                  min={1}
                  step={1}
                />
                <div className='text-muted-foreground flex justify-between text-xs'>
                  <span>Fast</span>
                  <span>Best</span>
                </div>
              </div>
            </>
          )}

          <div className='flex items-center justify-between'>
            <div className='space-y-1'>
              <Label className='text-sm font-medium'>Enable CDN</Label>
              <p className='text-muted-foreground text-xs'>
                Use content delivery network for static assets
              </p>
            </div>
            <Switch
              checked={settings.cdnEnabled}
              onCheckedChange={(checked) =>
                handleSettingChange('cdnEnabled', checked)
              }
            />
          </div>

          {settings.cdnEnabled && (
            <div className='space-y-2'>
              <Label>CDN URL</Label>
              <Input
                value={settings.cdnUrl}
                onChange={(e) => handleSettingChange('cdnUrl', e.target.value)}
                placeholder='https://cdn.company.com'
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Database Performance */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <IconCpu size={20} />
            Database Performance
          </CardTitle>
          <CardDescription>
            Configure database connection and query optimization settings.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='flex items-center justify-between'>
            <Label className='text-sm font-medium'>
              Enable Connection Pooling
            </Label>
            <Switch
              checked={settings.connectionPooling}
              onCheckedChange={(checked) =>
                handleSettingChange('connectionPooling', checked)
              }
            />
          </div>

          <div className='grid gap-4 md:grid-cols-2'>
            <div className='space-y-2'>
              <Label>Max Connections</Label>
              <Input
                type='number'
                value={settings.maxConnections}
                onChange={(e) =>
                  handleSettingChange(
                    'maxConnections',
                    parseInt(e.target.value)
                  )
                }
                min={10}
                max={1000}
              />
            </div>

            <div className='space-y-2'>
              <Label>Query Timeout (ms)</Label>
              <Input
                type='number'
                value={settings.queryTimeout}
                onChange={(e) =>
                  handleSettingChange('queryTimeout', parseInt(e.target.value))
                }
                min={1000}
                max={300000}
              />
            </div>
          </div>

          <div className='space-y-2'>
            <Label>Batch Processing Size</Label>
            <Input
              type='number'
              value={settings.batchSize}
              onChange={(e) =>
                handleSettingChange('batchSize', parseInt(e.target.value))
              }
              min={100}
              max={10000}
            />
          </div>

          <div className='flex items-center space-x-2'>
            <Switch
              checked={settings.indexOptimization}
              onCheckedChange={(checked) =>
                handleSettingChange('indexOptimization', checked)
              }
            />
            <Label className='text-sm'>
              Enable Automatic Index Optimization
            </Label>
          </div>
        </CardContent>
      </Card>

      {/* Performance Actions */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <IconBrain size={20} />
            Performance Actions
          </CardTitle>
          <CardDescription>
            Run performance optimization and analysis tools.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='grid gap-2 md:grid-cols-3'>
            <Button variant='outline' onClick={optimizePerformance}>
              Optimize Now
            </Button>
            <Button variant='outline' onClick={runBenchmark}>
              Run Benchmark
            </Button>
            <Button
              variant='outline'
              onClick={() => toast.info('Performance report generated')}
            >
              Generate Report
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

// Created and developed by Jai Singh
