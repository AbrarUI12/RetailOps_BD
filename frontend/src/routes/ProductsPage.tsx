import { PackagePlus, Search, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { FadeUp } from "../components/motion/FadeUp";
import { PageTransition } from "../components/motion/PageTransition";
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

interface ProductPageData { items: Product[]; total: number; page: number; page_size: number }

export function ProductsPage() {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const products = useQuery({
    queryKey: ["products", search],
    queryFn: () => api<ProductPageData>(`/api/v1/products?search=${encodeURIComponent(search)}`),
  });
  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<Product>("/api/v1/products", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: async () => { setOpen(false); await queryClient.invalidateQueries({ queryKey: ["products"] }); },
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const value = (key: string) => {
      const entry = data.get(key);
      return typeof entry === "string" ? entry : "";
    };
    const name = value("name");
    const sku = value("sku").toUpperCase();
    create.mutate({ name, sku, description: value("description"), variants: [{ name: value("variant"), sku: `${sku}-${value("variantSku")}`.toUpperCase(), barcode: value("barcode") || null, price: Number(value("price")), cost: Number(value("cost")), reorder_level: Number(value("reorder")) }] });
  }
  return <PageTransition><div>
    <FadeUp><PageHeader eyebrow="Catalog" title="Products" description={`${products.data?.total ?? 0} products across your active assortment.`} actions={<Dialog onOpenChange={setOpen} open={open}><DialogTrigger asChild><Button><PackagePlus size={17}/> Add product</Button></DialogTrigger><DialogContent><DialogTitle>Create product</DialogTitle><DialogDescription>Add the product and its first sellable variant.</DialogDescription><form className="form-grid" onSubmit={submit}><Input label="Product name" name="name" required/><Input label="Product SKU" name="sku" required/><Input label="Description" name="description"/><Input defaultValue="Default" label="Variant name" name="variant" required/><Input defaultValue="STD" label="Variant suffix" name="variantSku" required/><Input label="Barcode" name="barcode"/><Input label="Selling price" min="0.01" name="price" required step="0.01" type="number"/><Input label="Cost" min="0" name="cost" required step="0.01" type="number"/><Input defaultValue="5" label="Reorder level" min="0" name="reorder" required type="number"/>{create.error ? <div className="form-alert full">{create.error.message}</div> : null}<div className="form-actions full"><Button onClick={() => setOpen(false)} type="button" variant="ghost">Cancel</Button><Button disabled={create.isPending} type="submit">{create.isPending ? "Creating…" : "Create product"}</Button></div></form></DialogContent></Dialog>} /></FadeUp>
    <FadeUp delay={.05}><Card><CardContent><div className="toolbar"><div className="search-field"><Search size={16}/><input aria-label="Search products" onChange={(event) => setSearch(event.target.value)} placeholder="Search name, SKU or barcode…" value={search}/></div><Button variant="secondary"><SlidersHorizontal size={16}/> Filters</Button></div>
    {products.isError ? <EmptyState action="Try again" description={products.error.message} icon={PackagePlus} title="Catalog unavailable"/> : null}
    {products.data?.items.length === 0 ? <EmptyState action="Add product" description="Create your first product and sellable variant." icon={PackagePlus} title="Your catalog is ready to begin"/> : null}
    {products.data?.items.length ? <Table><TableHeader><TableRow><TableHead>Product</TableHead><TableHead>SKU</TableHead><TableHead>Variant</TableHead><TableHead>Barcode</TableHead><TableHead className="align-right">Price</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{products.data.items.flatMap((product) => product.variants.map((variant) => <TableRow key={variant.id}><TableCell><strong>{product.name}</strong><small className="cell-subtitle">{product.description}</small></TableCell><TableCell className="mono">{variant.sku}</TableCell><TableCell>{variant.name}</TableCell><TableCell className="mono">{variant.barcode ?? "—"}</TableCell><TableCell className="align-right strong">{formatBDT(Number(variant.price))}</TableCell><TableCell><Badge tone={variant.is_active ? "success" : "neutral"}>{variant.is_active ? "Active" : "Archived"}</Badge></TableCell></TableRow>))}</TableBody></Table> : null}
    </CardContent></Card></FadeUp>
  </div></PageTransition>;
}
