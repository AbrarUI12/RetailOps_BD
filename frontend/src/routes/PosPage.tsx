import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { CartPanel } from "../components/pos/CartPanel";
import { CatalogPanel } from "../components/pos/CatalogPanel";
import { Receipt, type SaleReceipt } from "../components/pos/Receipt";
import { api } from "../lib/api";
import { catalogStatus, clearCatalogIfForeign, refreshCatalog } from "../lib/catalog";
import { useOnline } from "../lib/hooks";
import { queueSale } from "../lib/offlineDb";
import { isTransientFailure } from "../lib/syncEngine";
import { toast } from "../lib/toast";
import { formatBDT } from "../lib/format";
import { useAuthStore } from "../stores/authStore";
import { useCartStore } from "../stores/cartStore";

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

export function PosPage() {
  const user = useAuthStore((state) => state.user);
  const online = useOnline();
  const offline = !online;
  const catalog = useCatalogSync(user?.organization_id, online);
  const queryClient = useQueryClient();
  const { add, clear, discount, lines } = useCartStore();
  const [payment, setPayment] = useState("CASH");
  const [amountReceived, setAmountReceived] = useState("");
  const [receipt, setReceipt] = useState<SaleReceipt | null>(null);
  const subtotal = lines.reduce((sum, line) => sum + Number(line.item.price) * line.quantity, 0);
  const total = Math.max(0, subtotal - discount);

  async function saveOffline(payload: SalePayload) {
    await queueSale(payload);
    setReceipt({
      id: payload.client_transaction_id,
      invoice_number: `OFF-${payload.client_transaction_id.slice(0, 8).toUpperCase()}`,
      total: String(total),
      amount_received: String(payload.amount_received),
      change_due: String(Math.max(0, payload.amount_received - total)),
      created_at: new Date().toISOString(),
      items: lines.map((line) => ({ product_name: line.item.product_name, variant_name: line.item.variant_name, quantity: line.quantity, line_total: String(Number(line.item.price) * line.quantity) })),
      inventory_conflict: false,
    });
    toast.info("Sale saved offline", "It will sync when the connection returns.");
    clear();
  }

  const checkout = useMutation({
    mutationFn: async (payload: SalePayload) => {
      try {
        return await api<SaleReceipt>("/api/v1/pos/sales", { method: "POST", body: JSON.stringify(payload) });
      } catch (reason) {
        // A lost response may mean the sale committed; queueing the same id lets sync replay it exactly once.
        if (isTransientFailure(reason)) {
          await saveOffline(payload);
          return null;
        }
        throw reason;
      }
    },
    onSuccess: (result) => {
      if (!result) return;
      setReceipt(result);
      clear();
      toast.success("Sale complete", `${result.invoice_number} · ${formatBDT(result.total)}`);
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["inventory"] });
      catalog.refresh();
    },
  });

  async function completeSale() {
    // unit_price and offline_created_at are the facts of the sale as the customer saw it; the server
    // ignores them online and keeps them if this sale has to be synced later.
    const payload: SalePayload = {
      items: lines.map((line) => ({ variant_id: line.item.variant_id, quantity: line.quantity, unit_price: line.item.price })),
      payment_method: payment,
      amount_received: Number(amountReceived || total),
      discount,
      client_transaction_id: crypto.randomUUID(),
      offline_created_at: new Date().toISOString(),
    };
    if (offline) {
      await saveOffline(payload);
      return;
    }
    checkout.mutate(payload);
  }

  if (receipt) {
    return <Receipt offline={receipt.invoice_number.startsWith("OFF-")} onNew={() => { setReceipt(null); setAmountReceived(""); }} receipt={receipt} />;
  }
  return (
    <div className="pos-page">
      <CatalogPanel offline={offline} onAdd={add} onRefresh={catalog.refresh} refreshError={catalog.error} refreshing={catalog.refreshing} status={catalog.status} />
      <CartPanel
        amountReceived={amountReceived}
        error={checkout.error?.message ?? null}
        offline={offline}
        onAmountReceived={setAmountReceived}
        onCheckout={() => void completeSale()}
        onPayment={setPayment}
        payment={payment}
        pending={checkout.isPending}
      />
    </div>
  );
}
