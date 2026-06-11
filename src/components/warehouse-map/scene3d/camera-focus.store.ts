// Created and developed by Jai Singh
// ---------------------------------------------------------------------------
// camera-focus.store — a tiny bridge so DOM/keyboard can request a camera
// "frame-selection" tween that the in-Canvas <Focuser> performs. Target is in
// SCENE METERS (cx,cz) + a radius to fit. A nonce makes repeated focuses on the
// same target re-trigger the animation.
import { create } from 'zustand'

export interface FocusTarget {
  cx: number
  cz: number
  radius: number
}

interface CameraFocusState {
  target: FocusTarget | null
  nonce: number
  requestFocus: (t: FocusTarget) => void
  /** Multiplicative zoom request from DOM controls (>1 = zoom in). */
  zoomFactor: number
  zoomNonce: number
  requestZoom: (factor: number) => void
  /** "Frame the whole layout" request — resolved by the scene shell, which
   *  knows the bounds (the DOM toolbar does not). */
  frameAllNonce: number
  requestFrameAll: () => void
}

export const useCameraFocus = create<CameraFocusState>((set) => ({
  target: null,
  nonce: 0,
  requestFocus: (t) => set((s) => ({ target: t, nonce: s.nonce + 1 })),
  zoomFactor: 1,
  zoomNonce: 0,
  requestZoom: (factor) =>
    set((s) => ({ zoomFactor: factor, zoomNonce: s.zoomNonce + 1 })),
  frameAllNonce: 0,
  requestFrameAll: () => set((s) => ({ frameAllNonce: s.frameAllNonce + 1 })),
}))

// Created and developed by Jai Singh
