import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { History, Printer, ReceiptText, RotateCcw, Search } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";

import { ReceiptPaper } from "../components/pos/Receipt";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardContent } from "../components/ui/Card";
import { DataState, LoadingSkeleton } from "../components/ui/DataState";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../components/ui/Dialog";
import { Drawer } from "../components/ui/Drawer";
import { Input } from "../components/ui/Input";
import { PageHeader } from "../components/ui/PageHeader";
import { Pagination } from "../components/ui/Pagination";
import { ResponsiveTable, type Column } from "../components/ui/ResponsiveTable";
import { SelectField, TextareaField } from "../components/ui/Field";
import { api } from "../lib/api";
import { formatBDT, formatDateTime } from "../lib/format";
import { useDebounced } from "../lib/hooks";
import { can } from "../lib/permissions";
import type { SaleListItem, SalePageData, SaleReceipt } from "../lib/sales";
import { toast } from "../lib/toast";
import { useAuthStore } from "../stores/authStore";

const PAGE_SIZE = 25;

export function SalesPage() {
  const user = useAuthStore((state) => state.user);
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const term = useDebounced(search);
  const selectedId = params.get("sale");
  const query = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) });
  if (term.trim()) query.set("search", term.trim());
  const sales = useQuery({ queryKey: ["sales", page, term], queryFn: () => api<SalePageData>(`/api/v1/pos/sales?${query}`) });
  const detail = useQuery({
    queryKey: ["sale", selectedId],
    queryFn: () => api<SaleReceipt>(`/api/v1/pos/sales/${selectedId}`),
    enabled: Boolean(selectedId),
  });
  const open = (sale: SaleListItem) => setParams({ sale: sale.id });
  const close = () => setParams({});
  const columns: Column<SaleListItem>[] = [
    { key: "invoice", header: "Invoice", primary: true, cell: (sale) => <span><strong className="mono">{sale.invoice_number}</strong><small className="cell-subtitle">{formatDateTime(sale.created_at)}</small></span> },
    { key: "customer", header: "Customer", cell: (sale) => sale.customer_name ?? "Walk-in" },
    { key: "cashier", header: "Cashier", hideOnMobile: true, cell: (sale) => sale.cashier_name },
    { key: "items", header: "Items", cell: (sale) => `${sale.item_count} ${sale.item_count === 1 ? "item" : "items"}${sale.returned_quantity ? ` · ${sale.returned_quantity} returned` : ""}` },
    { key: "payment", header: "Payment", cell: (sale) => <Badge tone="info">{sale.payment_method}</Badge> },
    { key: "total", header: "Total", numeric: true, trailing: true, cell: (sale) => <strong>{formatBDT(sale.total)}</strong> },
  ];

  return (
    <div className="sales-page">
      <PageHeader eyebrow="Point of sale" title="Sales" description="Find every register transaction, reprint an exact receipt, or receive an approved return." />
      <Card>
        <CardContent>
          <div className="filter-bar">
            <label className="search-field">
              <Search aria-hidden="true" size={17} />
              <span className="sr-only">Search sales</span>
              <input onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Invoice or customer" type="search" value={search} />
            </label>
          </div>
          <DataState
            empty={{ icon: ReceiptText, title: term ? "No matching sales" : "No sales yet", description: term ? "Try another invoice or customer name." : "Completed POS transactions will appear here." }}
            query={sales}
          >
            {(data) => <><ResponsiveTable caption="Sales history" columns={columns} onRowClick={open} rowKey={(sale) => sale.id} rowLabel={(sale) => `View ${sale.invoice_number}`} rows={data.items} /><Pagination noun="sales" onPage={setPage} page={data.page} pageSize={data.page_size} total={data.total} /></>}
          </DataState>
        </CardContent>
      </Card>
      <Drawer
        description={detail.data ? formatDateTime(detail.data.created_at) : "Loading transaction…"}
        footer={detail.data ? <div className="sale-drawer-actions"><Button onClick={() => print()} variant="secondary"><Printer aria-hidden="true" size={16} /> Reprint</Button>{can(user, "sale:refund") && detail.data.items.some((line) => line.returned_quantity < line.quantity) ? <RefundDialog sale={detail.data} /> : null}</div> : undefined}
        meta={detail.data ? <Badge tone={detail.data.items.some((line) => line.returned_quantity > 0) ? "warning" : "success"}>{detail.data.items.some((line) => line.returned_quantity > 0) ? "Returned" : "Paid"}</Badge> : undefined}
        onOpenChange={(value) => { if (!value) close(); }}
        open={Boolean(selectedId)}
        title={detail.data?.invoice_number ?? "Sale details"}
        wide
      >
        {detail.isPending ? <LoadingSkeleton variant="page" /> : detail.isError ? <div className="form-alert">{detail.error.message}</div> : detail.data ? <div className="sale-detail"><ReceiptPaper receipt={detail.data} /><section className="sale-return-summary"><h3><History aria-hidden="true" size={17} /> Return history</h3>{detail.data.items.some((line) => line.returned_quantity) ? detail.data.items.filter((line) => line.returned_quantity).map((line) => <div key={line.variant_id}><span>{line.product_name} · {line.variant_name}</span><strong>{line.returned_quantity} of {line.quantity}</strong></div>) : <p>No items from this sale have been returned.</p>}</section></div> : null}
      </Drawer>
    </div>
  );
}

function RefundDialog({ sale }: { sale: SaleReceipt }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const refund = useMutation({
    mutationFn: (body: object) => api(`/api/v1/pos/sales/${sale.id}/refund`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: async () => {
      setOpen(false);
      toast.success("Return received", "Sellable stock and the sale history are updated.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sale", sale.id] }),
        queryClient.invalidateQueries({ queryKey: ["sales"] }),
        queryClient.invalidateQueries({ queryKey: ["inventory"] }),
      ]);
    },
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const value = (key: string, fallback = "") => {
      const item = data.get(key);
      return typeof item === "string" ? item : fallback;
    };
    const items = sale.items.flatMap((line) => {
      const quantity = Number(data.get(`quantity-${line.variant_id}`) ?? 0);
      return quantity > 0 ? [{ variant_id: line.variant_id, quantity, disposition: value(`disposition-${line.variant_id}`, "SELLABLE") }] : [];
    });
    if (!items.length) return;
    refund.mutate({ reason: value("reason"), items });
  }
  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <Button onClick={() => setOpen(true)} variant="danger"><RotateCcw aria-hidden="true" size={16} /> Refund items</Button>
      <DialogContent className="refund-dialog">
        <DialogTitle>Receive sale return</DialogTitle>
        <DialogDescription>Select only the units physically received. The server prevents returning more than was sold.</DialogDescription>
        <form onSubmit={submit}>
          <div className="refund-lines">
            {sale.items.map((line) => {
              const available = line.quantity - line.returned_quantity;
              return <div className="refund-line" key={line.variant_id}><span><strong>{line.product_name}</strong><small>{line.variant_name} · {available} returnable</small></span><Input aria-label={`Quantity for ${line.product_name} ${line.variant_name}`} defaultValue="0" max={available} min="0" name={`quantity-${line.variant_id}`} type="number" /><SelectField label="Condition" name={`disposition-${line.variant_id}`}><option value="SELLABLE">Sellable</option><option value="DAMAGED">Damaged</option><option value="MISSING">Missing</option></SelectField></div>;
            })}
          </div>
          <TextareaField label="Reason" minLength={3} name="reason" placeholder="Why is this being returned?" required />
          {refund.error ? <div className="form-alert" role="alert">{refund.error.message}</div> : null}
          <div className="form-actions"><Button disabled={refund.isPending} type="submit" variant="danger">{refund.isPending ? "Receiving…" : "Confirm return"}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
