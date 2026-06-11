// Created and developed by Jai Singh
// Spherical math for the supply-chain globe: lat/lng placement and
// great-circle flight arcs. Pure (only three's math types) — unit-testable.
import { Curve, Vector3 } from 'three'

export const GLOBE_RADIUS = 100

const DEG = Math.PI / 180

/** lat/lng (degrees) → point on a sphere of the given radius (y up). */
export function latLngToVector3(
  lat: number,
  lng: number,
  radius: number = GLOBE_RADIUS
): Vector3 {
  const phi = (90 - lat) * DEG // polar angle from +y
  const theta = (lng + 180) * DEG
  return new Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  )
}

/** Angular distance (radians) between two unit-sphere points. */
export function angularDistance(a: Vector3, b: Vector3): number {
  const dot = a.clone().normalize().dot(b.clone().normalize())
  return Math.acos(Math.min(1, Math.max(-1, dot)))
}

/**
 * Great-circle arc with altitude lift, as an exact parametric Curve so
 * TubeGeometry samples it without Catmull-Rom approximation. Lift scales
 * with angular span (long-haul lanes fly higher), capped so antipodal-ish
 * routes don't leave the camera frame.
 */
export class GreatCircleArc extends Curve<Vector3> {
  private readonly a: Vector3
  private readonly b: Vector3
  private readonly omega: number
  private readonly sinOmega: number
  private readonly radius: number
  private readonly lift: number

  constructor(
    from: Vector3,
    to: Vector3,
    radius: number = GLOBE_RADIUS,
    liftFactor: number = 0.28
  ) {
    super()
    this.radius = radius
    this.a = from.clone().normalize()
    this.b = to.clone().normalize()
    this.omega = angularDistance(this.a, this.b)
    this.sinOmega = Math.sin(this.omega)
    // Altitude: proportional to span, between 1.5% and 35% of the radius
    this.lift = Math.min(
      0.35,
      Math.max(0.015, (this.omega / Math.PI) * liftFactor * 2)
    )
  }

  override getPoint(t: number, target: Vector3 = new Vector3()): Vector3 {
    // Spherical linear interpolation between the two unit vectors
    if (this.sinOmega < 1e-6) {
      target.copy(this.a)
    } else {
      const w1 = Math.sin((1 - t) * this.omega) / this.sinOmega
      const w2 = Math.sin(t * this.omega) / this.sinOmega
      target.set(
        this.a.x * w1 + this.b.x * w2,
        this.a.y * w1 + this.b.y * w2,
        this.a.z * w1 + this.b.z * w2
      )
      target.normalize()
    }
    const altitude = 1 + Math.sin(Math.PI * t) * this.lift
    return target.multiplyScalar(this.radius * altitude)
  }

  /** Approximate arc length factor — used to keep pulse speed uniform. */
  get span(): number {
    return this.omega
  }
}

/** Build the arc for a lane between two lat/lng endpoints. */
export function laneArc(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
  radius: number = GLOBE_RADIUS
): GreatCircleArc {
  return new GreatCircleArc(
    latLngToVector3(fromLat, fromLng, radius),
    latLngToVector3(toLat, toLng, radius),
    radius
  )
}

/**
 * Evenly distributed points on a sphere (Fibonacci lattice) — the dot grid
 * used for the landmass. Returns lat/lng pairs in degrees.
 */
export function fibonacciSphere(count: number): Array<[number, number]> {
  const pts: Array<[number, number]> = []
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2
    const lat = Math.asin(y) / DEG
    const lng = (((i * golden) / DEG) % 360) - 180
    pts.push([lat, lng])
  }
  return pts
}
