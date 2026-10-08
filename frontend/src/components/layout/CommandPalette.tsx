import {
  Boxes,
  CircleDollarSign,
  ClipboardPlus,
  PackagePlus,
  RefreshCw,
  Search,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useUIStore } from "../../stores/uiStore";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../ui/Dialog";

const commands = [
  { label: "Start a new sale", detail: "Open point of sale", to: "/pos", icon: CircleDollarSign, keys: "N S" },
  { label: "Create an order", detail: "Phone, Facebook or walk-in", to: "/orders", icon: ClipboardPlus, keys: "N O" },
  { label: "Add a product", detail: "Create product and variants", to: "/products", icon: PackagePlus, keys: "N P" },
  { label: "Adjust stock", detail: "Record an inventory movement", to: "/inventory", icon: Boxes, keys: "A S" },
  { label: "Open Sync Center", detail: "Review device and queue status", to: "/sync", icon: RefreshCw, keys: "G S" },
] as const;

export function CommandPalette() {
  const navigate = useNavigate();
  const open = useUIStore((state) => state.commandOpen);
  const setOpen = useUIStore((state) => state.setCommandOpen);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(!open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, setOpen]);

  const results = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return normalized
      ? commands.filter((command) => `${command.label} ${command.detail}`.toLowerCase().includes(normalized))
      : commands;
  }, [query]);

  const choose = (to: string) => {
    setOpen(false);
    setQuery("");
    void navigate(to);
  };

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogContent className="command-dialog">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">Search RetailOps pages and quick actions.</DialogDescription>
        <label className="command-search">
          <Search aria-hidden="true" size={19} />
          <span className="sr-only">Search commands</span>
          <input
            autoFocus
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search products, orders, customers or actions…"
            value={query}
          />
          <kbd>ESC</kbd>
        </label>
        <div className="command-results">
          <p className="command-group-label">Quick actions</p>
          {results.length ? results.map(({ detail, icon: Icon, keys, label, to }) => (
            <button className="command-item" key={label} onClick={() => choose(to)} type="button">
              <span className="command-icon"><Icon aria-hidden="true" size={18} /></span>
              <span><strong>{label}</strong><small>{detail}</small></span>
              <kbd>{keys}</kbd>
            </button>
          )) : (
            <div className="command-empty">No commands match “{query}”.</div>
          )}
        </div>
        <footer className="command-footer">
          <span><kbd>↑↓</kbd> Navigate</span><span><kbd>↵</kbd> Open</span>
          <span className="command-brand"><i /> RetailOps search</span>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

