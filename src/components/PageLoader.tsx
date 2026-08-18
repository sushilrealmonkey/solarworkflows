type PageLoaderProps = {
  label?: string;
  className?: string;
};

/** A consistent, accessible loading indicator for Supabase-backed page requests. */
export function PageLoader({
  label = "Loading workspace data…",
  className = "",
}: PageLoaderProps) {
  return (
    <div
      aria-live="polite"
      className={`flex min-h-24 items-center justify-center rounded-xl border border-stone-200 bg-white px-4 py-6 shadow-sm ${className}`}
      role="status"
    >
      <div className="flex items-center gap-3 text-sm font-medium text-slate-600">
        <span
          aria-hidden="true"
          className="h-5 w-5 animate-spin rounded-full border-2 border-orange-200 border-t-orange-600"
        />
        <span>{label}</span>
      </div>
    </div>
  );
}
