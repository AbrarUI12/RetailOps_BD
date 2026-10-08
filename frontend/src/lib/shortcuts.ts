/** "⌘ K" on Apple devices, "Ctrl K" elsewhere. */
export const SHORTCUT_LABEL = typeof navigator !== "undefined" && /mac|iphone|ipad/i.test(navigator.userAgent) ? "⌘ K" : "Ctrl K";
