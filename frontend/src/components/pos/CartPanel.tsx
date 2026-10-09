import { Keyboard, Minus, Plus, ShoppingCart, Trash2, UserRound, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { discountAmount } from "../../lib/checkout";
import { formatBDT, formatNumber } from "../../lib/format";
import { cartSubtotal, useCartStore } from "../../stores/cartStore";
import { AnimatedNumber } from "../ui/AnimatedNumber";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";

interface CartPanelProps {
  offline: boolean;
  onCheckout: (focus?: "customer" | "discount" | "payment") => void;
  onShowShortcuts: () => void;
}

const money = (value: number) => formatBDT(value, { precise: !Number.isInteger(value) });

/** Always-visible cart (plan §13): animated rows, live totals, and the way into checkout. */
export function CartPanel({ offline, onCheckout, onShowShortcuts }: CartPanelProps) {
  const { customer, discountInput, discountMode, increment, lines, remove, setCustomer } = useCartStore();
  const reduceMotion = useReducedMotion();
  const subtotal = cartSubtotal(lines);
  const discount = discountAmount(subtotal, discountInput, discountMode);
  const total = subtotal - discount;
  const count = lines.reduce((sum, line) => sum + line.quantity, 0);

  return (
    <aside aria-label="Current cart" className="cart-panel">
      <div className="cart-title">
        <div><ShoppingCart aria-hidden="true" size={20} /><strong>Current cart</strong></div>
        <div className="inline-actions">
          <Badge>{formatNumber(count)} item{count === 1 ? "" : "s"}</Badge>
          <Button aria-label="Keyboard shortcuts" onClick={onShowShortcuts} size="icon" title="Keyboard shortcuts" variant="ghost"><Keyboard aria-hidden="true" size={18} /></Button>
        </div>
      </div>

      <div className="cart-customer">
        {customer ? (
          <span className="customer-chip">
            <UserRound aria-hidden="true" size={16} />
            <span><strong>{customer.name}</strong><small>{customer.phone}</small></span>
            <button aria-label={`Remove customer ${customer.name}`} onClick={() => setCustomer(null)} type="button"><X aria-hidden="true" size={15} /></button>
          </span>
        ) : (
          <Button onClick={() => onCheckout("customer")} size="sm" variant="ghost"><UserRound aria-hidden="true" size={16} /> Add customer <kbd>F4</kbd></Button>
        )}
      </div>

      <div aria-live="polite" className="cart-lines">
        {lines.length === 0 ? (
          <div className="cart-empty"><ShoppingCart aria-hidden="true" /><strong>Cart is empty</strong><span>Scan or select a product to begin.</span></div>
        ) : (
          <ul className="cart-list">
            <AnimatePresence initial={false}>
              {lines.map((line) => (
                <motion.li
                  animate={{ opacity: 1, x: 0, height: "auto" }}
                  className="cart-line"
                  exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 24, height: 0, paddingTop: 0, paddingBottom: 0 }}
                  initial={reduceMotion ? false : { opacity: 0, x: -12, height: 0 }}
                  key={line.item.variant_id}
                  layout={!reduceMotion}
                  transition={{ type: "spring", stiffness: 520, damping: 40 }}
                >
                  <div><strong>{line.item.product_name}</strong><small>{line.item.variant_name} · {formatBDT(line.item.price)}</small></div>
                  <div className="quantity-control">
                    <button aria-label={`One fewer ${line.item.product_name}`} onClick={() => increment(line.item.variant_id, -1)} type="button"><Minus aria-hidden="true" size={14} /></button>
                    <motion.span aria-label={`Quantity ${line.quantity}`} animate={{ scale: 1 }} initial={reduceMotion ? false : { scale: 1.25 }} key={line.quantity}>{line.quantity}</motion.span>
                    <button aria-label={`One more ${line.item.product_name}`} onClick={() => increment(line.item.variant_id, 1)} type="button"><Plus aria-hidden="true" size={14} /></button>
                  </div>
                  <AnimatedNumber className="line-total" format={money} value={Number(line.item.price) * line.quantity} />
                  <button aria-label={`Remove ${line.item.product_name}`} className="remove-line" onClick={() => remove(line.item.variant_id)} type="button"><Trash2 aria-hidden="true" size={15} /></button>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>

      <div className="cart-summary">
        <div><span>Subtotal</span><AnimatedNumber format={money} value={subtotal} /></div>
        <div>
          <button className="text-button" disabled={!lines.length} onClick={() => onCheckout("discount")} type="button">Discount <kbd>F6</kbd></button>
          <span className={discount ? "delta-down" : undefined}>{discount ? `−${money(discount)}` : "—"}</span>
        </div>
        <div className="cart-total"><span>Total</span><AnimatedNumber format={money} value={total} /></div>
        <Button aria-keyshortcuts="F9" disabled={!lines.length} onClick={() => onCheckout()} size="lg">
          {offline ? "Checkout offline" : "Checkout"} · {money(total)} <kbd className="on-brand">F9</kbd>
        </Button>
      </div>
    </aside>
  );
}
