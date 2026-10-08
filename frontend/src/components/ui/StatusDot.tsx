import type { HTMLAttributes } from "react";

import { cn } from "../../lib/utils";

type StatusTone = "online" | "offline" | "syncing" | "warning" | "danger";

interface StatusDotProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: StatusTone;
  label?: string;
}

export function StatusDot({ className, label, tone = "online", ...props }: StatusDotProps) {
  return (
    <span className={cn("status-dot-wrap", className)} {...props}>
      <span aria-hidden="true" className={cn("status-dot", `status-dot-${tone}`)} />
      {label ? <span>{label}</span> : <span className="sr-only">{tone}</span>}
    </span>
  );
}

