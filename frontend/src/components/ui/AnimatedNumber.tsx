import { animate, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

interface AnimatedNumberProps {
  value: number;
  format: (value: number) => string;
  className?: string;
}

/** Counts smoothly to a new total (plan §9.8); jumps instantly under reduced motion. */
export function AnimatedNumber({ className, format, value }: AnimatedNumberProps) {
  const reduceMotion = useReducedMotion();
  const [display, setDisplay] = useState(value);
  const previous = useRef(value);

  useEffect(() => {
    const from = previous.current;
    previous.current = value;
    if (reduceMotion || from === value) {
      setDisplay(value);
      return undefined;
    }
    const controls = animate(from, value, { duration: 0.35, ease: [0.22, 1, 0.36, 1], onUpdate: setDisplay });
    return () => controls.stop();
  }, [reduceMotion, value]);

  return (
    <span className={className} style={{ fontVariantNumeric: "tabular-nums" }}>
      {format(display)}
      <span className="sr-only" aria-live="polite">{display === value ? "" : format(value)}</span>
    </span>
  );
}
