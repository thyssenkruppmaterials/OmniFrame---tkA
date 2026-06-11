// Created and developed by Jai Singh
import { useState } from "react";
import { ChevronDown, Play, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { sessionActions } from "@/features/sessions/session-actions";
import { QUICK_ACTIONS, type QuickActionId } from "@/lib/types";

interface QuickActionsProps {
  slotId: number;
  disabled?: boolean;
}

interface ActionForm {
  toNumber: string;
  material: string;
  plant: string;
}

const DEFAULT_FORM: ActionForm = {
  toNumber: "",
  material: "",
  plant: "WH5",
};

export function QuickActions({ slotId, disabled = false }: QuickActionsProps) {
  const [openAction, setOpenAction] = useState<QuickActionId | null>(null);
  const [form, setForm] = useState<ActionForm>(DEFAULT_FORM);
  const [lastResult, setLastResult] = useState<unknown>(null);

  function payloadForAction(action: QuickActionId): Record<string, unknown> {
    switch (action) {
      case "lt12_confirm":
        return { to_number: form.toNumber.trim() };
      case "mm03_lookup":
        return { material: form.material.trim() };
      case "zmm60_lookup":
        return { material: form.material.trim(), plant: form.plant.trim() };
      case "lt24_query":
        return { material: form.material.trim() };
      default:
        return {};
    }
  }

  async function dispatch(action: QuickActionId) {
    const payload = payloadForAction(action);
    const result = await sessionActions.runQuickAction<unknown>(
      slotId,
      action,
      payload,
      `${action.toUpperCase()} on slot ${slotId + 1}`,
    );
    if (result !== undefined) setLastResult(result);
    setOpenAction(null);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
        <Zap className="h-3 w-3" />
        Quick actions
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {QUICK_ACTIONS.map((action) => (
          <Dialog
            key={action.id}
            open={openAction === action.id}
            onOpenChange={(open) => setOpenAction(open ? action.id : null)}
          >
            <DialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                disabled={disabled}
                className="justify-start font-mono"
              >
                <Play className="h-3 w-3" />
                {action.label}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  Run {action.label.toUpperCase()} on slot {slotId + 1}
                </DialogTitle>
                <DialogDescription>{action.description}</DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-3">
                {action.id === "lt12_confirm" ? (
                  <Field
                    label="TO number"
                    value={form.toNumber}
                    placeholder="e.g. 8801234"
                    onChange={(v) =>
                      setForm((prev) => ({ ...prev, toNumber: v }))
                    }
                  />
                ) : null}
                {(action.id === "mm03_lookup" ||
                  action.id === "lt24_query") ? (
                  <Field
                    label="Material"
                    value={form.material}
                    placeholder="e.g. 12345"
                    onChange={(v) =>
                      setForm((prev) => ({ ...prev, material: v }))
                    }
                  />
                ) : null}
                {action.id === "zmm60_lookup" ? (
                  <>
                    <Field
                      label="Material"
                      value={form.material}
                      placeholder="e.g. 12345"
                      onChange={(v) =>
                        setForm((prev) => ({ ...prev, material: v }))
                      }
                    />
                    <Field
                      label="Plant"
                      value={form.plant}
                      placeholder="e.g. WH5"
                      onChange={(v) =>
                        setForm((prev) => ({ ...prev, plant: v }))
                      }
                    />
                  </>
                ) : null}
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setOpenAction(null)}
                >
                  Cancel
                </Button>
                <Button onClick={() => void dispatch(action.id)}>
                  <Play className="h-3 w-3" />
                  Dispatch
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ))}
      </div>

      {lastResult ? (
        <details className="rounded-lg border border-border bg-card/60 p-3 text-[11px]">
          <summary className="flex cursor-pointer items-center gap-2 font-medium text-muted-foreground">
            <ChevronDown className="h-3 w-3" />
            Last action result
          </summary>
          <Separator className="my-2" />
          <pre className="overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-foreground">
            {JSON.stringify(lastResult, null, 2)}
          </pre>
        </details>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="rounded-lg border border-dashed border-border bg-card/30 px-3 py-2 text-[11px] text-muted-foreground">
              No actions dispatched yet. Pick a transaction above to send a
              one-shot job to this slot.
            </div>
          </TooltipTrigger>
          <TooltipContent>
            Actions hit the Python helper via `run_quick_action` and stream
            their progress through the console tail.
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

interface FieldProps {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (next: string) => void;
}

function Field({ label, value, placeholder, onChange }: FieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={label}>{label}</Label>
      <Input
        id={label}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

// Created and developed by Jai Singh
