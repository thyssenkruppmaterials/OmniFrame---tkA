---
tags: [type/implementation, status/active, domain/backend, domain/database]
created: 2026-04-10
---
# Path Engine Location Mapping Configuration

## Purpose
Configured the Path Engine's Resolution Rules and Path Rules to handle three warehouse area types: Racks, Kardex vertical storage, and Shelves.

## Resolution Rules Created

### 1. Racks (RD/RE/RF)
- **Format:** `RD-14-A-01` = Aisle-Bay-Level-Bin
- **Regex:** `^(R[D-F])-(\d+)-([A-Z])-(\d+)$`
- **Zone:** `Racks` (static)
- **Aisle:** `\1` (RD, RE, RF)
- **Sequence:** `\2\4` (bay+bin concatenated, e.g., 1401)

### 2. Kardex (K1-K4)
- **Format:** `K3-01-01-2` = Kardex#-Tray-Slot-Row
- **Regex:** `^(K[1-4])-(\d+)-(\d+)-(\d+)$`
- **Zone:** `Kardex` (static)
- **Aisle:** `\1` (each machine is its own aisle)
- **Sequence:** `\2\3\4` (tray+slot+row concatenated)

### 3. Shelves (S-series)
- **Format:** `SF-22-A-01` = Aisle-Bay-Level-Bin
- **Regex:** `^(S[A-Z])-(\d+)-([A-Z])-(\d+)$`
- **Zone:** `Shelves` (static)
- **Aisle:** `\1` (SB, SC, SD, SF, etc.)
- **Sequence:** `\2\4` (bay+bin concatenated)

## Path Rules
Three zone-specific rules (Racks, Kardex, Shelves) all using Serpentine Zone strategy with max 1 counter per aisle.

## Related
- [[Cycle-Count-System]]


## UI Redesign (2026-04-10)

Redesigned the Path Engine panel for end-user clarity. Tabs renamed to "Location Rules" and "Counting Rules". All technical labels replaced with plain language. Added tooltip help on every field, collapsible Advanced section for canonical bin template, and enhanced test results showing resolved Zone/Aisle/Order instead of raw regex groups.