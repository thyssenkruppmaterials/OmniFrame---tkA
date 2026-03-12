/**
 * Device Fingerprinting and Identification Utilities
 * Creates unique device identifiers for RF Terminal tracking
 *
 * Uses Capacitor Device API when running in native iOS app for accurate device info.
 * Falls back to user agent parsing for web browsers.
 *
 * NOTE: IMEI access is not available on iOS due to Apple's privacy restrictions.
 * We use the Device UUID as an alternative unique identifier.
 */
import { Capacitor } from '@capacitor/core'
import { Device, DeviceId, DeviceInfo } from '@capacitor/device'
import { logger } from '@/lib/utils/logger'

/**
 * Map internal iPhone model identifiers to marketing names
 * Source: https://www.theiphonewiki.com/wiki/Models
 */
const iPhoneModelMap: Record<string, string> = {
  // iPhone 17 Series (2025) - Future models
  'iPhone18,1': 'iPhone 17 Pro',
  'iPhone18,2': 'iPhone 17 Pro Max',
  'iPhone18,3': 'iPhone 17',
  'iPhone18,4': 'iPhone 17 Plus',

  // iPhone 16 Series (2024)
  'iPhone17,1': 'iPhone 16 Pro',
  'iPhone17,2': 'iPhone 16 Pro Max',
  'iPhone17,3': 'iPhone 16',
  'iPhone17,4': 'iPhone 16 Plus',

  // iPhone 15 Series (2023)
  'iPhone16,1': 'iPhone 15 Pro',
  'iPhone16,2': 'iPhone 15 Pro Max',
  'iPhone15,4': 'iPhone 15',
  'iPhone15,5': 'iPhone 15 Plus',

  // iPhone 14 Series (2022)
  'iPhone15,2': 'iPhone 14 Pro',
  'iPhone15,3': 'iPhone 14 Pro Max',
  'iPhone14,7': 'iPhone 14',
  'iPhone14,8': 'iPhone 14 Plus',

  // iPhone 13 Series (2021)
  'iPhone14,2': 'iPhone 13 Pro',
  'iPhone14,3': 'iPhone 13 Pro Max',
  'iPhone14,4': 'iPhone 13 mini',
  'iPhone14,5': 'iPhone 13',

  // iPhone 12 Series (2020)
  'iPhone13,1': 'iPhone 12 mini',
  'iPhone13,2': 'iPhone 12',
  'iPhone13,3': 'iPhone 12 Pro',
  'iPhone13,4': 'iPhone 12 Pro Max',

  // iPhone 11 Series (2019)
  'iPhone12,1': 'iPhone 11',
  'iPhone12,3': 'iPhone 11 Pro',
  'iPhone12,5': 'iPhone 11 Pro Max',

  // iPhone SE
  'iPhone14,6': 'iPhone SE (3rd generation)',
  'iPhone12,8': 'iPhone SE (2nd generation)',

  // iPhone X Series
  'iPhone11,2': 'iPhone XS',
  'iPhone11,4': 'iPhone XS Max',
  'iPhone11,6': 'iPhone XS Max',
  'iPhone11,8': 'iPhone XR',
  'iPhone10,3': 'iPhone X',
  'iPhone10,6': 'iPhone X',
}

/**
 * Map internal iPad model identifiers to marketing names
 */
const iPadModelMap: Record<string, string> = {
  // iPad Pro 12.9-inch
  'iPad14,6': 'iPad Pro 12.9-inch (6th generation)',
  'iPad8,12': 'iPad Pro 12.9-inch (5th generation)',
  'iPad8,11': 'iPad Pro 12.9-inch (4th generation)',

  // iPad Pro 11-inch
  'iPad14,4': 'iPad Pro 11-inch (4th generation)',
  'iPad13,7': 'iPad Pro 11-inch (3rd generation)',
  'iPad8,10': 'iPad Pro 11-inch (2nd generation)',
  'iPad8,9': 'iPad Pro 11-inch (1st generation)',

  // iPad Air
  'iPad13,17': 'iPad Air (5th generation)',
  'iPad13,2': 'iPad Air (4th generation)',
  'iPad11,4': 'iPad Air (3rd generation)',

  // iPad mini
  'iPad14,2': 'iPad mini (6th generation)',
  'iPad11,2': 'iPad mini (5th generation)',

  // iPad
  'iPad13,19': 'iPad (10th generation)',
  'iPad12,2': 'iPad (9th generation)',
  'iPad11,7': 'iPad (8th generation)',
  'iPad7,12': 'iPad (7th generation)',
}

/**
 * Convert internal model identifier to user-friendly marketing name
 */
function getMarketingName(model: string): string {
  // Check iPhone models
  if (iPhoneModelMap[model]) {
    return iPhoneModelMap[model]
  }

  // Check iPad models
  if (iPadModelMap[model]) {
    return iPadModelMap[model]
  }

  // Fallback for unknown models - try to parse intelligently
  if (model.startsWith('iPhone')) {
    // Extract version number (e.g., "iPhone18,1" -> "18,1")
    const match = model.match(/iPhone(\d+),(\d+)/)
    if (match) {
      const majorVersion = parseInt(match[1])
      const minorVersion = parseInt(match[2])

      // Rough mapping based on release patterns
      // Major version typically corresponds to iPhone generation + 7
      // (e.g., iPhone17,x = iPhone 16 series)
      const generation = majorVersion - 7

      // Minor version often indicates variant: 1=Pro, 2=Pro Max, 3=Base, 4=Plus
      const variants: Record<number, string> = {
        1: 'Pro',
        2: 'Pro Max',
        3: '',
        4: 'Plus',
      }

      const variant = variants[minorVersion] || ''
      return `iPhone ${generation}${variant ? ' ' + variant : ''} (${model})`
    }
  } else if (model.startsWith('iPad')) {
    return `iPad (${model})`
  }

  // Last resort: return the model identifier as-is
  return model
}

export interface DeviceFingerprint {
  id: string
  userAgent: string
  platform: string
  screenResolution: string
  colorDepth: number
  timezone: string
  language: string
  touchPoints: number
  hardwareConcurrency: number
  timestamp: string
}

export interface RegisteredDevice {
  fingerprint_id: string
  device_name: string // User-assigned name like "Warehouse Scanner 1" or "Jai's iPhone"
  device_type: 'iPhone' | 'iPad' | 'Android' | 'Desktop' | 'Unknown'
  os_name: string
  os_version: string
  browser: string
  first_registered: string
  last_seen: string
  user_id?: string
  is_active: boolean
}

/**
 * Create a unique device fingerprint
 * Uses multiple browser properties to create a consistent identifier
 */
export async function createDeviceFingerprint(): Promise<DeviceFingerprint> {
  const components = [
    navigator.userAgent,
    navigator.platform,
    navigator.language,
    screen.width + 'x' + screen.height,
    screen.colorDepth.toString(),
    new Date().getTimezoneOffset().toString(),
    navigator.hardwareConcurrency?.toString() || 'unknown',
    navigator.maxTouchPoints?.toString() || '0',
  ]

  const fingerprint = components.join('|')

  // Create hash for consistent ID
  const encoder = new TextEncoder()
  const data = encoder.encode(fingerprint)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')

  return {
    id: hashHex.substring(0, 32), // First 32 characters for storage
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    screenResolution: `${screen.width}x${screen.height}`,
    colorDepth: screen.colorDepth,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    language: navigator.language,
    touchPoints: navigator.maxTouchPoints || 0,
    hardwareConcurrency: navigator.hardwareConcurrency || 0,
    timestamp: new Date().toISOString(),
  }
}

/**
 * Parse user agent to extract device information
 * Uses Capacitor Device API when available for accurate native device info
 *
 * NOTE: IMEI is not accessible on iOS due to Apple's privacy restrictions.
 * We provide the Device UUID as an alternative unique hardware identifier.
 */
export async function parseDeviceInfo(
  userAgent: string = navigator.userAgent
): Promise<{
  deviceType: 'iPhone' | 'iPad' | 'Android' | 'Desktop' | 'Unknown'
  osName: string
  osVersion: string
  browser: string
  isIOSDevice: boolean
  model?: string
  manufacturer?: string
  isNativeApp: boolean
  deviceId?: string // UUID - alternative to IMEI (IMEI not available on iOS)
  webViewVersion?: string
  memoryUsed?: number
  batteryLevel?: number
  isCharging?: boolean
  rawModel?: string // Internal model identifier (e.g., iPhone17,1)
}> {
  // Check if running in Capacitor (native app) - multiple detection methods
  const capacitorNative = Capacitor.isNativePlatform()
  const capacitorPlatform = Capacitor.getPlatform()

  // Check for Capacitor bridge presence in window object
  const windowCap =
    typeof window !== 'undefined'
      ? (
          window as unknown as {
            Capacitor?: { platform?: string; isNativePlatform?: () => boolean }
          }
        ).Capacitor
      : null
  const bridgePlatform = windowCap?.platform
  const hasBridge = !!windowCap

  // Fallback detection: Check if running in iOS/Android WebView
  const uaLower = userAgent.toLowerCase()
  const isIOSDevice = /iphone|ipad|ipod/.test(uaLower)
  const isAndroidDevice = /android/.test(uaLower)
  const isStandaloneMode =
    typeof window !== 'undefined' &&
    ((window.navigator as Navigator & { standalone?: boolean }).standalone ===
      true ||
      window.matchMedia('(display-mode: standalone)').matches)

  // Consider it a native app if:
  // 1. Capacitor explicitly says so
  // 2. Capacitor platform is ios/android
  // 3. We have a Capacitor bridge with ios/android platform
  // 4. Running in standalone PWA mode on iOS/Android
  const isNativeApp =
    capacitorNative ||
    capacitorPlatform === 'ios' ||
    capacitorPlatform === 'android' ||
    bridgePlatform === 'ios' ||
    bridgePlatform === 'android' ||
    (isStandaloneMode && (isIOSDevice || isAndroidDevice))

  // Debug logging for Capacitor detection
  logger.log('🔍 Capacitor Detection:', {
    capacitorNative,
    capacitorPlatform,
    hasBridge,
    bridgePlatform,
    isIOSDevice,
    isAndroidDevice,
    isStandaloneMode,
    finalIsNativeApp: isNativeApp,
    userAgent: userAgent.substring(0, 150),
  })

  // Try to get device info from native APIs first
  let nativeInfo: DeviceInfo | null = null
  let deviceIdInfo: DeviceId | null = null

  try {
    // Always try Device.getInfo() - it might work even if isNativePlatform returns false
    nativeInfo = await Device.getInfo()
    logger.log('📱 Device.getInfo() Result:', nativeInfo)
  } catch (error) {
    logger.warn('⚠️ Device.getInfo() failed:', error)
    // Continue with user agent parsing
  }

  // Get unique device identifier (UUID - alternative to IMEI which is not available on iOS)
  try {
    deviceIdInfo = await Device.getId()
    logger.log('🔑 Device.getId() Result:', deviceIdInfo)
  } catch (error) {
    logger.warn('⚠️ Device.getId() failed:', error)
    // Continue without device ID
  }

  // If we have native info with valid platform, use it
  if (
    nativeInfo &&
    (nativeInfo.platform === 'ios' || nativeInfo.platform === 'android')
  ) {
    let deviceType: 'iPhone' | 'iPad' | 'Android' | 'Desktop' | 'Unknown' =
      'Unknown'

    if (nativeInfo.platform === 'ios') {
      // Detect iPhone vs iPad based on model or user agent
      if (
        nativeInfo.model?.toLowerCase().includes('ipad') ||
        /ipad/.test(uaLower)
      ) {
        deviceType = 'iPad'
      } else {
        deviceType = 'iPhone'
      }
    } else if (nativeInfo.platform === 'android') {
      deviceType = 'Android'
    }

    // Convert internal model identifier to marketing name
    const marketingName = nativeInfo.model
      ? getMarketingName(nativeInfo.model)
      : 'Unknown Device'

    logger.log('✅ Using native device info:', {
      deviceType,
      model: marketingName,
      rawModel: nativeInfo.model,
      deviceId: deviceIdInfo?.identifier
        ? `${deviceIdInfo.identifier.substring(0, 8)}...`
        : 'N/A',
    })

    return {
      deviceType,
      osName:
        nativeInfo.operatingSystem === 'ios'
          ? deviceType === 'iPad'
            ? 'iPadOS'
            : 'iOS'
          : nativeInfo.operatingSystem === 'android'
            ? 'Android'
            : nativeInfo.operatingSystem,
      osVersion: nativeInfo.osVersion || 'Unknown',
      browser: nativeInfo.webViewVersion || 'Native WebView',
      isIOSDevice: nativeInfo.platform === 'ios',
      model: marketingName,
      manufacturer:
        nativeInfo.manufacturer ||
        (nativeInfo.platform === 'ios' ? 'Apple' : 'Unknown'),
      isNativeApp: true,
      deviceId: deviceIdInfo?.identifier, // UUID - alternative to IMEI (not available on iOS)
      webViewVersion: nativeInfo.webViewVersion,
      memoryUsed: nativeInfo.memUsed,
      rawModel: nativeInfo.model, // Internal model identifier (e.g., iPhone17,1)
    }
  }

  // Fallback to user agent parsing (native API not available or failed)
  logger.log('⚠️ Falling back to user agent parsing for device info')
  const ua = userAgent.toLowerCase()

  let deviceType: 'iPhone' | 'iPad' | 'Android' | 'Desktop' | 'Unknown' =
    'Unknown'
  let osName = 'Unknown'
  let osVersion = 'Unknown'
  let browser = 'Unknown'
  let model: string | undefined = undefined
  let manufacturer: string | undefined = undefined

  // iOS Detection
  if (/iphone/.test(ua)) {
    deviceType = 'iPhone'
    osName = 'iOS'
    manufacturer = 'Apple'

    // Extract iOS version (e.g., "OS 17_1_2" -> "17.1.2")
    const iosVersionMatch = userAgent.match(/OS ([\d_]+)/)
    if (iosVersionMatch) {
      osVersion = iosVersionMatch[1].replace(/_/g, '.')
    }

    // Try to guess iPhone model from iOS version (rough approximation)
    const majorVersion = parseInt(osVersion.split('.')[0] || '0')
    if (majorVersion >= 18) {
      model = 'iPhone (iOS 18+)'
    } else if (majorVersion >= 17) {
      model = 'iPhone (iOS 17)'
    } else if (majorVersion >= 16) {
      model = 'iPhone (iOS 16)'
    } else {
      model = 'iPhone'
    }
  } else if (/ipad/.test(ua)) {
    deviceType = 'iPad'
    osName = 'iPadOS'
    manufacturer = 'Apple'
    model = 'iPad'

    const iosVersionMatch = userAgent.match(/OS ([\d_]+)/)
    if (iosVersionMatch) {
      osVersion = iosVersionMatch[1].replace(/_/g, '.')
    }
  }
  // Android Detection
  else if (/android/.test(ua)) {
    deviceType = 'Android'
    osName = 'Android'

    const androidVersionMatch = ua.match(/android ([\d.]+)/)
    if (androidVersionMatch) {
      osVersion = androidVersionMatch[1]
    }

    // Try to extract Android device model from user agent
    const modelMatch = userAgent.match(/; ([^;)]+) Build/)
    if (modelMatch) {
      model = modelMatch[1].trim()
      // Extract manufacturer from model (usually first word)
      const parts = model.split(' ')
      if (parts.length > 0) {
        manufacturer = parts[0]
      }
    }
  }
  // Desktop Detection
  else {
    deviceType = 'Desktop'

    if (/win/.test(ua)) {
      osName = 'Windows'
    } else if (/mac/.test(ua)) {
      osName = 'macOS'
    } else if (/linux/.test(ua)) {
      osName = 'Linux'
    }
  }

  // Browser Detection
  if (ua.includes('chrome') && !ua.includes('edg')) {
    browser = 'Chrome'
  } else if (ua.includes('safari') && !ua.includes('chrome')) {
    browser = 'Safari'
  } else if (ua.includes('firefox')) {
    browser = 'Firefox'
  } else if (ua.includes('edg')) {
    browser = 'Edge'
  }

  logger.log('📋 User Agent Parsing Result:', {
    deviceType,
    osName,
    osVersion,
    model,
    isNativeApp,
    deviceId: deviceIdInfo?.identifier
      ? `${deviceIdInfo.identifier.substring(0, 8)}...`
      : 'N/A',
  })

  // Use the isNativeApp detection from the top of the function
  // This handles cases where Capacitor.getInfo() fails but we still detected native app
  return {
    deviceType,
    osName,
    osVersion,
    browser: isNativeApp ? 'Native WebView' : browser,
    isIOSDevice: deviceType === 'iPhone' || deviceType === 'iPad',
    model,
    manufacturer,
    isNativeApp,
    deviceId: deviceIdInfo?.identifier, // UUID - alternative to IMEI (not available on iOS)
  }
}

/**
 * Get or create device registration from localStorage
 */
export async function getDeviceRegistration(): Promise<RegisteredDevice | null> {
  try {
    const stored = localStorage.getItem('rf_device_registration')
    if (stored) {
      const device = JSON.parse(stored) as RegisteredDevice

      // Update last seen
      device.last_seen = new Date().toISOString()
      localStorage.setItem('rf_device_registration', JSON.stringify(device))

      return device
    }
    return null
  } catch (error) {
    logger.error('Error retrieving device registration:', error)
    return null
  }
}

/**
 * Register a new device with user-assigned name
 */
export async function registerDevice(
  deviceName: string,
  userId?: string
): Promise<RegisteredDevice> {
  const fingerprint = await createDeviceFingerprint()
  const deviceInfo = await parseDeviceInfo()

  const registration: RegisteredDevice = {
    fingerprint_id: fingerprint.id,
    device_name: deviceName,
    device_type: deviceInfo.deviceType,
    os_name: deviceInfo.osName,
    os_version: deviceInfo.osVersion,
    browser: deviceInfo.browser,
    first_registered: new Date().toISOString(),
    last_seen: new Date().toISOString(),
    user_id: userId,
    is_active: true,
  }

  // Store in localStorage for persistence
  localStorage.setItem('rf_device_registration', JSON.stringify(registration))

  return registration
}

/**
 * Update device name
 */
export async function updateDeviceName(newName: string): Promise<void> {
  const registration = await getDeviceRegistration()

  if (registration) {
    registration.device_name = newName
    registration.last_seen = new Date().toISOString()
    localStorage.setItem('rf_device_registration', JSON.stringify(registration))
  }
}

/**
 * Clear device registration (useful for testing or device transfer)
 */
export function clearDeviceRegistration(): void {
  localStorage.removeItem('rf_device_registration')
}

/**
 * Generate a suggested device name based on user and device info
 */
export async function generateSuggestedDeviceName(
  userName?: string
): Promise<string> {
  const deviceInfo = await parseDeviceInfo()

  if (userName) {
    // Include model for more specific name in native apps
    if (deviceInfo.isNativeApp && deviceInfo.model) {
      return `${userName}'s ${deviceInfo.model}`
    }
    return `${userName}'s ${deviceInfo.deviceType}`
  }

  // Fallback suggestions
  const timestamp = new Date().toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  return `RF ${deviceInfo.deviceType} ${timestamp}`
}
