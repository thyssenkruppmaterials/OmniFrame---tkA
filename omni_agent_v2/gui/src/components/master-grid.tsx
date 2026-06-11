// Created and developed by Jai Singh
import { AnimatePresence, motion } from "framer-motion";

import { SessionCard } from "@/components/session-card";
import type { SessionSlot } from "@/lib/types";

interface MasterGridProps {
  slots: SessionSlot[];
  selectedSlot: number;
  onSelect: (slotId: number) => void;
}

const HOTKEYS = ["⌘1", "⌘2", "⌘3", "⌘4", "⌘5", "⌘6"] as const;

export function MasterGrid({
  slots,
  selectedSlot,
  onSelect,
}: MasterGridProps) {
  return (
    <AnimatePresence mode="popLayout">
      <motion.div
        layout
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
      >
        {slots.map((slot, idx) => (
          <SessionCard
            key={slot.slot_id}
            slot={slot}
            selected={selectedSlot === slot.slot_id}
            onSelect={onSelect}
            hotkey={HOTKEYS[idx]}
          />
        ))}
      </motion.div>
    </AnimatePresence>
  );
}

// Created and developed by Jai Singh
