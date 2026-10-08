import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "./Button";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: string;
  onAction?: () => void;
  footer?: ReactNode;
}

export function EmptyState({ action, description, footer, icon: Icon, onAction, title }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <span className="empty-state-icon"><Icon aria-hidden="true" size={22} /></span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action && onAction ? <Button onClick={onAction} size="sm" type="button">{action}</Button> : null}
      {footer}
    </div>
  );
}

