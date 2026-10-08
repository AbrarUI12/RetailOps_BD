import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { AppShell } from "../components/layout/AppShell";
import { PlaceholderPage } from "../routes/PlaceholderPage";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
});

const routes = [
  ["dashboard", "Dashboard"],
  ["pos", "Point of sale"],
  ["orders", "Orders"],
  ["products", "Products"],
  ["inventory", "Inventory"],
  ["customers", "Customers"],
  ["reports", "Reports"],
  ["sync", "Sync Center"],
  ["settings", "Settings"],
] as const;

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<Navigate replace to="/dashboard" />} />
            {routes.map(([path, title]) => (
              <Route key={path} path={path} element={<PlaceholderPage title={title} />} />
            ))}
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

