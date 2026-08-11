"use client";

import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { useMemo, useState } from "react";

interface CsvRendererProps {
  content: string;
}

function parseCsv(content: string): { headers: string[]; rows: string[][] } {
  const lines = content.trim().split(/\r?\n/);
  if (lines.length === 0) return { headers: [], rows: [] };

  const parseLine = (line: string): string[] => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') {
          current += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ",") {
          result.push(current);
          current = "";
        } else {
          current += ch;
        }
      }
    }
    result.push(current);
    return result;
  };

  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).map(parseLine);
  return { headers, rows };
}

export function CsvRenderer({ content }: CsvRendererProps) {
  const [sorting, setSorting] = useState<SortingState>([]);

  const { headers, rows } = useMemo(() => parseCsv(content), [content]);

  const columns = useMemo<ColumnDef<Record<string, string>, string>[]>(() => {
    return headers.map((header, i) => ({
      accessorKey: header || `col_${i}`,
      header: header || `Column ${i + 1}`,
      cell: (info) => info.getValue(),
    }));
  }, [headers]);

  const data = useMemo(() => {
    return rows.map((row) => {
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => {
        obj[h || `col_${i}`] = row[i] ?? "";
      });
      return obj;
    });
  }, [rows, headers]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  if (headers.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-500 text-sm">No data</div>
    );
  }

  return (
    <div className="flex-1 overflow-auto">
      <table className="w-full text-sm border-collapse">
        <thead className="sticky top-0 z-10">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th
                  key={header.id}
                  onClick={header.column.getToggleSortingHandler()}
                  className="px-3 py-2 text-left text-xs font-semibold text-zinc-300 bg-zinc-800 border-b border-zinc-700 cursor-pointer select-none hover:bg-zinc-700 transition-colors"
                >
                  <div className="flex items-center gap-1">
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    {header.column.getIsSorted() === "asc" && (
                      <span className="text-zinc-400">↑</span>
                    )}
                    {header.column.getIsSorted() === "desc" && (
                      <span className="text-zinc-400">↓</span>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row, rowIdx) => (
            <tr key={row.id} className={rowIdx % 2 === 0 ? "bg-zinc-900" : "bg-zinc-900/50"}>
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="px-3 py-1.5 text-zinc-300 border-b border-zinc-800/50">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
