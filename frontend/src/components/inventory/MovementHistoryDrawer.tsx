import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";

import { api, type InventoryDetail } from "../../lib/api";
import { formatDateTime, formatNumber, label } from "../../lib/format";
import { cn } from "../../lib/utils";
import { Button } from "../ui/Button";
import { DataState } from "../ui/DataState";
import { Drawer } from "../ui/Drawer";
import { StockBadge } from "../ui/StockBadge";

/** The immutable ledger for one variant (plan §19): every change, who made it and why. */
export function MovementHistoryDrawer({ onAdjust, onOpenChange, variantId }: { variantId: string; onOpenChange: (open: boolean) => void; onAdjust?: () => void }) {
  const detail = useQuery({ queryKey: ["inventory", "detail", variantId], queryFn: () => api<InventoryDetail>(`/api/v1/inventory/${variantId}`) });
  const item = detail.data?.item;
  return (
    <Drawer
      description={item ? `${item.sku} · ${formatNumber(item.physical_quantity)} on hand, ${formatNumber(item.reserved_quantity)} reserved` : undefined}
      footer={onAdjust ? <Button onClick={onAdjust}>Adjust stock</Button> : undefined}
      meta={item ? <StockBadge available={item.available_quantity} reorderLevel={item.reorder_level} /> : undefined}
      onOpenChange={onOpenChange}
      open
      title={item ? `${item.product_name} · ${item.variant_name}` : "Stock history"}
    >
      <DataState
        empty={{ icon: History, title: "No movements yet", description: "Stock changes from sales, purchases, returns and adjustments will appear here." }}
        isEmpty={(data) => data.movements.length === 0}
        query={detail}
      >
        {(data) => (
          <ol aria-label="Stock movements, newest first" className="timeline">
            {data.movements.map((movement) => (
              <li key={movement.id}>
                <div className="what">
                  <strong>{label(movement.movement_type)}</strong>
                  {movement.note ? <small>{movement.note}</small> : null}
                  <small>{formatDateTime(movement.created_at)}{movement.created_by_name ? ` · ${movement.created_by_name}` : ""}</small>
                </div>
                <div className="amount">
                  <span className={cn(movement.quantity_delta > 0 && "delta-up", movement.quantity_delta < 0 && "delta-down")}>
                    {movement.quantity_delta > 0 ? "+" : ""}{formatNumber(movement.quantity_delta)}
                  </span>
                  <small>{formatNumber(movement.previous_quantity)} → {formatNumber(movement.new_quantity)}</small>
                </div>
              </li>
            ))}
          </ol>
        )}
      </DataState>
    </Drawer>
  );
}
