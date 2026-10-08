/**
 * Display formatting (plan §30–31, §60). Money arrives from the API as decimal strings; times are UTC
 * and are always shown in Asia/Dhaka, whatever the device's time zone.
 */
export const BUSINESS_TIME_ZONE = "Asia/Dhaka";

const taka = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const takaPrecise = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const plainNumber = new Intl.NumberFormat("en-IN");

/** ৳5,700 — lakh grouping, no space after the sign, minus sign before it. */
export function formatBDT(value: number | string | null | undefined, { precise = false } = {}) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return "৳0";
  const formatted = (precise ? takaPrecise : taka).format(Math.abs(amount));
  return `${amount < 0 ? "−" : ""}৳${formatted}`;
}

export function formatNumber(value: number | string | null | undefined) {
  return plainNumber.format(Number(value ?? 0));
}

export function formatPercent(rate: number | null | undefined, digits = 0) {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) return "—";
  return `${(rate * 100).toFixed(digits)}%`;
}

const dateFormat = new Intl.DateTimeFormat("en-GB", { timeZone: BUSINESS_TIME_ZONE, day: "numeric", month: "short", year: "numeric" });
const timeFormat = new Intl.DateTimeFormat("en-GB", { timeZone: BUSINESS_TIME_ZONE, hour: "numeric", minute: "2-digit", hour12: true });
const longDateFormat = new Intl.DateTimeFormat("en-GB", { timeZone: BUSINESS_TIME_ZONE, weekday: "long", day: "numeric", month: "long" });

function toDate(value: string | number | Date) {
  return value instanceof Date ? value : new Date(value);
}

/** 9 Oct 2026 */
export function formatDate(value: string | number | Date) {
  return dateFormat.format(toDate(value));
}

/** 3:05 pm */
export function formatTime(value: string | number | Date) {
  return timeFormat.format(toDate(value)).replace(/\s?([ap])\.?m\.?/i, " $1m").toLowerCase();
}

/** 9 Oct 2026, 3:05 pm */
export function formatDateTime(value: string | number | Date) {
  return `${formatDate(value)}, ${formatTime(value)}`;
}

/** Friday, 9 October */
export function formatLongDate(value: string | number | Date) {
  return longDateFormat.format(toDate(value));
}

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["second", 60],
  ["minute", 60],
  ["hour", 24],
  ["day", 7],
  ["week", 4.35],
  ["month", 12],
  ["year", Number.POSITIVE_INFINITY],
];

/** "just now", "5 minutes ago", "yesterday" */
export function formatRelative(value: string | number | Date, now: number = Date.now()) {
  let delta = (toDate(value).getTime() - now) / 1000;
  if (Math.abs(delta) < 30) return "just now";
  for (const [unit, size] of STEPS) {
    if (Math.abs(delta) < size) return relative.format(Math.round(delta), unit);
    delta /= size;
  }
  return formatDate(value);
}

/** Today's date in Dhaka as YYYY-MM-DD, offset by whole days. */
export function dhakaDateISO(offsetDays = 0, now: number = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(now - offsetDays * 86_400_000),
  );
  return parts;
}

const LABELS: Record<string, string> = {
  // Payment methods
  CASH: "Cash",
  BKASH: "bKash",
  NAGAD: "Nagad",
  CARD: "Card",
  SPLIT: "Split",
  COD: "Cash on delivery",
  // Order statuses
  DRAFT: "Draft",
  PENDING_CONFIRMATION: "Pending confirmation",
  CONFIRMED: "Confirmed",
  PACKING: "Packing",
  READY_FOR_SHIPMENT: "Ready to ship",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
  RETURN_REQUESTED: "Return requested",
  RETURNED: "Returned",
  FAILED_DELIVERY: "Failed delivery",
  // Order sources
  FACEBOOK: "Facebook",
  INSTAGRAM: "Instagram",
  WHATSAPP: "WhatsApp",
  PHONE: "Phone",
  WEBSITE: "Website",
  POS: "In store",
  OTHER: "Other",
  // Sync and connectivity
  PENDING: "Pending",
  SYNCING: "Syncing",
  SYNCED: "Synced",
  FAILED: "Retrying",
  REJECTED: "Needs review",
  CONFLICT: "Conflict",
  ONLINE: "Online",
  OFFLINE: "Offline",
  ERROR: "Needs attention",
  // Risk
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  VERY_HIGH: "Very high",
  // Roles
  OWNER: "Owner",
  MANAGER: "Manager",
  CASHIER: "Cashier",
  SUPPORT: "Support",
  WAREHOUSE: "Warehouse",
  // Inventory movements
  OPENING_STOCK: "Opening stock",
  MANUAL_ADJUSTMENT: "Adjustment",
  SALE: "POS sale",
  OFFLINE_SYNC: "Offline sale",
  PURCHASE_RECEIPT: "Purchase received",
  ORDER_FULFILLMENT: "Order shipped",
  RETURN_SELLABLE: "Returned to stock",
  RETURN_DAMAGED: "Returned damaged",
  RETURN_MISSING: "Reported missing",
  // Conflicts
  INVENTORY_OVERSELL: "Sold beyond stock",
  PRICE_MISMATCH: "Price changed",
  // Shipments
  CREATED: "Booked",
  PICKED_UP: "Picked up",
  IN_TRANSIT: "In transit",
  // Stock status
  IN_STOCK: "In stock",
  LOW_STOCK: "Low stock",
  OUT_OF_STOCK: "Out of stock",
};

/** Human label for an API enum value; unknown values are title-cased rather than shown raw. */
export function label(value: string | null | undefined) {
  if (!value) return "";
  return LABELS[value] ?? value.toLowerCase().replaceAll(/[_.]/g, " ").replace(/^\w/, (first) => first.toUpperCase());
}

/** "sale.created" → "Sale created" */
export function actionLabel(action: string) {
  return label(action.replaceAll(".", "_").toUpperCase());
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}
