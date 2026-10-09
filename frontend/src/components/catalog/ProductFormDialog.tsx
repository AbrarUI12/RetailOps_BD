import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";

import { ApiError, api, type Category, type Product } from "../../lib/api";
import { toast } from "../../lib/toast";
import { Button } from "../ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/Dialog";
import { SelectField, TextareaField } from "../ui/Field";
import { Input } from "../ui/Input";
import { generateVariants, type AttributeInput, type VariantDraft } from "./variantBuilder";

interface ProductFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: Category[];
  onCreated: (product: Product) => void;
}

const EMPTY_ATTRIBUTE: AttributeInput = { name: "", values: "" };

/** Quick create on one screen (plan §17): basics, pricing, variants, stock defaults, media. */
export function ProductFormDialog({ categories, onCreated, onOpenChange, open }: ProductFormDialogProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [price, setPrice] = useState("");
  const [cost, setCost] = useState("");
  const [reorderLevel, setReorderLevel] = useState("5");
  const [imageUrl, setImageUrl] = useState("");
  const [description, setDescription] = useState("");
  const [attributes, setAttributes] = useState<AttributeInput[]>([{ name: "Size", values: "" }]);
  const [variants, setVariants] = useState<VariantDraft[]>([]);
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);

  const drafts = variants.length ? variants : generateVariants(sku, attributes, { price, cost });

  function reset() {
    setName(""); setSku(""); setCategoryId(""); setPrice(""); setCost(""); setReorderLevel("5");
    setImageUrl(""); setDescription(""); setAttributes([{ name: "Size", values: "" }]); setVariants([]); setError(null);
  }

  function regenerate(nextAttributes = attributes, nextSku = sku) {
    setVariants(generateVariants(nextSku, nextAttributes, { price, cost }, variants));
  }

  function updateAttribute(index: number, change: Partial<AttributeInput>) {
    const next = attributes.map((attribute, position) => (position === index ? { ...attribute, ...change } : attribute));
    setAttributes(next);
    regenerate(next);
  }

  function updateDraft(key: string, change: Partial<VariantDraft>) {
    setVariants(drafts.map((draft) => (draft.key === key ? { ...draft, ...change } : draft)));
  }

  const create = useMutation({
    mutationFn: () =>
      api<Product>("/api/v1/products", {
        method: "POST",
        body: JSON.stringify({
          name,
          sku,
          category_id: categoryId || null,
          description: description || null,
          image_url: imageUrl || null,
          variants: drafts.map((draft) => ({
            name: draft.name,
            sku: draft.sku,
            barcode: draft.barcode || null,
            price: draft.price || price,
            cost: draft.cost || cost || "0",
            attributes: draft.attributes,
            reorder_level: Number(reorderLevel || 0),
          })),
        }),
      }),
    onSuccess: (product) => {
      void queryClient.invalidateQueries({ queryKey: ["products"] });
      void queryClient.invalidateQueries({ queryKey: ["inventory"] });
      toast.success("Product created", `${product.name} · ${product.variants.length} variant${product.variants.length === 1 ? "" : "s"}`);
      reset();
      // The parent closes this dialog and opens the new product in one navigation.
      onCreated(product);
    },
    onError: (reason) => {
      const details = reason instanceof ApiError ? reason : null;
      setError({ message: reason instanceof Error ? reason.message : "Could not save the product", field: details?.code === "DUPLICATE_BARCODE" ? "barcode" : details?.code === "DUPLICATE_SKU" ? "sku" : undefined });
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (drafts.some((draft) => !(draft.price || price))) {
      setError({ message: "Every variant needs a selling price" });
      return;
    }
    create.mutate();
  }

  return (
    <Dialog onOpenChange={(next) => { if (!create.isPending) onOpenChange(next); }} open={open}>
      <DialogContent className="wide-dialog">
        <DialogHeader>
          <DialogTitle>Add product</DialogTitle>
          <DialogDescription>Create the product and all its variants in one step.</DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={submit}>
          <section className="form-section">
            <header><h3>Basics</h3></header>
            <div className="form-row">
              <Input label="Product name" onChange={(event) => setName(event.target.value)} placeholder="e.g. Premium Panjabi" required value={name} />
              <Input
                error={error?.field === "sku" ? error.message : undefined}
                hint="Variant SKUs are built from this"
                label="Product SKU"
                onChange={(event) => { setSku(event.target.value); regenerate(attributes, event.target.value); }}
                placeholder="e.g. PAN"
                required
                value={sku}
              />
              <SelectField label="Category" onChange={(event) => setCategoryId(event.target.value)} optional value={categoryId}>
                <option value="">Uncategorised</option>
                {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </SelectField>
            </div>
          </section>

          <section className="form-section">
            <header><h3>Pricing</h3><p>Defaults for every variant; adjust single variants below.</p></header>
            <div className="form-row">
              <Input inputMode="decimal" label="Selling price (৳)" min="0" onChange={(event) => setPrice(event.target.value)} placeholder="e.g. 1,500" required step="0.01" type="number" value={price} />
              <Input hint="Used for profit reports" inputMode="decimal" label="Cost price (৳)" min="0" onChange={(event) => setCost(event.target.value)} placeholder="e.g. 800" step="0.01" type="number" value={cost} />
            </div>
          </section>

          <section className="form-section variant-builder">
            <header><h3>Variants</h3><p>List options such as Color and Size; every combination becomes a variant.</p></header>
            {attributes.map((attribute, index) => (
              <div className="attribute-row" key={index}>
                <Input label="Option" onChange={(event) => updateAttribute(index, { name: event.target.value })} placeholder="e.g. Color" value={attribute.name} />
                <Input hint="Separate values with commas" label="Values" onChange={(event) => updateAttribute(index, { values: event.target.value })} placeholder="e.g. Black, White" value={attribute.values} />
                <Button aria-label={`Remove option ${attribute.name || index + 1}`} onClick={() => { const next = attributes.filter((_, position) => position !== index); setAttributes(next); regenerate(next); }} size="icon" type="button" variant="ghost"><Trash2 aria-hidden="true" size={17} /></Button>
              </div>
            ))}
            <div><Button onClick={() => setAttributes([...attributes, EMPTY_ATTRIBUTE])} size="sm" type="button" variant="secondary"><Plus aria-hidden="true" size={16} /> Add option</Button></div>
            <div className="variant-grid" role="group" aria-label={`${drafts.length} variants`}>
              <div className="variant-grid-row variant-grid-head" aria-hidden="true"><span>Variant</span><span>SKU</span><span>Barcode</span><span>Price (৳)</span><span /></div>
              {drafts.map((draft) => (
                <div className="variant-grid-row" key={draft.key}>
                  <strong>{draft.name}</strong>
                  <input aria-label={`SKU for ${draft.name}`} className="input" onChange={(event) => updateDraft(draft.key, { sku: event.target.value })} value={draft.sku} />
                  <input aria-invalid={error?.field === "barcode"} aria-label={`Barcode for ${draft.name}`} className="input" inputMode="numeric" onChange={(event) => updateDraft(draft.key, { barcode: event.target.value })} placeholder="Scan or type" value={draft.barcode} />
                  <input aria-label={`Price for ${draft.name}`} className="input" inputMode="decimal" onChange={(event) => updateDraft(draft.key, { price: event.target.value })} placeholder={price ? `${price} (default)` : "Price"} value={draft.price} />
                  <Button aria-label={`Remove ${draft.name}`} disabled={drafts.length === 1} onClick={() => setVariants(drafts.filter((item) => item.key !== draft.key))} size="icon" type="button" variant="ghost"><Trash2 aria-hidden="true" size={16} /></Button>
                </div>
              ))}
            </div>
          </section>

          <section className="form-section">
            <header><h3>Inventory defaults</h3></header>
            <div className="form-row">
              <Input hint="Alert when available stock reaches this level" inputMode="numeric" label="Reorder level" min="0" onChange={(event) => setReorderLevel(event.target.value)} type="number" value={reorderLevel} />
            </div>
          </section>

          <section className="form-section">
            <header><h3>Media and details</h3></header>
            <div className="form-row">
              <Input label="Image URL" onChange={(event) => setImageUrl(event.target.value)} placeholder="https://…" type="url" value={imageUrl} />
            </div>
            <TextareaField label="Description" onChange={(event) => setDescription(event.target.value)} optional rows={3} value={description} />
          </section>

          {error && error.field !== "sku" ? <div className="form-alert" role="alert">{error.message}</div> : null}
          <div className="dialog-footer">
            <Button disabled={create.isPending} onClick={() => onOpenChange(false)} type="button" variant="secondary">Cancel</Button>
            <Button aria-busy={create.isPending} disabled={create.isPending || !name || !sku} type="submit">
              {create.isPending ? <span aria-hidden="true" className="spinner" /> : null}
              Create product
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
