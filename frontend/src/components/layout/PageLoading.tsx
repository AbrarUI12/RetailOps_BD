import { Skeleton } from "../ui/Skeleton";

export function PageLoading() {
  return (
    <div aria-label="Loading page" className="loading-state">
      <Skeleton className="skeleton-title" />
      <Skeleton className="skeleton-line" />
      <div className="skeleton-grid"><Skeleton /><Skeleton /><Skeleton /></div>
    </div>
  );
}
