import * as Popover from "@radix-ui/react-popover";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { api, type AppNotification } from "../../lib/api";
import { formatRelative } from "../../lib/format";
import { notificationLink } from "../../lib/notifications";
import { cn } from "../../lib/utils";
import { Button } from "../ui/Button";

export function NotificationBell({ unread }: { unread: number }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const notifications = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api<AppNotification[]>("/api/v1/notifications"),
    enabled: open,
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    void queryClient.invalidateQueries({ queryKey: ["workspace-counts"] });
  };
  const markRead = useMutation({
    mutationFn: (id: string) => api<AppNotification>(`/api/v1/notifications/${id}/read`, { method: "POST" }),
    onSuccess: refresh,
  });
  const markAll = useMutation({
    mutationFn: () => api<void>("/api/v1/notifications/read-all", { method: "POST" }),
    onSuccess: refresh,
  });
  const latest = (notifications.data ?? []).slice(0, 8);

  return (
    <Popover.Root onOpenChange={setOpen} open={open}>
      <Popover.Trigger asChild>
        <Button aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"} className="notification-button" size="icon" variant="ghost">
          <Bell aria-hidden="true" size={19} />
          {unread ? <span aria-hidden="true" className="notification-count">{unread > 99 ? "99+" : unread}</span> : null}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" className="menu-content notification-panel" sideOffset={8}>
          <div className="notification-panel-head">
            <strong>Notifications</strong>
            <Button disabled={!unread || markAll.isPending} onClick={() => markAll.mutate()} size="sm" variant="ghost">
              <CheckCheck aria-hidden="true" size={16} /> Mark all read
            </Button>
          </div>
          <div className="notification-list">
            {notifications.isPending ? <p className="menu-label">Loading…</p> : null}
            {notifications.isError ? <p className="menu-label">Notifications could not be loaded.</p> : null}
            {notifications.data && latest.length === 0 ? <p className="menu-label">You're all caught up.</p> : null}
            {latest.map((item) => (
              <button
                className={cn("notification-item", !item.read_at && "unread")}
                key={item.id}
                onClick={() => {
                  if (!item.read_at) markRead.mutate(item.id);
                  setOpen(false);
                  void navigate(notificationLink(item));
                }}
                type="button"
              >
                <span aria-hidden="true" className="notification-dot" />
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.message}</small>
                  <time dateTime={item.created_at}>{formatRelative(item.created_at)}</time>
                </span>
              </button>
            ))}
          </div>
          <Link className="notification-footer" onClick={() => setOpen(false)} to="/activity">View all activity</Link>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
