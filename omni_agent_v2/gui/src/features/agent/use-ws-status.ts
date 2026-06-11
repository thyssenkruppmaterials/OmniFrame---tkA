// Created and developed by Jai Singh
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { listen, tauriApi } from "@/lib/tauri";
import type { WsStatus } from "@/lib/types";

export const WS_STATUS_QUERY_KEY = ["ws-status"] as const;

/**
 * Standalone WS status reader for the header bar. The poller also pushes
 * `ws-event` payloads (a subset of [`AgentMetrics.ws_status`]) every metrics
 * tick — we mirror those into the same query cache so subscribers stay in
 * lockstep with the agent-metrics query.
 */
export function useWsStatus() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: WS_STATUS_QUERY_KEY,
    queryFn: () => tauriApi.getWsStatus(),
    refetchInterval: 10_000,
    refetchOnWindowFocus: false,
    staleTime: 1_000,
  });

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void listen<WsStatus>("ws-event", (status) => {
      if (cancelled) return;
      qc.setQueryData(WS_STATUS_QUERY_KEY, status);
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
