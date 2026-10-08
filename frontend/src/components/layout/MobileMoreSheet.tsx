import { LogOut } from "lucide-react";
import { NavLink } from "react-router-dom";

import type { WorkspaceCounts } from "../../lib/api";
import { initials, label } from "../../lib/format";
import { cn } from "../../lib/utils";
import { useAuthStore } from "../../stores/authStore";
import { Button } from "../ui/Button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "../ui/Sheet";
import type { NavItem } from "./navigation";

interface MobileMoreSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: NavItem[];
  counts?: WorkspaceCounts;
}

/** Every destination the role can open plus account actions, for phones (plan §10). */
export function MobileMoreSheet({ counts, items, onOpenChange, open }: MobileMoreSheetProps) {
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetContent className="mobile-sheet">
        <SheetTitle className="dialog-title">Menu</SheetTitle>
        <SheetDescription className="sr-only">All areas and account actions</SheetDescription>
        {user ? (
          <div className="mobile-sheet-user">
            <span aria-hidden="true" className="avatar">{initials(user.full_name)}</span>
            <span><strong>{user.full_name}</strong><small>{label(user.role)} · {user.organization_name}, {user.branch_name}</small></span>
          </div>
        ) : null}
        <nav aria-label="All areas" className="mobile-sheet-nav">
          {items.map((item) => {
            const Icon = item.icon;
            const count = item.badge ? counts?.[item.badge] : null;
            return (
              <NavLink className={({ isActive }) => cn("nav-link", isActive && "active")} key={item.to} onClick={() => onOpenChange(false)} to={item.to}>
                <Icon aria-hidden="true" size={19} />
                <span className="nav-label">{item.label}</span>
                {count ? <span className={cn("nav-badge", item.alert && "alert")}>{count}</span> : null}
              </NavLink>
            );
          })}
        </nav>
        <Button className="mobile-sheet-signout" onClick={() => { onOpenChange(false); void logout(); }} variant="secondary">
          <LogOut aria-hidden="true" size={17} /> Sign out
        </Button>
      </SheetContent>
    </Sheet>
  );
}
