import { create } from "zustand";

import type { CatalogItem } from "../lib/offlineDb";

export interface CartLine {
  item: CatalogItem;
  quantity: number;
}

interface CartState {
  lines: CartLine[];
  discount: number;
  /** Adds one unit, or one more if the variant is already in the cart (repeat scans). */
  add: (item: CatalogItem) => void;
  increment: (variantId: string, amount: number) => void;
  remove: (variantId: string) => void;
  setDiscount: (value: number) => void;
  clear: () => void;
}

export const useCartStore = create<CartState>((set) => ({
  lines: [],
  discount: 0,
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
  remove: (variantId) => set((state) => ({ lines: state.lines.filter((line) => line.item.variant_id !== variantId) })),
  setDiscount: (discount) => set({ discount: Math.max(0, discount) }),
  clear: () => set({ lines: [], discount: 0 }),
}));
