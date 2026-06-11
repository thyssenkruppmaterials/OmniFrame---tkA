// Created and developed by Jai Singh
import * as React from "react";

import { cn } from "@/lib/utils";

type KbdProps = React.HTMLAttributes<HTMLElement>;

export const Kbd = React.forwardRef<HTMLElement, KbdProps>(
  ({ className, children, ...props }, ref) => (
    <kbd
      ref={ref}
      className={cn(
        "inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded border border-border bg-muted px-1 font-mono text-[10px] font-medium text-muted-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </kbd>
  ),
);
Kbd.displayName = "Kbd";

// Created and developed by Jai Singh
