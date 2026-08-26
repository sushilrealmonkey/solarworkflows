import { safeHttpUrl } from "./surveyUtils";
import type { SiteSurvey } from "./types";

export function SiteSurveyMapLinkButton({
  survey,
  className = "",
}: {
  survey: Pick<SiteSurvey, "google_map_link" | "survey_status">;
  className?: string;
}) {
  const mapUrl = safeHttpUrl(survey.google_map_link);

  if (!mapUrl || survey.survey_status === "completed") {
    return null;
  }

  return (
    <a
      aria-label="Open Google Maps"
      className={`inline-flex min-h-10 items-center justify-center rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-stone-50 ${className}`}
      href={mapUrl}
      rel="noopener noreferrer"
      target="_blank"
    >
      Open Google Maps
    </a>
  );
}
