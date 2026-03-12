import { supabase } from '@/lib/supabase/client'
import { logger } from '@/lib/utils/logger'

export interface AnomalyResult {
  hasAnomalies: boolean
  anomalies: string[]
  riskScore: number
  recommendedActions: string[]
}

interface GeoLocation {
  latitude?: number
  longitude?: number
}

interface SessionActivity {
  userId: string
  ip: string
  timestamp: string
  deviceFingerprint: string
  location?: GeoLocation
}

export class SessionAnomalyDetector {
  static async detectAnomalies(
    _sessionId: string,
    currentActivity: SessionActivity
  ): Promise<AnomalyResult> {
    const anomalies: string[] = []
    let riskScore = 0

    try {
      // 1. Check IP address changes
      const ipAnomalies = await this.checkIPAddressAnomalies(
        currentActivity.userId,
        currentActivity.ip
      )
      anomalies.push(...ipAnomalies.anomalies)
      riskScore += ipAnomalies.riskScore

      // 2. Check unusual time patterns
      const timeAnomalies = this.checkTimePatterns(currentActivity.timestamp)
      anomalies.push(...timeAnomalies.anomalies)
      riskScore += timeAnomalies.riskScore

      // 3. Check device fingerprint changes
      const deviceAnomalies = await this.checkDeviceFingerprint(
        currentActivity.userId,
        currentActivity.deviceFingerprint
      )
      anomalies.push(...deviceAnomalies.anomalies)
      riskScore += deviceAnomalies.riskScore

      // 4. Check geographic anomalies
      const geoAnomalies = await this.checkGeographicAnomalies(
        currentActivity.userId,
        currentActivity.location
      )
      anomalies.push(...geoAnomalies.anomalies)
      riskScore += geoAnomalies.riskScore

      // 5. Check session frequency patterns
      const frequencyAnomalies = await this.checkSessionFrequency(
        currentActivity.userId
      )
      anomalies.push(...frequencyAnomalies.anomalies)
      riskScore += frequencyAnomalies.riskScore

      return {
        hasAnomalies: anomalies.length > 0,
        anomalies,
        riskScore: Math.min(riskScore, 100),
        recommendedActions: this.getRecommendedActions(riskScore, anomalies),
      }
    } catch (error) {
      logger.error('Anomaly detection error:', error)
      return {
        hasAnomalies: true,
        anomalies: ['Detection system error'],
        riskScore: 50,
        recommendedActions: ['Manual security review required'],
      }
    }
  }

  private static async checkIPAddressAnomalies(
    userId: string,
    currentIP: string
  ): Promise<{ anomalies: string[]; riskScore: number }> {
    const anomalies: string[] = []
    let riskScore = 0

    try {
      // Get recent IP addresses for this user from audit logs
      const { data: recentSessions } = await supabase
        .from('audit_logs')
        .select('ip_address, created_at')
        .eq('user_id', userId)
        .gte(
          'created_at',
          new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
        )
        .order('created_at', { ascending: false })
        .limit(10)

      if (!recentSessions || recentSessions.length === 0)
        return { anomalies, riskScore }

      const uniqueIPs = new Set(
        recentSessions.map((s) => s.ip_address).filter(Boolean)
      )

      if (uniqueIPs.size > 3) {
        anomalies.push('Multiple IP addresses detected')
        riskScore += 30
      }

      if (!uniqueIPs.has(currentIP)) {
        anomalies.push('New IP address detected')
        riskScore += 20
      }

      // Check for suspicious IP patterns
      if (this.isSuspiciousIP(currentIP)) {
        anomalies.push('Suspicious IP address pattern')
        riskScore += 40
      }
    } catch (error) {
      logger.error('IP anomaly check error:', error)
    }

    return { anomalies, riskScore }
  }

  private static checkTimePatterns(timestamp: string): {
    anomalies: string[]
    riskScore: number
  } {
    const anomalies: string[] = []
    let riskScore = 0

    const currentHour = new Date(timestamp).getHours()

    // Check for unusual hours
    if (currentHour < 5 || currentHour > 22) {
      anomalies.push('Unusual access time')
      riskScore += 15
    }

    // Check for rapid successive logins
    // Implementation would check session creation timestamps

    return { anomalies, riskScore }
  }

  private static async checkDeviceFingerprint(
    userId: string,
    currentFingerprint: string
  ): Promise<{ anomalies: string[]; riskScore: number }> {
    const anomalies: string[] = []
    let riskScore = 0

    try {
      // Get recent device fingerprints from audit logs
      const { data: recentSessions } = await supabase
        .from('audit_logs')
        .select('metadata')
        .eq('user_id', userId)
        .gte(
          'created_at',
          new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
        )
        .not('metadata', 'is', null)

      if (!recentSessions) return { anomalies, riskScore }

      const knownFingerprints = new Set(
        recentSessions
          .map((s) => {
            const metadata = s.metadata as Record<string, unknown> | null
            return metadata?.deviceFingerprint as string | undefined
          })
          .filter(Boolean)
      )

      if (
        knownFingerprints.size > 0 &&
        !knownFingerprints.has(currentFingerprint)
      ) {
        anomalies.push('New device fingerprint detected')
        riskScore += 25
      }
    } catch (error) {
      logger.error('Device fingerprint check error:', error)
    }

    return { anomalies, riskScore }
  }

  private static async checkGeographicAnomalies(
    userId: string,
    currentLocation: GeoLocation | undefined
  ): Promise<{ anomalies: string[]; riskScore: number }> {
    const anomalies: string[] = []
    let riskScore = 0

    try {
      // Get user's typical locations from user profile
      const { data: userProfile } = await supabase
        .from('user_profiles')
        .select('metadata')
        .eq('id', userId)
        .single()

      if (userProfile?.metadata && currentLocation) {
        const metadata = userProfile.metadata as Record<string, unknown> | null
        if (metadata?.typical_location) {
          const distance = this.calculateDistance(
            metadata.typical_location as GeoLocation,
            currentLocation
          )

          if (distance > 500) {
            // More than 500km from typical location
            anomalies.push('Geographic location anomaly')
            riskScore += 35
          }
        }
      }
    } catch (error) {
      logger.error('Geographic anomaly check error:', error)
    }

    return { anomalies, riskScore }
  }

  private static async checkSessionFrequency(
    userId: string
  ): Promise<{ anomalies: string[]; riskScore: number }> {
    const anomalies: string[] = []
    let riskScore = 0

    try {
      // Check session creation frequency from audit logs
      const { data: recentSessions } = await supabase
        .from('audit_logs')
        .select('created_at')
        .eq('user_id', userId)
        .eq('action', 'login')
        .gte('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString()) // Last hour

      if (recentSessions && recentSessions.length > 5) {
        anomalies.push('High session creation frequency')
        riskScore += 20
      }
    } catch (error) {
      logger.error('Session frequency check error:', error)
    }

    return { anomalies, riskScore }
  }

  private static isSuspiciousIP(ip: string): boolean {
    // Check for known suspicious IP patterns
    const suspiciousPatterns = [
      /^192\.168\./, // Private network (shouldn't be external)
      /^10\./, // Private network
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // Private network
      // Add more patterns as needed
    ]

    return suspiciousPatterns.some((pattern) => pattern.test(ip))
  }

  private static calculateDistance(
    loc1: GeoLocation,
    loc2: GeoLocation
  ): number {
    // Simplified distance calculation
    if (!loc1 || !loc2) return 0

    const lat1 = loc1.latitude || 0
    const lon1 = loc1.longitude || 0
    const lat2 = loc2.latitude || 0
    const lon2 = loc2.longitude || 0

    const dLat = ((lat2 - lat1) * Math.PI) / 180
    const dLon = ((lon2 - lon1) * Math.PI) / 180

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2)

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    const distance = 6371 * c // Distance in km

    return distance
  }

  private static getRecommendedActions(
    riskScore: number,
    anomalies: string[]
  ): string[] {
    const actions: string[] = []

    if (riskScore >= 70) {
      actions.push('Immediate session termination')
      actions.push('Require multi-factor authentication')
      actions.push('Send security alert to user and administrators')
      actions.push('Log security incident for investigation')
    } else if (riskScore >= 40) {
      actions.push('Send security notification to user')
      actions.push('Increase monitoring for this session')
      actions.push('Require additional verification for sensitive operations')
    } else if (riskScore >= 20) {
      actions.push('Log anomaly for review')
      actions.push('Send low-priority security notification')
    }

    // Specific actions based on anomaly types
    if (anomalies.some((a) => a.includes('IP'))) {
      actions.push('Verify IP address legitimacy')
    }

    if (anomalies.some((a) => a.includes('device'))) {
      actions.push('Verify device authenticity')
    }

    return actions
  }
}
