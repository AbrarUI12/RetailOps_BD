import { motion, useReducedMotion } from "motion/react";

import { initials } from "../../lib/format";
import { cn } from "../../lib/utils";

/**
 * Product image or initials. The large drawer version scales in from the row (plan §9.5); list
 * thumbs stay static because the table and phone cards render each row twice, and a shared
 * layoutId would make Motion hide one copy.
 */
export function ProductThumb({ imageUrl, large = false, name }: { id?: string; name: string; imageUrl: string | null; large?: boolean }) {
  const reduceMotion = useReducedMotion();
  const size = large ? 96 : 44;
  const content = imageUrl ? (
    <img alt="" decoding="async" height={size} loading="lazy" referrerPolicy="no-referrer" src={imageUrl} width={size} />
  ) : initials(name);
  if (!large) return <span aria-hidden="true" className="thumb">{content}</span>;
  return (
    <motion.span
      animate={{ opacity: 1, scale: 1 }}
      aria-hidden="true"
      className={cn("thumb", "large")}
      initial={reduceMotion ? false : { opacity: 0, scale: 0.6 }}
      transition={{ type: "spring", stiffness: 380, damping: 30 }}
    >
      {content}
    </motion.span>
  );
}
