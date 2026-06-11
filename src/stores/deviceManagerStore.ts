// Created and developed by Jai Singh
import { create } from 'zustand'

interface DeviceManagerState {
  selectedDeviceId: string | null
  selectedGroupId: string | null
  fleetFilters: FleetFilters
  commandDraftState: CommandDraft | null
  approvalModalOpen: boolean
  approvalCommandId: string | null
  mapMode: 'live' | 'history' | 'geofence'
  liveRefreshEnabled: boolean

  setSelectedDevice: (id: string | null) => void
  setSelectedGroup: (id: string | null) => void
  setFleetFilters: (filters: Partial<FleetFilters>) => void
  resetFleetFilters: () => void
  setCommandDraft: (draft: CommandDraft | null) => void
  openApprovalModal: (commandId: string) => void
  closeApprovalModal: () => void
  setMapMode: (mode: 'live' | 'history' | 'geofence') => void
  setLiveRefreshEnabled: (enabled: boolean) => void
}

interface FleetFilters {
  search: string
  status: string[]
  model: string[]
  osVersion: string[]
  groupId: string | null
  enrollmentType: string[]
  complianceStatus: string | null
}

interface CommandDraft {
  commandType: string
  targetDeviceIds: string[]
  targetGroupId: string | null
  payload: Record<string, unknown>
  scheduledAt: string | null
}

const DEFAULT_FILTERS: FleetFilters = {
  search: '',
  status: [],
  model: [],
  osVersion: [],
  groupId: null,
  enrollmentType: [],
  complianceStatus: null,
}

export const useDeviceManagerStore = create<DeviceManagerState>((set) => ({
  selectedDeviceId: null,
  selectedGroupId: null,
  fleetFilters: DEFAULT_FILTERS,
  commandDraftState: null,
  approvalModalOpen: false,
  approvalCommandId: null,
  mapMode: 'live',
  liveRefreshEnabled: true,

  setSelectedDevice: (id) => set({ selectedDeviceId: id }),
  setSelectedGroup: (id) => set({ selectedGroupId: id }),
  setFleetFilters: (filters) =>
    set((state) => ({
      fleetFilters: { ...state.fleetFilters, ...filters },
    })),
  resetFleetFilters: () => set({ fleetFilters: DEFAULT_FILTERS }),
  setCommandDraft: (draft) => set({ commandDraftState: draft }),
  openApprovalModal: (commandId) =>
    set({ approvalModalOpen: true, approvalCommandId: commandId }),
  closeApprovalModal: () =>
    set({ approvalModalOpen: false, approvalCommandId: null }),
  setMapMode: (mode) => set({ mapMode: mode }),
  setLiveRefreshEnabled: (enabled) => set({ liveRefreshEnabled: enabled }),
}))

// Created and developed by Jai Singh
