import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { lazy } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { AppShell } from "../components/layout/AppShell";
import { ProtectedRoute } from "../components/auth/ProtectedRoute";
import { Toaster } from "../components/ui/Toast";
import { LoginPage } from "../routes/LoginPage";
// Offline-critical screens ship in the entry bundle so they work before ever being visited online.
import { PosPage } from "../routes/PosPage";
import { SyncPage } from "../routes/SyncPage";

const DashboardPage = lazy(() => import("../routes/DashboardPage").then((m) => ({ default: m.DashboardPage })));
const WorkspacePage = lazy(() => import("../routes/WorkspacePage").then((m) => ({ default: m.WorkspacePage })));
const ProductsPage = lazy(() => import("../routes/ProductsPage").then((m) => ({ default: m.ProductsPage })));
const InventoryPage = lazy(() => import("../routes/InventoryPage").then((m) => ({ default: m.InventoryPage })));
const CustomersPage = lazy(() => import("../routes/CustomersPage").then((m) => ({ default: m.CustomersPage })));
const OrdersPage = lazy(() => import("../routes/OrdersPage").then((m) => ({ default: m.OrdersPage })));
const PurchasesPage = lazy(() => import("../routes/PurchasesPage").then((m) => ({ default: m.PurchasesPage })));
const ReportsPage = lazy(() => import("../routes/ReportsPage").then((m) => ({ default: m.ReportsPage })));
const ActivityPage = lazy(() => import("../routes/ActivityPage").then((m) => ({ default: m.ActivityPage })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
});

const workspaceRoutes = ["settings"];

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion="user">
        <BrowserRouter>
          <Routes>
            <Route path="login" element={<LoginPage />} />
            <Route element={<ProtectedRoute />}>
              <Route element={<AppShell />}>
                <Route index element={<Navigate replace to="/dashboard" />} />
                <Route path="dashboard" element={<DashboardPage />} />
                <Route path="pos" element={<PosPage />} />
                <Route path="products" element={<ProductsPage />} />
                <Route path="inventory" element={<InventoryPage />} />
                <Route path="customers" element={<CustomersPage />} />
                <Route path="orders" element={<OrdersPage />} />
                <Route path="purchases" element={<PurchasesPage />} />
                <Route path="reports" element={<ReportsPage />} />
                <Route path="sync" element={<SyncPage />} />
                <Route path="activity" element={<ActivityPage />} />
                {workspaceRoutes.map((path) => <Route element={<WorkspacePage />} key={path} path={path} />)}
              </Route>
            </Route>
            <Route path="*" element={<Navigate replace to="/dashboard" />} />
          </Routes>
        </BrowserRouter>
        <Toaster />
      </MotionConfig>
    </QueryClientProvider>
  );
}
