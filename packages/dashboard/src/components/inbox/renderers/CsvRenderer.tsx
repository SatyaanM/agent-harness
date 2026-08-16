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

export function parseCsv(content: string): { headers: string[]; rows: string[][] } {
  if (content.length === 0) return { headers: [], rows: [] };

  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let inQuotes = false;

  const endField = () => {
    record.push(field);
    field = "";
  };
  const endRecord = () => {
    endField();
    records.push(record);
    record = [];
  };

  for (let index = 0; index < content.length; index++) {
    const character = content[index];
    if (inQuotes) {
      if (character === '"' && content[index + 1] === '"') {
        field += '"';
        index++;
      } else if (character === '"') {
        inQuotes = false;
      } else {
        field += character;
      }
    } else if (character === '"' && field.length === 0) {
      inQuotes = true;
    } else if (character === ",") {
      endField();
    } else if (character === "\n" || character === "\r") {
      endRecord();
      if (character === "\r" && content[index + 1] === "\n") index++;
    } else {
      field += character;
    }
  }

  if (field.length > 0 || record.length > 0 || !/[\r\n]$/.test(content)) endRecord();
  const [headers = [], ...rows] = records;
  return { headers, rows };
}

function columnKey(index: number): string {
  return `column_${index}`;
}

export function CsvRenderer({ content }: CsvRendererProps) {
  const [sorting, setSorting] = useState<SortingState>([]);

  const { headers, rows } = useMemo(() => parseCsv(content), [content]);

  const columns = useMemo<ColumnDef<Record<string, string>, string>[]>(() => {
    return headers.map((header, i) => ({
      accessorKey: columnKey(i),
      header: header || `Column ${i + 1}`,
      cell: (info) => info.getValue(),
    }));
  }, [headers]);

  const data = useMemo(() => {
    return rows.map((row) => {
      const obj: Record<string, string> = {};
      headers.forEach((_, i) => {
        obj[columnKey(i)] = row[i] ?? "";
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
