export interface SaleLine {
  variant_id: string;
  product_name: string;
  variant_name: string;
  sku: string;
  quantity: number;
  unit_price: string;
  line_total: string;
  returned_quantity: number;
}

export interface SalePayment {
  method: string;
  amount: string;
}

export interface SaleReceipt {
  id: string;
  invoice_number: string;
  subtotal: string;
  discount: string;
  total: string;
  payment_method: string;
  payments: SalePayment[];
  amount_received: string;
  change_due: string;
  created_at: string;
  cashier_name?: string | null;
  customer_name?: string | null;
  synced_offline?: boolean;
  items: SaleLine[];
  inventory_conflict: boolean;
}

export interface SaleListItem {
  id: string;
  invoice_number: string;
  customer_name: string | null;
  cashier_name: string;
  item_count: number;
  total: string;
  payment_method: string;
  returned_quantity: number;
  synced_offline: boolean;
  created_at: string;
}

export interface SalePageData {
  items: SaleListItem[];
  total: number;
  page: number;
  page_size: number;
}
