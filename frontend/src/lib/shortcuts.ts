/** "⌘ K" on Apple devices, "Ctrl K" elsewhere. */
export const SHORTCUT_LABEL = typeof navigator !== "undefined" && /mac|iphone|ipad/i.test(navigator.userAgent) ? "⌘ K" : "Ctrl K";

/** POS keyboard shortcuts (plan §13), listed in the in-app shortcuts dialog. */
export const POS_SHORTCUTS = [
  { keys: "F2", action: "Focus product search / scan" },
  { keys: "Enter", action: "Add the scanned barcode or SKU" },
  { keys: "F4", action: "Choose a customer" },
  { keys: "F6", action: "Apply a discount" },
  { keys: "F8", action: "Choose the payment method" },
  { keys: "F9", action: "Open checkout, or complete the sale when checkout is open" },
  { keys: "Esc", action: "Close the current dialog" },
] as const;
