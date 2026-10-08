import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { AppShell } from "../components/layout/AppShell";
import { Skeleton } from "../components/ui/Skeleton";

const DashboardPage = lazy(() =>
  import("../routes/DashboardPage").then((module) => ({ default: module.DashboardPage })),
);
const WorkspacePage = lazy(() =>
  import("../routes/WorkspacePage").then((module) => ({ default: module.WorkspacePage })),
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
});

const workspaceRoutes = ["pos", "orders", "products", "inventory", "customers", "reports", "sync", "settings"];

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion="user">
        <BrowserRouter>
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<Navigate replace to="/dashboard" />} />
              <Route path="dashboard" element={<Suspense fallback={<PageLoading />}><DashboardPage /></Suspense>} />
              {workspaceRoutes.map((path) => <Route element={<Suspense fallback={<PageLoading />}><WorkspacePage /></Suspense>} key={path} path={path} />)}
            </Route>
          </Routes>
        </BrowserRouter>
      </MotionConfig>
    </QueryClientProvider>
  );
}

function PageLoading() {
  return (
    <div aria-label="Loading page" className="loading-state">
      <Skeleton className="skeleton-title" />
      <Skeleton className="skeleton-line" />
      <div className="skeleton-grid"><Skeleton /><Skeleton /><Skeleton /></div>
    </div>
  );
}

