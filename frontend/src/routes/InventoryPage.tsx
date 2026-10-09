import { useQuery } from "@tanstack/react-query";
import { Boxes, History, Search, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";

import { AdjustStockDialog } from "../components/inventory/AdjustStockDialog";
import { MovementHistoryDrawer } from "../components/inventory/MovementHistoryDrawer";
import { Button } from "../components/ui/Button";
import { Card, CardContent } from "../components/ui/Card";
import { DataState } from "../components/ui/DataState";
import { SelectField } from "../components/ui/Field";
import { PageHeader } from "../components/ui/PageHeader";
import { Pagination } from "../components/ui/Pagination";
import { ResponsiveTable, type Column } from "../components/ui/ResponsiveTable";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { StockBadge } from "../components/ui/StockBadge";
import { api, type Category, type InventoryItem, type Page } from "../lib/api";
import { formatNumber } from "../lib/format";
import { useDebounced } from "../lib/hooks";
import { can } from "../lib/permissions";
import { useAuthStore } from "../stores/authStore";

const PAGE_SIZE = 50;
const STATUS_FILTERS = [
  { value: "all", label: "All" },
  { value: "low", label: "Low stock" },
  { value: "out", label: "Out of stock" },
  { value: "in_stock", label: "Healthy" },
] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number]["value"];

export function InventoryPage() {
  const user = useAuthStore((state) => state.user);
  const canAdjust = can(user, "inventory:adjust");
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get("search") ?? "");
  const [status, setStatus] = useState<StatusFilter>(params.get("filter") === "low" ? "low" : "all");
  const [categoryId, setCategoryId] = useState("");
  const [page, setPage] = useState(1);
  const [adjusting, setAdjusting] = useState<InventoryItem | null>(null);
  const historyId = params.get("variant");
  const term = useDebounced(search);

  const query = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) });
  if (term.trim()) query.set("search", term.trim());
  if (status !== "all") query.set("status", status);
  if (categoryId) query.set("category_id", categoryId);
  const inventory = useQuery({ queryKey: ["inventory", query.toString()], queryFn: () => api<Page<InventoryItem>>(`/api/v1/inventory?${query.toString()}`), placeholderData: (previous) => previous });
  const categories = useQuery({ queryKey: ["categories"], queryFn: () => api<Category[]>("/api/v1/categories") });
  const historyItem = inventory.data?.items.find((item) => item.variant_id === historyId);

  const setHistory = (variantId: string | null) => {
    const next = new URLSearchParams(params);
    if (variantId) next.set("variant", variantId); else next.delete("variant");
    setParams(next, { replace: true });
  };

  const columns: Column<InventoryItem>[] = [
    {
      key: "variant",
      header: "Variant",
      primary: true,
      cell: (item) => <span><span className="cell-title">{item.product_name}</span><span className="cell-subtitle">{item.variant_name}{item.category_name ? ` · ${item.category_name}` : ""}</span></span>,
    },
    { key: "sku", header: "SKU", cell: (item) => <span className="mono">{item.sku}</span> },
    { key: "physical", header: "Physical", numeric: true, cell: (item) => formatNumber(item.physical_quantity) },
    { key: "reserved", header: "Reserved", numeric: true, cell: (item) => formatNumber(item.reserved_quantity) },
    { key: "available", header: "Available", numeric: true, cell: (item) => <strong>{formatNumber(item.available_quantity)}</strong> },
    { key: "reorder", header: "Reorder at", numeric: true, hideOnMobile: true, cell: (item) => formatNumber(item.reorder_level) },
    { key: "status", header: "Status", trailing: true, cell: (item) => <StockBadge available={item.available_quantity} reorderLevel={item.reorder_level} /> },
    {
      key: "actions",
      header: "Actions",
      cardFooter: true,
      cell: (item) => (
        <span className="inline-actions">
          <Button aria-label={`Stock history for ${item.product_name} ${item.variant_name}`} onClick={(event) => { event.stopPropagation(); setHistory(item.variant_id); }} size="sm" variant="ghost"><History aria-hidden="true" size={15} /> History</Button>
          {canAdjust ? <Button aria-label={`Adjust stock for ${item.product_name} ${item.variant_name}`} onClick={(event) => { event.stopPropagation(); setAdjusting(item); }} size="sm" variant="secondary"><SlidersHorizontal aria-hidden="true" size={15} /> Adjust</Button> : null}
        </span>
      ),
    },
  ];

  const filtersActive = Boolean(term || categoryId || status !== "all");
  return (
    <div>
      <PageHeader
        description="Physical stock minus reservations for confirmed orders is what you can sell. Every change is recorded in the ledger."
        eyebrow="Stock control"
        title="Inventory"
      />
      <Card>
        <CardContent>
          <div className="filter-bar">
            <label className="search-field">
              <Search aria-hidden="true" size={17} />
              <span className="sr-only">Search inventory</span>
              <input onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search product, variant, SKU or barcode" type="search" value={search} />
            </label>
            <SelectField label="Category" onChange={(event) => { setCategoryId(event.target.value); setPage(1); }} value={categoryId}>
              <option value="">All categories</option>
              {(categories.data ?? []).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </SelectField>
            <SegmentedControl label="Stock status" onChange={(value) => { setStatus(value); setPage(1); }} options={STATUS_FILTERS} value={status} />
          </div>
          <DataState
            empty={{
              icon: Boxes,
              title: filtersActive ? "Nothing matches" : "No stock yet",
              description: filtersActive ? "Try a different search or filter." : "Add products, then record opening stock or receive a purchase.",
              action: filtersActive ? <Button onClick={() => { setSearch(""); setCategoryId(""); setStatus("all"); }} size="sm" variant="secondary">Clear filters</Button> : undefined,
            }}
            query={inventory}
          >
            {(data) => (
              <>
                <ResponsiveTable caption="Inventory" columns={columns} onRowClick={(item) => setHistory(item.variant_id)} rowKey={(item) => item.variant_id} rowLabel={(item) => `Stock history for ${item.product_name} ${item.variant_name}`} rows={data.items} />
                <Pagination noun="variants" onPage={setPage} page={data.page} pageSize={data.page_size} total={data.total} />
              </>
            )}
          </DataState>
        </CardContent>
      </Card>
      {historyId ? (
        <MovementHistoryDrawer
          key={historyId}
          onAdjust={canAdjust && historyItem ? () => { setHistory(null); setAdjusting(historyItem); } : undefined}
          onOpenChange={(open) => { if (!open) setHistory(null); }}
          variantId={historyId}
        />
      ) : null}
      {adjusting ? <AdjustStockDialog item={adjusting} key={adjusting.variant_id} onOpenChange={(open) => { if (!open) setAdjusting(null); }} /> : null}
    </div>
  );
}
