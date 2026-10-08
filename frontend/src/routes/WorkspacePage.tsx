import {
  AlertCircle,
  Boxes,
  ClipboardList,
  CloudOff,
  FileBarChart,
  LockKeyhole,
  PackageOpen,
  RefreshCw,
  Settings,
  ShoppingBag,
  Store,
  Users,
} from "lucide-react";
import { useState } from "react";
import { useLocation } from "react-router-dom";

import { FadeUp } from "../components/motion/FadeUp";
import { PageTransition } from "../components/motion/PageTransition";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { PageHeader } from "../components/ui/PageHeader";
import { Skeleton } from "../components/ui/Skeleton";

const pageConfig = {
  "/pos": { title: "Point of sale", eyebrow: "Fast checkout", description: "Scan, search and complete sales from one focused workspace.", icon: Store, action: "Start a sale" },
  "/orders": { title: "Orders", eyebrow: "Fulfillment", description: "Manage every order from confirmation through delivery.", icon: ClipboardList, action: "Create order" },
  "/products": { title: "Products", eyebrow: "Catalog", description: "Organize products, variants, pricing and barcodes.", icon: ShoppingBag, action: "Add product" },
  "/inventory": { title: "Inventory", eyebrow: "Stock control", description: "Track physical, reserved and available stock with a clear ledger.", icon: Boxes, action: "Adjust stock" },
  "/customers": { title: "Customers", eyebrow: "Relationships", description: "Understand purchase history, addresses and delivery outcomes.", icon: Users, action: "Add customer" },
  "/reports": { title: "Reports", eyebrow: "Decision support", description: "See the performance signals that matter to your operation.", icon: FileBarChart, action: "Create report" },
  "/sync": { title: "Synchronization", eyebrow: "Device POS-01", description: "Keep offline transactions safe, visible and reconciled.", icon: RefreshCw, action: "Sync now" },
  "/settings": { title: "Settings", eyebrow: "Workspace", description: "Configure your organization, branch, team and preferences.", icon: Settings, action: "Save changes" },
} as const;

type PreviewState = "empty" | "loading" | "error" | "offline" | "denied";

export function WorkspacePage() {
  const { pathname } = useLocation();
  const config = pageConfig[pathname as keyof typeof pageConfig] ?? pageConfig["/products"];
  const [state, setState] = useState<PreviewState>("empty");
  const Icon = config.icon;

  return (
    <PageTransition>
      <div>
      <FadeUp>
        <PageHeader
          actions={<Button><Icon size={17} /> {config.action}</Button>}
          description={config.description}
          eyebrow={config.eyebrow}
          title={config.title}
        />
      </FadeUp>

      <FadeUp delay={0.05}>
        <Card className="workspace-preview">
          <CardHeader>
            <div><CardTitle>Experience states</CardTitle><CardDescription>Every workflow is designed for the moments between perfect responses.</CardDescription></div>
            <Badge tone="brand">UI foundation</Badge>
          </CardHeader>
          <div className="state-tabs" role="tablist" aria-label="Preview interface states">
            {(["empty", "loading", "error", "offline", "denied"] as const).map((item) => (
              <button aria-selected={state === item} key={item} onClick={() => setState(item)} role="tab" type="button">{item}</button>
            ))}
          </div>
          <CardContent className="state-stage">
            {state === "loading" ? (
              <div aria-label="Loading content" className="loading-state">
                <Skeleton className="skeleton-title" /><Skeleton className="skeleton-line" />
                <div className="skeleton-grid"><Skeleton /><Skeleton /><Skeleton /></div>
              </div>
            ) : null}
            {state === "empty" ? <EmptyState action={config.action} description={`Your first ${config.title.toLowerCase()} workflow will appear here.`} icon={PackageOpen} title={`No ${config.title.toLowerCase()} yet`} /> : null}
            {state === "error" ? <EmptyState action="Try again" description="The request did not complete. Your saved work is unaffected." icon={AlertCircle} title="Something needs another try" /> : null}
            {state === "offline" ? <EmptyState action="Open Sync Center" description="You can keep working. Safe local changes will sync when the connection returns." icon={CloudOff} title="Working offline" footer={<Badge tone="warning">2 changes waiting</Badge>} /> : null}
            {state === "denied" ? <EmptyState description="Ask an owner or manager for access to this workspace." icon={LockKeyhole} title="Permission required" /> : null}
          </CardContent>
        </Card>
      </FadeUp>
      </div>
    </PageTransition>
  );
}

