import { motion } from "motion/react";
import type { ComponentProps } from "react";

export function LayoutList(props: ComponentProps<typeof motion.div>) {
  return <motion.div layout="position" {...props} />;
}

