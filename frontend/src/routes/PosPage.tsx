import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { CartPanel } from "../components/pos/CartPanel";
import { CatalogPanel } from "../components/pos/CatalogPanel";
import { CheckoutSheet, type CheckoutFocus } from "../components/pos/CheckoutSheet";
import { Receipt, type SaleReceipt } from "../components/pos/Receipt";
import { ShortcutsDialog } from "../components/pos/ShortcutsDialog";
import { api } from "../lib/api";
import { catalogStatus, clearCatalogIfForeign, refreshCatalog } from "../lib/catalog";
import type { paymentPayload } from "../lib/checkout";
import { formatBDT } from "../lib/format";
import { useOnline } from "../lib/hooks";
import { queueSale } from "../lib/offlineDb";
import { isTransientFailure } from "../lib/syncEngine";
import { toast } from "../lib/toast";
import { useAuthStore } from "../stores/authStore";
import { cartSubtotal, useCartStore } from "../stores/cartStore";

const CATALOG_REFRESH_MS = 5 * 60_000;

/** Keeps the device catalog fresh: on open, on reconnect and every few minutes (plan §40). */
function useCatalogSync(organizationId: string | undefined, online: boolean) {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ["catalog-status"], queryFn: catalogStatus, networkMode: "always" });
  const sync = useQuery({
    queryKey: ["catalog-refresh", organizationId],
    queryFn: async () => {
      await clearCatalogIfForeign(organizationId!);
      const result = await refreshCatalog(organizationId!);
      await queryClient.invalidateQueries({ queryKey: ["catalog-status"] });
      return result;
    },
    enabled: Boolean(organizationId) && online,
    refetchInterval: CATALOG_REFRESH_MS,
    refetchOnReconnect: true,
    retry: false,
    staleTime: 30_000,
  });
  return {
    status: status.data,
    refreshing: sync.isFetching,
    error: sync.error ? sync.error.message : null,
    refresh: () => void sync.refetch(),
  };
}

type SalePayload = { client_transaction_id: string; amount_received: number } & Record<string, unknown>;
type Payment = ReturnType<typeof paymentPayload>;
const FOCUS_KEYS: Record<string, CheckoutFocus> = { F4: "customer", F6: "discount", F8: "payment" };

export function PosPage() {
  const user = useAuthStore((state) => state.user);
  const online = useOnline();
  const offline = !online;
  const catalog = useCatalogSync(user?.organization_id, online);
  const queryClient = useQueryClient();
  const { add, clear, customer, lines } = useCartStore();
  const [receipt, setReceipt] = useState<SaleReceipt | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutFocus, setCheckoutFocus] = useState<CheckoutFocus | null>(null);
  const [submitSignal, setSubmitSignal] = useState(0);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const live = useRef({ checkoutOpen, hasLines: lines.length > 0, showingReceipt: Boolean(receipt) });
  useEffect(() => {
    live.current = { checkoutOpen, hasLines: lines.length > 0, showingReceipt: Boolean(receipt) };
  }, [checkoutOpen, lines.length, receipt]);

  // F4 customer, F6 discount, F8 payment, F9 checkout or complete (plan §13). F2 lives in CatalogPanel.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const { checkoutOpen: isOpen, hasLines, showingReceipt } = live.current;
      if (showingReceipt) return;
      const focus = FOCUS_KEYS[event.key];
      if (focus) {
        event.preventDefault();
        if (hasLines || focus === "customer") {
          setCheckoutFocus(focus);
          setCheckoutOpen(true);
        }
      } else if (event.key === "F9") {
        event.preventDefault();
        if (isOpen) setSubmitSignal((value) => value + 1);
        else if (hasLines) {
          setCheckoutFocus(null);
          setCheckoutOpen(true);
        }
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  function openCheckout(focus: CheckoutFocus | null = null) {
    setCheckoutFocus(focus);
    setCheckoutOpen(true);
  }

  function receiptFromCart(payload: SalePayload, total: number): SaleReceipt {
    return {
      id: payload.client_transaction_id,
      invoice_number: `OFF-${payload.client_transaction_id.slice(0, 8).toUpperCase()}`,
      total: String(total),
      amount_received: String(payload.amount_received),
      change_due: String(Math.max(0, payload.amount_received - total)),
      created_at: new Date().toISOString(),
      items: lines.map((line) => ({ product_name: line.item.product_name, variant_name: line.item.variant_name, quantity: line.quantity, line_total: String(Number(line.item.price) * line.quantity) })),
      inventory_conflict: false,
    };
  }

  async function saveOffline(payload: SalePayload, total: number) {
    await queueSale(payload);
    setReceipt(receiptFromCart(payload, total));
    setCheckoutOpen(false);
    toast.info("Sale saved offline", "It is stored on this device and will sync when the connection returns.");
    clear();
  }

  const checkout = useMutation({
    mutationFn: async ({ payload, total }: { payload: SalePayload; total: number }) => {
      try {
        return await api<SaleReceipt>("/api/v1/pos/sales", { method: "POST", body: JSON.stringify(payload) });
      } catch (reason) {
        // A lost response may mean the sale committed; queueing the same id lets sync replay it exactly once.
        if (isTransientFailure(reason)) {
          await saveOffline(payload, total);
          return null;
        }
        throw reason;
      }
    },
    onSuccess: (result) => {
      if (!result) return;
      setReceipt(result);
      setCheckoutOpen(false);
      clear();
      toast.success("Sale complete", `${result.invoice_number} · ${formatBDT(result.total)}`);
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["inventory"] });
      catalog.refresh();
    },
  });

  async function completeSale(payment: Payment, discount: number) {
    const total = cartSubtotal(lines) - discount;
    // unit_price and offline_created_at are the facts of the sale as the customer saw it; the server
    // ignores them online and keeps them if this sale has to be synced later.
    const payload: SalePayload = {
      items: lines.map((line) => ({ variant_id: line.item.variant_id, quantity: line.quantity, unit_price: line.item.price })),
      ...payment,
      discount: discount.toFixed(2),
      customer_id: customer?.id ?? null,
      client_transaction_id: crypto.randomUUID(),
      offline_created_at: new Date().toISOString(),
    };
    if (offline) {
      await saveOffline(payload, total);
      return;
    }
    checkout.mutate({ payload, total });
  }

  if (receipt) {
    return <Receipt offline={receipt.invoice_number.startsWith("OFF-")} onNew={() => setReceipt(null)} receipt={receipt} />;
  }
  return (
    <div className="pos-page">
      <CatalogPanel offline={offline} onAdd={add} onRefresh={catalog.refresh} refreshError={catalog.error} refreshing={catalog.refreshing} status={catalog.status} />
      <CartPanel offline={offline} onCheckout={openCheckout} onShowShortcuts={() => setShortcutsOpen(true)} />
      <CheckoutSheet
        error={checkout.error?.message ?? null}
        focus={checkoutFocus}
        key={checkoutOpen ? "open" : "closed"}
        offline={offline}
        onComplete={(payment, discount) => void completeSale(payment, discount)}
        onOpenChange={setCheckoutOpen}
        open={checkoutOpen}
        pending={checkout.isPending}
        submitSignal={submitSignal}
      />
      <ShortcutsDialog onOpenChange={setShortcutsOpen} open={shortcutsOpen} />
    </div>
  );
}
