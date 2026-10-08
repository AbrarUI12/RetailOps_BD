import {
  Boxes,
  ChartNoAxesCombined,
  CircleDollarSign,
  ClipboardList,
  LayoutDashboard,
  PackageSearch,
  RefreshCw,
  Settings,
  ShoppingBag,
  Users,
} from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";

const navigation = [
  { label: "Dashboard", to: "/dashboard", icon: LayoutDashboard },
  { label: "POS", to: "/pos", icon: CircleDollarSign },
  { label: "Orders", to: "/orders", icon: ClipboardList },
  { label: "Products", to: "/products", icon: ShoppingBag },
  { label: "Inventory", to: "/inventory", icon: Boxes },
  { label: "Customers", to: "/customers", icon: Users },
  { label: "Reports", to: "/reports", icon: ChartNoAxesCombined },
  { label: "Sync Center", to: "/sync", icon: RefreshCw },
] as const;

export function AppShell() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <NavLink aria-label="RetailOps BD home" className="brand" to="/dashboard">
          <span className="brand-mark">R</span>
          <span>RetailOps <strong>BD</strong></span>
        </NavLink>
        <nav aria-label="Primary navigation">
          {navigation.map(({ icon: Icon, label, to }) => (
            <NavLink className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")} key={to} to={to}>
              <Icon aria-hidden="true" size={18} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <NavLink className="nav-link settings-link" to="/settings">
          <Settings aria-hidden="true" size={18} />
          <span>Settings</span>
        </NavLink>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <button className="search-button" type="button">
            <PackageSearch aria-hidden="true" size={18} />
            Search anything
            <kbd>⌘ K</kbd>
          </button>
          <span className="status"><span /> Online</span>
          <div className="avatar" aria-label="Current user">MA</div>
        </header>
        <main className="content"><Outlet /></main>
      </div>
    </div>
  );
}

