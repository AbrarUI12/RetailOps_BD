import type { KeyboardEvent, ReactNode } from "react";

import { cn } from "../../lib/utils";

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  numeric?: boolean;
  /** Shown as the card heading on small screens; holds the row's open button. */
  primary?: boolean;
  /** Shown beside the heading on small screens (status badges, amounts). */
  trailing?: boolean;
  /** Left out of the stacked card layout. */
  hideOnMobile?: boolean;
  /** On cards, rendered full-width below the fields without a label (row actions). */
  cardFooter?: boolean;
}

interface ResponsiveTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Opens a row's details. Keyboard and screen-reader users reach it through a real button. */
  onRowClick?: (row: T) => void;
  rowLabel?: (row: T) => string;
  caption?: string;
}

/** A table on wide screens and stacked cards below 760px, so nothing scrolls sideways (plan §58). */
export function ResponsiveTable<T>({ caption, columns, onRowClick, rowKey, rowLabel, rows }: ResponsiveTableProps<T>) {
  const primary = columns.find((column) => column.primary) ?? columns[0];
  const trailing = columns.filter((column) => column.trailing);
  const fields = columns.filter((column) => column !== primary && !column.trailing && !column.hideOnMobile && !column.cardFooter);
  const footers = columns.filter((column) => column.cardFooter && !column.hideOnMobile);
  const open = (row: T) => onRowClick?.(row);
  const primaryCell = (row: T) =>
    onRowClick ? (
      <button aria-label={rowLabel?.(row)} className="row-link" onClick={(event) => { event.stopPropagation(); open(row); }} type="button">
        {primary.cell(row)}
      </button>
    ) : (
      primary.cell(row)
    );

  return (
    <>
      <div className="table-wrap responsive">
        <table className="table">
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          <thead>
            <tr className="table-row">
              {columns.map((column) => (
                <th className={cn("table-head", column.numeric && "numeric")} key={column.key} scope="col">{column.header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              // The row click is a mouse convenience; the button in the primary cell is the accessible control.
              <tr className={cn("table-row", onRowClick && "clickable")} key={rowKey(row)} onClick={onRowClick ? () => open(row) : undefined}>
                {columns.map((column) => (
                  <td className={cn("table-cell", column.numeric && "numeric")} key={column.key}>
                    {column === primary ? primaryCell(row) : column.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul aria-label={caption} className="row-cards">
        {rows.map((row) => (
          <li key={rowKey(row)}>
            <div
              aria-label={onRowClick ? rowLabel?.(row) : undefined}
              className={cn("row-card", onRowClick && "clickable")}
              onClick={onRowClick ? () => open(row) : undefined}
              onKeyDown={
                onRowClick
                  ? (event: KeyboardEvent) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        open(row);
                      }
                    }
                  : undefined
              }
              role={onRowClick ? "button" : undefined}
              tabIndex={onRowClick ? 0 : undefined}
            >
              <div className="row-card-head">
                <div>{primary.cell(row)}</div>
                {trailing.length ? <div className="row-card-trailing">{trailing.map((column) => <div key={column.key}>{column.cell(row)}</div>)}</div> : null}
              </div>
              {fields.length ? (
                <dl className="row-card-fields">
                  {fields.map((column) => (
                    <div key={column.key}>
                      <dt>{column.header}</dt>
                      <dd>{column.cell(row)}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              {footers.map((column) => <div className="row-card-footer" key={column.key}>{column.cell(row)}</div>)}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
