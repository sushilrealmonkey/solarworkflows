import { useEffect, useMemo, useState } from "react";

const pageSizeOptions = [25, 50, 75, 100] as const;

export type TablePaginationModel<T> = {
  page: number;
  pageItems: T[];
  pageSize: number;
  totalItems: number;
  totalPages: number;
  startItem: number;
  endItem: number;
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
};

export function useTablePagination<T>(
  items: readonly T[],
  initialPageSize = 25,
): TablePaginationModel<T> {
  const [page, setPageState] = useState(1);
  const [pageSize, setPageSizeState] = useState(initialPageSize);
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  useEffect(() => {
    setPageState((current) => Math.min(current, totalPages));
  }, [totalPages]);

  const pageItems = useMemo(() => {
    const startIndex = (page - 1) * pageSize;
    return items.slice(startIndex, startIndex + pageSize);
  }, [items, page, pageSize]);

  const startItem = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const endItem = Math.min(totalItems, page * pageSize);

  function setPage(nextPage: number) {
    setPageState(Math.min(Math.max(nextPage, 1), totalPages));
  }

  function setPageSize(nextPageSize: number) {
    setPageSizeState(nextPageSize);
    setPageState(1);
  }

  return {
    page,
    pageItems,
    pageSize,
    totalItems,
    totalPages,
    startItem,
    endItem,
    setPage,
    setPageSize,
  };
}

type TablePaginationProps = {
  label?: string;
  pagination: TablePaginationModel<unknown>;
};

export function TablePagination({
  label = "records",
  pagination,
}: TablePaginationProps) {
  if (pagination.totalItems === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div>
        Showing{" "}
        <span className="font-semibold text-slate-900">
          {pagination.startItem}-{pagination.endItem}
        </span>{" "}
        of{" "}
        <span className="font-semibold text-slate-900">
          {pagination.totalItems}
        </span>{" "}
        {label}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="flex items-center gap-2">
          <span className="whitespace-nowrap text-xs font-semibold uppercase tracking-wide text-slate-500">
            Rows
          </span>
          <select
            className="h-9 rounded-lg border border-stone-200 bg-white px-3 text-sm font-medium text-slate-900 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200"
            value={pagination.pageSize}
            onChange={(event) =>
              pagination.setPageSize(Number(event.target.value))
            }
          >
            {pageSizeOptions.map((pageSize) => (
              <option key={pageSize} value={pageSize}>
                {pageSize}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-2">
          <button
            type="button"
            className="h-9 rounded-lg border border-stone-200 px-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => pagination.setPage(pagination.page - 1)}
            disabled={pagination.page <= 1}
          >
            Previous
          </button>
          <span className="min-w-20 text-center text-sm font-semibold text-slate-900">
            {pagination.page} / {pagination.totalPages}
          </span>
          <button
            type="button"
            className="h-9 rounded-lg border border-stone-200 px-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => pagination.setPage(pagination.page + 1)}
            disabled={pagination.page >= pagination.totalPages}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
