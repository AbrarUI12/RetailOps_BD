import { Check, Minus, PackageSearch, Phone, Plus, ShieldCheck, Trash2, UserRound, X } from "lucide-react";
import { useDeferredValue, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ApiError, api, type Product, type Variant } from "../../lib/api";
import { formatBDT, label } from "../../lib/format";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "../ui/Sheet";

interface Customer { id: string; name: string; normalized_phone: string }
interface CustomerProfile { metrics: { successful_deliveries: number; delivery_outcomes: number; cod_risk: { score: number; level: string; reasons: string[]; recommendation: string } }; addresses: { address: string; area: string | null }[] }
interface OrderItem { variant: Variant; productName: string; quantity: number }
interface OrderResult { id: string; order_number: string; total: string; risk: { score: number; level: string; reasons: string[]; recommendation: string } }
interface ProductPage { items: Product[] }

export function OrderEntrySheet({ onOpenChange, open }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [area, setArea] = useState("");
  const [source, setSource] = useState("FACEBOOK");
  const [deliveryFee, setDeliveryFee] = useState("80");
  const [discount, setDiscount] = useState("0");
  const [productSearch, setProductSearch] = useState("");
  const [items, setItems] = useState<OrderItem[]>([]);
  const [created, setCreated] = useState<OrderResult | null>(null);
  const deferredPhone = useDeferredValue(phone);
  const deferredProduct = useDeferredValue(productSearch);
  const phoneReady = deferredPhone.replace(/\D/g, "").length >= 11;
  const customer = useQuery({
    queryKey: ["customer-phone-lookup", deferredPhone],
    queryFn: () => api<Customer>(`/api/v1/customers/lookup?phone=${encodeURIComponent(deferredPhone)}`),
    enabled: open && phoneReady,
    retry: false,
  });
  const profile = useQuery({ queryKey: ["customer-profile", customer.data?.id], queryFn: () => api<CustomerProfile>(`/api/v1/customers/${customer.data?.id}/profile`), enabled: Boolean(customer.data?.id) });
  const products = useQuery({
    queryKey: ["order-product-search", deferredProduct],
    queryFn: () => api<ProductPage>(`/api/v1/products?active=true&page_size=50&search=${encodeURIComponent(deferredProduct)}`),
    enabled: open && !created,
  });
  const create = useMutation({
    mutationFn: (body: object) => api<OrderResult>("/api/v1/orders", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: async (result) => { setCreated(result); await queryClient.invalidateQueries({ queryKey: ["orders"] }); },
  });
  const savedAddress = profile.data?.addresses[0];
  const effectiveName = customer.data?.name ?? name;
  const effectiveAddress = address || savedAddress?.address || "";
  const effectiveArea = area || savedAddress?.area || "";
  const subtotal = useMemo(() => items.reduce((sum, item) => sum + Number(item.variant.price) * item.quantity, 0), [items]);
  const total = Math.max(0, subtotal + Number(deliveryFee || 0) - Number(discount || 0));
  const lookupMissing = customer.error instanceof ApiError && customer.error.status === 404;
  function addItem(productName: string, variant: Variant) { setItems((current) => { const existing = current.find((item) => item.variant.id === variant.id); return existing ? current.map((item) => item.variant.id === variant.id ? { ...item, quantity: item.quantity + 1 } : item) : [...current, { productName, variant, quantity: 1 }]; }); setProductSearch(""); }
  function quantity(id: string, delta: number) { setItems((current) => current.flatMap((item) => item.variant.id !== id ? [item] : item.quantity + delta > 0 ? [{ ...item, quantity: item.quantity + delta }] : [])); }
  function reset() { setPhone(""); setName(""); setAddress(""); setArea(""); setSource("FACEBOOK"); setDeliveryFee("80"); setDiscount("0"); setProductSearch(""); setItems([]); setCreated(null); create.reset(); }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const customerPart = customer.data ? { customer_id: customer.data.id } : { customer: { name: effectiveName, phone, address: { label: "Home", address: effectiveAddress, area: effectiveArea || null, city: "Dhaka" } } }; create.mutate({ ...customerPart, source, delivery_address: effectiveAddress, area: effectiveArea || null, delivery_fee: deliveryFee || "0", discount: discount || "0", items: items.map((item) => ({ variant_id: item.variant.id, quantity: item.quantity })) }); }
  function handleOpen(next: boolean) { if (!next) reset(); onOpenChange(next); }
  const variants = products.data?.items.flatMap((product) => product.variants.filter((variant) => variant.is_active).map((variant) => ({ product, variant }))) ?? [];
  return <Sheet onOpenChange={handleOpen} open={open}><SheetContent className="order-entry-sheet"><SheetTitle>{created ? "Order created" : "Create manual order"}</SheetTitle><SheetDescription>{created ? "The order is ready for confirmation." : "Capture a Facebook, phone or social order in under a minute."}</SheetDescription>{created ? <div className="order-created"><span className="success-orb"><Check size={28}/></span><div><p className="eyebrow">Successfully created</p><h2>{created.order_number}</h2><strong>{formatBDT(created.total)}</strong></div><div className="created-risk"><Badge tone={created.risk.level === "LOW" ? "success" : created.risk.level === "MEDIUM" ? "warning" : "danger"}>{label(created.risk.level)} risk · {created.risk.score}/100</Badge><p>{created.risk.recommendation}</p></div><div className="form-actions"><Button onClick={reset}>Create another</Button><Button onClick={() => handleOpen(false)} variant="secondary">Done</Button></div></div> : <form className="order-entry" onSubmit={submit}><section><div className="entry-section-title"><span>1</span><div><h3>Customer</h3><p>Existing customers appear as soon as the phone matches.</p></div></div><div className="form-grid"><Input autoFocus label="Customer phone" name="phone" onChange={(event) => { setPhone(event.target.value); setName(""); setAddress(""); setArea(""); }} placeholder="01712 345678" required value={phone}/><Input disabled={Boolean(customer.data)} label="Customer name" name="name" onChange={(event) => setName(event.target.value)} required value={effectiveName}/><Input className="full" label="Delivery address" name="address" onChange={(event) => setAddress(event.target.value)} required value={effectiveAddress}/><Input label="Area" name="area" onChange={(event) => setArea(event.target.value)} value={effectiveArea}/><label className="field"><span className="field-label">Order source</span><select className="input" onChange={(event) => setSource(event.target.value)} value={source}><option value="FACEBOOK">Facebook</option><option value="INSTAGRAM">Instagram</option><option value="PHONE">Phone</option><option value="WHATSAPP">WhatsApp</option><option value="OTHER">Other</option></select></label></div><CustomerMatch customer={customer.data} loading={customer.isFetching} missing={lookupMissing} profile={profile.data}/></section><section><div className="entry-section-title"><span>2</span><div><h3>Products</h3><p>Search name, SKU or barcode and add multiple variants.</p></div></div><div className="product-picker"><div className="search-field"><PackageSearch size={17}/><input aria-label="Search products for order" onChange={(event) => setProductSearch(event.target.value)} placeholder="Search products, SKU or barcode…" value={productSearch}/>{productSearch ? <button aria-label="Clear product search" onClick={() => setProductSearch("")} type="button"><X size={15}/></button> : null}</div>{productSearch && variants.length ? <div className="product-options">{variants.slice(0, 8).map(({ product, variant }) => <button key={variant.id} onClick={() => addItem(product.name, variant)} type="button"><span><strong>{product.name}</strong><small>{variant.name} · {variant.sku}</small></span><span><strong>{formatBDT(variant.price)}</strong><small>{variant.available_quantity} available</small></span><Plus size={16}/></button>)}</div> : null}</div>{items.length ? <div className="order-lines">{items.map((item) => <div className="order-line" key={item.variant.id}><span><strong>{item.productName}</strong><small>{item.variant.name} · {item.variant.sku}</small></span><div className="quantity-control"><button aria-label={`Decrease ${item.productName}`} onClick={() => quantity(item.variant.id, -1)} type="button"><Minus size={14}/></button><strong>{item.quantity}</strong><button aria-label={`Increase ${item.productName}`} onClick={() => quantity(item.variant.id, 1)} type="button"><Plus size={14}/></button></div><strong>{formatBDT(Number(item.variant.price) * item.quantity)}</strong><button aria-label={`Remove ${item.productName}`} className="icon-button danger" onClick={() => setItems((current) => current.filter((line) => line.variant.id !== item.variant.id))} type="button"><Trash2 size={16}/></button></div>)}</div> : <div className="entry-empty"><PackageSearch size={22}/><span><strong>No items added</strong><small>Search above to build the order.</small></span></div>}</section><section><div className="entry-section-title"><span>3</span><div><h3>Delivery & payment</h3><p>Courier booking happens after confirmation. Payment is cash on delivery.</p></div></div><div className="form-grid"><Input label="Delivery fee" min="0" onChange={(event) => setDeliveryFee(event.target.value)} type="number" value={deliveryFee}/><Input label="Discount" max={subtotal + Number(deliveryFee || 0)} min="0" onChange={(event) => setDiscount(event.target.value)} type="number" value={discount}/><div className="static-field"><span>Courier</span><strong>Assign after confirmation</strong></div><div className="static-field"><span>Payment</span><strong>Cash on delivery</strong></div></div></section><aside className="order-summary"><div><span>Subtotal</span><strong>{formatBDT(subtotal)}</strong></div><div><span>Delivery</span><strong>{formatBDT(deliveryFee)}</strong></div><div><span>Discount</span><strong>−{formatBDT(discount)}</strong></div><div className="summary-total"><span>Total</span><strong>{formatBDT(total)}</strong></div>{create.error ? <div className="form-alert">{create.error.message}</div> : null}<Button disabled={create.isPending || !phoneReady || !effectiveName.trim() || effectiveAddress.trim().length < 5 || !items.length || Number(discount) > subtotal + Number(deliveryFee)} type="submit">{create.isPending ? "Creating order…" : `Create COD order · ${formatBDT(total)}`}</Button></aside></form>}</SheetContent></Sheet>;
}

function CustomerMatch({ customer, loading, missing, profile }: { customer: Customer | undefined; loading: boolean; missing: boolean; profile: CustomerProfile | undefined }) { if (loading) return <div className="customer-match muted"><Phone size={17}/><span>Checking customer history…</span></div>; if (customer) { const risk = profile?.metrics.cod_risk; const returns = profile ? profile.metrics.delivery_outcomes - profile.metrics.successful_deliveries : 0; return <div className="customer-match found"><UserRound size={18}/><span><strong>{customer.name}</strong><small>{profile ? `${profile.metrics.successful_deliveries} delivered · ${returns} returned` : customer.normalized_phone}</small></span>{risk ? <Badge tone={risk.level === "LOW" ? "success" : risk.level === "MEDIUM" ? "warning" : "danger"}><ShieldCheck size={12}/>{label(risk.level)} risk</Badge> : null}</div>; } if (missing) return <div className="customer-match new"><Plus size={17}/><span><strong>New customer</strong><small>Enter their name and address; the profile will be saved with this order.</small></span></div>; return null; }
