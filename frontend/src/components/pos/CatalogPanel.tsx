import { useQuery } from "@tanstack/react-query";
import { PackageSearch, RefreshCw, ScanBarcode, Search, WifiOff } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { cachedCategories, findByCode, searchCatalog, type CatalogStatus } from "../../lib/catalog";
import { formatBDT, formatNumber, formatRelative } from "../../lib/format";
import type { CatalogItem } from "../../lib/offlineDb";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { StateMessage } from "../ui/DataState";

interface CatalogPanelProps {
  onAdd: (item: CatalogItem) => void;
  offline: boolean;
  status: CatalogStatus | undefined;
  refreshing: boolean;
  refreshError: string | null;
  onRefresh: () => void;
}

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}

/** Search, scan, categories and product grid, all served from the device's catalog (plan §13, §40). */
export function CatalogPanel({ offline, onAdd, onRefresh, refreshError, refreshing, status }: CatalogPanelProps) {
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: "success" | "warning" } | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const reduceMotion = useReducedMotion();

  const results = useQuery({ queryKey: ["pos-catalog", search.trim(), categoryId, status?.version, status?.stockAt], queryFn: () => searchCatalog(search.trim(), categoryId), placeholderData: (previous) => previous, networkMode: "always" });
  // Local IndexedDB reads must keep running offline; React Query pauses network queries by default.
  const categories = useQuery({ queryKey: ["pos-categories", status?.version], queryFn: cachedCategories, networkMode: "always" });

  // F2 jumps to the search/scan field from anywhere on the POS (plan §13 shortcuts).
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "F2") {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(null), 2500);
    return () => clearTimeout(timer);
  }, [notice]);

  function add(item: CatalogItem) {
    onAdd(item);
    setFlashId(item.variant_id);
    setNotice({ text: `Added ${item.product_name} · ${item.variant_name}`, tone: "success" });
    setTimeout(() => setFlashId(null), 600);
  }

  async function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const code = search.trim();
    if (!code) return;
    // Scanners type the barcode and press Enter: an exact barcode/SKU match is added immediately.
    const exact = await findByCode(code);
    const match = exact ?? (results.data?.length === 1 ? results.data[0] : undefined);
    if (match) {
      add(match);
      // A fast scanner may already be typing the next code: only clear what this scan entered.
      setSearch((current) => (current.trim() === code ? "" : current));
    } else {
      setNotice({ text: `No product with barcode or SKU “${code}”`, tone: "warning" });
    }
  }

  const items = results.data ?? [];
  const neverDownloaded = status !== undefined && status.count === 0;

  return (
    <section aria-label="Products" className="pos-catalog">
      <div className="pos-heading">
        <div>
          <span className="eyebrow">Point of sale</span>
          <h1>New sale</h1>
        </div>
        {offline ? <Badge tone="warning"><WifiOff aria-hidden="true" size={14} /> Offline: selling from this device</Badge> : <Badge tone="success">Register ready</Badge>}
      </div>

      <div className="pos-search">
        <ScanBarcode aria-hidden="true" size={20} />
        <label className="sr-only" htmlFor="pos-search-input">Search or scan a barcode</label>
        <input
          id="pos-search-input"
          aria-describedby="pos-scan-hint"
          autoComplete="off"
          autoFocus
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => void onKeyDown(event)}
          placeholder="Scan a barcode or search products…"
          ref={inputRef}
          type="search"
          value={search}
        />
        <kbd aria-hidden="true">F2</kbd>
      </div>
      <p className="pos-hint" id="pos-scan-hint">
        <Search aria-hidden="true" size={13} /> Press Enter to add an exact barcode or SKU match.
      </p>
      <div aria-live="polite" className="pos-notice-slot">
        <AnimatePresence>
          {notice ? (
            <motion.p animate={{ opacity: 1, y: 0 }} className={cn("pos-notice", notice.tone)} exit={{ opacity: 0 }} initial={{ opacity: 0, y: -4 }} key={notice.text}>
              {notice.text}
            </motion.p>
          ) : null}
        </AnimatePresence>
      </div>

      <div aria-label="Categories" className="category-pills" role="group">
        <button aria-pressed={categoryId === null} onClick={() => setCategoryId(null)} type="button">All products</button>
        {(categories.data ?? []).map((category) => (
          <button aria-pressed={categoryId === category.id} key={category.id} onClick={() => setCategoryId(category.id)} type="button">{category.name}</button>
        ))}
      </div>

      {neverDownloaded ? (
        <StateMessage
          action={offline ? undefined : <Button disabled={refreshing} onClick={onRefresh} size="sm"><RefreshCw aria-hidden="true" size={15} /> Download catalog</Button>}
          description={offline ? "Connect once so this device can download the catalog; after that it keeps selling offline." : refreshError ?? "Downloading the catalog to this device…"}
          icon={PackageSearch}
          title="Catalog not on this device yet"
          tone={refreshError ? "error" : "neutral"}
        />
      ) : items.length === 0 && !results.isPending ? (
        <StateMessage description={search ? "Try another name, SKU or barcode." : "No products in this category."} icon={PackageSearch} title={search ? `Nothing matches “${search}”` : "No products here"} />
      ) : (
        <div className="product-grid">
          {items.map((item) => {
            const outOfStock = item.available_quantity <= 0;
            const low = !outOfStock && item.available_quantity <= item.reorder_level;
            return (
              <motion.button
                animate={flashId === item.variant_id && !reduceMotion ? { scale: [1, 0.96, 1] } : { scale: 1 }}
                aria-label={`Add ${item.product_name} ${item.variant_name}, ${formatBDT(item.price)}${outOfStock ? ", out of stock" : ""}`}
                className={cn("product-tile", flashId === item.variant_id && "flash")}
                disabled={outOfStock && !offline}
                key={item.variant_id}
                onClick={() => add(item)}
                transition={{ duration: 0.25 }}
                type="button"
              >
                <span aria-hidden="true" className="product-art">{item.image_url ? <img alt="" decoding="async" height="96" loading="lazy" referrerPolicy="no-referrer" src={item.image_url} width="160" /> : initials(item.product_name)}</span>
                <span>
                  <strong>{item.product_name}</strong>
                  <small>{item.variant_name} · {item.sku}</small>
                </span>
                <span className="product-price">{formatBDT(item.price)}</span>
                <span className={cn("product-stock", low && "low", outOfStock && "out")}>{outOfStock ? "Out of stock" : `${formatNumber(item.available_quantity)} available`}</span>
              </motion.button>
            );
          })}
        </div>
      )}

      <footer className="catalog-status">
        <span>
          {status?.count ? `${formatNumber(status.count)} items on this device` : "No catalog yet"}
          {status?.syncedAt ? ` · catalog updated ${formatRelative(status.syncedAt)}` : ""}
          {status?.stockAt ? ` · stock as of ${formatRelative(status.stockAt)}` : ""}
        </span>
        {refreshError && !neverDownloaded ? <span className="catalog-error" role="status">Could not refresh: showing the saved catalog</span> : null}
        <Button aria-busy={refreshing} disabled={offline || refreshing} onClick={onRefresh} size="sm" variant="ghost">
          <RefreshCw aria-hidden="true" className={cn(refreshing && "spin")} size={15} /> {refreshing ? "Refreshing…" : "Refresh"}
        </Button>
      </footer>
    </section>
  );
}
