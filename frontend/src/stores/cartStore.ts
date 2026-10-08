import { create } from "zustand";

import type { Product, Variant } from "../lib/api";

export interface CartLine {
  product: Product;
  variant: Variant;
  quantity: number;
}

interface CartState {
  lines: CartLine[];
  discount: number;
  add: (product: Product, variant: Variant) => void;
  increment: (variantId: string, amount: number) => void;
  remove: (variantId: string) => void;
  setDiscount: (value: number) => void;
  clear: () => void;
}

export const useCartStore = create<CartState>((set) => ({
  lines: [],
  discount: 0,
  add: (product, variant) =>
    set((state) => {
      const existing = state.lines.find((line) => line.variant.id === variant.id);
      return existing
        ? {
            lines: state.lines.map((line) =>
              line.variant.id === variant.id ? { ...line, quantity: line.quantity + 1 } : line,
            ),
          }
        : { lines: [...state.lines, { product, variant, quantity: 1 }] };
    }),
  increment: (variantId, amount) =>
    set((state) => ({
      lines: state.lines
        .map((line) =>
          line.variant.id === variantId
            ? { ...line, quantity: Math.max(0, line.quantity + amount) }
            : line,
        )
        .filter((line) => line.quantity > 0),
    })),
  remove: (variantId) =>
    set((state) => ({ lines: state.lines.filter((line) => line.variant.id !== variantId) })),
  setDiscount: (discount) => set({ discount: Math.max(0, discount) }),
  clear: () => set({ lines: [], discount: 0 }),
}));
