import type { ComponentProps } from "react";

import { cn } from "../../lib/utils";

export function Table({ className, ...props }: ComponentProps<"table">) {
  return <div className="table-wrap"><table className={cn("table", className)} {...props} /></div>;
}

export function TableHeader(props: ComponentProps<"thead">) { return <thead {...props} />; }
export function TableBody(props: ComponentProps<"tbody">) { return <tbody {...props} />; }
export function TableRow({ className, ...props }: ComponentProps<"tr">) { return <tr className={cn("table-row", className)} {...props} />; }
export function TableHead({ className, ...props }: ComponentProps<"th">) { return <th className={cn("table-head", className)} {...props} />; }
export function TableCell({ className, ...props }: ComponentProps<"td">) { return <td className={cn("table-cell", className)} {...props} />; }

