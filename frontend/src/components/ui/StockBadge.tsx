import { formatNumber } from "../../lib/format";
import { Badge } from "./Badge";

/** Stock level with text, never color alone (plan §59). */
export function StockBadge({ available, reorderLevel }: { available: number; reorderLevel: number }) {
  if (available <= 0) return <Badge tone="danger">Out of stock</Badge>;
  if (available <= reorderLevel) return <Badge tone="warning">Low · {formatNumber(available)}</Badge>;
  return <Badge tone="success">{formatNumber(available)} in stock</Badge>;
}
