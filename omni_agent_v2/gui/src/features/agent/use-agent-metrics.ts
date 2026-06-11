// Created and developed by Jai Singh
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { listen, tauriApi } from "@/lib/tauri";
import type { AgentMetrics } from "@/lib/types";

export const AGENT_METRICS_QUERY_KEY = ["agent-metrics"] as const;

/**
 * Agent metrics reader — polls `get_agent_metrics` every 5s and overlays
 * `agent-metrics` Tauri events for sub-5s updates when the Rust poller
 * detects a change.
 */
export function useAgentMetrics() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: AGENT_METRICS_QUERY_KEY,
    queryFn: () => tauriApi.getAgentMetrics(),
    refetchInterval: 5_000,
    refetchOnWindowFocus: false,
    staleTime: 1_000,
  });

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void listen<AgentMetrics>("agent-metrics", (metrics) => {
      if (cancelled) return;
      qc.setQueryData(AGENT_METRICS_QUERY_KEY, metrics);
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
