import { Minus, Plus, ShoppingCart, Trash2 } from "lucide-react";

import { formatBDT, formatNumber } from "../../lib/format";
import { cn } from "../../lib/utils";
import { useCartStore } from "../../stores/cartStore";
import { LayoutList } from "../motion/LayoutList";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";

const METHODS = [
  { value: "CASH", label: "Cash" },
  { value: "BKASH", label: "bKash" },
  { value: "NAGAD", label: "Nagad" },
  { value: "CARD", label: "Card" },
] as const;

interface CartPanelProps {
  payment: string;
  onPayment: (method: string) => void;
  amountReceived: string;
  onAmountReceived: (value: string) => void;
  onCheckout: () => void;
  pending: boolean;
  error: string | null;
  offline: boolean;
}

/** Cart and payment (Session 7 replaces the inline payment area with the checkout sheet). */
export function CartPanel({ amountReceived, error, offline, onAmountReceived, onCheckout, onPayment, payment, pending }: CartPanelProps) {
  const { discount, increment, lines, remove, setDiscount } = useCartStore();
  const subtotal = lines.reduce((sum, line) => sum + Number(line.item.price) * line.quantity, 0);
  const total = Math.max(0, subtotal - discount);
  const count = lines.reduce((sum, line) => sum + line.quantity, 0);
  const received = Number(amountReceived || total);

  return (
    <aside aria-label="Current cart" className="cart-panel">
      <div className="cart-title">
        <div><ShoppingCart aria-hidden="true" size={20} /><strong>Current cart</strong></div>
        <Badge>{formatNumber(count)} item{count === 1 ? "" : "s"}</Badge>
      </div>
      <div className="cart-lines">
        {lines.length === 0 ? (
          <div className="cart-empty"><ShoppingCart aria-hidden="true" /><strong>Cart is empty</strong><span>Scan or select a product to begin.</span></div>
        ) : (
          <LayoutList>
            {lines.map((line) => (
              <div className="cart-line" key={line.item.variant_id}>
                <div><strong>{line.item.product_name}</strong><small>{line.item.variant_name} · {formatBDT(line.item.price)}</small></div>
                <div className="quantity-control">
                  <button aria-label={`One fewer ${line.item.product_name}`} onClick={() => increment(line.item.variant_id, -1)} type="button"><Minus aria-hidden="true" size={14} /></button>
                  <span aria-label={`Quantity ${line.quantity}`}>{line.quantity}</span>
                  <button aria-label={`One more ${line.item.product_name}`} onClick={() => increment(line.item.variant_id, 1)} type="button"><Plus aria-hidden="true" size={14} /></button>
                </div>
                <strong className="line-total">{formatBDT(Number(line.item.price) * line.quantity)}</strong>
                <button aria-label={`Remove ${line.item.product_name}`} className="remove-line" onClick={() => remove(line.item.variant_id)} type="button"><Trash2 aria-hidden="true" size={15} /></button>
              </div>
            ))}
          </LayoutList>
        )}
      </div>
      <div className="cart-summary">
        <label>Discount (৳) <input inputMode="decimal" min="0" onChange={(event) => setDiscount(Number(event.target.value))} type="number" value={discount || ""} /></label>
        <div><span>Subtotal</span><strong>{formatBDT(subtotal)}</strong></div>
        <div className="cart-total"><span>Total</span><strong>{formatBDT(total)}</strong></div>
        <div aria-label="Payment method" className="payment-tabs" role="group">
          {METHODS.map((method) => (
            <button aria-pressed={payment === method.value} className={cn(payment === method.value && "active")} key={method.value} onClick={() => onPayment(method.value)} type="button">{method.label}</button>
          ))}
        </div>
        <Input inputMode="decimal" label="Amount received (৳)" min={total} onChange={(event) => onAmountReceived(event.target.value)} placeholder={String(total)} step="0.01" type="number" value={amountReceived} />
        {received > total ? <div className="cart-change"><span>Change due</span><strong>{formatBDT(received - total)}</strong></div> : null}
        <Button aria-busy={pending} disabled={!lines.length || pending || received < total || discount > subtotal} onClick={onCheckout} size="lg">
          {pending ? "Completing…" : offline ? `Save offline sale · ${formatBDT(total)}` : `Charge ${formatBDT(total)}`}
        </Button>
        {discount > subtotal ? <div className="form-alert" role="alert">Discount cannot exceed the subtotal.</div> : null}
        {error ? <div className="form-alert" role="alert">{error}</div> : null}
      </div>
    </aside>
  );
}
