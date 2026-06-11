// Created and developed by Jai Singh
import { describe, expect, it } from 'vitest'
import {
  CONTINENT_ORDER,
  continentOfLatLng,
  continentOfNode,
  continentsInNetwork,
} from './continents'
import { DEMO_NETWORKS } from './demo-networks'
import type { SupplyChainNode } from './types'

function node(country: string, lat = 0, lng = 0): SupplyChainNode {
  return {
    id: 'x',
    name: 'x',
    kind: 'factory',
    tier: 0,
    lat,
    lng,
    country,
    capacityPerWeek: 1,
    throughputPerWeek: 1,
  }
}

describe('continentOfNode — country lookup', () => {
  it.each([
    ['United States', 'north_america'],
    ['Mexico', 'north_america'],
    ['Chile', 'south_america'],
    ['Germany', 'europe'],
    ['DR Congo', 'africa'],
    ['Mozambique', 'africa'],
    ['China', 'asia'],
    ['Taiwan', 'asia'],
    ['Singapore', 'asia'],
    ['Australia', 'oceania'],
  ] as const)('%s → %s', (country, continent) => {
    expect(continentOfNode(node(country))).toBe(continent)
  })
})

describe('continentOfLatLng — fallback for unmapped countries', () => {
  it.each([
    ['Chicago', 41.9, -87.6, 'north_america'],
    ['São Paulo', -23.5, -46.6, 'south_america'],
    ['Moscow', 55.8, 37.6, 'europe'],
    ['Lagos', 6.5, 3.4, 'africa'],
    ['Vladivostok', 43.1, 131.9, 'asia'],
    ['Sydney', -33.9, 151.2, 'oceania'],
    ['Jakarta (north of oceania cutoff)', -6.2, 106.8, 'asia'],
  ] as const)('%s → %s', (_name, lat, lng, continent) => {
    expect(continentOfLatLng(lat, lng)).toBe(continent)
  })

  it('drives classification when the country is unmapped', () => {
    expect(continentOfNode(node('Atlantis', 48.8, 2.3))).toBe('europe')
  })
})

describe('continentsInNetwork', () => {
  it.each(DEMO_NETWORKS.map((d) => [d.id, d] as const))(
    '%s classifies every node and spans multiple continents',
    (_id, network) => {
      for (const n of network.nodes) {
        expect(CONTINENT_ORDER).toContain(continentOfNode(n))
      }
      const present = continentsInNetwork(network)
      expect(present.length).toBeGreaterThanOrEqual(2)
      // stable display order
      const indices = present.map((c) => CONTINENT_ORDER.indexOf(c))
      expect([...indices].sort((a, b) => a - b)).toEqual(indices)
    }
  )
})
