import type { ArchiveScope } from "./types";

export function ArchiveScopeFilter({
  value,
  onChange,
}: {
  value: ArchiveScope;
  onChange: (scope: ArchiveScope) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-stone-200 bg-white p-1" aria-label="Record visibility">
      {(["active", "archived", "all"] as const).map((scope) => (
        <button
          className={`min-h-9 rounded-md px-3 text-sm font-semibold capitalize transition ${
            value === scope ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-stone-50"
          }`}
          key={scope}
          onClick={() => onChange(scope)}
          type="button"
        >
          {scope}
        </button>
      ))}
    </div>
  );
}

