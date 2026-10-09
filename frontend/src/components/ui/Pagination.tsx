import { ChevronLeft, ChevronRight } from "lucide-react";

import { formatNumber } from "../../lib/format";
import { Button } from "./Button";

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  noun?: string;
}

export function Pagination({ noun = "items", onPage, page, pageSize, total }: PaginationProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const first = total ? (page - 1) * pageSize + 1 : 0;
  const last = Math.min(total, page * pageSize);
  return (
    <nav aria-label="Pagination" className="pagination">
      <span>{total ? `${formatNumber(first)}–${formatNumber(last)} of ${formatNumber(total)} ${noun}` : `No ${noun}`}</span>
      <div>
        <Button disabled={page <= 1} onClick={() => onPage(page - 1)} size="sm" variant="secondary"><ChevronLeft aria-hidden="true" size={16} /> Previous</Button>
        <Button disabled={page >= pages} onClick={() => onPage(page + 1)} size="sm" variant="secondary">Next <ChevronRight aria-hidden="true" size={16} /></Button>
      </div>
    </nav>
  );
}
