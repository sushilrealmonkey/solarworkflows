import { Link } from "react-router-dom";
import type { BriefCardData, BriefSeverity } from "./types";

const severityStyles: Record<
  BriefSeverity,
  { container: string; badge: string; label: string }
> = {
  critical: {
    container: "border-red-200 bg-red-50/60",
    badge: "bg-red-100 text-red-700",
    label: "Critical",
  },
  attention: {
    container: "border-amber-200 bg-amber-50/60",
    badge: "bg-amber-100 text-amber-700",
    label: "Needs attention",
  },
  info: {
    container: "border-slate-200 bg-white",
    badge: "bg-slate-100 text-slate-600",
    label: "Good to know",
  },
};

type BriefCardProps = {
  card: BriefCardData;
  onPrompt: (prompt: string) => void;
  disabled: boolean;
};

export function BriefCard({ card, onPrompt, disabled }: BriefCardProps) {
  const styles = severityStyles[card.severity] ?? severityStyles.info;

  return (
    <article
      className={`rounded-2xl border p-4 shadow-sm ${styles.container}`}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-900">{card.title}</h3>
        <span
          className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${styles.badge}`}
        >
          {styles.label}
        </span>
      </div>
      <p className="mt-2 text-sm leading-6 text-slate-700">{card.body}</p>
      {card.refs.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {card.refs.map((ref) => (
            <Link
              key={`${ref.path}-${ref.label}`}
              to={ref.path}
              className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:border-slate-300 hover:text-slate-900"
            >
              {ref.label}
            </Link>
          ))}
        </div>
      ) : null}
      {card.prompts.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {card.prompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              disabled={disabled}
              onClick={() => onPrompt(prompt)}
              className="inline-flex items-center rounded-full bg-slate-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {prompt}
            </button>
          ))}
        </div>
      ) : null}
    </article>
  );
}
