import { useQuery } from "@tanstack/react-query";
import {
  Boxes,
  CircleDollarSign,
  ClipboardList,
  ClipboardPlus,
  PackagePlus,
  ReceiptText,
  RefreshCw,
  Search,
  ShoppingBag,
  Truck,
  User,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";

import { api, type SearchHit } from "../../lib/api";
import { can, type Permission } from "../../lib/permissions";
import { SHORTCUT_LABEL } from "../../lib/shortcuts";
import { useAuthStore } from "../../stores/authStore";
import { useUIStore } from "../../stores/uiStore";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../ui/Dialog";

interface Entry {
  id: string;
  group: string;
  title: string;
  detail: string;
  to: string;
  icon: LucideIcon;
}

const ACTIONS: (Omit<Entry, "id" | "group"> & { permission: Permission })[] = [
  { title: "Start a new sale", detail: "Open the point of sale", to: "/pos", icon: CircleDollarSign, permission: "sale:create" },
  { title: "Create an order", detail: "Facebook, phone or WhatsApp order", to: "/orders?new=1", icon: ClipboardPlus, permission: "order:write" },
  { title: "Add a product", detail: "Product with variants", to: "/products?new=1", icon: PackagePlus, permission: "product:write" },
  { title: "Adjust stock", detail: "Record a counted inventory change", to: "/inventory", icon: Boxes, permission: "inventory:adjust" },
  { title: "Receive a purchase", detail: "Book supplier stock into inventory", to: "/purchases", icon: Truck, permission: "purchase:write" },
  { title: "Open Sync Center", detail: "Device queue and conflicts", to: "/sync", icon: RefreshCw, permission: "sale:create" },
];

const HIT_ICONS: Record<SearchHit["kind"], LucideIcon> = {
  product: ShoppingBag,
  order: ClipboardList,
  customer: User,
  sale: ReceiptText,
  shipment: Truck,
};
const HIT_GROUPS: Record<SearchHit["kind"], string> = {
  product: "Products",
  order: "Orders",
  customer: "Customers",
  sale: "Sales",
  shipment: "Shipments",
};

function useDebounced(value: string, delay = 200) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [delay, value]);
  return debounced;
}

/** Global search and quick actions (plan §11). */
export function CommandPalette() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const open = useUIStore((state) => state.commandOpen);
  const setOpen = useUIStore((state) => state.setCommandOpen);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const term = useDebounced(query.trim());

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(!useUIStore.getState().commandOpen);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setOpen]);

  const search = useQuery({
    queryKey: ["search", term],
    queryFn: () => api<SearchHit[]>(`/api/v1/search?q=${encodeURIComponent(term)}`),
    enabled: open && term.length >= 2 && navigator.onLine,
    staleTime: 15_000,
  });

  const entries = useMemo<Entry[]>(() => {
    const normalized = query.trim().toLowerCase();
    const actions = ACTIONS.filter((action) => can(user, action.permission))
      .filter((action) => !normalized || `${action.title} ${action.detail}`.toLowerCase().includes(normalized))
      .map((action) => ({ ...action, id: `action:${action.to}`, group: "Quick actions" }));
    const hits = (term.length >= 2 ? search.data ?? [] : []).map((hit) => ({
      // Product search returns one hit per matching variant, so the product ID alone is not unique.
      id: `${hit.kind}:${hit.id}:${hit.subtitle}`,
      group: HIT_GROUPS[hit.kind],
      title: hit.title,
      detail: hit.subtitle,
      to: hit.to,
      icon: HIT_ICONS[hit.kind],
    }));
    return [...hits, ...actions];
  }, [query, search.data, term, user]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const choose = (entry: Entry) => {
    setOpen(false);
    setQuery("");
    void navigate(entry.to);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => Math.min(entries.length - 1, index + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(0, index - 1));
    } else if (event.key === "Enter" && entries[active]) {
      event.preventDefault();
      choose(entries[active]);
    }
  };

  const searching = term.length >= 2 && search.isFetching;
  let lastGroup = "";

  return (
    <Dialog onOpenChange={(next) => { setOpen(next); if (!next) setQuery(""); }} open={open}>
      <DialogContent className="command-dialog">
        <DialogTitle className="sr-only">Search and quick actions</DialogTitle>
        <DialogDescription className="sr-only">Search products, barcodes, orders, customer phones, invoices and tracking codes.</DialogDescription>
        <label className="command-search">
          <Search aria-hidden="true" size={19} />
          <span className="sr-only">Search</span>
          <input
            aria-activedescendant={entries[active] ? `command-${active}` : undefined}
            aria-controls="command-results"
            aria-expanded="true"
            autoFocus
            onChange={(event) => { setQuery(event.target.value); setActive(0); }}
            onKeyDown={onKeyDown}
            placeholder="Search products, barcodes, orders, phones, invoices…"
            role="combobox"
            value={query}
          />
          <kbd>Esc</kbd>
        </label>
        <div className="command-results" id="command-results" ref={listRef} role="listbox">
          {entries.map((entry, index) => {
            const Icon = entry.icon;
            const heading = entry.group !== lastGroup ? entry.group : null;
            lastGroup = entry.group;
            return (
              <div key={entry.id}>
                {heading ? <p className="command-group-label" role="presentation">{heading}</p> : null}
                <div
                  aria-selected={index === active}
                  className="command-item"
                  data-active={index === active}
                  data-index={index}
                  id={`command-${index}`}
                  onClick={() => choose(entry)}
                  onMouseMove={() => setActive(index)}
                  role="option"
                >
                  <span className="command-icon"><Icon aria-hidden="true" size={18} /></span>
                  <span><strong>{entry.title}</strong><small>{entry.detail}</small></span>
                </div>
              </div>
            );
          })}
          {!entries.length && !searching ? (
            <div className="command-empty">{term.length >= 2 ? `Nothing matches “${query}”.` : "Type at least two characters to search."}</div>
          ) : null}
          {searching ? <div className="command-empty" role="status">Searching…</div> : null}
          {search.isError ? <div className="command-empty" role="alert">Search is unavailable right now.</div> : null}
        </div>
        <footer className="command-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> Move</span>
          <span><kbd>Enter</kbd> Open</span>
          <span className="command-brand"><i /> {SHORTCUT_LABEL} anywhere</span>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
