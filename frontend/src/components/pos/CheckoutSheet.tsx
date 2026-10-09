import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search, Trash2, UserRound, WifiOff, X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { api } from "../../lib/api";
import {
  discountAmount,
  evaluateTender,
  paymentPayload,
  quickCashOptions,
  type PaymentMethod,
  type SplitLine,
  type TenderMethod,
} from "../../lib/checkout";
import { formatBDT } from "../../lib/format";
import { useDebounced } from "../../lib/hooks";
import { cn } from "../../lib/utils";
import { cartSubtotal, useCartStore, type CartCustomer } from "../../stores/cartStore";
import { AnimatedNumber } from "../ui/AnimatedNumber";
import { Button } from "../ui/Button";
import { SegmentedControl } from "../ui/SegmentedControl";

export type CheckoutFocus = "customer" | "discount" | "payment";

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "CASH", label: "Cash" },
  { value: "BKASH", label: "bKash" },
  { value: "NAGAD", label: "Nagad" },
  { value: "CARD", label: "Card" },
  { value: "SPLIT", label: "Split" },
];
const TENDERS: TenderMethod[] = ["CASH", "BKASH", "NAGAD", "CARD"];
const money = (value: number) => formatBDT(value, { precise: !Number.isInteger(value) });

interface CheckoutSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  focus: CheckoutFocus | null;
  offline: boolean;
  pending: boolean;
  error: string | null;
  onComplete: (payment: ReturnType<typeof paymentPayload>, discount: number) => void;
  /** Bumped by the page when F9 is pressed while the sheet is open. */
  submitSignal: number;
}

/** Focused checkout (plan §14): customer → discount → payment → received → change → complete. */
export function CheckoutSheet({ error, focus, offline, onComplete, onOpenChange, open, pending, submitSignal }: CheckoutSheetProps) {
  const { customer, discountInput, discountMode, lines, setCustomer, setDiscount } = useCartStore();
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [received, setReceived] = useState("");
  const [splits, setSplits] = useState<SplitLine[]>([{ method: "BKASH", amount: "" }, { method: "CASH", amount: "" }]);
  const customerRef = useRef<HTMLInputElement>(null);
  const discountRef = useRef<HTMLInputElement>(null);
  const paymentRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const reduceMotion = useReducedMotion();

  const subtotal = cartSubtotal(lines);
  const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0);
  const discount = discountAmount(subtotal, discountInput, discountMode);
  const total = subtotal - discount;
  const tender = evaluateTender(total, method, received, splits);
  const blocked = pending || !lines.length || tender.problem !== null;

  // F4 / F6 / F8 open the sheet straight at the matching step.
  useEffect(() => {
    if (!open) return undefined;
    const timer = setTimeout(() => {
      if (focus === "customer") customerRef.current?.focus();
      else if (focus === "discount") discountRef.current?.focus();
      else if (focus === "payment") paymentRef.current?.querySelector<HTMLButtonElement>("button[aria-pressed='true']")?.focus();
    }, 30);
    return () => clearTimeout(timer);
  }, [focus, open]);

  // F9 inside the sheet completes the sale. Only presses after the sheet opened count, so an
  // earlier sale's F9 can never auto-submit a fresh checkout.
  const openedAtSignal = useRef(submitSignal);
  useEffect(() => {
    if (open && submitSignal !== openedAtSignal.current) formRef.current?.requestSubmit();
  }, [open, submitSignal]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!blocked) onComplete(paymentPayload(method, tender, splits), discount);
  }

  function updateSplit(index: number, change: Partial<SplitLine>) {
    setSplits(splits.map((line, position) => (position === index ? { ...line, ...change } : line)));
  }

  function fillRemaining(index: number) {
    const others = splits.reduce((sum, line, position) => (position === index ? sum : sum + Number(line.amount || 0)), 0);
    updateSplit(index, { amount: String(Math.max(0, Math.round((total - others) * 100) / 100)) });
  }

  return (
    <DialogPrimitive.Root onOpenChange={(next) => { if (!pending) onOpenChange(next); }} open={open}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dialog-overlay" />
        <DialogPrimitive.Content aria-describedby="checkout-summary" className="checkout-sheet">
          <motion.form
            animate={{ x: 0, opacity: 1 }}
            className="checkout-form"
            initial={reduceMotion ? false : { x: 48, opacity: 0 }}
            onSubmit={submit}
            ref={formRef}
            transition={{ type: "spring", stiffness: 420, damping: 38 }}
          >
            <header className="drawer-header">
              <div style={{ flex: 1 }}>
                <DialogPrimitive.Title className="dialog-title">Checkout</DialogPrimitive.Title>
                <p className="dialog-description" id="checkout-summary">{itemCount} item{itemCount === 1 ? "" : "s"} · {money(total)}{offline ? " · saved on this device" : ""}</p>
              </div>
              <DialogPrimitive.Close aria-label="Close checkout" className="dialog-close" type="button"><X aria-hidden="true" size={18} /></DialogPrimitive.Close>
            </header>

            <div className="drawer-body checkout-steps">
              <section aria-labelledby="step-customer" className="checkout-step">
                <h3 id="step-customer"><span>1</span> Customer <small>optional · F4</small></h3>
                <CustomerPicker customer={customer} inputRef={customerRef} offline={offline} onSelect={setCustomer} />
              </section>

              <section aria-labelledby="step-discount" className="checkout-step">
                <h3 id="step-discount"><span>2</span> Discount <small>optional · F6</small></h3>
                <div className="discount-row">
                  <input aria-label={discountMode === "percent" ? "Discount percent" : "Discount in taka"} className="input" inputMode="decimal" min="0" onChange={(event) => setDiscount(event.target.value)} placeholder="0" ref={discountRef} type="number" value={discountInput} />
                  <SegmentedControl label="Discount type" onChange={(mode) => setDiscount(discountInput, mode)} options={[{ value: "amount", label: "৳" }, { value: "percent", label: "%" }]} value={discountMode} />
                  <span className="discount-result">{discount ? `−${money(discount)}` : "No discount"}</span>
                </div>
              </section>

              <section aria-labelledby="step-payment" className="checkout-step">
                <h3 id="step-payment"><span>3</span> Payment <small>F8</small></h3>
                <div aria-labelledby="step-payment" className="method-grid" ref={paymentRef} role="group">
                  {METHODS.map((option) => (
                    <button aria-pressed={method === option.value} className="method-button" key={option.value} onClick={() => setMethod(option.value)} type="button">{option.label}</button>
                  ))}
                </div>

                {method === "SPLIT" ? (
                  <div className="split-lines">
                    {splits.map((line, index) => (
                      <div className="split-line" key={index}>
                        <select aria-label={`Payment line ${index + 1} method`} className="native-select" onChange={(event) => updateSplit(index, { method: event.target.value as TenderMethod })} value={line.method}>
                          {TENDERS.map((tenderMethod) => <option key={tenderMethod} value={tenderMethod}>{METHODS.find((item) => item.value === tenderMethod)?.label}</option>)}
                        </select>
                        <input aria-label={`Payment line ${index + 1} amount`} className="input" inputMode="decimal" min="0" onChange={(event) => updateSplit(index, { amount: event.target.value })} placeholder="0" type="number" value={line.amount} />
                        <Button onClick={() => fillRemaining(index)} size="sm" type="button" variant="ghost">Rest</Button>
                        <Button aria-label={`Remove payment line ${index + 1}`} disabled={splits.length <= 2} onClick={() => setSplits(splits.filter((_, position) => position !== index))} size="icon" type="button" variant="ghost"><Trash2 aria-hidden="true" size={16} /></Button>
                      </div>
                    ))}
                    {splits.length < 4 ? <div><Button onClick={() => setSplits([...splits, { method: "CASH", amount: "" }])} size="sm" type="button" variant="secondary"><Plus aria-hidden="true" size={15} /> Add payment line</Button></div> : null}
                  </div>
                ) : (
                  <div className="received-block">
                    <label className="field-label" htmlFor="amount-received">{method === "CASH" ? "Cash received" : "Amount paid"}</label>
                    <input className="input input-large" id="amount-received" inputMode="decimal" min="0" onChange={(event) => setReceived(event.target.value)} placeholder={String(total)} step="0.01" type="number" value={received} />
                    {method === "CASH" ? (
                      <div aria-label="Quick cash amounts" className="quick-cash" role="group">
                        {quickCashOptions(total).map((amount) => (
                          <button aria-pressed={Number(received || total) === amount} className="pill" key={amount} onClick={() => setReceived(String(amount))} type="button">{amount === total ? "Exact" : money(amount)}</button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                )}
              </section>
            </div>

            <footer className="checkout-footer">
              <dl className="checkout-totals">
                <div><dt>Subtotal</dt><dd>{money(subtotal)}</dd></div>
                {discount ? <div><dt>Discount</dt><dd className="delta-down">−{money(discount)}</dd></div> : null}
                <div className="grand"><dt>Total</dt><dd><AnimatedNumber format={money} value={total} /></dd></div>
                <div><dt>Received</dt><dd>{money(tender.received)}</dd></div>
                <div className={cn("change", tender.change > 0 && "positive")}><dt>Change due</dt><dd><AnimatedNumber format={money} value={tender.change} /></dd></div>
              </dl>
              {offline ? <p className="checkout-offline"><WifiOff aria-hidden="true" size={15} /> Offline: the sale is saved on this device and syncs later.</p> : null}
              {tender.problem ? <p className="checkout-problem" role="status">{tender.problem}</p> : null}
              {error ? <div className="form-alert" role="alert">{error}</div> : null}
              <Button aria-busy={pending} aria-keyshortcuts="F9" className="complete-button" disabled={blocked} size="lg" type="submit">
                {pending ? <span aria-hidden="true" className="spinner" /> : null}
                {pending ? "Completing…" : `Complete sale · ${money(total)}`} <kbd className="on-brand">F9</kbd>
              </Button>
            </footer>
          </motion.form>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

interface CustomerResult {
  id: string;
  name: string;
  phone: string;
}

function CustomerPicker({ customer, inputRef, offline, onSelect }: { customer: CartCustomer | null; offline: boolean; onSelect: (customer: CartCustomer | null) => void; inputRef: React.RefObject<HTMLInputElement | null> }) {
  const [query, setQuery] = useState("");
  const term = useDebounced(query.trim(), 250);
  const results = useQuery({
    queryKey: ["customers", "lookup", term],
    queryFn: () => api<CustomerResult[]>(`/api/v1/customers?search=${encodeURIComponent(term)}`),
    enabled: term.length >= 3 && !offline,
  });

  if (customer) {
    return (
      <div className="customer-chip large">
        <UserRound aria-hidden="true" size={18} />
        <span><strong>{customer.name}</strong><small>{customer.phone}</small></span>
        <button aria-label={`Remove customer ${customer.name}`} onClick={() => onSelect(null)} type="button"><X aria-hidden="true" size={16} /></button>
      </div>
    );
  }
  return (
    <div className="customer-picker">
      <div className="search-field">
        <Search aria-hidden="true" size={16} />
        <input aria-label="Find customer by phone or name" disabled={offline} onChange={(event) => setQuery(event.target.value)} placeholder={offline ? "Customer lookup needs a connection" : "Phone (01…) or name"} ref={inputRef} type="search" value={query} />
      </div>
      {term.length >= 3 && results.data ? (
        results.data.length ? (
          <ul aria-label="Matching customers" className="customer-results">
            {results.data.slice(0, 5).map((result) => (
              <li key={result.id}><button onClick={() => { onSelect({ id: result.id, name: result.name, phone: result.phone }); setQuery(""); }} type="button"><strong>{result.name}</strong><small>{result.phone}</small></button></li>
            ))}
          </ul>
        ) : <p className="field-hint">No customer matches “{term}”. Continue as a walk-in sale.</p>
      ) : null}
      {results.isError ? <p className="field-error">Customer lookup failed; continue as a walk-in sale.</p> : null}
    </div>
  );
}
