import type { ReactNode } from "react";

type RecordTitleProps = {
  recordType: string;
  name: ReactNode;
  meta: Array<ReactNode | null | undefined | false>;
  action?: ReactNode;
};

export function RecordTitle({ recordType, name, meta, action }: RecordTitleProps) {
  const visibleMeta = meta.filter(hasVisibleMeta);

  return (
    <header className="min-w-0 space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {recordType}
      </p>
      <div className="flex min-w-0 items-start gap-2">
        <h1 className="min-w-0 text-2xl font-semibold tracking-normal text-slate-950 sm:text-3xl">
          {name}
        </h1>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {visibleMeta.length > 0 ? (
        <p className="flex max-w-3xl flex-wrap items-center gap-x-2 gap-y-1 text-sm leading-6 text-slate-600 sm:text-base">
          {visibleMeta.map((item, index) => (
            <span className="inline-flex min-w-0 items-center gap-2" key={index}>
              {index > 0 ? <span className="text-slate-400">{"\u00b7"}</span> : null}
              <span className="min-w-0 break-words">{item}</span>
            </span>
          ))}
        </p>
      ) : null}
    </header>
  );
}

function hasVisibleMeta(
  item: ReactNode | null | undefined | false,
): item is ReactNode {
  if (item === null || item === undefined || item === false) {
    return false;
  }

  return typeof item !== "string" || item.trim() !== "";
}
