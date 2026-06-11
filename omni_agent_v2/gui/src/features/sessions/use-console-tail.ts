// Created and developed by Jai Singh
import { useCallback, useEffect, useRef, useState } from "react";

import { listen, tauriApi } from "@/lib/tauri";
import type { ConsoleLine } from "@/lib/types";

const DEFAULT_MAX_LINES = 200;

interface UseConsoleTailOptions {
  slotId: number;
  maxLines?: number;
  paused?: boolean;
}

/**
 * Console tail consumer.
 *
 * Subscribes to `console-line:{slot_id}` Tauri events for the active slot
 * and keeps a bounded ring buffer of the most recent N lines (default 200).
 * Falls back to a one-shot HTTP fetch (`getConsoleTail(slot, 0)`) on mount
 * so the panel renders something even before the first event arrives.
 *
 * Returns:
 *   - `lines` — newest-last list, sliced to `maxLines`.
 *   - `clear()` — manually empty the buffer (the Clear button in the UI).
 *   - `setPaused(p)` — pause inbound events without clearing the buffer.
 *   - `paused` — current pause state.
 */
export function useConsoleTail({
  slotId,
  maxLines = DEFAULT_MAX_LINES,
  paused: pausedProp,
}: UseConsoleTailOptions) {
  const [lines, setLines] = useState<ConsoleLine[]>([]);
  const [pausedState, setPausedState] = useState(false);
  const paused = pausedProp ?? pausedState;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  // Reset when slot changes.
  useEffect(() => {
    setLines([]);
    let cancelled = false;
    void tauriApi.getConsoleTail(slotId, 0).then((initial) => {
      if (cancelled) return;
      setLines(initial.slice(-maxLines));
    });
    return () => {
      cancelled = true;
    };
  }, [slotId, maxLines]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    const eventName = `console-line:${slotId}`;
    void listen<ConsoleLine>(eventName, (line) => {
      if (cancelled || pausedRef.current) return;
      setLines((prev) => {
        const next = prev.length >= maxLines ? prev.slice(-(maxLines - 1)) : prev;
        return [...next, line];
      });
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlisten = fn;
      }
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [slotId, maxLines]);

  const clear = useCallback(() => setLines([]), []);
  const setPaused = useCallback((next: boolean) => setPausedState(next), []);

  return { lines, clear, paused, setPaused };
}

// Created and developed by Jai Singh
