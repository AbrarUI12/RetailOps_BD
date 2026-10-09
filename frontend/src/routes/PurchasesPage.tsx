import { Building2, Eye, PackageCheck, Plus, Trash2, Truck, Users } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardContent } from "../components/ui/Card";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { DataState } from "../components/ui/DataState";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../components/ui/Dialog";
import { Drawer } from "../components/ui/Drawer";
import { SelectField } from "../components/ui/Field";
import { Input } from "../components/ui/Input";
import { PageHeader } from "../components/ui/PageHeader";
import { ResponsiveTable, type Column } from "../components/ui/ResponsiveTable";
import { api, type Page, type Product } from "../lib/api";
import { formatBDT, formatDate } from "../lib/format";
import { toast } from "../lib/toast";

interface Supplier { id: string; name: string; phone: string | null; email: string | null }
interface PurchaseItem { variant_id: string; product_name: string; variant_name: string; sku: string; quantity: number; unit_cost: string; line_total: string }
interface Purchase { id: string; reference: string; supplier_id: string; supplier_name: string; branch_id: string; status: "DRAFT" | "RECEIVED"; total: string; created_at: string; items: PurchaseItem[] }
interface DraftLine { key: number; variantId: string; quantity: string; unitCost: string }

let nextLineKey = 1;
const emptyLine = (): DraftLine => ({ key: nextLineKey++, variantId: "", quantity: "1", unitCost: "" });

export function PurchasesPage() {
  const queryClient = useQueryClient();
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [suppliersOpen, setSuppliersOpen] = useState(false);
  const [selected, setSelected] = useState<Purchase | null>(null);
  const [receiving, setReceiving] = useState<Purchase | null>(null);
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);
  const purchases = useQuery({ queryKey: ["purchases"], queryFn: () => api<Purchase[]>("/api/v1/purchases") });
  const suppliers = useQuery({ queryKey: ["suppliers"], queryFn: () => api<Supplier[]>("/api/v1/suppliers") });
  const products = useQuery({ queryKey: ["products", "purchase"], queryFn: () => api<Page<Product>>("/api/v1/products?page_size=100&status=active") });
  const variants = useMemo(() => products.data?.items.flatMap((product) => product.variants.filter((variant) => variant.is_active).map((variant) => ({ id: variant.id, label: `${product.name} · ${variant.name}`, sku: variant.sku, cost: variant.cost }))) ?? [], [products.data]);
  const draftTotal = lines.reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.unitCost || 0), 0);

  const createPurchase = useMutation({
    mutationFn: (body: object) => api<Purchase>("/api/v1/purchases", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: async (purchase) => {
      setPurchaseOpen(false);
      setLines([emptyLine()]);
      toast.success("Purchase saved", `${purchase.reference} is ready to receive.`);
      await queryClient.invalidateQueries({ queryKey: ["purchases"] });
    },
  });
  const createSupplier = useMutation({
    mutationFn: (body: object) => api<Supplier>("/api/v1/suppliers", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: async (supplier) => {
      toast.success("Supplier added", supplier.name);
      await queryClient.invalidateQueries({ queryKey: ["suppliers"] });
    },
  });
  const receive = useMutation({
    mutationFn: (id: string) => api<Purchase>(`/api/v1/purchases/${id}/receive`, { method: "POST" }),
    onSuccess: async (purchase) => {
      setReceiving(null);
      setSelected((current) => current?.id === purchase.id ? purchase : current);
      toast.success("Stock received", `${purchase.reference} was added to the inventory ledger.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["purchases"] }),
        queryClient.invalidateQueries({ queryKey: ["inventory"] }),
        queryClient.invalidateQueries({ queryKey: ["workspace-counts"] }),
      ]);
    },
  });

  function updateLine(key: number, change: Partial<DraftLine>) {
    setLines((current) => current.map((line) => line.key === key ? { ...line, ...change } : line));
  }
  function submitPurchase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const value = (name: string) => {
      const entry = data.get(name);
      return typeof entry === "string" ? entry : "";
    };
    createPurchase.mutate({
      supplier_id: value("supplier"),
      reference: value("reference"),
      items: lines.map((line) => ({ variant_id: line.variantId, quantity: Number(line.quantity), unit_cost: line.unitCost })),
    });
  }
  function submitSupplier(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const value = (name: string) => {
      const entry = data.get(name);
      return typeof entry === "string" ? entry : "";
    };
    createSupplier.mutate({ name: value("name"), phone: value("phone") || null, email: value("email") || null });
    form.reset();
  }

  const columns: Column<Purchase>[] = [
    { key: "reference", header: "Reference", primary: true, cell: (purchase) => <span className="purchase-reference"><strong className="mono">{purchase.reference}</strong><small>{purchase.items.length} line{purchase.items.length === 1 ? "" : "s"}</small></span> },
    { key: "supplier", header: "Supplier", cell: (purchase) => purchase.supplier_name },
    { key: "date", header: "Created", cell: (purchase) => formatDate(purchase.created_at) },
    { key: "status", header: "Status", trailing: true, cell: (purchase) => <Badge tone={purchase.status === "RECEIVED" ? "success" : "warning"}>{purchase.status === "RECEIVED" ? "Received" : "Draft"}</Badge> },
    { key: "total", header: "Total", numeric: true, trailing: true, cell: (purchase) => <strong>{formatBDT(purchase.total, { precise: true })}</strong> },
    { key: "actions", header: "Actions", cardFooter: true, cell: (purchase) => <div className="purchase-row-actions"><Button aria-label={`View ${purchase.reference}`} onClick={(event) => { event.stopPropagation(); setSelected(purchase); }} size="sm" type="button" variant="ghost"><Eye aria-hidden="true" size={15}/> View</Button>{purchase.status === "DRAFT" ? <Button onClick={(event) => { event.stopPropagation(); setReceiving(purchase); }} size="sm" type="button"><PackageCheck aria-hidden="true" size={15}/> Receive</Button> : null}</div> },
  ];

  return <div className="purchases-page">
    <PageHeader eyebrow="Inbound stock" title="Purchases & suppliers" description="Create purchase drafts and receive every unit through the immutable inventory ledger." actions={<div className="page-actions"><Button onClick={() => setSuppliersOpen(true)} type="button" variant="secondary"><Users aria-hidden="true" size={17}/> Suppliers</Button><Button onClick={() => setPurchaseOpen(true)} type="button"><Plus aria-hidden="true" size={17}/> New purchase</Button></div>}/>
    <Card><CardContent><DataState query={purchases} empty={{ icon: Truck, title: "No purchases yet", description: "Add a supplier, then create the first incoming purchase.", action: <Button onClick={() => setPurchaseOpen(true)} size="sm" type="button">Create purchase</Button> }}>{(rows) => <ResponsiveTable caption="Purchases" columns={columns} onRowClick={setSelected} rowKey={(purchase) => purchase.id} rowLabel={(purchase) => `View ${purchase.reference}`} rows={rows}/>}</DataState></CardContent></Card>

    <Dialog onOpenChange={setPurchaseOpen} open={purchaseOpen}>
      <DialogContent className="purchase-dialog">
        <DialogTitle>Create purchase</DialogTitle>
        <DialogDescription>Save an incoming supplier invoice as a draft. Stock changes only after you confirm receipt.</DialogDescription>
        <form className="purchase-form" onSubmit={submitPurchase}>
          <div className="form-grid purchase-basics"><Input label="Supplier reference" name="reference" placeholder="PO-2026-014" required/><SelectField label="Supplier" name="supplier" required><option value="">Select supplier</option>{suppliers.data?.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</SelectField></div>
          <div className="purchase-line-heading"><span><strong>Purchase items</strong><small>Each variant can appear once.</small></span><Button onClick={() => setLines((current) => [...current, emptyLine()])} size="sm" type="button" variant="secondary"><Plus aria-hidden="true" size={15}/> Add line</Button></div>
          <div className="purchase-lines">{lines.map((line, index) => <div className="purchase-line" key={line.key}>
            <span className="purchase-line-number">{index + 1}</span>
            <SelectField aria-label={`Product for line ${index + 1}`} label="Product" onChange={(event) => { const variant = variants.find((item) => item.id === event.target.value); updateLine(line.key, { variantId: event.target.value, unitCost: line.unitCost || variant?.cost || "" }); }} required value={line.variantId}><option value="">Select a product variant</option>{variants.map((variant) => <option key={variant.id} value={variant.id}>{variant.label} · {variant.sku}</option>)}</SelectField>
            <Input aria-label={`Quantity for line ${index + 1}`} label="Quantity" min="1" onChange={(event) => updateLine(line.key, { quantity: event.target.value })} required type="number" value={line.quantity}/>
            <Input aria-label={`Unit cost for line ${index + 1}`} label="Unit cost" min="0.01" onChange={(event) => updateLine(line.key, { unitCost: event.target.value })} required step="0.01" type="number" value={line.unitCost}/>
            <strong className="purchase-line-total"><small>Line total</small>{formatBDT(Number(line.quantity || 0) * Number(line.unitCost || 0), { precise: true })}</strong>
            <Button aria-label={`Remove line ${index + 1}`} disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))} size="icon" type="button" variant="ghost"><Trash2 aria-hidden="true" size={16}/></Button>
          </div>)}</div>
          <div className="purchase-form-footer"><span>Total <strong>{formatBDT(draftTotal, { precise: true })}</strong></span><Button disabled={createPurchase.isPending || !suppliers.data?.length} type="submit">{createPurchase.isPending ? "Saving…" : "Save draft"}</Button></div>
          {!suppliers.data?.length ? <div className="form-alert" role="alert">Add a supplier before creating a purchase.</div> : null}
          {createPurchase.error ? <div className="form-alert" role="alert">{createPurchase.error.message}</div> : null}
        </form>
      </DialogContent>
    </Dialog>

    <Dialog onOpenChange={setSuppliersOpen} open={suppliersOpen}>
      <DialogContent className="supplier-dialog">
        <DialogTitle>Suppliers</DialogTitle><DialogDescription>Keep contact details beside every incoming purchase.</DialogDescription>
        <form className="supplier-form" onSubmit={submitSupplier}><Input label="Supplier name" name="name" required/><Input label="Phone" name="phone" type="tel"/><Input label="Email" name="email" type="email"/><Button disabled={createSupplier.isPending} type="submit"><Plus aria-hidden="true" size={15}/> {createSupplier.isPending ? "Adding…" : "Add supplier"}</Button></form>
        {createSupplier.error ? <div className="form-alert" role="alert">{createSupplier.error.message}</div> : null}
        <div className="supplier-list">{suppliers.data?.length ? suppliers.data.map((supplier) => <div key={supplier.id}><span className="supplier-icon"><Building2 aria-hidden="true" size={16}/></span><span><strong>{supplier.name}</strong><small>{[supplier.phone, supplier.email].filter(Boolean).join(" · ") || "No contact details"}</small></span></div>) : <p>No suppliers added yet.</p>}</div>
      </DialogContent>
    </Dialog>

    <Drawer description={selected ? `${selected.supplier_name} · ${formatDate(selected.created_at)}` : undefined} footer={selected?.status === "DRAFT" ? <Button onClick={() => setReceiving(selected)} type="button"><PackageCheck aria-hidden="true" size={16}/> Receive stock</Button> : undefined} meta={selected ? <Badge tone={selected.status === "RECEIVED" ? "success" : "warning"}>{selected.status === "RECEIVED" ? "Received" : "Draft"}</Badge> : undefined} onOpenChange={(open) => { if (!open) setSelected(null); }} open={Boolean(selected)} title={selected?.reference ?? "Purchase"} wide>
      {selected ? <div className="purchase-detail"><div className="purchase-detail-lines">{selected.items.map((item) => <div key={item.variant_id}><span><strong>{item.product_name}</strong><small>{item.variant_name} · {item.sku}</small></span><span>{item.quantity} × {formatBDT(item.unit_cost, { precise: true })}</span><strong>{formatBDT(item.line_total, { precise: true })}</strong></div>)}</div><div className="purchase-detail-total"><span>Purchase total</span><strong>{formatBDT(selected.total, { precise: true })}</strong></div><p className="purchase-ledger-note"><PackageCheck aria-hidden="true" size={17}/>{selected.status === "RECEIVED" ? "Every line has been recorded as a purchase receipt in the inventory ledger." : "Inventory will not change until this purchase is received."}</p></div> : null}
    </Drawer>

    <ConfirmDialog confirmLabel="Receive into stock" description="This creates immutable inventory movements for every purchase line. It cannot be received twice." error={receive.error?.message} onConfirm={() => { if (receiving) receive.mutate(receiving.id); }} onOpenChange={(open) => { if (!open) setReceiving(null); }} open={Boolean(receiving)} pending={receive.isPending} title={`Receive ${receiving?.reference ?? "purchase"}?`}>
      {receiving ? <div className="receive-preview"><span>{receiving.items.length} line{receiving.items.length === 1 ? "" : "s"}</span><strong>{formatBDT(receiving.total, { precise: true })}</strong></div> : null}
    </ConfirmDialog>
  </div>;
}
