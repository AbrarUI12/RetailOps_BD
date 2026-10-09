import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Save } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";

import { api, type Category, type Product, type Variant } from "../../lib/api";
import { formatBDT, formatDate } from "../../lib/format";
import { can } from "../../lib/permissions";
import { toast } from "../../lib/toast";
import { useAuthStore } from "../../stores/authStore";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Drawer } from "../ui/Drawer";
import { SelectField, TextareaField } from "../ui/Field";
import { Input } from "../ui/Input";
import { StockBadge } from "../ui/StockBadge";
import { Tabs } from "../ui/Tabs";
import { ProductThumb } from "./ProductThumb";

interface ProductDrawerProps {
  product: Product | null;
  categories: Category[];
  onOpenChange: (open: boolean) => void;
  initialTab?: "details" | "variants";
}

function useProductUpdated(onDone?: () => void) {
  const queryClient = useQueryClient();
  return (product: Product) => {
    queryClient.setQueriesData<{ items: Product[] }>({ queryKey: ["products"] }, (page) =>
      page ? { ...page, items: page.items.map((item) => (item.id === product.id ? product : item)) } : page,
    );
    void queryClient.invalidateQueries({ queryKey: ["products"] });
    void queryClient.invalidateQueries({ queryKey: ["inventory"] });
    onDone?.();
  };
}

export function ProductDrawer({ categories, initialTab = "details", onOpenChange, product }: ProductDrawerProps) {
  const [tab, setTab] = useState<"details" | "variants">(initialTab);
  const [current, setCurrent] = useState<Product | null>(product);
  const [confirmStatus, setConfirmStatus] = useState(false);
  const user = useAuthStore((state) => state.user);
  const editable = can(user, "product:write");
  const shown = current && product && current.id === product.id ? current : product;
  const onUpdated = useProductUpdated();

  const toggleActive = useMutation({
    mutationFn: (active: boolean) =>
      active
        ? api<Product>(`/api/v1/products/${shown?.id}`, { method: "PATCH", body: JSON.stringify({ is_active: true }) })
        : api<Product>(`/api/v1/products/${shown?.id}`, { method: "DELETE" }),
    onSuccess: (updated) => {
      setCurrent(updated);
      onUpdated(updated);
      setConfirmStatus(false);
      toast.success(updated.is_active ? "Product reactivated" : "Product deactivated", updated.is_active ? "It can be sold again." : "It no longer appears at the POS; history is kept.");
    },
  });

  if (!shown) return null;
  const totalStock = shown.variants.reduce((sum, variant) => sum + variant.available_quantity, 0);
  const prices = shown.variants.map((variant) => Number(variant.price));

  return (
    <>
      <Drawer
        description={`${shown.sku} · ${shown.category_name ?? "Uncategorised"}`}
        footer={editable ? (
          <Button onClick={() => setConfirmStatus(true)} variant={shown.is_active ? "secondary" : "primary"}>
            {shown.is_active ? "Deactivate product" : "Reactivate product"}
          </Button>
        ) : undefined}
        meta={<Badge tone={shown.is_active ? "success" : "neutral"}>{shown.is_active ? "Active" : "Inactive"}</Badge>}
        onOpenChange={onOpenChange}
        open
        title={shown.name}
        wide
      >
        <div className="product-summary">
          <ProductThumb id={shown.id} imageUrl={shown.image_url} large name={shown.name} />
          <dl>
            <dt>Variants</dt><dd>{shown.variants.length}</dd>
            <dt>Price</dt><dd>{Math.min(...prices) === Math.max(...prices) ? formatBDT(prices[0]) : `${formatBDT(Math.min(...prices))}–${formatBDT(Math.max(...prices))}`}</dd>
            <dt>Available</dt><dd>{totalStock}</dd>
            <dt>Added</dt><dd>{formatDate(shown.created_at)}</dd>
          </dl>
        </div>
        <Tabs
          label="Product sections"
          onChange={setTab}
          tabs={[
            { value: "details", label: "Details", content: <DetailsForm categories={categories} editable={editable} key={shown.id} onSaved={(updated) => { setCurrent(updated); onUpdated(updated); }} product={shown} /> },
            { value: "variants", label: `Variants (${shown.variants.length})`, content: <VariantsPanel editable={editable} onSaved={(updated) => { setCurrent(updated); onUpdated(updated); }} product={shown} /> },
          ]}
          value={tab}
        />
      </Drawer>
      <ConfirmDialog
        confirmLabel={shown.is_active ? "Deactivate" : "Reactivate"}
        description={shown.is_active ? "Its variants stop appearing at the POS and in new orders. Past sales, orders and stock history stay intact." : "The product and its variants become sellable again."}
        error={toggleActive.error?.message}
        onConfirm={() => toggleActive.mutate(!shown.is_active)}
        onOpenChange={setConfirmStatus}
        open={confirmStatus}
        pending={toggleActive.isPending}
        title={shown.is_active ? `Deactivate ${shown.name}?` : `Reactivate ${shown.name}?`}
        tone={shown.is_active ? "danger" : "primary"}
      />
    </>
  );
}

function DetailsForm({ categories, editable, onSaved, product }: { product: Product; categories: Category[]; editable: boolean; onSaved: (product: Product) => void }) {
  const [name, setName] = useState(product.name);
  const [categoryId, setCategoryId] = useState(product.category_id ?? "");
  const [imageUrl, setImageUrl] = useState(product.image_url ?? "");
  const [description, setDescription] = useState(product.description ?? "");
  const save = useMutation({
    mutationFn: () =>
      api<Product>(`/api/v1/products/${product.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name, category_id: categoryId || null, image_url: imageUrl || null, description: description || null }),
      }),
    onSuccess: (updated) => { onSaved(updated); toast.success("Product saved"); },
  });
  const dirty = name !== product.name || categoryId !== (product.category_id ?? "") || imageUrl !== (product.image_url ?? "") || description !== (product.description ?? "");

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <form className="form-stack" onSubmit={submit}>
      <Input disabled={!editable} label="Product name" onChange={(event) => setName(event.target.value)} required value={name} />
      <SelectField disabled={!editable} label="Category" onChange={(event) => setCategoryId(event.target.value)} value={categoryId}>
        <option value="">Uncategorised</option>
        {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
      </SelectField>
      <Input disabled={!editable} label="Image URL" onChange={(event) => setImageUrl(event.target.value)} placeholder="https://…" type="url" value={imageUrl} />
      <TextareaField disabled={!editable} label="Description" onChange={(event) => setDescription(event.target.value)} optional rows={3} value={description} />
      {save.error ? <div className="form-alert" role="alert">{save.error.message}</div> : null}
      {editable ? (
        <div className="form-actions">
          <Button aria-busy={save.isPending} disabled={!dirty || save.isPending || name.trim().length < 2} type="submit"><Save aria-hidden="true" size={16} /> Save details</Button>
        </div>
      ) : null}
    </form>
  );
}

function VariantsPanel({ editable, onSaved, product }: { product: Product; editable: boolean; onSaved: (product: Product) => void }) {
  const [adding, setAdding] = useState(false);
  return (
    <div style={{ display: "grid", gap: "var(--space-3)" }}>
      {product.variants.map((variant) => <VariantCard editable={editable} key={variant.id} onSaved={onSaved} variant={variant} />)}
      {editable ? (
        adding ? <NewVariantForm onCancel={() => setAdding(false)} onSaved={(updated) => { setAdding(false); onSaved(updated); }} product={product} /> : (
          <div><Button onClick={() => setAdding(true)} size="sm" variant="secondary"><Plus aria-hidden="true" size={16} /> Add variant</Button></div>
        )
      ) : null}
    </div>
  );
}

function VariantCard({ editable, onSaved, variant }: { variant: Variant; editable: boolean; onSaved: (product: Product) => void }) {
  const [price, setPrice] = useState(variant.price);
  const [cost, setCost] = useState(variant.cost);
  const [barcode, setBarcode] = useState(variant.barcode ?? "");
  const [reorder, setReorder] = useState(String(variant.reorder_level));
  const save = useMutation({
    mutationFn: (changes: Record<string, unknown>) => api<Product>(`/api/v1/variants/${variant.id}`, { method: "PATCH", body: JSON.stringify(changes) }),
    onSuccess: (updated) => { onSaved(updated); toast.success("Variant saved", variant.name); },
  });
  const dirty = price !== variant.price || cost !== variant.cost || barcode !== (variant.barcode ?? "") || reorder !== String(variant.reorder_level);

  return (
    <article className="variant-card">
      <header>
        <div><strong>{variant.name}</strong><small className="mono">{variant.sku}</small></div>
        <div className="inline-actions">
          <StockBadge available={variant.available_quantity} reorderLevel={variant.reorder_level} />
          {!variant.is_active ? <Badge>Inactive</Badge> : null}
        </div>
      </header>
      <div className="form-row">
        <Input disabled={!editable} inputMode="decimal" label="Price (৳)" onChange={(event) => setPrice(event.target.value)} value={price} />
        <Input disabled={!editable} inputMode="decimal" label="Cost (৳)" onChange={(event) => setCost(event.target.value)} value={cost} />
        <Input disabled={!editable} inputMode="numeric" label="Barcode" onChange={(event) => setBarcode(event.target.value)} placeholder="None" value={barcode} />
        <Input disabled={!editable} inputMode="numeric" label="Reorder level" onChange={(event) => setReorder(event.target.value)} value={reorder} />
      </div>
      {save.error ? <div className="form-alert" role="alert">{save.error.message}</div> : null}
      <div className="inline-actions">
        {editable ? <Button aria-busy={save.isPending} disabled={!dirty || save.isPending} onClick={() => save.mutate({ price, cost, barcode: barcode || null, reorder_level: Number(reorder || 0) })} size="sm"><Save aria-hidden="true" size={15} /> Save variant</Button> : null}
        {editable ? <Button disabled={save.isPending} onClick={() => save.mutate({ is_active: !variant.is_active })} size="sm" variant="ghost">{variant.is_active ? "Stop selling" : "Sell again"}</Button> : null}
        <Button asChild size="sm" variant="ghost"><Link to={`/inventory?variant=${variant.id}`}>Stock history</Link></Button>
      </div>
    </article>
  );
}

function NewVariantForm({ onCancel, onSaved, product }: { product: Product; onCancel: () => void; onSaved: (product: Product) => void }) {
  const [name, setName] = useState("");
  const [sku, setSku] = useState(`${product.sku}-`);
  const [barcode, setBarcode] = useState("");
  const [price, setPrice] = useState(product.variants[0]?.price ?? "");
  const add = useMutation({
    mutationFn: () => api<Product>(`/api/v1/products/${product.id}/variants`, { method: "POST", body: JSON.stringify({ name, sku, barcode: barcode || null, price, cost: product.variants[0]?.cost ?? "0" }) }),
    onSuccess: (updated) => { onSaved(updated); toast.success("Variant added", name); },
  });
  return (
    <form className="variant-card" onSubmit={(event) => { event.preventDefault(); add.mutate(); }}>
      <strong>New variant</strong>
      <div className="form-row">
        <Input label="Name" onChange={(event) => setName(event.target.value)} placeholder="Blue / XL" required value={name} />
        <Input label="SKU" onChange={(event) => setSku(event.target.value)} required value={sku} />
        <Input inputMode="numeric" label="Barcode" onChange={(event) => setBarcode(event.target.value)} value={barcode} />
        <Input inputMode="decimal" label="Price (৳)" onChange={(event) => setPrice(event.target.value)} required value={price} />
      </div>
      {add.error ? <div className="form-alert" role="alert">{add.error.message}</div> : null}
      <div className="inline-actions">
        <Button aria-busy={add.isPending} disabled={add.isPending || !name || !sku || !price} size="sm" type="submit">Add variant</Button>
        <Button onClick={onCancel} size="sm" type="button" variant="ghost">Cancel</Button>
      </div>
    </form>
  );
}
