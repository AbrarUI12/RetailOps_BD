import type { AppNotification } from "./api";

/** Where a notification about an entity takes the user. */
export function notificationLink(notification: Pick<AppNotification, "entity_type" | "entity_id" | "kind">) {
  if (notification.kind === "SYNC_CONFLICT") return "/sync";
  switch (notification.entity_type) {
    case "product_variant":
      return notification.entity_id ? `/inventory?variant=${notification.entity_id}` : "/inventory?filter=low";
    case "order":
      return notification.entity_id ? `/orders?focus=${notification.entity_id}` : "/orders";
    case "sale":
      return notification.entity_id ? `/sales?sale=${notification.entity_id}` : "/sales";
    default:
      return "/activity";
  }
}

/** Best available destination for an audited business entity. */
export function auditLink(entityType: string, entityId: string | null) {
  if (!entityId) return null;
  switch (entityType) {
    case "product": return `/products?focus=${entityId}`;
    case "product_variant": return `/inventory?variant=${entityId}`;
    case "customer": return `/customers?customer=${entityId}`;
    case "order": return `/orders?focus=${entityId}`;
    case "sale": return `/sales?sale=${entityId}`;
    case "sync_conflict": return "/sync";
    case "purchase": return "/purchases";
    case "shipment": return "/orders";
    default: return null;
  }
}
