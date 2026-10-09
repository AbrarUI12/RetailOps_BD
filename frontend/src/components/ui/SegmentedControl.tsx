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

/**
 * Mutually exclusive choice (timeframes, filters, ৳/%). The selected state is pure CSS so it stays
 * correct inside sheets and drawers whose own entrance transforms would distort a shared Motion
 * layout indicator. Tabs (components/ui/Tabs) keep the sliding indicator.
 */
export function SegmentedControl<T extends string>({ className, label, onChange, options, value }: SegmentedControlProps<T>) {
  return (
    <div aria-label={label} className={cn("segmented", className)} role="group">
      {options.map((option) => (
        <button aria-pressed={option.value === value} key={option.value} onClick={() => onChange(option.value)} type="button">
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}
