import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { lazy } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { AppShell } from "../components/layout/AppShell";
import { ProtectedRoute } from "../components/auth/ProtectedRoute";
import { RequirePermission } from "../components/auth/RequirePermission";
import { Toaster } from "../components/ui/Toast";
import { LoginPage } from "../routes/LoginPage";
import { OfflinePage } from "../routes/OfflinePage";
import {
  ForgotPasswordPage,
  ResetPasswordPage,
} from "../routes/PasswordRecoveryPages";
import { can } from "../lib/permissions";
import { useAuthStore } from "../stores/authStore";

const DashboardPage = lazy(() =>
  import("../routes/DashboardPage").then((m) => ({ default: m.DashboardPage })),
);
const WorkspacePage = lazy(() =>
  import("../routes/WorkspacePage").then((m) => ({ default: m.WorkspacePage })),
);
const ProductsPage = lazy(() =>
  import("../routes/ProductsPage").then((m) => ({ default: m.ProductsPage })),
);
const InventoryPage = lazy(() =>
  import("../routes/InventoryPage").then((m) => ({ default: m.InventoryPage })),
);
const CustomersPage = lazy(() =>
  import("../routes/CustomersPage").then((m) => ({ default: m.CustomersPage })),
);
const OrdersPage = lazy(() =>
  import("../routes/OrdersPage").then((m) => ({ default: m.OrdersPage })),
);
const PurchasesPage = lazy(() =>
  import("../routes/PurchasesPage").then((m) => ({ default: m.PurchasesPage })),
);
const ReportsPage = lazy(() =>
  import("../routes/ReportsPage").then((m) => ({ default: m.ReportsPage })),
);
const ActivityPage = lazy(() =>
  import("../routes/ActivityPage").then((m) => ({ default: m.ActivityPage })),
);
const SalesPage = lazy(() =>
  import("../routes/SalesPage").then((m) => ({ default: m.SalesPage })),
);
// The production service worker precaches emitted route chunks, so these remain offline-safe
// without making every sign-in download the POS database and sync engine up front.
const PosPage = lazy(() =>
  import("../routes/PosPage").then((m) => ({ default: m.PosPage })),
);
const SyncPage = lazy(() =>
  import("../routes/SyncPage").then((m) => ({ default: m.SyncPage })),
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
});

const workspaceRoutes = ["settings"];

function RoleHome() {
  const user = useAuthStore((state) => state.user);
  const target = can(user, "report:read")
    ? "/dashboard"
    : can(user, "sale:create")
      ? "/pos"
      : can(user, "order:read")
        ? "/orders"
        : "/products";
  return <Navigate replace to={target} />;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion="user">
        <BrowserRouter>
          <Routes>
            <Route path="login" element={<LoginPage />} />
            <Route path="forgot-password" element={<ForgotPasswordPage />} />
            <Route path="reset-password" element={<ResetPasswordPage />} />
            <Route path="offline" element={<OfflinePage />} />
            <Route element={<ProtectedRoute />}>
              <Route element={<AppShell />}>
                <Route index element={<RoleHome />} />
                <Route
                  path="dashboard"
                  element={
                    <RequirePermission permission="report:read">
                      <DashboardPage />
                    </RequirePermission>
                  }
                />
                <Route
                  path="pos"
                  element={
                    <RequirePermission permission="sale:create">
                      <PosPage />
                    </RequirePermission>
                  }
                />
                <Route
                  path="sales"
                  element={
                    <RequirePermission permission="sale:create">
                      <SalesPage />
                    </RequirePermission>
                  }
                />
                <Route
                  path="products"
                  element={
                    <RequirePermission permission="product:read">
                      <ProductsPage />
                    </RequirePermission>
                  }
                />
                <Route
                  path="inventory"
                  element={
                    <RequirePermission permission="inventory:read">
                      <InventoryPage />
                    </RequirePermission>
                  }
                />
                <Route
                  path="customers"
                  element={
                    <RequirePermission permission="customer:read">
                      <CustomersPage />
                    </RequirePermission>
                  }
                />
                <Route
                  path="orders"
                  element={
                    <RequirePermission permission="order:read">
                      <OrdersPage />
                    </RequirePermission>
                  }
                />
                <Route
                  path="purchases"
                  element={
                    <RequirePermission permission="purchase:write">
                      <PurchasesPage />
                    </RequirePermission>
                  }
                />
                <Route
                  path="reports"
                  element={
                    <RequirePermission permission="report:read">
                      <ReportsPage />
                    </RequirePermission>
                  }
                />
                <Route
                  path="sync"
                  element={
                    <RequirePermission permission="sale:create">
                      <SyncPage />
                    </RequirePermission>
                  }
                />
                <Route
                  path="activity"
                  element={
                    <RequirePermission permission="product:read">
                      <ActivityPage />
                    </RequirePermission>
                  }
                />
                {workspaceRoutes.map((path) => (
                  <Route
                    element={
                      <RequirePermission permission="settings:manage">
                        <WorkspacePage />
                      </RequirePermission>
                    }
                    key={path}
                    path={path}
                  />
                ))}
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
