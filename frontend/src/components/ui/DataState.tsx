import { AlertTriangle, Lock, WifiOff, type LucideIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";

import { ApiError } from "../../lib/api";
import { t } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import { Button } from "./Button";
import { Skeleton } from "./Skeleton";

interface QueryLike<T> {
  data: T | undefined;
  isPending: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => unknown;
}

interface EmptyConfig {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}

interface DataStateProps<T> {
  query: QueryLike<T>;
  /** Decides whether loaded data counts as empty. Defaults to empty arrays. */
  isEmpty?: (data: T) => boolean;
  empty: EmptyConfig;
  skeleton?: "rows" | "cards" | "page";
  children: (data: T) => ReactNode;
}

/**
 * Every data view goes through one state machine (plan §57): loading → content, empty, error,
 * offline or permission denied. Loading never masquerades as "nothing found".
 */
export function DataState<T>({ children, empty, isEmpty, query, skeleton = "rows" }: DataStateProps<T>) {
  let key: string;
  let body: ReactNode;
  if (query.isPending) {
    key = "loading";
    body = <LoadingSkeleton variant={skeleton} />;
  } else if (query.isError) {
    key = "error";
    body = <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  } else if (query.data === undefined || (isEmpty ?? defaultIsEmpty)(query.data)) {
    key = "empty";
    body = <StateMessage action={empty.action} description={empty.description} icon={empty.icon} title={empty.title} />;
  } else {
    key = "content";
    body = children(query.data);
  }
  return (
    <AnimatePresence initial={false} mode="wait">
      <motion.div animate={{ opacity: 1 }} exit={{ opacity: 0 }} initial={{ opacity: 0 }} key={key} transition={{ duration: 0.16 }}>
        {body}
      </motion.div>
    </AnimatePresence>
  );
}

function defaultIsEmpty(data: unknown) {
  if (Array.isArray(data)) return data.length === 0;
  if (data && typeof data === "object" && "items" in data && Array.isArray((data as { items: unknown[] }).items)) {
    return (data as { items: unknown[] }).items.length === 0;
  }
  return false;
}

export function LoadingSkeleton({ variant = "rows" }: { variant?: "rows" | "cards" | "page" }) {
  if (variant === "cards") {
    return <div aria-busy="true" aria-label={t("common.loading")} className="skeleton-grid" role="status"><Skeleton /><Skeleton /><Skeleton /></div>;
  }
  if (variant === "page") {
    return (
      <div aria-busy="true" aria-label={t("common.loading")} className="loading-state" role="status">
        <Skeleton className="skeleton-title" />
        <Skeleton className="skeleton-line" />
        <div className="skeleton-grid"><Skeleton /><Skeleton /><Skeleton /></div>
      </div>
    );
  }
  return (
    <div aria-busy="true" aria-label={t("common.loading")} className="skeleton-rows" role="status">
      {Array.from({ length: 5 }, (_, index) => <Skeleton key={index} />)}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: Error | null; onRetry?: () => void }) {
  if (error instanceof ApiError && error.status === 403) {
    return <StateMessage description={t("state.deniedBody")} icon={Lock} title={t("state.deniedTitle")} tone="denied" />;
  }
  const offline = typeof navigator !== "undefined" && !navigator.onLine;
  return (
    <StateMessage
      action={onRetry ? <Button onClick={onRetry} size="sm" type="button" variant="secondary">{t("common.retry")}</Button> : undefined}
      description={offline ? t("state.offlineBody") : error instanceof ApiError ? error.message : t("state.errorBody")}
      icon={offline ? WifiOff : AlertTriangle}
      title={offline ? t("state.offlineTitle") : t("state.errorTitle")}
      tone="error"
    />
  );
}

interface StateMessageProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
  tone?: "neutral" | "error" | "denied";
}

export function StateMessage({ action, description, icon: Icon, title, tone = "neutral" }: StateMessageProps) {
  return (
    <div className={cn("data-state", tone !== "neutral" && tone)} role={tone === "error" ? "alert" : undefined}>
      <span className="data-state-icon"><Icon aria-hidden="true" size={22} /></span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action ? <div className="actions">{action}</div> : null}
    </div>
  );
}
