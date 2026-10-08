import type { User } from "./api";

export type Permission =
  | "product:read" | "product:write" | "inventory:read" | "inventory:adjust" | "sale:create" | "sale:refund"
  | "customer:read" | "customer:write" | "order:read" | "order:write" | "order:confirm" | "order:cancel"
  | "shipment:create" | "return:create" | "purchase:write" | "report:read" | "audit:read" | "staff:manage"
  | "settings:manage";

/** UI convenience only: the server enforces every permission again. */
export function can(user: User | null | undefined, permission: Permission) {
  return Boolean(user?.permissions.includes(permission));
}
