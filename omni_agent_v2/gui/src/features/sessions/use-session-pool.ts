// Created and developed by Jai Singh
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { listen, tauriApi } from "@/lib/tauri";
import type { SessionPoolSnapshot } from "@/lib/types";

/**
 * Session-pool reader.
 *
 * Sources of truth, in priority order:
 *   1. `session-state-changed` Tauri events (emitted by the Rust poller in
 *      `crates/agent-gui/src/main.rs` whenever a slot diffs).
 *   2. A backup `useQuery` polling `get_session_states` every 5s in case
 *      events are lost or the agent restarts.
 *
 * Both paths converge through the React Query cache so consumers see a
 * single snapshot.
 */

export const SESSION_POOL_QUERY_KEY = ["session-pool"] as const;

export function useSessionPool() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: SESSION_POOL_QUERY_KEY,
    queryFn: () => tauriApi.getSessionStates(),
    refetchInterval: 5_000,
    refetchOnWindowFocus: false,
    staleTime: 250,
  });

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void listen<SessionPoolSnapshot>("session-state-changed", (snapshot) => {
      if (cancelled) return;
      qc.setQueryData(SESSION_POOL_QUERY_KEY, snapshot);
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
  }, [qc]);

  return query;
}

// Created and developed by Jai Singh
