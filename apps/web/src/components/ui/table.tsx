import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import {
  forwardRef,
  type HTMLAttributes,
  type ReactNode,
  type TdHTMLAttributes,
  type ThHTMLAttributes,
} from "react";

import type { SortDir } from "@/hooks/use-sort";
import { cn } from "@/lib/utils";

export const Table = forwardRef<HTMLTableElement, HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <div className="relative w-full overflow-auto rounded-[inherit]">
      <table
        ref={ref}
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  ),
);
Table.displayName = "Table";

export const TableHeader = forwardRef<
  HTMLTableSectionElement,
  HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead
    ref={ref}
    className={cn("bg-muted [&_tr]:border-b [&_tr]:border-border [&_tr]:hover:bg-transparent", className)}
    {...props}
  />
));
TableHeader.displayName = "TableHeader";

export const TableBody = forwardRef<
  HTMLTableSectionElement,
  HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    className={cn("[&_tr:last-child]:border-0", className)}
    {...props}
  />
));
TableBody.displayName = "TableBody";

export const TableFooter = forwardRef<
  HTMLTableSectionElement,
  HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn(
      "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
      className,
    )}
    {...props}
  />
));
TableFooter.displayName = "TableFooter";

export const TableRow = forwardRef<
  HTMLTableRowElement,
  HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn(
      "border-b border-divider transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted",
      className,
    )}
    {...props}
  />
));
TableRow.displayName = "TableRow";

/* Coluna que não rola junto. Numa tabela larga sob scroll horizontal, sem
   isto a pessoa arrasta pro lado e perde a única coluna que diz de QUEM é a
   linha. Não substitui virar card (ver `lista-responsiva.tsx`) — é o
   remendo pra tabela que continua tabela em tela estreita. O `bg` é
   obrigatório: célula transparente deixa o conteúdo rolar por baixo. */
const COLUNA_FIXA = "sticky left-0 z-10 bg-card";

export const TableHead = forwardRef<
  HTMLTableCellElement,
  ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean; fixa?: boolean }
>(({ className, numeric, fixa, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      "h-10 px-4 text-left align-middle whitespace-nowrap text-2xs font-normal text-muted-foreground [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
      numeric && "text-right",
      // No header o fundo é o do <thead> (bg-muted/30 sobre o card), não o
      // bg-card puro — senão a célula fixa fica de uma cor e o resto de outra.
      fixa && "sticky left-0 z-10 bg-[color-mix(in_srgb,var(--muted)_30%,var(--card))]",
      className,
    )}
    {...props}
  />
));
TableHead.displayName = "TableHead";

/** Cabeçalho clicável pra ordenar (client-side). `active`/`dir` vêm do useSort;
 *  `onSort` chama toggle(key). Acessível: aria-sort + <button>. */
export function SortableTableHead({
  className,
  active = false,
  dir,
  numeric = false,
  onSort,
  children,
}: {
  className?: string;
  active?: boolean;
  dir?: SortDir;
  numeric?: boolean;
  onSort: () => void;
  children: ReactNode;
}) {
  const Icon = !active ? ChevronsUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead
      numeric={numeric}
      className={cn("p-0", className)}
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={onSort}
        className={cn(
          "group inline-flex h-10 items-center gap-1 px-4 whitespace-nowrap transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:shadow-focus-soft rounded-sm",
          numeric && "flex-row-reverse",
        )}
      >
        {children}
        <Icon
          className={cn(
            "size-3 shrink-0 transition-colors",
            active ? "text-foreground" : "text-muted-foreground/40 group-hover:text-muted-foreground",
          )}
        />
      </button>
    </TableHead>
  );
}

export const TableCell = forwardRef<
  HTMLTableCellElement,
  TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean; fixa?: boolean }
>(({ className, numeric, fixa, ...props }, ref) => (
  <td
    ref={ref}
    className={cn(
      "px-4 py-3.5 align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
      numeric && "text-right tabular-nums",
      fixa && COLUNA_FIXA,
      className,
    )}
    {...props}
  />
));
TableCell.displayName = "TableCell";

export const TableCaption = forwardRef<
  HTMLTableCaptionElement,
  HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption
    ref={ref}
    className={cn("mt-4 text-sm text-muted-foreground", className)}
    {...props}
  />
));
TableCaption.displayName = "TableCaption";
