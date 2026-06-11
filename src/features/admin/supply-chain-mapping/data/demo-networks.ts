// Created and developed by Jai Singh
// Demo supply-chain scenarios. Coordinates are real-world; volumes are
// illustrative. Each scenario seeds a different disruption mix so the map
// shows nominal / elevated / bottleneck / broken lanes out of the box.
import type {
  LinkDisruption,
  NodeKind,
  SupplyChainLink,
  SupplyChainNetwork,
  SupplyChainNode,
  TransportMode,
} from './types'

function n(
  id: string,
  name: string,
  kind: NodeKind,
  tier: number,
  lat: number,
  lng: number,
  country: string,
  capacityPerWeek: number,
  throughputPerWeek: number,
  inventoryDaysOfSupply?: number
): SupplyChainNode {
  return {
    id,
    name,
    kind,
    tier,
    lat,
    lng,
    country,
    capacityPerWeek,
    throughputPerWeek,
    inventoryDaysOfSupply,
  }
}

function l(
  from: string,
  to: string,
  mode: TransportMode,
  leadTimeDays: number,
  capacityPerWeek: number,
  flowPerWeek: number,
  disruption?: LinkDisruption
): SupplyChainLink {
  return {
    id: `${from}->${to}`,
    from,
    to,
    mode,
    leadTimeDays,
    capacityPerWeek,
    flowPerWeek,
    disruption,
  }
}

/* ────────────────────────────── Scenario 1 ──────────────────────────────
 * Global electronics: raw materials → wafer fabs / component clusters →
 * final assembly → sea + air lanes → regional DCs → markets.
 * Seeded events: Red Sea closure (Suez lane broken, Cape reroute strained),
 * West-coast port congestion, one fab running hot.
 * ──────────────────────────────────────────────────────────────────────── */
const electronics: SupplyChainNetwork = {
  id: 'electronics',
  name: 'Global Electronics — Server Platform',
  description:
    'Multi-tier silicon-to-rack network: mines and polysilicon through wafer fabs, component clusters, final assembly, and dual sea/air distribution into four demand regions.',
  product: 'Rack-scale compute servers',
  nodes: [
    // Tier 0 — raw material origins
    n(
      'lithium-au',
      'Greenbushes Lithium',
      'source',
      0,
      -33.86,
      116.06,
      'Australia',
      900,
      760
    ),
    n(
      'cobalt-cd',
      'Kolwezi Cobalt',
      'source',
      0,
      -10.71,
      25.47,
      'DR Congo',
      500,
      430
    ),
    n(
      'rare-earth-cn',
      'Baotou Rare Earths',
      'source',
      0,
      40.66,
      109.83,
      'China',
      700,
      610
    ),
    n(
      'poly-de',
      'Burghausen Polysilicon',
      'source',
      0,
      48.17,
      12.83,
      'Germany',
      650,
      560
    ),
    n(
      'copper-cl',
      'Escondida Copper',
      'source',
      0,
      -24.27,
      -69.07,
      'Chile',
      800,
      690
    ),
    // Tier 1 — fabs & refined materials
    n(
      'fab-tw',
      'Hsinchu Wafer Fab',
      'supplier',
      1,
      24.78,
      121.0,
      'Taiwan',
      520,
      500,
      11
    ),
    n(
      'fab-kr',
      'Hwaseong Memory Fab',
      'supplier',
      1,
      37.2,
      127.0,
      'South Korea',
      480,
      410,
      18
    ),
    n(
      'cathode-kr',
      'Cheongju Cathode',
      'supplier',
      1,
      36.64,
      127.49,
      'South Korea',
      420,
      360,
      14
    ),
    n(
      'pcb-cn',
      'Shenzhen PCB Cluster',
      'supplier',
      1,
      22.54,
      114.06,
      'China',
      600,
      510,
      9
    ),
    n(
      'passives-my',
      'Penang Passives',
      'supplier',
      1,
      5.35,
      100.3,
      'Malaysia',
      450,
      380,
      16
    ),
    n(
      'power-jp',
      'Osaka Power Modules',
      'supplier',
      1,
      34.69,
      135.5,
      'Japan',
      300,
      255,
      21
    ),
    // Tier 2 — final assembly
    n(
      'asm-zz',
      'Zhengzhou Assembly',
      'factory',
      2,
      34.75,
      113.62,
      'China',
      340,
      322,
      6
    ),
    n(
      'asm-tw',
      'Taoyuan Assembly',
      'factory',
      2,
      25.0,
      121.3,
      'Taiwan',
      260,
      215,
      8
    ),
    n(
      'asm-mx',
      'Guadalajara Assembly',
      'factory',
      2,
      20.67,
      -103.35,
      'Mexico',
      180,
      150,
      12
    ),
    // Tier 3 — origin ports / air hubs
    n(
      'port-sha',
      'Port of Shanghai',
      'port',
      3,
      30.63,
      122.06,
      'China',
      700,
      540
    ),
    n(
      'port-yantian',
      'Yantian Terminal',
      'port',
      3,
      22.58,
      114.27,
      'China',
      520,
      410
    ),
    n(
      'port-khh',
      'Port of Kaohsiung',
      'port',
      3,
      22.61,
      120.28,
      'Taiwan',
      420,
      300
    ),
    n(
      'air-hkg',
      'Hong Kong Air Cargo',
      'airport',
      3,
      22.31,
      113.91,
      'Hong Kong',
      160,
      132
    ),
    n(
      'air-anc',
      'Anchorage Air Hub',
      'airport',
      3,
      61.17,
      -149.99,
      'United States',
      170,
      138
    ),
    // Tier 4 — destination gateways
    n(
      'port-lalb',
      'LA / Long Beach',
      'port',
      4,
      33.74,
      -118.26,
      'United States',
      560,
      525
    ),
    n(
      'port-svn',
      'Port of Savannah',
      'port',
      4,
      32.13,
      -81.14,
      'United States',
      380,
      250
    ),
    n(
      'port-rtm',
      'Port of Rotterdam',
      'port',
      4,
      51.95,
      4.14,
      'Netherlands',
      520,
      370
    ),
    n(
      'port-sin',
      'Port of Singapore',
      'port',
      4,
      1.26,
      103.84,
      'Singapore',
      600,
      470
    ),
    // Tier 5 — regional DCs
    n(
      'dc-reno',
      'Reno Mega DC',
      'distribution_center',
      5,
      39.53,
      -119.81,
      'United States',
      330,
      300,
      13
    ),
    n(
      'dc-louisville',
      'Louisville DC',
      'distribution_center',
      5,
      38.25,
      -85.76,
      'United States',
      260,
      205,
      17
    ),
    n(
      'dc-tilburg',
      'Tilburg EU DC',
      'distribution_center',
      5,
      51.56,
      5.09,
      'Netherlands',
      300,
      245,
      15
    ),
    n(
      'dc-sin',
      'Singapore APAC DC',
      'distribution_center',
      5,
      1.35,
      103.94,
      'Singapore',
      280,
      235,
      14
    ),
    // Tier 6 — demand regions
    n(
      'mkt-us-west',
      'NA West Market',
      'market',
      6,
      37.77,
      -122.42,
      'United States',
      320,
      290
    ),
    n(
      'mkt-us-east',
      'NA East Market',
      'market',
      6,
      40.71,
      -74.01,
      'United States',
      300,
      240
    ),
    n('mkt-eu', 'EU Market', 'market', 6, 50.11, 8.68, 'Germany', 310, 250),
    n('mkt-apac', 'APAC Market', 'market', 6, 35.68, 139.69, 'Japan', 290, 230),
  ],
  links: [
    // Raw → tier 1
    l('lithium-au', 'cathode-kr', 'sea', 14, 420, 350),
    l('cobalt-cd', 'cathode-kr', 'sea', 28, 260, 215),
    l('rare-earth-cn', 'power-jp', 'sea', 7, 280, 235),
    l('rare-earth-cn', 'pcb-cn', 'rail', 4, 340, 290),
    l('poly-de', 'fab-tw', 'sea', 32, 320, 270),
    l('poly-de', 'fab-kr', 'sea', 30, 260, 215),
    l('copper-cl', 'pcb-cn', 'sea', 25, 380, 310),
    // Tier 1 → assembly
    l('fab-tw', 'asm-zz', 'air', 2, 200, 192, {
      kind: 'congestion',
      severity: 0.35,
      note: 'Advanced-node allocation — orders on controlled release',
    }),
    l('fab-tw', 'asm-tw', 'road', 1, 180, 150),
    l('fab-kr', 'asm-zz', 'sea', 4, 220, 175),
    l('cathode-kr', 'power-jp', 'sea', 3, 200, 165),
    l('pcb-cn', 'asm-zz', 'road', 2, 320, 295),
    l('pcb-cn', 'asm-tw', 'sea', 4, 180, 140),
    l('passives-my', 'asm-zz', 'sea', 6, 240, 200),
    l('passives-my', 'asm-tw', 'sea', 5, 150, 115),
    l('power-jp', 'asm-zz', 'sea', 4, 160, 138),
    l('power-jp', 'asm-mx', 'sea', 16, 110, 88),
    l('fab-tw', 'asm-mx', 'air', 3, 90, 72),
    l('pcb-cn', 'asm-mx', 'sea', 19, 120, 95),
    // Assembly → origin gateways
    l('asm-zz', 'port-sha', 'rail', 2, 360, 330),
    l('asm-zz', 'port-yantian', 'road', 3, 240, 205),
    l('asm-zz', 'air-hkg', 'road', 2, 110, 96),
    l('asm-tw', 'port-khh', 'road', 1, 250, 195),
    l('asm-tw', 'air-hkg', 'air', 1, 60, 42),
    // Ocean legs
    l('port-sha', 'port-lalb', 'sea', 15, 380, 355, {
      kind: 'congestion',
      severity: 0.55,
      note: 'Transpacific peak surge — 6.2 days average anchorage wait',
    }),
    l('port-sha', 'port-rtm', 'sea', 33, 260, 230, {
      kind: 'closure',
      severity: 1,
      note: 'Red Sea transit suspended — Suez routing closed to carrier',
    }),
    l('port-sha', 'port-sin', 'sea', 6, 300, 250),
    l('port-yantian', 'port-lalb', 'sea', 16, 300, 245),
    l('port-yantian', 'port-svn', 'sea', 24, 220, 165),
    l('port-khh', 'port-lalb', 'sea', 14, 260, 200),
    l('port-sin', 'port-rtm', 'sea', 39, 280, 262, {
      kind: 'capacity_loss',
      severity: 0.3,
      note: 'Cape of Good Hope reroute absorbing diverted Suez volume',
    }),
    // Air legs
    l('air-hkg', 'air-anc', 'air', 1, 150, 128),
    l('air-anc', 'dc-louisville', 'air', 1, 150, 126),
    l('air-hkg', 'dc-tilburg', 'air', 2, 70, 52),
    // Destination gateway → DC
    l('port-lalb', 'dc-reno', 'rail', 3, 340, 318, {
      kind: 'congestion',
      severity: 0.45,
      note: 'Chassis shortage at intermodal yard — dwell 4.1 days',
    }),
    l('port-svn', 'dc-louisville', 'road', 2, 200, 150),
    l('port-rtm', 'dc-tilburg', 'road', 1, 320, 240),
    l('port-sin', 'dc-sin', 'road', 1, 300, 235),
    l('asm-mx', 'dc-reno', 'road', 4, 130, 102),
    l('asm-mx', 'dc-louisville', 'rail', 5, 110, 84),
    // DC → market
    l('dc-reno', 'mkt-us-west', 'road', 1, 320, 290),
    l('dc-reno', 'mkt-us-east', 'rail', 4, 120, 92),
    l('dc-louisville', 'mkt-us-east', 'road', 1, 240, 195),
    l('dc-tilburg', 'mkt-eu', 'road', 1, 300, 250),
    l('dc-sin', 'mkt-apac', 'sea', 4, 270, 230),
  ],
}

/* ────────────────────────────── Scenario 2 ──────────────────────────────
 * EV automotive platform: battery minerals → cells/semis → vehicle plants
 * → ro-ro distribution. Seeded events: cell plant quality hold, chip
 * bottleneck, rail strike closure.
 * ──────────────────────────────────────────────────────────────────────── */
const automotive: SupplyChainNetwork = {
  id: 'automotive',
  name: 'Automotive — Global EV Platform',
  description:
    'Battery minerals through cell plants and semiconductor fabs into three vehicle plants, with ro-ro ocean distribution to dealer regions.',
  product: 'Battery-electric vehicles',
  nodes: [
    n(
      'li-cl',
      'Atacama Lithium Brine',
      'source',
      0,
      -23.5,
      -68.25,
      'Chile',
      700,
      620
    ),
    n(
      'ni-id',
      'Morowali Nickel',
      'source',
      0,
      -2.64,
      121.91,
      'Indonesia',
      620,
      540
    ),
    n(
      'graphite-mz',
      'Balama Graphite',
      'source',
      0,
      -13.35,
      38.65,
      'Mozambique',
      380,
      300
    ),
    n(
      'cathode-kr2',
      'Pohang Cathode',
      'supplier',
      1,
      36.02,
      129.36,
      'South Korea',
      520,
      450,
      12
    ),
    n(
      'cells-cn',
      'Ningde Cell Plant',
      'supplier',
      1,
      26.66,
      119.55,
      'China',
      480,
      455,
      7
    ),
    n(
      'cells-pl',
      'Wrocław Cell Plant',
      'supplier',
      1,
      51.11,
      17.04,
      'Poland',
      300,
      282,
      9
    ),
    n(
      'chips-de',
      'Dresden Power Semis',
      'supplier',
      1,
      51.05,
      13.74,
      'Germany',
      240,
      230,
      5
    ),
    n(
      'chips-us',
      'Austin MCU Fab',
      'supplier',
      1,
      30.27,
      -97.74,
      'United States',
      200,
      168,
      8
    ),
    n(
      'drivetrain-jp',
      'Nagoya e-Axle',
      'supplier',
      1,
      35.18,
      136.91,
      'Japan',
      260,
      215,
      15
    ),
    n(
      'plant-tx',
      'Texas Vehicle Plant',
      'factory',
      2,
      30.22,
      -97.62,
      'United States',
      190,
      172,
      6
    ),
    n(
      'plant-de',
      'Brandenburg Plant',
      'factory',
      2,
      52.39,
      13.79,
      'Germany',
      170,
      148,
      8
    ),
    n(
      'plant-cn',
      'Shanghai Plant',
      'factory',
      2,
      30.88,
      121.77,
      'China',
      220,
      196,
      5
    ),
    n(
      'roro-bremerhaven',
      'Bremerhaven Ro-Ro',
      'port',
      3,
      53.55,
      8.55,
      'Germany',
      200,
      152
    ),
    n(
      'roro-sha',
      'Shanghai Haitong Ro-Ro',
      'port',
      3,
      30.62,
      122.08,
      'China',
      240,
      188
    ),
    n(
      'roro-zeebrugge',
      'Zeebrugge Ro-Ro',
      'port',
      4,
      51.35,
      3.2,
      'Belgium',
      220,
      160
    ),
    n(
      'dealers-na',
      'NA Dealer Network',
      'market',
      5,
      39.74,
      -104.99,
      'United States',
      260,
      215
    ),
    n(
      'dealers-eu',
      'EU Dealer Network',
      'market',
      5,
      48.86,
      2.35,
      'France',
      240,
      190
    ),
    n(
      'dealers-apac',
      'APAC Dealer Network',
      'market',
      5,
      1.29,
      103.85,
      'Singapore',
      200,
      158
    ),
  ],
  links: [
    l('li-cl', 'cathode-kr2', 'sea', 28, 360, 300),
    l('ni-id', 'cathode-kr2', 'sea', 9, 320, 270),
    l('ni-id', 'cells-cn', 'sea', 7, 260, 210),
    l('graphite-mz', 'cells-cn', 'sea', 21, 220, 175),
    l('cathode-kr2', 'cells-cn', 'sea', 3, 300, 255),
    l('cathode-kr2', 'cells-pl', 'sea', 34, 220, 185),
    l('cells-cn', 'plant-cn', 'road', 2, 240, 218),
    l('cells-cn', 'plant-tx', 'sea', 24, 180, 171, {
      kind: 'quality_hold',
      severity: 0.6,
      note: 'Cell lot quarantine — thermal cycling audit in progress',
    }),
    l('cells-pl', 'plant-de', 'road', 1, 260, 230),
    l('chips-de', 'plant-de', 'road', 1, 120, 110),
    l('chips-de', 'plant-cn', 'air', 3, 90, 87, {
      kind: 'capacity_loss',
      severity: 0.4,
      note: 'IGBT allocation — single-source power module constraint',
    }),
    l('chips-us', 'plant-tx', 'road', 1, 140, 112),
    l('drivetrain-jp', 'plant-cn', 'sea', 4, 160, 130),
    l('drivetrain-jp', 'plant-tx', 'sea', 17, 130, 104),
    l('plant-de', 'roro-bremerhaven', 'rail', 1, 180, 150, {
      kind: 'closure',
      severity: 1,
      note: 'National rail strike — vehicle trains suspended',
    }),
    l('plant-de', 'roro-zeebrugge', 'road', 2, 120, 96),
    l('plant-cn', 'roro-sha', 'road', 1, 220, 180),
    l('roro-sha', 'dealers-apac', 'sea', 6, 200, 156),
    l('roro-sha', 'dealers-na', 'sea', 18, 160, 128),
    l('roro-bremerhaven', 'dealers-eu', 'road', 2, 180, 90),
    l('roro-zeebrugge', 'dealers-eu', 'road', 1, 160, 128),
    l('plant-tx', 'dealers-na', 'road', 3, 200, 168),
  ],
}

/* ────────────────────────────── Scenario 3 ──────────────────────────────
 * Pharma cold chain: API → fill-finish → air cold-chain hubs → regional
 * distribution. Tight, high-value, fragile.
 * ──────────────────────────────────────────────────────────────────────── */
const pharma: SupplyChainNetwork = {
  id: 'pharma',
  name: 'Pharma — Biologics Cold Chain',
  description:
    'Temperature-controlled biologics network: API synthesis through fill-finish into airfreight cold-chain hubs and regional pharma DCs.',
  product: 'mAb biologic (2–8 °C)',
  nodes: [
    n(
      'api-in',
      'Hyderabad API Campus',
      'source',
      0,
      17.39,
      78.49,
      'India',
      300,
      260
    ),
    n(
      'api-ie',
      'Cork API Plant',
      'source',
      0,
      51.9,
      -8.47,
      'Ireland',
      240,
      200
    ),
    n(
      'ff-ch',
      'Basel Fill-Finish',
      'factory',
      1,
      47.56,
      7.59,
      'Switzerland',
      260,
      240,
      10
    ),
    n(
      'ff-us',
      'RTP Fill-Finish',
      'factory',
      1,
      35.9,
      -78.86,
      'United States',
      220,
      175,
      14
    ),
    n(
      'air-zrh',
      'Zurich Pharma Hub',
      'airport',
      2,
      47.46,
      8.55,
      'Switzerland',
      200,
      178
    ),
    n(
      'air-cvg',
      'Cincinnati Cold Hub',
      'airport',
      2,
      39.05,
      -84.66,
      'United States',
      190,
      150
    ),
    n(
      'air-sin2',
      'Changi Coolport',
      'airport',
      2,
      1.36,
      103.99,
      'Singapore',
      160,
      126
    ),
    n(
      'dc-memphis',
      'Memphis Pharma DC',
      'distribution_center',
      3,
      35.15,
      -90.05,
      'United States',
      180,
      142
    ),
    n(
      'dc-frankfurt',
      'Frankfurt Pharma DC',
      'distribution_center',
      3,
      50.03,
      8.57,
      'Germany',
      170,
      150
    ),
    n(
      'dc-tokyo',
      'Narita Pharma DC',
      'distribution_center',
      3,
      35.77,
      140.39,
      'Japan',
      140,
      110
    ),
    n(
      'mkt-na-health',
      'NA Health Systems',
      'market',
      4,
      41.88,
      -87.63,
      'United States',
      200,
      158
    ),
    n(
      'mkt-eu-health',
      'EU Health Systems',
      'market',
      4,
      52.52,
      13.41,
      'Germany',
      180,
      148
    ),
    n(
      'mkt-apac-health',
      'APAC Health Systems',
      'market',
      4,
      35.68,
      139.69,
      'Japan',
      150,
      118
    ),
  ],
  links: [
    l('api-in', 'ff-ch', 'air', 3, 170, 148),
    l('api-in', 'ff-us', 'air', 4, 140, 112),
    l('api-ie', 'ff-ch', 'road', 3, 130, 105),
    l('ff-ch', 'air-zrh', 'road', 1, 200, 178),
    l('ff-us', 'air-cvg', 'road', 1, 180, 146),
    l('air-zrh', 'dc-frankfurt', 'road', 1, 170, 152, {
      kind: 'congestion',
      severity: 0.5,
      note: 'GDP lane audit — reefer truck capacity halved this week',
    }),
    l('air-zrh', 'air-sin2', 'air', 2, 110, 86),
    l('air-zrh', 'dc-tokyo', 'air', 2, 80, 78, {
      kind: 'capacity_loss',
      severity: 0.35,
      note: 'Active container (Envirotainer) shortage on JP rotation',
    }),
    l('air-cvg', 'dc-memphis', 'road', 1, 170, 138),
    l('air-sin2', 'dc-tokyo', 'air', 1, 90, 70),
    l('dc-memphis', 'mkt-na-health', 'road', 2, 170, 136),
    l('dc-frankfurt', 'mkt-eu-health', 'road', 1, 160, 142),
    l('dc-tokyo', 'mkt-apac-health', 'road', 1, 130, 104),
    l('ff-us', 'dc-memphis', 'road', 2, 90, 30),
  ],
}

export const DEMO_NETWORKS: SupplyChainNetwork[] = [
  electronics,
  automotive,
  pharma,
]
