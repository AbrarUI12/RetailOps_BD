import { motion } from "motion/react";
import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";

import { cn } from "../../lib/utils";

interface Tab<T extends string> {
  value: T;
  label: string;
  content: ReactNode;
}

interface TabsProps<T extends string> {
  tabs: readonly Tab<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}

/** WAI-ARIA tabs with arrow-key navigation and a shared sliding indicator (plan §9). */
export function Tabs<T extends string>({ className, label, onChange, tabs, value }: TabsProps<T>) {
  const id = useId();
  const listRef = useRef<HTMLDivElement>(null);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = tabs.findIndex((tab) => tab.value === value);
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + step + tabs.length) % tabs.length;
    onChange(tabs[next].value);
    listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  }

  const active = tabs.find((tab) => tab.value === value) ?? tabs[0];
  return (
    <div className={className}>
      <div aria-label={label} className="segmented tabs-list" onKeyDown={onKeyDown} ref={listRef} role="tablist">
        {tabs.map((tab) => {
          const selected = tab.value === active.value;
          return (
            <button
              aria-controls={`${id}-panel-${tab.value}`}
              aria-selected={selected}
              id={`${id}-tab-${tab.value}`}
              key={tab.value}
              onClick={() => onChange(tab.value)}
              role="tab"
              tabIndex={selected ? 0 : -1}
              type="button"
            >
              {selected ? <motion.span className="segmented-indicator" layoutId={`${id}-indicator`} transition={{ type: "spring", stiffness: 500, damping: 40 }} /> : null}
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>
      <div aria-labelledby={`${id}-tab-${active.value}`} className={cn("tab-panel")} id={`${id}-panel-${active.value}`} role="tabpanel" tabIndex={0}>
        {active.content}
      </div>
    </div>
  );
}
