import { motion } from "motion/react";
import { useId } from "react";

import { cn } from "../../lib/utils";

interface Option<T extends string> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  options: readonly Option<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}

/** Mutually exclusive choice (timeframes, views) with a shared sliding indicator (plan §9). */
export function SegmentedControl<T extends string>({ className, label, onChange, options, value }: SegmentedControlProps<T>) {
  const layoutId = useId();
  return (
    <div aria-label={label} className={cn("segmented", className)} role="group">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button aria-pressed={active} key={option.value} onClick={() => onChange(option.value)} type="button">
            {active ? <motion.span className="segmented-indicator" layoutId={layoutId} transition={{ type: "spring", stiffness: 500, damping: 40 }} /> : null}
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
