import { CheckCircle2, Minus, Plus, Printer, Search, ShoppingCart, Trash2, WifiOff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";

import { LayoutList } from "../components/motion/LayoutList";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { api, type Product } from "../lib/api";
import { cacheProducts, offlineDb, queueSale } from "../lib/offlineDb";
import { isTransientFailure } from "../lib/syncEngine";
import { formatBDT } from "../lib/utils";
import { useCartStore } from "../stores/cartStore";

interface ProductPageData { items: Product[]; total: number }
interface SaleReceipt { id: string; invoice_number: string; total: string; amount_received: string; change_due: string; created_at: string; items: { product_name: string; variant_name: string; quantity: number; line_total: string }[]; inventory_conflict: boolean }

export function PosPage() {
  const [search, setSearch] = useState("");
  const [payment, setPayment] = useState("CASH");
  const [amountReceived, setAmountReceived] = useState("");
  const [receipt, setReceipt] = useState<SaleReceipt | null>(null);
  const [offline, setOffline] = useState(!navigator.onLine);
  const { lines, discount, add, increment, remove, setDiscount, clear } = useCartStore();
  const products = useQuery({ queryKey: ["pos-products"], queryFn: async () => { const result = await api<ProductPageData>("/api/v1/products?page_size=100"); await cacheProducts(result.items); return result.items; } });
  const [cachedProducts, setCachedProducts] = useState<Product[]>([]);
  useEffect(() => { const update = () => setOffline(!navigator.onLine); addEventListener("online", update); addEventListener("offline", update); void offlineDb.products.toArray().then(setCachedProducts); return () => { removeEventListener("online", update); removeEventListener("offline", update); }; }, [products.data]);
  const catalog = products.data ?? cachedProducts;
  const filtered = catalog.filter((product) => `${product.name} ${product.sku} ${product.variants.map((v) => `${v.sku} ${v.barcode}`).join(" ")}`.toLowerCase().includes(search.toLowerCase()));
  const subtotal = useMemo(() => lines.reduce((sum, line) => sum + Number(line.variant.price) * line.quantity, 0), [lines]);
  const total = Math.max(0, subtotal - discount);
  type SalePayload = { client_transaction_id: string; amount_received: number } & Record<string, unknown>;
  async function saveOffline(payload: SalePayload) {
    await queueSale(payload);
    setReceipt({ id: payload.client_transaction_id, invoice_number: `OFF-${payload.client_transaction_id.slice(0, 8).toUpperCase()}`, total: String(total), amount_received: String(payload.amount_received), change_due: String(Math.max(0, payload.amount_received - total)), created_at: new Date().toISOString(), items: lines.map((line) => ({ product_name: line.product.name, variant_name: line.variant.name, quantity: line.quantity, line_total: String(Number(line.variant.price) * line.quantity) })), inventory_conflict: false });
    clear();
  }
  const checkout = useMutation({
    mutationFn: async (payload: SalePayload) => {
      try {
        return await api<SaleReceipt>("/api/v1/pos/sales", { method: "POST", body: JSON.stringify(payload) });
      } catch (reason) {
        // A lost response may mean the sale committed; queueing the same id lets sync replay it exactly once.
        if (isTransientFailure(reason)) { await saveOffline(payload); return null; }
        throw reason;
      }
    },
    onSuccess: (result) => { if (result) { setReceipt(result); clear(); } },
  });
  async function completeSale() {
    const payload: SalePayload = { items: lines.map((line) => ({ variant_id: line.variant.id, quantity: line.quantity })), payment_method: payment, amount_received: Number(amountReceived || total), discount, client_transaction_id: crypto.randomUUID() };
    if (offline) { await saveOffline(payload); return; }
    checkout.mutate(payload);
  }
  if (receipt) return <Receipt receipt={receipt} onNew={() => { setReceipt(null); setAmountReceived(""); }} offline={receipt.invoice_number.startsWith("OFF-")} />;
  return <div className="pos-page"><section className="pos-catalog"><div className="pos-heading"><div><span className="eyebrow">Point of sale</span><h1>New sale</h1></div>{offline ? <Badge tone="warning"><WifiOff size={13}/> Offline mode</Badge> : <Badge tone="success">Register ready</Badge>}</div><div className="pos-search"><Search size={18}/><input autoFocus aria-label="Search or scan products" onChange={(event) => setSearch(event.target.value)} placeholder="Search products or scan barcode…" value={search}/><kbd>F2</kbd></div><div className="category-pills"><button className="active">All products</button><button>Apparel</button><button>Accessories</button><button>Beauty</button><button>Home</button></div><div className="product-grid">{filtered.map((product) => product.variants.map((variant) => <button className="product-tile" key={variant.id} onClick={() => add(product, variant)} type="button"><span className="product-art">{product.name.slice(0, 2).toUpperCase()}</span><span><strong>{product.name}</strong><small>{variant.name} · {variant.sku}</small></span><span className="product-price">{formatBDT(Number(variant.price))}</span></button>))}</div></section>
    <aside className="cart-panel"><div className="cart-title"><div><ShoppingCart size={19}/><strong>Current cart</strong></div><Badge>{lines.reduce((sum, line) => sum + line.quantity, 0)} items</Badge></div><div className="cart-lines">{lines.length === 0 ? <div className="cart-empty"><ShoppingCart/><strong>Cart is empty</strong><span>Scan or select a product to begin.</span></div> : <LayoutList>{lines.map((line) => <div className="cart-line" key={line.variant.id}><div><strong>{line.product.name}</strong><small>{line.variant.name}</small></div><div className="quantity-control"><button onClick={() => increment(line.variant.id, -1)}><Minus size={13}/></button><span>{line.quantity}</span><button onClick={() => increment(line.variant.id, 1)}><Plus size={13}/></button></div><strong>{formatBDT(Number(line.variant.price) * line.quantity)}</strong><button aria-label={`Remove ${line.product.name}`} className="remove-line" onClick={() => remove(line.variant.id)}><Trash2 size={14}/></button></div>)}</LayoutList>}</div><div className="cart-summary"><label>Discount <input min="0" onChange={(event) => setDiscount(Number(event.target.value))} type="number" value={discount}/></label><div><span>Subtotal</span><strong>{formatBDT(subtotal)}</strong></div><div className="cart-total"><span>Total</span><strong>{formatBDT(total)}</strong></div><div className="payment-tabs">{["CASH", "BKASH", "NAGAD", "CARD"].map((method) => <button className={payment === method ? "active" : ""} key={method} onClick={() => setPayment(method)}>{method}</button>)}</div><Input label="Amount received" min={total} onChange={(event) => setAmountReceived(event.target.value)} placeholder={String(total)} step="0.01" type="number" value={amountReceived}/><Button disabled={!lines.length || checkout.isPending || Number(amountReceived || total) < total} onClick={() => void completeSale()} size="lg">{checkout.isPending ? "Completing…" : offline ? "Save offline sale" : `Charge ${formatBDT(total)}`}</Button>{checkout.error ? <div className="form-alert">{checkout.error.message}</div> : null}</div></aside>
  </div>;
}

function Receipt({ receipt, onNew, offline }: { receipt: SaleReceipt; onNew: () => void; offline: boolean }) {
  return <main className="receipt-screen"><section className="receipt-success"><span><CheckCircle2 size={30}/></span><h1>{offline ? "Sale saved offline" : "Payment successful"}</h1><p>{offline ? "It will sync automatically when your connection returns." : "Inventory and today’s dashboard have been updated."}</p><div className="receipt-actions"><Button onClick={() => print()} variant="secondary"><Printer size={17}/> Print receipt</Button><Button onClick={onNew}>Start new sale</Button></div></section><article className="receipt-paper"><header><div className="receipt-logo">R</div><strong>RetailOps BD Demo</strong><span>Dhanmondi Flagship · Dhaka</span></header><div className="receipt-meta"><span>{receipt.invoice_number}</span><span>{new Intl.DateTimeFormat("en-BD", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dhaka" }).format(new Date(receipt.created_at))}</span></div>{receipt.items.map((item, index) => <div className="receipt-line" key={`${item.product_name}-${index}`}><span>{item.product_name}<small>{item.variant_name} × {item.quantity}</small></span><strong>{formatBDT(Number(item.line_total))}</strong></div>)}<div className="receipt-total"><span>Total</span><strong>{formatBDT(Number(receipt.total))}</strong></div><div className="receipt-total small"><span>Change</span><strong>{formatBDT(Number(receipt.change_due))}</strong></div><footer>Thank you for shopping with us.<br/>retailops.bd</footer></article></main>;
}
