import type { AppNotification } from "./api";

/** Where a notification about an entity takes the user. */
export function notificationLink(notification: Pick<AppNotification, "entity_type" | "entity_id" | "kind">) {
  if (notification.kind === "SYNC_CONFLICT") return "/sync";
  switch (notification.entity_type) {
    case "product_variant":
      return "/inventory?filter=low";
    case "order":
      return notification.entity_id ? `/orders?focus=${notification.entity_id}` : "/orders";
    case "sale":
      return notification.entity_id ? `/sales?sale=${notification.entity_id}` : "/sales";
    default:
      return "/activity";
  }
}
