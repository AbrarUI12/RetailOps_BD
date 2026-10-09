import { CheckCircle2, Printer } from "lucide-react";

import { formatBDT, formatDateTime } from "../../lib/format";
import { useAuthStore } from "../../stores/authStore";
import { Button } from "../ui/Button";

export interface SaleReceipt {
  id: string;
  invoice_number: string;
  total: string;
  amount_received: string;
  change_due: string;
  created_at: string;
  items: { product_name: string; variant_name: string; quantity: number; line_total: string }[];
  inventory_conflict: boolean;
}

/** Post-sale screen and printable slip (Session 9 completes the plan §47 receipt content). */
export function Receipt({ offline, onNew, receipt }: { receipt: SaleReceipt; onNew: () => void; offline: boolean }) {
  const user = useAuthStore((state) => state.user);
  return (
    <section aria-label="Sale receipt" className="receipt-screen">
      <section className="receipt-success">
        <span><CheckCircle2 aria-hidden="true" size={30} /></span>
        <h1>{offline ? "Sale saved offline" : "Payment successful"}</h1>
        <p>{offline ? "It is stored on this device and will sync automatically when the connection returns." : "Inventory and today's dashboard have been updated."}</p>
        <div className="receipt-actions">
          <Button onClick={() => print()} variant="secondary"><Printer aria-hidden="true" size={17} /> Print receipt</Button>
          <Button autoFocus onClick={onNew}>Start new sale</Button>
        </div>
      </section>
      <article aria-label="Receipt" className="receipt-paper">
        <header>
          <div aria-hidden="true" className="receipt-logo">R</div>
          <strong>{user?.organization_name ?? "RetailOps BD"}</strong>
          <span>{user?.branch_name}{user?.branch_address ? ` · ${user.branch_address}` : ""}</span>
        </header>
        <div className="receipt-meta">
          <span>{receipt.invoice_number}</span>
          <span>{formatDateTime(receipt.created_at)}</span>
        </div>
        {receipt.items.map((item, index) => (
          <div className="receipt-line" key={`${item.product_name}-${index}`}>
            <span>{item.product_name}<small>{item.variant_name} × {item.quantity}</small></span>
            <strong>{formatBDT(item.line_total)}</strong>
          </div>
        ))}
        <div className="receipt-total"><span>Total</span><strong>{formatBDT(receipt.total)}</strong></div>
        <div className="receipt-total small"><span>Change</span><strong>{formatBDT(receipt.change_due)}</strong></div>
        <footer>Thank you for shopping with us.</footer>
      </article>
    </section>
  );
}
