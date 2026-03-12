/**
 * RF Drone Control Component
 *
 * Mobile-optimized interface for DJI drone warehouse scanning.
 * Provides connection management, photo capture, telemetry display,
 * and mission control.
 */
import { useState, useCallback } from 'react'
import { Capacitor } from '@capacitor/core'
import {
  ChevronLeft,
  Wifi,
  WifiOff,
  Camera,
  Battery,
  Navigation,
  MapPin,
  Loader2,
  Play,
  Square,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Upload,
  Eye,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  DJIDrone,
  type TelemetryData,
  type PhotoCaptureResult,
} from '@/lib/drone/dji-plugin'
import { logger } from '@/lib/utils/logger'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'

interface RFDroneControlProps {
  onBack: () => void
  onScanCaptured?: (scan: PhotoCaptureResult) => void
}

export default function RFDroneControl({
  onBack,
  onScanCaptured,
}: RFDroneControlProps) {
  // Connection state
  const [isConnecting, setIsConnecting] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [droneModel, setDroneModel] = useState<string | null>(null)

  // Telemetry state
  const [telemetry, setTelemetry] = useState<TelemetryData | null>(null)
  const [isLoadingTelemetry, setIsLoadingTelemetry] = useState(false)

  // Capture state
  const [isCapturing, setIsCapturing] = useState(false)
  const [lastCapture, setLastCapture] = useState<PhotoCaptureResult | null>(
    null
  )
  const [captureCount, setCaptureCount] = useState(0)

  // Mission state
  const [missionActive, setMissionActive] = useState(false)
  const [missionProgress, setMissionProgress] = useState(0)

  // Platform check
  const isNativePlatform = Capacitor.isNativePlatform()

  // Connect to drone
  const handleConnect = async () => {
    setIsConnecting(true)
    try {
      const result = await DJIDrone.connect()
      if (result.connected) {
        setIsConnected(true)
        setDroneModel(result.droneModel || 'Unknown Drone')
        toast.success('Connected to drone')

        // Start telemetry polling
        startTelemetryPolling()
      } else {
        toast.error('Failed to connect: ' + result.message)
      }
    } catch (error: unknown) {
      toast.error(
        'Connection error: ' +
          (error instanceof Error ? error.message : String(error))
      )
    } finally {
      setIsConnecting(false)
    }
  }

  // Disconnect from drone
  const handleDisconnect = async () => {
    try {
      await DJIDrone.disconnect()
      setIsConnected(false)
      setDroneModel(null)
      setTelemetry(null)
      setMissionActive(false)
      toast.info('Disconnected from drone')
    } catch (error: unknown) {
      toast.error(
        'Disconnect error: ' +
          (error instanceof Error ? error.message : String(error))
      )
    }
  }

  // Telemetry polling
  const startTelemetryPolling = useCallback(() => {
    const fetchTelemetry = async () => {
      if (!isConnected) return

      try {
        const data = await DJIDrone.getTelemetry()
        setTelemetry(data)
      } catch (error) {
        logger.warn('Telemetry fetch failed:', error)
      }
    }

    // Initial fetch
    fetchTelemetry()

    // Poll every 2 seconds
    const interval = setInterval(fetchTelemetry, 2000)

    return () => clearInterval(interval)
  }, [isConnected])

  // Capture photo
  const handleCapture = async () => {
    if (!isConnected) {
      toast.error('Not connected to drone')
      return
    }

    setIsCapturing(true)
    try {
      const result = await DJIDrone.capturePhoto()

      if (result.success) {
        setLastCapture(result)
        setCaptureCount((prev) => prev + 1)
        toast.success('Photo captured successfully')

        // Notify parent component
        if (onScanCaptured) {
          onScanCaptured(result)
        }
      }
    } catch (error: unknown) {
      toast.error(
        'Capture failed: ' +
          (error instanceof Error ? error.message : String(error))
      )
    } finally {
      setIsCapturing(false)
    }
  }

  // Refresh telemetry
  const handleRefreshTelemetry = async () => {
    setIsLoadingTelemetry(true)
    try {
      const data = await DJIDrone.getTelemetry()
      setTelemetry(data)
    } catch (error: unknown) {
      toast.error('Failed to refresh telemetry')
    } finally {
      setIsLoadingTelemetry(false)
    }
  }

  // Start mission
  const handleStartMission = async () => {
    if (!isConnected) {
      toast.error('Not connected to drone')
      return
    }

    try {
      // Simple grid mission for demo
      const result = await DJIDrone.startMission({
        name: 'Warehouse Scan',
        waypoints: [
          {
            lat: telemetry?.gps?.lat || 0,
            lng: telemetry?.gps?.lng || 0,
            alt: 10,
            action: 'takePhoto',
          },
          {
            lat: (telemetry?.gps?.lat || 0) + 0.0001,
            lng: telemetry?.gps?.lng || 0,
            alt: 10,
            action: 'takePhoto',
          },
          {
            lat: (telemetry?.gps?.lat || 0) + 0.0001,
            lng: (telemetry?.gps?.lng || 0) + 0.0001,
            alt: 10,
            action: 'takePhoto',
          },
        ],
      })

      if (result.success) {
        setMissionActive(true)
        setMissionProgress(0)
        toast.success(`Mission started: ${result.waypointCount} waypoints`)

        // Poll mission status
        const statusInterval = setInterval(async () => {
          const status = await DJIDrone.getMissionStatus({})
          setMissionProgress(status.progress * 100)

          if (!status.isActive) {
            setMissionActive(false)
            clearInterval(statusInterval)
            toast.success('Mission completed')
          }
        }, 1000)
      }
    } catch (error: unknown) {
      toast.error(
        'Failed to start mission: ' +
          (error instanceof Error ? error.message : String(error))
      )
    }
  }

  // Stop mission
  const handleStopMission = async () => {
    try {
      await DJIDrone.stopMission()
      setMissionActive(false)
      setMissionProgress(0)
      toast.info('Mission stopped')
    } catch (error: unknown) {
      toast.error(
        'Failed to stop mission: ' +
          (error instanceof Error ? error.message : String(error))
      )
    }
  }

  // Get battery color
  const getBatteryColor = (percentage?: number) => {
    if (!percentage) return 'text-muted-foreground'
    if (percentage > 50) return 'text-green-500'
    if (percentage > 20) return 'text-yellow-500'
    return 'text-red-500'
  }

  return (
    <div className='flex flex-1 flex-col space-y-3'>
      {/* Header */}
      <div className='flex items-center'>
        <Button
          variant='ghost'
          size='sm'
          onClick={onBack}
          className='h-8 w-8 p-0'
        >
          <ChevronLeft className='h-4 w-4' />
        </Button>
        <h2 className='flex-1 text-center text-base font-bold'>
          Drone Control
        </h2>
        <Badge
          variant={isConnected ? 'default' : 'secondary'}
          className='text-xs'
        >
          {isConnected ? (
            <>
              <Wifi className='mr-1 h-3 w-3' />
              Connected
            </>
          ) : (
            <>
              <WifiOff className='mr-1 h-3 w-3' />
              Disconnected
            </>
          )}
        </Badge>
      </div>

      {/* Main Content */}
      <div className='flex-1 space-y-3 overflow-y-auto pb-4'>
        {/* Connection Card */}
        <Card>
          <CardContent className='p-3'>
            {!isConnected ? (
              <div className='space-y-3 text-center'>
                <div className='bg-muted mx-auto flex h-16 w-16 items-center justify-center rounded-full'>
                  <WifiOff className='text-muted-foreground h-8 w-8' />
                </div>
                <div>
                  <p className='text-sm font-medium'>No Drone Connected</p>
                  <p className='text-muted-foreground text-xs'>
                    {isNativePlatform
                      ? 'Tap to connect to your DJI drone'
                      : 'Running in web simulation mode'}
                  </p>
                </div>
                <Button
                  onClick={handleConnect}
                  disabled={isConnecting}
                  className='w-full'
                >
                  {isConnecting ? (
                    <>
                      <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                      Connecting...
                    </>
                  ) : (
                    <>
                      <Wifi className='mr-2 h-4 w-4' />
                      Connect to Drone
                    </>
                  )}
                </Button>
              </div>
            ) : (
              <div className='space-y-3'>
                <div className='flex items-center justify-between'>
                  <div className='flex items-center gap-2'>
                    <CheckCircle2 className='h-5 w-5 text-green-500' />
                    <div>
                      <p className='text-sm font-medium'>{droneModel}</p>
                      <p className='text-muted-foreground text-xs'>Connected</p>
                    </div>
                  </div>
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={handleDisconnect}
                  >
                    Disconnect
                  </Button>
                </div>

                {telemetry?.simulated && (
                  <div className='flex items-center gap-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-600 dark:bg-amber-900/20'>
                    <AlertTriangle className='h-3 w-3' />
                    Simulation Mode
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Telemetry Card */}
        {isConnected && (
          <Card>
            <CardHeader className='px-3 pt-3 pb-2'>
              <div className='flex items-center justify-between'>
                <CardTitle className='text-sm'>Telemetry</CardTitle>
                <Button
                  variant='ghost'
                  size='sm'
                  onClick={handleRefreshTelemetry}
                  disabled={isLoadingTelemetry}
                  className='h-6 w-6 p-0'
                >
                  <RefreshCw
                    className={`h-3 w-3 ${isLoadingTelemetry ? 'animate-spin' : ''}`}
                  />
                </Button>
              </div>
            </CardHeader>
            <CardContent className='px-3 pt-0 pb-3'>
              <div className='grid grid-cols-2 gap-2'>
                {/* Battery */}
                <div className='bg-muted/50 flex items-center gap-2 rounded p-2'>
                  <Battery
                    className={`h-4 w-4 ${getBatteryColor(telemetry?.battery?.percentage)}`}
                  />
                  <div>
                    <p className='text-muted-foreground text-xs'>Battery</p>
                    <p className='text-sm font-medium'>
                      {telemetry?.battery?.percentage || '--'}%
                    </p>
                  </div>
                </div>

                {/* Altitude */}
                <div className='bg-muted/50 flex items-center gap-2 rounded p-2'>
                  <Navigation className='h-4 w-4 text-blue-500' />
                  <div>
                    <p className='text-muted-foreground text-xs'>Altitude</p>
                    <p className='text-sm font-medium'>
                      {telemetry?.altitude?.toFixed(1) || '--'}m
                    </p>
                  </div>
                </div>

                {/* GPS */}
                <div className='bg-muted/50 col-span-2 flex items-center gap-2 rounded p-2'>
                  <MapPin className='h-4 w-4 text-green-500' />
                  <div className='flex-1'>
                    <p className='text-muted-foreground text-xs'>
                      GPS Location
                    </p>
                    <p className='font-mono text-xs'>
                      {telemetry?.gps
                        ? `${telemetry.gps.lat.toFixed(6)}, ${telemetry.gps.lng.toFixed(6)}`
                        : 'No GPS signal'}
                    </p>
                  </div>
                </div>

                {/* Flight Mode */}
                <div className='bg-muted/50 col-span-2 flex items-center gap-2 rounded p-2'>
                  <Badge
                    variant={telemetry?.isFlying ? 'default' : 'secondary'}
                    className='text-xs'
                  >
                    {telemetry?.isFlying ? 'In Flight' : 'Grounded'}
                  </Badge>
                  <Badge variant='outline' className='text-xs'>
                    {telemetry?.flightMode || 'Unknown'}
                  </Badge>
                  <span className='text-muted-foreground ml-auto text-xs'>
                    Heading: {telemetry?.heading?.toFixed(0) || '--'}°
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Capture Card */}
        {isConnected && (
          <Card>
            <CardHeader className='px-3 pt-3 pb-2'>
              <CardTitle className='flex items-center gap-2 text-sm'>
                <Camera className='h-4 w-4' />
                Photo Capture
              </CardTitle>
            </CardHeader>
            <CardContent className='space-y-3 px-3 pt-0 pb-3'>
              <Button
                onClick={handleCapture}
                disabled={isCapturing}
                className='h-14 w-full'
                size='lg'
              >
                {isCapturing ? (
                  <>
                    <Loader2 className='mr-2 h-5 w-5 animate-spin' />
                    Capturing...
                  </>
                ) : (
                  <>
                    <Camera className='mr-2 h-5 w-5' />
                    Capture Photo
                  </>
                )}
              </Button>

              {/* Capture stats */}
              <div className='text-muted-foreground flex items-center justify-between text-xs'>
                <span>Photos captured this session: {captureCount}</span>
                {lastCapture && (
                  <Button
                    variant='ghost'
                    size='sm'
                    className='h-6 gap-1 text-xs'
                  >
                    <Eye className='h-3 w-3' />
                    View Last
                  </Button>
                )}
              </div>

              {/* Last capture info */}
              {lastCapture && (
                <div className='rounded bg-green-50 p-2 text-xs dark:bg-green-900/20'>
                  <div className='flex items-center gap-1 text-green-700 dark:text-green-400'>
                    <CheckCircle2 className='h-3 w-3' />
                    <span>
                      Last capture:{' '}
                      {new Date(lastCapture.capturedAt).toLocaleTimeString()}
                    </span>
                  </div>
                  {lastCapture.gps && (
                    <p className='mt-1 font-mono text-green-600 dark:text-green-500'>
                      GPS: {lastCapture.gps.lat.toFixed(6)},{' '}
                      {lastCapture.gps.lng.toFixed(6)}
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Mission Card */}
        {isConnected && (
          <Card>
            <CardHeader className='px-3 pt-3 pb-2'>
              <CardTitle className='flex items-center gap-2 text-sm'>
                <MapPin className='h-4 w-4' />
                Quick Mission
              </CardTitle>
            </CardHeader>
            <CardContent className='space-y-3 px-3 pt-0 pb-3'>
              {missionActive ? (
                <>
                  <div className='space-y-2'>
                    <div className='flex items-center justify-between text-sm'>
                      <span>Mission Progress</span>
                      <span>{missionProgress.toFixed(0)}%</span>
                    </div>
                    <Progress value={missionProgress} className='h-2' />
                  </div>
                  <Button
                    onClick={handleStopMission}
                    variant='destructive'
                    className='w-full'
                  >
                    <Square className='mr-2 h-4 w-4' />
                    Stop Mission
                  </Button>
                </>
              ) : (
                <>
                  <p className='text-muted-foreground text-xs'>
                    Start a quick grid scan mission at your current location.
                    The drone will capture photos at multiple waypoints.
                  </p>
                  <Button onClick={handleStartMission} className='w-full'>
                    <Play className='mr-2 h-4 w-4' />
                    Start Grid Scan
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* Upload Status Card */}
        {captureCount > 0 && (
          <Card>
            <CardContent className='p-3'>
              <div className='flex items-center gap-2'>
                <Upload className='h-4 w-4 text-blue-500' />
                <div className='flex-1'>
                  <p className='text-xs font-medium'>Ready for Analysis</p>
                  <p className='text-muted-foreground text-xs'>
                    {captureCount} photo{captureCount > 1 ? 's' : ''} captured
                    and ready for AI analysis
                  </p>
                </div>
                <Button variant='outline' size='sm' className='text-xs'>
                  Upload All
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
