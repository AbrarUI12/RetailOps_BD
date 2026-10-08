import { AnimatePresence, motion } from "motion/react";
import { Link } from "react-router-dom";

import { formatRelative, label } from "../../lib/format";
import { useSyncStore } from "../../stores/syncStore";
import { StatusDot } from "../ui/StatusDot";

const TONES = { OFFLINE: "offline", ONLINE: "online", SYNCING: "syncing", SYNCED: "online", ERROR: "danger" } as const;

/** Connectivity and queue state in the topbar (plan §9.6, §15). */
export function SyncIndicator() {
  const { lastSyncedAt, pending, status } = useSyncStore();
  const detail = pending ? `${pending} waiting to sync` : lastSyncedAt ? `Synced ${formatRelative(lastSyncedAt)}` : "All sales synced";
  return (
    <Link aria-label={`Sync status: ${label(status)}. ${detail}`} className="sync-status" to="/sync">
      <AnimatePresence initial={false} mode="wait">
        <motion.span animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} initial={{ opacity: 0, y: 4 }} key={status} transition={{ duration: 0.16 }}>
          <StatusDot label={label(status)} tone={TONES[status]} />
        </motion.span>
      </AnimatePresence>
      <small>{detail}</small>
    </Link>
  );
}
