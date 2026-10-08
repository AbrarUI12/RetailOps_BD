import { PackageCheck, Plus, Truck } from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardContent } from "../components/ui/Card";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "../components/ui/Dialog";
import { EmptyState } from "../components/ui/EmptyState";
import { Input } from "../components/ui/Input";
import { PageHeader } from "../components/ui/PageHeader";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/Table";
import { api, type Product } from "../lib/api";
import { formatBDT } from "../lib/utils";

interface Supplier { id: string; name: string }
interface Purchase { id: string; reference: string; supplier_id: string; status: string; total: string; created_at: string }
interface ProductPageData { items: Product[] }

export function PurchasesPage() {
  const [open, setOpen] = useState(false); const queryClient = useQueryClient();
  const purchases = useQuery({ queryKey: ["purchases"], queryFn: () => api<Purchase[]>("/api/v1/purchases") });
  const suppliers = useQuery({ queryKey: ["suppliers"], queryFn: () => api<Supplier[]>("/api/v1/suppliers") });
  const products = useQuery({ queryKey: ["products", "purchase"], queryFn: () => api<ProductPageData>("/api/v1/products?page_size=100") });
  const create = useMutation({ mutationFn: (body: object) => api<Purchase>("/api/v1/purchases", { method: "POST", body: JSON.stringify(body) }), onSuccess: async () => { setOpen(false); await queryClient.invalidateQueries({ queryKey: ["purchases"] }); } });
  const receive = useMutation({ mutationFn: (id: string) => api<Purchase>(`/api/v1/purchases/${id}/receive`, { method: "POST" }), onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["purchases"] }) });
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); const get = (key: string) => { const value = data.get(key); return typeof value === "string" ? value : ""; }; create.mutate({ supplier_id: get("supplier"), reference: get("reference"), items: [{ variant_id: get("variant"), quantity: Number(get("quantity")), unit_cost: Number(get("cost")) }] }); }
  return <div><PageHeader eyebrow="Inbound stock" title="Purchases & suppliers" description="Receive supplier purchases through the same immutable inventory ledger." actions={<Dialog onOpenChange={setOpen} open={open}><DialogTrigger asChild><Button><Plus size={17}/> New purchase</Button></DialogTrigger><DialogContent><DialogTitle>Create purchase</DialogTitle><DialogDescription>Receiving this draft will add stock ledger movements.</DialogDescription><form className="form-stack" onSubmit={submit}><Input label="Supplier reference" name="reference" required/><label className="field"><span className="field-label">Supplier</span><select className="input" name="supplier" required><option value="">Select supplier</option>{suppliers.data?.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="field"><span className="field-label">Product</span><select className="input" name="variant" required><option value="">Select product</option>{products.data?.items.flatMap((product) => product.variants.map((variant) => <option key={variant.id} value={variant.id}>{product.name} · {variant.name}</option>))}</select></label><Input label="Quantity" min="1" name="quantity" required type="number"/><Input label="Unit cost" min=".01" name="cost" required step=".01" type="number"/><Button type="submit">Save draft</Button></form></DialogContent></Dialog>}/><Card><CardContent>{purchases.data?.length ? <Table><TableHeader><TableRow><TableHead>Reference</TableHead><TableHead>Supplier</TableHead><TableHead>Status</TableHead><TableHead className="align-right">Total</TableHead><TableHead/></TableRow></TableHeader><TableBody>{purchases.data.map((purchase) => <TableRow key={purchase.id}><TableCell className="mono strong">{purchase.reference}</TableCell><TableCell>{suppliers.data?.find((supplier) => supplier.id === purchase.supplier_id)?.name ?? "Supplier"}</TableCell><TableCell><Badge tone={purchase.status === "RECEIVED" ? "success" : "warning"}>{purchase.status}</Badge></TableCell><TableCell className="align-right strong">{formatBDT(Number(purchase.total))}</TableCell><TableCell className="align-right">{purchase.status !== "RECEIVED" ? <Button onClick={() => receive.mutate(purchase.id)} size="sm"><PackageCheck size={14}/> Receive stock</Button> : null}</TableCell></TableRow>)}</TableBody></Table> : <EmptyState action="Create purchase" description="Add a supplier, then create and receive a purchase." icon={Truck} title="No purchases yet"/>}</CardContent></Card></div>;
}
