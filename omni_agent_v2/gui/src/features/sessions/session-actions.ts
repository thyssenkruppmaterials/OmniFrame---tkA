// Created and developed by Jai Singh
import { toast } from "sonner";

import { tauriApi } from "@/lib/tauri";

/**
 * Friendly wrappers around the session command surface that show a toast on
 * success / failure. Components import these instead of calling
 * `tauriApi.*` directly so the UX is consistent across the master grid and
 * the detail panel.
 */

async function withToast<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<T | undefined> {
  const id = toast.loading(label);
  try {
    const result = await fn();
    toast.success(label, { id, duration: 1500 });
    return result;
  } catch (err) {
    toast.error(label, {
      id,
      description: err instanceof Error ? err.message : String(err),
      duration: 6_000,
    });
    return undefined;
  }
}

export const sessionActions = {
  connect: (slotId: number) =>
    withToast(`Connect slot ${slotId + 1}`, () =>
      tauriApi.connectSession(slotId),
    ),
  disconnect: (slotId: number) =>
    withToast(`Disconnect slot ${slotId + 1}`, () =>
      tauriApi.disconnectSession(slotId),
    ),
  release: (slotId: number) =>
    withToast(`Release slot ${slotId + 1}`, () =>
      tauriApi.releaseSession(slotId),
    ),
  pin: (slotId: number, connIdx: number, sessIdx: number) =>
    withToast(`Pin slot ${slotId + 1} → ${connIdx}/${sessIdx}`, () =>
      tauriApi.pinSapSession(slotId, connIdx, sessIdx),
    ),
  listSapSessions: () => tauriApi.listSapSessions(),
  runQuickAction: <T = unknown>(
    slotId: number,
    action: string,
    payload: unknown,
    label?: string,
  ) =>
    withToast(label ?? `${action.toUpperCase()} on slot ${slotId + 1}`, () =>
      tauriApi.runQuickAction<T>(slotId, action, payload),
    ),
};

// Created and developed by Jai Singh
