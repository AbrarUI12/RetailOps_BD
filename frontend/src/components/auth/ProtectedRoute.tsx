import { useEffect } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";

import { Skeleton } from "../ui/Skeleton";
import { useAuthStore } from "../../stores/authStore";

export function ProtectedRoute() {
  const { user, bootstrapped, bootstrap } = useAuthStore();
  const location = useLocation();
  useEffect(() => {
    if (!bootstrapped) void bootstrap();
  }, [bootstrap, bootstrapped]);
  if (!bootstrapped) return <div className="auth-loading"><Skeleton /></div>;
  if (!user) return <Navigate replace state={{ from: location.pathname }} to="/login" />;
  return <Outlet />;
}
