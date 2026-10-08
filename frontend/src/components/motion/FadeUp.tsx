import { motion } from "motion/react";
import type { ComponentProps } from "react";

interface FadeUpProps extends ComponentProps<typeof motion.div> {
  delay?: number;
}

export function FadeUp({ children, delay = 0, ...props }: FadeUpProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay, ease: [0.22, 1, 0.36, 1] }}
      {...props}
    >
      {children}
    </motion.div>
  );
}

