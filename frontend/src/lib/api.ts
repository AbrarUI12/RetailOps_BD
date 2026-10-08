import { useAuthStore } from "../stores/authStore";

// Production builds default to same-origin: the static site proxies /api and /health to the API,
// which keeps the refresh cookie first-party.
export const API_URL = String(import.meta.env.VITE_API_URL ?? (import.meta.env.PROD ? "" : "http://localhost:8000"));

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code = "REQUEST_FAILED",
  ) {
    super(message);
  }
}

async function apiResponse(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const token = useAuthStore.getState().accessToken;
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  if (response.status === 401 && retry && !path.includes("/auth/")) {
    const refreshed = await useAuthStore.getState().refresh();
    if (refreshed) return apiResponse(path, init, false);
  }
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: { code?: string; message?: string } }
      | null;
    throw new ApiError(
      payload?.error?.message ?? `Request failed (${response.status})`,
      response.status,
      payload?.error?.code,
    );
  }
  return response;
}

export async function api<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const response = await apiResponse(path, init, retry);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

/** Authenticated file download (e.g. CSV exports) that keeps the access token out of URLs. */
export async function downloadFile(path: string, filename: string) {
  const blob = await (await apiResponse(path)).blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export interface User {
  id: string;
  organization_id: string;
  organization_name: string;
  branch_id: string;
  branch_name: string;
  branch_address?: string | null;
  email: string;
  full_name: string;
  role: string;
  permissions: string[];
}

export interface AuthResponse {
  access_token: string;
  expires_in: number;
  user: User;
}

export interface Variant {
  id: string;
  product_id: string;
  name: string;
  sku: string;
  barcode: string | null;
  price: string;
  cost: string;
  reorder_level: number;
  is_active: boolean;
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  variants: Variant[];
}

export interface InventoryItem {
  variant_id: string;
  product_name: string;
  variant_name: string;
  sku: string;
  barcode: string | null;
  physical_quantity: number;
  reserved_quantity: number;
  available_quantity: number;
  reorder_level: number;
  stock_status: "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK";
}

export interface WorkspaceCounts {
  orders_to_action: number | null;
  low_stock: number | null;
  open_conflicts: number | null;
  unread_notifications: number;
}

export interface SearchHit {
  kind: "product" | "order" | "customer" | "sale" | "shipment";
  id: string;
  title: string;
  subtitle: string;
  to: string;
}

export interface AppNotification {
  id: string;
  kind: string;
  title: string;
  message: string;
  read_at: string | null;
  entity_type: string | null;
  entity_id: string | null;
  created_at: string;
}
