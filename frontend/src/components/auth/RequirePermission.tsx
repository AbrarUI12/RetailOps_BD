import { Lock } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { t } from "../../lib/i18n";
import { can, type Permission } from "../../lib/permissions";
import { useAuthStore } from "../../stores/authStore";
import { Button } from "../ui/Button";
import { StateMessage } from "../ui/DataState";

/** Shows a permission-denied state instead of a page the role cannot use (plan §34, §57). */
export function RequirePermission({ children, permission }: { children: ReactNode; permission: Permission }) {
  const user = useAuthStore((state) => state.user);
  if (can(user, permission)) return children;
  return (
    <StateMessage
      action={<Button asChild size="sm" variant="secondary"><Link to="/dashboard">Go to overview</Link></Button>}
      description={t("state.deniedBody")}
      icon={Lock}
      title={t("state.deniedTitle")}
      tone="denied"
    />
  );
}
