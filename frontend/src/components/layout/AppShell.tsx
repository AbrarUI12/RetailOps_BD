import {
  Bell,
  Boxes,
  ChartNoAxesCombined,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  LayoutDashboard,
  Menu,
  Search,
  Settings,
  ShoppingBag,
  Users,
  Wifi,
} from "lucide-react";
import { motion } from "motion/react";
import { NavLink, Outlet } from "react-router-dom";

import { cn } from "../../lib/utils";
import { useUIStore } from "../../stores/uiStore";
import { Button } from "../ui/Button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/Select";
import { StatusDot } from "../ui/StatusDot";
import { CommandPalette } from "./CommandPalette";

const navigation = [
  { label: "Overview", to: "/dashboard", icon: LayoutDashboard },
  { label: "Point of sale", shortLabel: "POS", to: "/pos", icon: CircleDollarSign },
  { label: "Orders", to: "/orders", icon: ClipboardList, badge: "8" },
  { label: "Products", to: "/products", icon: ShoppingBag },
  { label: "Inventory", shortLabel: "Stock", to: "/inventory", icon: Boxes, badge: "12" },
  { label: "Customers", to: "/customers", icon: Users },
  { label: "Reports", to: "/reports", icon: ChartNoAxesCombined },
] as const;

const secondaryNavigation = [
  { label: "Sync Center", to: "/sync", icon: Wifi, badge: "2" },
  { label: "Settings", to: "/settings", icon: Settings },
] as const;

const mobileNavigation = [navigation[0], navigation[2], navigation[1], navigation[4], secondaryNavigation[1]];

function NavigationLink({ item, mobile = false }: { item: (typeof navigation)[number] | (typeof secondaryNavigation)[number]; mobile?: boolean }) {
  const Icon = item.icon;
  const label = "shortLabel" in item ? item.shortLabel : item.label;
  return (
    <NavLink
      aria-label={item.label}
      className={({ isActive }) => cn(mobile ? "mobile-nav-link" : "nav-link", isActive && "active")}
      to={item.to}
    >
      {({ isActive }) => (
        <>
          {isActive ? <motion.span className={mobile ? "mobile-active" : "nav-active"} layoutId={mobile ? "mobile-nav-active" : "desktop-nav-active"} /> : null}
          <Icon aria-hidden="true" size={mobile && item.to === "/pos" ? 22 : 18} />
          <span className="nav-label">{label}</span>
          {"badge" in item ? <span className="nav-badge">{item.badge}</span> : null}
        </>
      )}
    </NavLink>
  );
}

export function AppShell() {
  const collapsed = useUIStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useUIStore((state) => state.toggleSidebar);
  const setCommandOpen = useUIStore((state) => state.setCommandOpen);

  return (
    <div className={cn("app-shell", collapsed && "sidebar-collapsed")}>
      <aside className="sidebar">
        <NavLink aria-label="RetailOps BD home" className="brand" to="/dashboard">
          <span className="brand-mark"><span>R</span></span>
          <span className="brand-copy">RetailOps <strong>BD</strong><small>Commerce OS</small></span>
        </NavLink>

        <div className="nav-section">
          <span className="nav-section-label">Workspace</span>
          <nav aria-label="Primary navigation">
            {navigation.map((item) => <NavigationLink item={item} key={item.to} />)}
          </nav>
        </div>

        <div className="nav-section secondary-section">
          <span className="nav-section-label">System</span>
          <nav aria-label="System navigation">
            {secondaryNavigation.map((item) => <NavigationLink item={item} key={item.to} />)}
          </nav>
        </div>

        <button aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} className="collapse-button" onClick={toggleSidebar} type="button">
          {collapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
        </button>

        <div className="store-card">
          <span className="store-avatar">RD</span>
          <span className="store-copy"><strong>RetailOps Demo</strong><small>Dhanmondi · Main branch</small></span>
          <ChevronRight aria-hidden="true" size={15} />
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="mobile-brand"><span className="brand-mark"><span>R</span></span><strong>RetailOps</strong></div>
          <button className="search-button" onClick={() => setCommandOpen(true)} type="button">
            <Search aria-hidden="true" size={17} />
            <span>Search orders, products, customers…</span>
            <kbd>⌘ K</kbd>
          </button>
          <Select defaultValue="dhanmondi">
            <SelectTrigger aria-label="Current branch" className="branch-select"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="dhanmondi">Dhanmondi</SelectItem>
              <SelectItem value="gulshan">Gulshan</SelectItem>
            </SelectContent>
          </Select>
          <div className="sync-status"><StatusDot label="Online" /><small>Synced now</small></div>
          <Button aria-label="Notifications, 3 unread" className="notification-button" size="icon" variant="ghost"><Bell size={18} /><span>3</span></Button>
          <button aria-label="Open profile menu" className="profile-button" type="button"><span className="avatar">MA</span><span><strong>Mir Abrar</strong><small>Owner</small></span><ChevronRight size={14} /></button>
          <Button aria-label="Open navigation menu" className="mobile-menu" size="icon" variant="ghost"><Menu size={20} /></Button>
        </header>
        <main className="content"><Outlet /></main>
      </div>

      <nav aria-label="Mobile navigation" className="mobile-nav">
        {mobileNavigation.map((item) => <NavigationLink item={item} key={item.to} mobile />)}
      </nav>
      <CommandPalette />
    </div>
  );
}

