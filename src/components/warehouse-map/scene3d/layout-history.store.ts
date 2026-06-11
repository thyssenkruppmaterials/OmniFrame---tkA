// Created and developed by Jai Singh
// ---------------------------------------------------------------------------
// Layout edit history — a command-pattern undo/redo stack for the 3D editor.
// ---------------------------------------------------------------------------
// Every reversible edit (place / move / resize / recolor / delete / duplicate /
// array) is pushed as a command carrying its own `undo` and `redo` thunks (which
// call the scene-object service + invalidate). This is the backbone the whole
// editor composes on — multi-select group edits push ONE command that fans out.
//
// Standalone store (not the big warehouse-map store) so the HUD buttons, the
// keyboard handler, and the mutation wrappers all share one source of truth.
import { create } from 'zustand'

export interface LayoutCommand {
  /** Human label for the HUD tooltip / future history panel. */
  label: string
  /** Revert the action. */
  undo: () => void | Promise<void>
  /** Re-apply the action. */
  redo: () => void | Promise<void>
}

const MAX_DEPTH = 100

interface HistoryState {
  past: LayoutCommand[]
  future: LayoutCommand[]
  /** Guards against re-entrancy while an undo/redo thunk is in flight. */
  isBusy: boolean
  canUndo: boolean
  canRedo: boolean
  lastLabel: string | null

  /** Record an action that has ALREADY been applied; clears the redo stack. */
  push: (cmd: LayoutCommand) => void
  undo: () => Promise<void>
  redo: () => Promise<void>
  clear: () => void
}

export const useLayoutHistory = create<HistoryState>((set, get) => ({
  past: [],
  future: [],
  isBusy: false,
  canUndo: false,
  canRedo: false,
  lastLabel: null,

  push: (cmd) =>
    set((s) => {
      const past = [...s.past, cmd]
      if (past.length > MAX_DEPTH) past.shift()
      return {
        past,
        future: [],
        canUndo: true,
        canRedo: false,
        lastLabel: cmd.label,
      }
    }),

  undo: async () => {
    const { past, future, isBusy } = get()
    if (isBusy || past.length === 0) return
    const cmd = past[past.length - 1]
    set({ isBusy: true })
    try {
      await cmd.undo()
    } finally {
      const nextPast = past.slice(0, -1)
      const nextFuture = [...future, cmd]
      set({
        past: nextPast,
        future: nextFuture,
        isBusy: false,
        canUndo: nextPast.length > 0,
        canRedo: true,
        lastLabel: cmd.label,
      })
    }
  },

  redo: async () => {
    const { past, future, isBusy } = get()
    if (isBusy || future.length === 0) return
    const cmd = future[future.length - 1]
    set({ isBusy: true })
    try {
      await cmd.redo()
    } finally {
      const nextFuture = future.slice(0, -1)
      const nextPast = [...past, cmd]
      set({
        past: nextPast,
        future: nextFuture,
        isBusy: false,
        canUndo: true,
        canRedo: nextFuture.length > 0,
        lastLabel: cmd.label,
      })
    }
  },

  clear: () =>
    set({
      past: [],
      future: [],
      canUndo: false,
      canRedo: false,
      lastLabel: null,
    }),
}))

// Created and developed by Jai Singh
