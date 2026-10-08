/**
 * Minimal translation layer (plan §60). English ships first; a Bangla dictionary can be added
 * without touching components because user-facing strings go through `t()`.
 */
const en = {
  "app.name": "RetailOps BD",
  "common.retry": "Try again",
  "common.cancel": "Cancel",
  "common.close": "Close",
  "common.save": "Save changes",
  "common.loading": "Loading…",
  "common.viewAll": "View all",
  "state.errorTitle": "Something went wrong",
  "state.errorBody": "We couldn't load this. Check your connection and try again.",
  "state.deniedTitle": "You don't have access",
  "state.deniedBody": "Ask an owner or manager to give your role access to this area.",
  "state.offlineTitle": "You're offline",
  "state.offlineBody": "This needs a connection. Sales on the POS still work offline.",
  "offline.banner": "You're offline. New sales are saved on this device and will sync when you're back online.",
  "toast.saleComplete": "Sale complete",
  "toast.saleSavedOffline": "Sale saved offline",
} as const;

export type MessageKey = keyof typeof en;
type Dictionary = Record<MessageKey, string>;

const dictionaries: Record<string, Dictionary> = { en };
let locale = "en";

export function setLocale(next: string) {
  if (dictionaries[next]) locale = next;
}

/** t("toast.saleComplete") or t("key", { count: 3 }) with {count} placeholders. */
export function t(key: MessageKey, values?: Record<string, string | number>) {
  const template = (dictionaries[locale] ?? en)[key] ?? en[key];
  if (!values) return template;
  return template.replaceAll(/\{(\w+)\}/g, (match, name: string) => String(values[name] ?? match));
}
