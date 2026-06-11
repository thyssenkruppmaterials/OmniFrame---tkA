// Created and developed by Jai Singh
import { useEffect, useState } from "react";

import { listen } from "@/lib/tauri";

export interface RecordingStatus {
  recording: boolean;
  slot_id?: number;
  started_at?: string;
  reason?: string;
}

/**
 * Lightweight subscriber to the optional `recording-status` Tauri event the
 * agent emits when an operator-recorder session is running against a slot.
 * The detail panel uses this to render a small "● REC" badge alongside the
 * session-card header.
 *
 * Until the recording subsystem ships its event stream, this hook just
 * returns `{ recording: false }`; consumers should render conditionally.
 */
export function useRecordingStatus() {
  const [status, setStatus] = useState<RecordingStatus>({ recording: false });

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void listen<RecordingStatus>("recording-status", (next) => {
      if (cancelled) return;
      setStatus(next);
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
  }, []);

  return status;
}

// Created and developed by Jai Singh
