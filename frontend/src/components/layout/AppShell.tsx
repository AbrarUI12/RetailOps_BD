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
  Truck,
  Users,
  Wifi,
} from "lucide-react";
import { motion } from "motion/react";
import { Suspense } from "react";
import { NavLink, Outlet } from "react-router-dom";

import { PageLoading } from "./PageLoading";
import { cn } from "../../lib/utils";
import { useUIStore } from "../../stores/uiStore";
import { useAuthStore } from "../../stores/authStore";
import { useSyncStore } from "../../stores/syncStore";
import { useSyncEngine } from "../../lib/syncEngine";
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
  { label: "Purchases", to: "/purchases", icon: Truck },
  { label: "Customers", to: "/customers", icon: Users },
  { label: "Reports", to: "/reports", icon: ChartNoAxesCombined },
] as const;

const secondaryNavigation = [
  { label: "Sync Center", to: "/sync", icon: Wifi, badge: "2" },
  { label: "Activity", to: "/activity", icon: Bell },
  { label: "Settings", to: "/settings", icon: Settings },
] as const;

const mobileNavigation = [navigation[0], navigation[2], navigation[1], navigation[4], secondaryNavigation[2]];

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
  useSyncEngine();
  const collapsed = useUIStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useUIStore((state) => state.toggleSidebar);
  const setCommandOpen = useUIStore((state) => state.setCommandOpen);
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const initials = user?.full_name.split(" ").map((part) => part[0]).slice(0, 2).join("") ?? "RO";
  const syncStatus = useSyncStore((state) => state.status);
  const pending = useSyncStore((state) => state.pending);

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
          <div className="sync-status"><StatusDot label={syncStatus === "OFFLINE" ? "Offline" : syncStatus === "SYNCING" ? "Syncing" : "Online"} tone={syncStatus === "OFFLINE" ? "offline" : syncStatus === "SYNCING" ? "syncing" : "online"} /><small>{pending ? `${pending} pending` : "Synced now"}</small></div>
          <Button aria-label="Notifications, 3 unread" className="notification-button" size="icon" variant="ghost"><Bell size={18} /><span>3</span></Button>
          <button aria-label="Sign out" className="profile-button" onClick={() => void logout()} type="button"><span className="avatar">{initials}</span><span><strong>{user?.full_name ?? "RetailOps user"}</strong><small>{user?.role ?? "Team"} · Sign out</small></span><ChevronRight size={14} /></button>
          <Button aria-label="Open navigation menu" className="mobile-menu" size="icon" variant="ghost"><Menu size={20} /></Button>
        </header>
        <main className="content"><Suspense fallback={<PageLoading />}><Outlet /></Suspense></main>
      </div>

      <nav aria-label="Mobile navigation" className="mobile-nav">
        {mobileNavigation.map((item) => <NavigationLink item={item} key={item.to} mobile />)}
      </nav>
      <CommandPalette />
    </div>
  );
}

