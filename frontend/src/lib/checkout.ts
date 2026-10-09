/**
 * Checkout arithmetic, kept pure so it is tested once and shared by the cart and the sheet.
 * Works in whole paisa (integers) to avoid floating-point drift on taka amounts.
 */
export type PaymentMethod = "CASH" | "BKASH" | "NAGAD" | "CARD" | "SPLIT";
export type TenderMethod = Exclude<PaymentMethod, "SPLIT">;

export interface SplitLine {
  method: TenderMethod;
  amount: string;
}

const toPaisa = (value: number | string) => Math.round(Number(value || 0) * 100);
const toTaka = (paisa: number) => paisa / 100;

export function subtotalOf(lines: { price: string | number; quantity: number }[]) {
  return toTaka(lines.reduce((sum, line) => sum + toPaisa(line.price) * line.quantity, 0));
}

/** Discount entered as taka or as a percentage of the subtotal, capped at the subtotal. */
export function discountAmount(subtotal: number, value: string, mode: "amount" | "percent") {
  const raw = Number(value || 0);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  const amount = mode === "percent" ? (subtotal * Math.min(raw, 100)) / 100 : raw;
  return toTaka(Math.min(toPaisa(amount), toPaisa(subtotal)));
}

/** Exact amount plus the next round notes a customer typically hands over. */
export function quickCashOptions(total: number) {
  const options = new Set<number>([total]);
  for (const step of [100, 500, 1000]) {
    const rounded = Math.ceil(total / step) * step;
    if (rounded > total) options.add(rounded);
  }
  return [...options].sort((a, b) => a - b).slice(0, 4);
}

export interface TenderResult {
  received: number;
  change: number;
  /** Why the sale cannot complete yet; null when it can. */
  problem: string | null;
}

/** Mirrors the server rules: only cash may exceed the total, and the total must be covered. */
export function evaluateTender(total: number, method: PaymentMethod, amountReceived: string, splits: SplitLine[]): TenderResult {
  if (method === "SPLIT") {
    const filled = splits.filter((line) => toPaisa(line.amount) > 0);
    const received = filled.reduce((sum, line) => sum + toPaisa(line.amount), 0);
    const nonCash = filled.filter((line) => line.method !== "CASH").reduce((sum, line) => sum + toPaisa(line.amount), 0);
    const totalPaisa = toPaisa(total);
    let problem: string | null = null;
    if (filled.length < 2) problem = "Add at least two payment lines";
    else if (nonCash > totalPaisa) problem = "Card and mobile payments cannot exceed the total";
    else if (received < totalPaisa) problem = `${formatShortfall(totalPaisa - received)} still to pay`;
    return { received: toTaka(received), change: toTaka(Math.max(0, received - totalPaisa)), problem };
  }
  const received = amountReceived === "" ? toPaisa(total) : toPaisa(amountReceived);
  const totalPaisa = toPaisa(total);
  let problem: string | null = null;
  if (received < totalPaisa) problem = `${formatShortfall(totalPaisa - received)} still to pay`;
  else if (method !== "CASH" && received > totalPaisa) problem = "Card and mobile payments must match the total exactly";
  return { received: toTaka(received), change: toTaka(Math.max(0, received - totalPaisa)), problem };
}

function formatShortfall(paisa: number) {
  return `৳${(paisa / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

/** The payment part of the POST /pos/sales payload. */
export function paymentPayload(method: PaymentMethod, tender: TenderResult, splits: SplitLine[]) {
  if (method === "SPLIT") {
    return {
      payment_method: "SPLIT" as const,
      amount_received: tender.received,
      payments: splits.filter((line) => toPaisa(line.amount) > 0).map((line) => ({ method: line.method, amount: toTaka(toPaisa(line.amount)).toFixed(2) })),
    };
  }
  return { payment_method: method, amount_received: tender.received };
}
