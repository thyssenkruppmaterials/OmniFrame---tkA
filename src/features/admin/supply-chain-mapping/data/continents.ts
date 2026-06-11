// Created and developed by Jai Singh
// Continent classification for supply-chain nodes — drives the "region
// focus" drill-down level (domestic / intra-continental view). Pure data +
// math, no three.js or React imports, so it stays unit-testable.
import type { SupplyChainNetwork, SupplyChainNode } from './types'

export type Continent =
  | 'north_america'
  | 'south_america'
  | 'europe'
  | 'africa'
  | 'asia'
  | 'oceania'

/** Stable display order for region pickers. */
export const CONTINENT_ORDER: Continent[] = [
  'north_america',
  'south_america',
  'europe',
  'africa',
  'asia',
  'oceania',
]

export const CONTINENT_LABELS: Record<Continent, string> = {
  north_america: 'North America',
  south_america: 'South America',
  europe: 'Europe',
  africa: 'Africa',
  asia: 'Asia',
  oceania: 'Oceania',
}

/**
 * Country → continent for every country that appears in shipped scenarios,
 * plus common trade-lane countries. Anything unmapped falls back to the
 * lat/lng heuristic below (deliberate for transcontinental countries like
 * Russia, where the site's coordinates decide).
 */
const COUNTRY_TO_CONTINENT: Record<string, Continent> = {
  // North America
  'United States': 'north_america',
  Canada: 'north_america',
  Mexico: 'north_america',
  Panama: 'north_america',
  'Costa Rica': 'north_america',
  Guatemala: 'north_america',
  // South America
  Chile: 'south_america',
  Brazil: 'south_america',
  Argentina: 'south_america',
  Peru: 'south_america',
  Colombia: 'south_america',
  Ecuador: 'south_america',
  Bolivia: 'south_america',
  Uruguay: 'south_america',
  Venezuela: 'south_america',
  // Europe
  Germany: 'europe',
  Netherlands: 'europe',
  Poland: 'europe',
  Switzerland: 'europe',
  Ireland: 'europe',
  France: 'europe',
  Belgium: 'europe',
  Spain: 'europe',
  Italy: 'europe',
  'United Kingdom': 'europe',
  Czechia: 'europe',
  Austria: 'europe',
  Hungary: 'europe',
  Slovakia: 'europe',
  Sweden: 'europe',
  Norway: 'europe',
  Denmark: 'europe',
  Finland: 'europe',
  Portugal: 'europe',
  // Africa
  'DR Congo': 'africa',
  Mozambique: 'africa',
  'South Africa': 'africa',
  Egypt: 'africa',
  Morocco: 'africa',
  Nigeria: 'africa',
  Kenya: 'africa',
  Ethiopia: 'africa',
  Ghana: 'africa',
  Tanzania: 'africa',
  Zambia: 'africa',
  // Asia
  China: 'asia',
  Taiwan: 'asia',
  'South Korea': 'asia',
  Japan: 'asia',
  Malaysia: 'asia',
  Singapore: 'asia',
  'Hong Kong': 'asia',
  India: 'asia',
  Indonesia: 'asia',
  Vietnam: 'asia',
  Thailand: 'asia',
  Philippines: 'asia',
  Bangladesh: 'asia',
  Pakistan: 'asia',
  'Saudi Arabia': 'asia',
  'United Arab Emirates': 'asia',
  Israel: 'asia',
  Kazakhstan: 'asia',
  // Oceania
  Australia: 'oceania',
  'New Zealand': 'oceania',
  'Papua New Guinea': 'oceania',
  Fiji: 'oceania',
}

/**
 * Rough geographic fallback for unmapped countries. Boxes are coarse on
 * purpose — country lookup is the primary classifier; this only has to be
 * directionally right for sites we have never seen.
 */
export function continentOfLatLng(lat: number, lng: number): Continent {
  if (lng < -30) return lat >= 8 ? 'north_america' : 'south_america'
  if (lng >= 110 && lat < -10) return 'oceania'
  if (lat >= 35 && lng >= -25 && lng < 45) return 'europe'
  if (lat < 35 && lat > -35 && lng >= -20 && lng <= 52) return 'africa'
  return 'asia'
}

export function continentOfNode(node: SupplyChainNode): Continent {
  return (
    COUNTRY_TO_CONTINENT[node.country] ?? continentOfLatLng(node.lat, node.lng)
  )
}

/** Continents present in a network, in stable display order. */
export function continentsInNetwork(network: SupplyChainNetwork): Continent[] {
  const present = new Set(network.nodes.map(continentOfNode))
  return CONTINENT_ORDER.filter((c) => present.has(c))
}
