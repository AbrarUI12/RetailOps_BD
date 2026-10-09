import { create } from "zustand";

import type { CatalogItem } from "../lib/offlineDb";

export interface CartLine {
  item: CatalogItem;
  quantity: number;
}

export interface CartCustomer {
  id: string;
  name: string;
  phone: string;
}

interface CartState {
  lines: CartLine[];
  customer: CartCustomer | null;
  /** What the cashier typed; converted with lib/checkout.discountAmount. */
  discountInput: string;
  discountMode: "amount" | "percent";
  /** Adds one unit, or one more if the variant is already in the cart (repeat scans). */
  add: (item: CatalogItem) => void;
  increment: (variantId: string, amount: number) => void;
  setQuantity: (variantId: string, quantity: number) => void;
  remove: (variantId: string) => void;
  setCustomer: (customer: CartCustomer | null) => void;
  setDiscount: (input: string, mode?: "amount" | "percent") => void;
  clear: () => void;
}

export const useCartStore = create<CartState>((set) => ({
  lines: [],
  customer: null,
  discountInput: "",
  discountMode: "amount",
  add: (item) =>
    set((state) => {
      const existing = state.lines.find((line) => line.item.variant_id === item.variant_id);
      return existing
        ? { lines: state.lines.map((line) => (line.item.variant_id === item.variant_id ? { ...line, quantity: line.quantity + 1 } : line)) }
        : { lines: [...state.lines, { item, quantity: 1 }] };
    }),
  increment: (variantId, amount) =>
    set((state) => ({
      lines: state.lines
        .map((line) => (line.item.variant_id === variantId ? { ...line, quantity: Math.max(0, line.quantity + amount) } : line))
        .filter((line) => line.quantity > 0),
    })),
  setQuantity: (variantId, quantity) =>
    set((state) => ({
      lines: state.lines
        .map((line) => (line.item.variant_id === variantId ? { ...line, quantity: Math.max(0, Math.min(999, Math.floor(quantity))) } : line))
        .filter((line) => line.quantity > 0),
    })),
  remove: (variantId) => set((state) => ({ lines: state.lines.filter((line) => line.item.variant_id !== variantId) })),
  setCustomer: (customer) => set({ customer }),
  setDiscount: (discountInput, mode) => set((state) => ({ discountInput, discountMode: mode ?? state.discountMode })),
  clear: () => set({ lines: [], customer: null, discountInput: "", discountMode: "amount" }),
}));

/** Subtotal of the cart in taka. */
export function cartSubtotal(lines: CartLine[]) {
  return lines.reduce((sum, line) => sum + Math.round(Number(line.item.price) * 100) * line.quantity, 0) / 100;
}
