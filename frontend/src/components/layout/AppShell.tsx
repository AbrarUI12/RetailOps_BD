import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Menu, Search, WifiOff } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Suspense, useState } from "react";
import { NavLink, useLocation, useOutlet } from "react-router-dom";

import { api, type WorkspaceCounts } from "../../lib/api";
import { initials } from "../../lib/format";
import { useOnline } from "../../lib/hooks";
import { t } from "../../lib/i18n";
import { can } from "../../lib/permissions";
import { useSyncEngine } from "../../lib/syncEngine";
import { cn } from "../../lib/utils";
import { useAuthStore } from "../../stores/authStore";
import { useSyncStore } from "../../stores/syncStore";
import { useUIStore } from "../../stores/uiStore";
import { Button } from "../ui/Button";
import { SHORTCUT_LABEL } from "../../lib/shortcuts";
import { CommandPalette } from "./CommandPalette";
import { MobileMoreSheet } from "./MobileMoreSheet";
import { mobileNavigation, primaryNavigation, systemNavigation, type NavItem } from "./navigation";
import { NotificationBell } from "./NotificationBell";
import { PageLoading } from "./PageLoading";
import { ProfileMenu } from "./ProfileMenu";
import { SyncIndicator } from "./SyncIndicator";

function NavigationLink({ count, item, mobile = false }: { item: NavItem; mobile?: boolean; count?: number | null }) {
  const Icon = item.icon;
  const isPos = item.to === "/pos";
  return (
    <NavLink
      aria-label={count ? `${item.label}, ${count}` : item.label}
      className={({ isActive }) => cn(mobile ? "mobile-nav-link" : "nav-link", mobile && isPos && "primary", isActive && "active")}
      title={item.label}
      to={item.to}
    >
      {({ isActive }) => (
        <>
          {isActive ? <motion.span className={mobile ? "mobile-active" : "nav-active"} layoutId={mobile ? "mobile-nav-active" : "desktop-nav-active"} /> : null}
          <Icon aria-hidden="true" size={mobile && isPos ? 24 : 19} />
          <span className="nav-label">{mobile ? item.shortLabel ?? item.label : item.label}</span>
          {count ? <span aria-hidden="true" className={cn("nav-badge", item.alert && "alert")}>{count > 99 ? "99+" : count}</span> : null}
        </>
      )}
    </NavLink>
  );
}

/** Page transition: AnimatePresence keeps the outgoing page's element while it fades out. */
function AnimatedOutlet() {
  const location = useLocation();
  const outlet = useOutlet();
  return (
    <AnimatePresence initial={false} mode="wait">
      <motion.div
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        initial={{ opacity: 0, y: 6 }}
        key={location.pathname}
        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      >
        {outlet}
      </motion.div>
    </AnimatePresence>
  );
}

export function AppShell() {
  useSyncEngine();
  const collapsed = useUIStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useUIStore((state) => state.toggleSidebar);
  const setCommandOpen = useUIStore((state) => state.setCommandOpen);
  const user = useAuthStore((state) => state.user);
  const pending = useSyncStore((state) => state.pending);
  const online = useOnline();
  const [moreOpen, setMoreOpen] = useState(false);

  const counts = useQuery({
    queryKey: ["workspace-counts"],
    queryFn: () => api<WorkspaceCounts>("/api/v1/workspace/counts"),
    refetchInterval: 60_000,
    enabled: online,
  });
  const badge = (item: NavItem) => (item.to === "/sync" ? (counts.data?.open_conflicts ?? 0) + pending : item.badge ? counts.data?.[item.badge] : null);
  const visiblePrimary = primaryNavigation.filter((item) => can(user, item.permission));
  const visibleSystem = systemNavigation.filter((item) => can(user, item.permission));
  const visible = [...visiblePrimary, ...visibleSystem];
  const mobileItems = mobileNavigation(visible);

  return (
    <div className={cn("app-shell", collapsed && "sidebar-collapsed")}>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <aside className="sidebar">
        <NavLink aria-label="RetailOps BD home" className="brand" to="/dashboard">
          <span aria-hidden="true" className="brand-mark"><span>R</span></span>
          <span className="brand-copy">RetailOps <strong>BD</strong><small>Commerce operations</small></span>
        </NavLink>

        <div className="nav-section">
          <span className="nav-section-label">Workspace</span>
          <nav aria-label="Primary navigation">
            {visiblePrimary.map((item) => <NavigationLink count={badge(item)} item={item} key={item.to} />)}
          </nav>
        </div>

        {visibleSystem.length ? (
          <div className="nav-section secondary-section">
            <span className="nav-section-label">System</span>
            <nav aria-label="System navigation">
              {visibleSystem.map((item) => <NavigationLink count={badge(item)} item={item} key={item.to} />)}
            </nav>
          </div>
        ) : null}

        <button aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} className="collapse-button" onClick={toggleSidebar} type="button">
          {collapsed ? <ChevronRight aria-hidden="true" size={16} /> : <ChevronLeft aria-hidden="true" size={16} />}
        </button>

        {user ? (
          <div className="store-card" title={`${user.organization_name} · ${user.branch_name}`}>
            <span aria-hidden="true" className="store-avatar">{initials(user.organization_name)}</span>
            <span className="store-copy"><strong>{user.organization_name}</strong><small>{user.branch_name}</small></span>
          </div>
        ) : null}
      </aside>

      <div className="workspace">
        {!online ? <div className="offline-banner" role="status"><WifiOff aria-hidden="true" size={16} /> {t("offline.banner")}</div> : null}
        <header className="topbar">
          <div className="mobile-brand"><span aria-hidden="true" className="brand-mark"><span>R</span></span><strong>RetailOps</strong></div>
          <button aria-label="Search and quick actions" className="search-button" onClick={() => setCommandOpen(true)} type="button">
            <Search aria-hidden="true" size={18} />
            <span>Search products, orders, customers…</span>
            <kbd>{SHORTCUT_LABEL}</kbd>
          </button>
          <span className="topbar-spacer" />
          <SyncIndicator />
          <NotificationBell unread={counts.data?.unread_notifications ?? 0} />
          <ProfileMenu />
          <Button aria-expanded={moreOpen} aria-label="Open menu" className="mobile-menu" onClick={() => setMoreOpen(true)} size="icon" variant="ghost"><Menu aria-hidden="true" size={22} /></Button>
        </header>
        <main className="content" id="main-content" tabIndex={-1}>
          <Suspense fallback={<PageLoading />}><AnimatedOutlet /></Suspense>
        </main>
      </div>

      <nav aria-label="Mobile navigation" className="mobile-nav" style={{ gridTemplateColumns: `repeat(${mobileItems.length + 1}, 1fr)` }}>
        {mobileItems.map((item) => <NavigationLink count={badge(item)} item={item} key={item.to} mobile />)}
        <button aria-label="More" className="mobile-nav-link" onClick={() => setMoreOpen(true)} type="button">
          <Menu aria-hidden="true" size={19} />
          <span className="nav-label">More</span>
        </button>
      </nav>
      <MobileMoreSheet counts={counts.data} items={visible} onOpenChange={setMoreOpen} open={moreOpen} />
      <CommandPalette />
    </div>
  );
}
