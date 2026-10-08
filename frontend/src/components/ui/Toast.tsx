import * as ToastPrimitive from "@radix-ui/react-toast";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";

import { useToastStore } from "../../lib/toast";
import { cn } from "../../lib/utils";

const ICONS = { success: CheckCircle2, error: XCircle, warning: AlertTriangle, info: Info } as const;

export function Toaster() {
  const { items, dismiss } = useToastStore();
  return (
    <ToastPrimitive.Provider duration={5000} swipeDirection="right">
      {items.map((item) => {
        const Icon = ICONS[item.tone];
        return (
          <ToastPrimitive.Root
            className={cn("toast", `toast-${item.tone}`)}
            key={item.id}
            onOpenChange={(open) => { if (!open) dismiss(item.id); }}
            type={item.tone === "error" ? "foreground" : "background"}
          >
            <Icon aria-hidden="true" className="toast-icon" size={20} />
            <div>
              <ToastPrimitive.Title className="toast-title">{item.title}</ToastPrimitive.Title>
              {item.description ? <ToastPrimitive.Description className="toast-description">{item.description}</ToastPrimitive.Description> : null}
            </div>
            <ToastPrimitive.Close aria-label="Dismiss notification" className="toast-close">
              <X aria-hidden="true" size={16} />
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        );
      })}
      <ToastPrimitive.Viewport className="toast-viewport" />
    </ToastPrimitive.Provider>
  );
}
