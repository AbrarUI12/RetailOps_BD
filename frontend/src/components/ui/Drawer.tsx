import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

import { cn } from "../../lib/utils";

interface DrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /** Shown beside the title, e.g. a status badge. */
  meta?: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}

/** Detail panel that slides in from the right and keeps the list visible behind it (plan §9.4). */
export function Drawer({ children, description, footer, meta, onOpenChange, open, title, wide = false }: DrawerProps) {
  const reduceMotion = useReducedMotion();
  return (
    <DialogPrimitive.Root onOpenChange={onOpenChange} open={open}>
      <AnimatePresence>
        {open ? (
          <DialogPrimitive.Portal forceMount>
            <DialogPrimitive.Overlay asChild forceMount>
              <motion.div animate={{ opacity: 1 }} className="dialog-overlay" exit={{ opacity: 0 }} initial={{ opacity: 0 }} style={{ animation: "none" }} transition={{ duration: 0.16 }} />
            </DialogPrimitive.Overlay>
            <DialogPrimitive.Content asChild forceMount {...(description ? {} : { "aria-describedby": undefined })}>
              <motion.aside
                animate={{ x: 0, opacity: 1 }}
                className={cn("drawer-content", wide && "wide")}
                exit={reduceMotion ? { opacity: 0 } : { x: 40, opacity: 0 }}
                initial={reduceMotion ? { opacity: 0 } : { x: 40, opacity: 0 }}
                transition={{ type: "spring", stiffness: 420, damping: 38 }}
              >
                <header className="drawer-header">
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <DialogPrimitive.Title className="dialog-title">{title}</DialogPrimitive.Title>
                    {description ? <DialogPrimitive.Description className="dialog-description">{description}</DialogPrimitive.Description> : null}
                  </div>
                  {meta}
                </header>
                <div className="drawer-body">{children}</div>
                {footer ? <footer className="drawer-footer">{footer}</footer> : null}
                <DialogPrimitive.Close aria-label="Close panel" className="dialog-close">
                  <X aria-hidden="true" size={18} />
                </DialogPrimitive.Close>
              </motion.aside>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        ) : null}
      </AnimatePresence>
    </DialogPrimitive.Root>
  );
}
