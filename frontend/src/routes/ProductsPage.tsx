import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useQuery } from "@tanstack/react-query";
import { FolderTree, MoreHorizontal, PackageOpen, PackagePlus, Search } from "lucide-react";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { CategoriesDialog } from "../components/catalog/CategoriesDialog";
import { ProductDrawer } from "../components/catalog/ProductDrawer";
import { ProductFormDialog } from "../components/catalog/ProductFormDialog";
import { ProductThumb } from "../components/catalog/ProductThumb";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardContent } from "../components/ui/Card";
import { DataState } from "../components/ui/DataState";
import { SelectField } from "../components/ui/Field";
import { PageHeader } from "../components/ui/PageHeader";
import { Pagination } from "../components/ui/Pagination";
import { ResponsiveTable, type Column } from "../components/ui/ResponsiveTable";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { StockBadge } from "../components/ui/StockBadge";
import { api, type Category, type Page, type Product } from "../lib/api";
import { formatBDT, formatNumber } from "../lib/format";
import { useDebounced } from "../lib/hooks";
import { can } from "../lib/permissions";
import { useAuthStore } from "../stores/authStore";

const PAGE_SIZE = 25;
const STOCK_FILTERS = [
  { value: "all", label: "All stock" },
  { value: "in_stock", label: "In stock" },
  { value: "low", label: "Low" },
  { value: "out", label: "Out" },
] as const;
type StockFilter = (typeof STOCK_FILTERS)[number]["value"];

function priceRange(product: Product) {
  const prices = product.variants.map((variant) => Number(variant.price));
  if (!prices.length) return "—";
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  return low === high ? formatBDT(low) : `${formatBDT(low)}–${formatBDT(high)}`;
}

function stockSummary(product: Product) {
  const active = product.variants.filter((variant) => variant.is_active);
  const available = active.reduce((sum, variant) => sum + variant.available_quantity, 0);
  const reorder = active.reduce((sum, variant) => sum + variant.reorder_level, 0);
  return { available, reorder };
}

export function ProductsPage() {
  const user = useAuthStore((state) => state.user);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [stock, setStock] = useState<StockFilter>("all");
  const [status, setStatus] = useState<"active" | "inactive" | "all">("active");
  const [page, setPage] = useState(1);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const term = useDebounced(search);
  const editable = can(user, "product:write");
  const creating = params.get("new") === "1" && editable;
  const focusId = params.get("focus");
  const [drawerTab, setDrawerTab] = useState<"details" | "variants">("details");

  const query = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) });
  if (term.trim()) query.set("search", term.trim());
  if (categoryId) query.set("category_id", categoryId);
  if (stock !== "all") query.set("stock", stock);
  if (status !== "all") query.set("active", String(status === "active"));
  const products = useQuery({ queryKey: ["products", query.toString()], queryFn: () => api<Page<Product>>(`/api/v1/products?${query.toString()}`), placeholderData: (previous) => previous });
  const categories = useQuery({ queryKey: ["categories"], queryFn: () => api<Category[]>("/api/v1/categories") });
  const focused = useQuery({
    queryKey: ["products", "detail", focusId],
    queryFn: () => api<Product>(`/api/v1/products/${focusId}`),
    enabled: Boolean(focusId),
    initialData: () => products.data?.items.find((item) => item.id === focusId),
  });

  // One atomic update: React Router's setSearchParams does not queue updates within a tick.
  const updateParams = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value); else next.delete(key);
    }
    setParams(next, { replace: true });
  };
  const setParam = (key: string, value: string | null) => updateParams({ [key]: value });
  const open = (product: Product, tab: "details" | "variants" = "details") => { setDrawerTab(tab); setParam("focus", product.id); };
  const filtersActive = Boolean(term || categoryId || stock !== "all" || status !== "active");

  const columns: Column<Product>[] = [
    {
      key: "product",
      header: "Product",
      primary: true,
      cell: (product) => (
        <span className="cell-with-thumb">
          <ProductThumb id={product.id} imageUrl={product.image_url} name={product.name} />
          <span><span className="cell-title">{product.name}</span><span className="cell-subtitle">{product.category_name ?? "Uncategorised"}</span></span>
        </span>
      ),
    },
    { key: "sku", header: "SKU", cell: (product) => <span className="mono">{product.sku}</span> },
    { key: "variants", header: "Variants", numeric: true, cell: (product) => formatNumber(product.variants.length) },
    { key: "stock", header: "Stock", trailing: true, cell: (product) => { const summary = stockSummary(product); return <StockBadge available={summary.available} reorderLevel={summary.reorder} />; } },
    { key: "price", header: "Price", numeric: true, cell: priceRange },
    { key: "status", header: "Status", hideOnMobile: true, cell: (product) => <Badge tone={product.is_active ? "success" : "neutral"}>{product.is_active ? "Active" : "Inactive"}</Badge> },
    {
      key: "actions",
      header: "Actions",
      hideOnMobile: true,
      cell: (product) => (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button aria-label={`Actions for ${product.name}`} onClick={(event) => event.stopPropagation()} size="icon" variant="ghost"><MoreHorizontal aria-hidden="true" size={18} /></Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" className="menu-content" onClick={(event) => event.stopPropagation()} sideOffset={4}>
              <DropdownMenu.Item className="menu-item" onSelect={() => open(product)}>{editable ? "Edit details" : "View details"}</DropdownMenu.Item>
              <DropdownMenu.Item className="menu-item" onSelect={() => open(product, "variants")}>{editable ? "Edit variants" : "View variants"}</DropdownMenu.Item>
              {can(user, "inventory:read") ? <DropdownMenu.Item className="menu-item" onSelect={() => void navigate(`/inventory?search=${encodeURIComponent(product.sku)}`)}>Stock and history</DropdownMenu.Item> : null}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        actions={editable ? (
          <>
            <Button onClick={() => setCategoriesOpen(true)} variant="secondary"><FolderTree aria-hidden="true" size={17} /> Categories</Button>
            <Button onClick={() => setParam("new", "1")}><PackagePlus aria-hidden="true" size={17} /> Add product</Button>
          </>
        ) : undefined}
        description={products.data ? `${formatNumber(products.data.total)} products match your filters.` : "Your catalog, variants and stock at a glance."}
        eyebrow="Catalog"
        title="Products"
      />
      <Card>
        <CardContent>
          <div className="filter-bar">
            <label className="search-field">
              <Search aria-hidden="true" size={17} />
              <span className="sr-only">Search products</span>
              <input onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search name, SKU or scan a barcode" type="search" value={search} />
            </label>
            <SelectField aria-label="Category" label="Category" onChange={(event) => { setCategoryId(event.target.value); setPage(1); }} value={categoryId}>
              <option value="">All categories</option>
              {(categories.data ?? []).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </SelectField>
            <SelectField label="Status" onChange={(event) => { setStatus(event.target.value as typeof status); setPage(1); }} value={status}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="all">All</option>
            </SelectField>
            <SegmentedControl label="Stock level" onChange={(value) => { setStock(value); setPage(1); }} options={STOCK_FILTERS} value={stock} />
          </div>
          <DataState
            empty={{
              icon: PackageOpen,
              title: filtersActive ? "No products match" : "No products yet",
              description: filtersActive ? "Try a different search or clear the filters." : "Add your first product with its sizes and colors to start selling.",
              action: filtersActive
                ? <Button onClick={() => { setSearch(""); setCategoryId(""); setStock("all"); setStatus("active"); }} size="sm" variant="secondary">Clear filters</Button>
                : editable ? <Button onClick={() => setParam("new", "1")} size="sm"><PackagePlus aria-hidden="true" size={16} /> Add product</Button> : undefined,
            }}
            query={products}
          >
            {(data) => (
              <>
                <ResponsiveTable caption="Products" columns={columns} onRowClick={(product) => open(product)} rowKey={(product) => product.id} rowLabel={(product) => `Open ${product.name}`} rows={data.items} />
                <Pagination noun="products" onPage={setPage} page={data.page} pageSize={data.page_size} total={data.total} />
              </>
            )}
          </DataState>
        </CardContent>
      </Card>

      <ProductFormDialog
        categories={categories.data ?? []}
        onCreated={(product) => updateParams({ new: null, focus: product.id })}
        onOpenChange={(value) => setParam("new", value ? "1" : null)}
        open={creating}
      />
      <CategoriesDialog categories={categories.data ?? []} onOpenChange={setCategoriesOpen} open={categoriesOpen} />
      {focusId && focused.data ? (
        <ProductDrawer categories={categories.data ?? []} initialTab={drawerTab} key={focusId} onOpenChange={(value) => { if (!value) setParam("focus", null); }} product={focused.data} />
      ) : null}
    </div>
  );
}
