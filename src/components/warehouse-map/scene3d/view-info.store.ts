// Created and developed by Jai Singh
// ---------------------------------------------------------------------------
// view-info.store — bridges live camera metrics from inside the Canvas to the
// DOM HUD (scale bar + compass). Written by <ViewReporter> (throttled in
// useFrame), read by the DOM widgets.
import { create } from 'zustand'

interface ViewInfoState {
  /** Scene meters per screen pixel (accurate in iso; approximate in perspective). */
  metersPerPixel: number
  /** Heading of "north" (world -Z) relative to the current view, degrees. */
  northDeg: number
  set: (metersPerPixel: number, northDeg: number) => void
}

export const useViewInfo = create<ViewInfoState>((set) => ({
  metersPerPixel: 0.05,
  northDeg: 0,
  set: (metersPerPixel, northDeg) => set({ metersPerPixel, northDeg }),
}))

// Created and developed by Jai Singh
