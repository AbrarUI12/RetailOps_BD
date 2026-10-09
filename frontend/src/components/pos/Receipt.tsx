import { CheckCircle2, ExternalLink, Printer } from "lucide-react";
import { Link } from "react-router-dom";

import { formatBDT, formatDateTime } from "../../lib/format";
import type { SaleReceipt } from "../../lib/sales";
import { useAuthStore } from "../../stores/authStore";
import { Button } from "../ui/Button";

/** Post-sale screen and printable 80mm slip (plan §47). */
export function Receipt({ offline, onNew, receipt }: { receipt: SaleReceipt; onNew: () => void; offline: boolean }) {
  return (
    <section aria-label="Sale receipt" className="receipt-screen">
      <section className="receipt-success">
        <span><CheckCircle2 aria-hidden="true" size={30} /></span>
        <h1>{offline ? "Sale saved offline" : "Payment successful"}</h1>
        <p>{offline ? "It is stored on this device and will sync automatically when the connection returns." : "Inventory and today's dashboard have been updated."}</p>
        <div className="receipt-actions">
          <Button onClick={() => print()} variant="secondary"><Printer aria-hidden="true" size={17} /> Print receipt</Button>
          <Button autoFocus onClick={onNew}>Start new sale</Button>
          {!offline ? <Button asChild variant="ghost"><Link to={`/sales?sale=${receipt.id}`}><ExternalLink aria-hidden="true" size={16} /> View sale</Link></Button> : null}
        </div>
      </section>
      <ReceiptPaper receipt={receipt} />
    </section>
  );
}

export function ReceiptPaper({ receipt }: { receipt: SaleReceipt }) {
  const user = useAuthStore((state) => state.user);
  return (
      <article aria-label={`Receipt ${receipt.invoice_number}`} className="receipt-paper">
        <header>
          <div aria-hidden="true" className="receipt-logo">R</div>
          <strong>{user?.organization_name ?? "RetailOps BD"}</strong>
          <span>{user?.branch_name}{user?.branch_address ? ` · ${user.branch_address}` : ""}</span>
        </header>
        <div className="receipt-meta">
          <span><b>Invoice:</b> {receipt.invoice_number}</span>
          <span><b>Date:</b> {formatDateTime(receipt.created_at)}</span>
          <span><b>Cashier:</b> {receipt.cashier_name ?? user?.full_name ?? "Register"}</span>
          {receipt.customer_name ? <span><b>Customer:</b> {receipt.customer_name}</span> : null}
        </div>
        {receipt.items.map((item, index) => (
          <div className="receipt-line" key={`${item.product_name}-${index}`}>
            <span>{item.product_name}<small>{item.variant_name} · {item.quantity} × {formatBDT(item.unit_price ?? Number(item.line_total) / item.quantity)}</small></span>
            <strong>{formatBDT(item.line_total)}</strong>
          </div>
        ))}
        <div className="receipt-totals">
          <div><span>Subtotal</span><strong>{formatBDT(receipt.subtotal ?? receipt.total)}</strong></div>
          {Number(receipt.discount) > 0 ? <div><span>Discount</span><strong>−{formatBDT(receipt.discount)}</strong></div> : null}
        </div>
        <div className="receipt-total"><span>Total</span><strong>{formatBDT(receipt.total)}</strong></div>
        <div className="receipt-payment">
          {(receipt.payments?.length ? receipt.payments : [{ method: receipt.payment_method ?? "CASH", amount: receipt.total }]).map((payment, index) => (
            <div key={`${payment.method}-${index}`}><span>{receipt.payments?.length > 1 ? payment.method : "Payment"}</span><strong>{receipt.payments?.length > 1 ? formatBDT(payment.amount) : payment.method}</strong></div>
          ))}
          {Number(receipt.amount_received) > Number(receipt.total) ? <><div><span>Received</span><strong>{formatBDT(receipt.amount_received)}</strong></div><div><span>Change</span><strong>{formatBDT(receipt.change_due)}</strong></div></> : null}
        </div>
        <footer>Thank you for shopping with us.</footer>
      </article>
  );
}
