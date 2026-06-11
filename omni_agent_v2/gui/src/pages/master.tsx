// Created and developed by Jai Singh
import { useEffect, useMemo, useState } from "react";

import { AgentStatusStrip } from "@/components/agent-status";
import { FleetCard } from "@/components/fleet-card";
import { MasterGrid } from "@/components/master-grid";
import { SessionDetail } from "@/components/session-detail";
import { useSessionPool } from "@/features/sessions/use-session-pool";
import type { SessionSlot } from "@/lib/types";
import { SLOT_COUNT } from "@/lib/types";
import { clamp } from "@/lib/utils";

/**
 * Primary view — the operator console.
 *
 * Layout:
 *   ┌─ Header bar (rendered by App)
 *   ├─ Agent status strip (healthy / jobs / WS / helper / uptime)
 *   ├─ Master grid (2×3 desktop, 1×2 narrow) + selected slot detail
 *   └─ Fleet card sidebar (peer agents)
 */
export function MasterPage() {
  const { data } = useSessionPool();
  const slots = useMemo(() => normaliseSlots(data?.slots), [data?.slots]);

  const [selectedSlot, setSelectedSlot] = useState(0);

  // Heuristic: when the snapshot first loads, focus the first busy slot so
  // the operator sees real activity instead of an empty slot.
  useEffect(() => {
    if (selectedSlot !== 0) return;
    const busy = slots.findIndex((s) => s.state === "busy" || s.state === "error");
    if (busy >= 0) setSelectedSlot(busy);
  }, [slots, selectedSlot]);

  // ⌘1 / Ctrl+1 …  ⌘6 / Ctrl+6 to switch slots.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const num = Number.parseInt(e.key, 10);
      if (Number.isNaN(num) || num < 1 || num > SLOT_COUNT) return;
      e.preventDefault();
      setSelectedSlot(clamp(num - 1, 0, SLOT_COUNT - 1));
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const active = slots[selectedSlot] ?? slots[0];

  return (
    <main className="bg-grid-pattern flex min-h-0 flex-1 flex-col gap-4 p-5">
      <AgentStatusStrip />
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-[1fr_360px]">
        <div className="flex min-h-0 flex-col gap-4">
          <MasterGrid
            slots={slots}
            selectedSlot={selectedSlot}
            onSelect={setSelectedSlot}
          />
          <div className="flex min-h-[440px] flex-1">
            <SessionDetail slot={active} />
          </div>
        </div>
        <aside className="hidden xl:flex">
          <FleetCard />
        </aside>
      </div>
    </main>
  );
}

function normaliseSlots(input: SessionSlot[] | undefined): SessionSlot[] {
  const base: SessionSlot[] = Array.from(
    { length: SLOT_COUNT },
    (_, slot_id): SessionSlot => ({
      slot_id,
      state: "empty",
      busy: false,
      pinned: false,
    }),
  );
  if (!input) return base;
  for (const slot of input) {
    const idx = slot.slot_id;
    if (idx < 0 || idx >= SLOT_COUNT) continue;
    base[idx] = { ...base[idx], ...slot };
  }
  return base;
}

// Created and developed by Jai Singh
