import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import mascotUrl from "../../assets/mascots/bizlee-solar-mascot.png";

export type MascotState =
  | "normal"
  | "new-insight"
  | "thinking"
  | "attention"
  | "success"
  | "loading";

type BizleeMascotLauncherProps = {
  placement?: "sidebar" | "mobile";
  sidebarCollapsed?: boolean;
  /**
   * Presentation-only until the assistant can provide a meaningful live state.
   */
  state?: MascotState;
};

const stateLabels: Record<MascotState, string> = {
  normal: "Ready to help",
  "new-insight": "New insight ready",
  thinking: "Thinking",
  attention: "Needs your attention",
  success: "All caught up",
  loading: "Loading Bizlee AI",
};

export function BizleeMascotLauncher({
  placement = "mobile",
  sidebarCollapsed = false,
  state = "normal",
}: BizleeMascotLauncherProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [isDismissed, setIsDismissed] = useState(false);
  const isSidebarPlacement = placement === "sidebar";

  if (isDismissed || location.pathname === "/today") return null;

  return (
    <div
      className={
        isSidebarPlacement
          ? "bizlee-mascot-launcher group relative shrink-0 pt-3"
          : "bizlee-mascot-launcher group fixed bottom-4 left-3 z-20 sm:bottom-5 lg:hidden"
      }
    >
      <button
        aria-label={`Open Bizlee AI — ${stateLabels[state]}`}
        className={`relative flex items-center outline-none transition duration-200 focus-visible:ring-4 focus-visible:ring-orange-300 focus-visible:ring-offset-2 ${
          isSidebarPlacement
            ? `w-full gap-2 rounded-xl px-1 py-1.5 text-left hover:bg-white/10 ${
                sidebarCollapsed ? "justify-center" : ""
              }`
            : "h-[4.75rem] w-[4.75rem] justify-center rounded-full hover:-translate-y-1 active:translate-y-0 sm:h-[5.5rem] sm:w-[5.5rem]"
        }`}
        onClick={() => navigate("/today")}
        title={isSidebarPlacement && sidebarCollapsed ? "Ask Bizlee AI" : undefined}
        type="button"
      >
        <span
          aria-hidden="true"
          className={`relative flex shrink-0 items-center justify-center rounded-full ${
            isSidebarPlacement
              ? "h-[4.25rem] w-[4.25rem]"
              : "h-[4.75rem] w-[4.75rem] sm:h-[5.5rem] sm:w-[5.5rem]"
          }`}
        >
          <span className="absolute inset-1 rounded-full bg-gradient-to-br from-orange-100 via-white to-blue-100 shadow-[0_12px_28px_rgba(15,36,91,0.2)] ring-1 ring-orange-200/80" />
          <span className={`bizlee-mascot-aura bizlee-mascot-aura--${state}`} />
          <img
            alt=""
            aria-hidden="true"
            className={`bizlee-mascot-image bizlee-mascot-image--${state} relative z-10 max-w-none object-contain ${
              isSidebarPlacement
                ? "h-[5rem] w-[5rem]"
                : "h-[5.6rem] w-[5.6rem] sm:h-[6.5rem] sm:w-[6.5rem]"
            }`}
            draggable={false}
            src={mascotUrl}
          />
          <MascotStateIndicator state={state} />
        </span>

        {isSidebarPlacement && !sidebarCollapsed ? (
          <span className="min-w-0 pr-1 text-white">
            <span className="block truncate text-sm font-semibold">Bizlee AI</span>
            <span className="mt-0.5 block text-xs leading-4 text-slate-300">
              Ask for a business brief
            </span>
          </span>
        ) : null}

        {!isSidebarPlacement ? (
          <span className="pointer-events-none absolute bottom-[calc(100%+0.75rem)] left-0 hidden w-52 translate-y-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left opacity-0 shadow-lg shadow-slate-900/10 transition duration-200 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100 sm:block">
            <span className="block text-sm font-semibold text-[#0d1b3d]">
              Ask Bizlee AI
            </span>
            <span className="mt-0.5 block text-xs leading-4 text-slate-500">
              {stateLabels[state]}. Get a quick business brief.
            </span>
          </span>
        ) : null}
      </button>
      <button
        aria-label="Hide Bizlee AI launcher"
        className="bizlee-mascot-dismiss absolute -right-1 -top-1 z-30 flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-base leading-none text-slate-600 shadow-md shadow-slate-900/15 transition hover:bg-slate-100 hover:text-slate-950 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300 focus-visible:ring-offset-2"
        onClick={() => setIsDismissed(true)}
        title="Hide Bizlee AI"
        type="button"
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}

function MascotStateIndicator({ state }: { state: MascotState }) {
  if (state === "normal") {
    return <span aria-hidden="true" className="bizlee-mascot-ready" />;
  }

  if (state === "thinking") {
    return (
      <span aria-hidden="true" className="bizlee-mascot-thinking-dots">
        <i />
        <i />
        <i />
      </span>
    );
  }

  if (state === "loading") {
    return <span aria-hidden="true" className="bizlee-mascot-loading" />;
  }

  const glyphs: Record<Exclude<MascotState, "normal" | "thinking" | "loading">, string> = {
    "new-insight": "✦",
    attention: "!",
    success: "✓",
  };

  return (
    <span
      aria-hidden="true"
      className={`bizlee-mascot-indicator bizlee-mascot-indicator--${state}`}
    >
      {glyphs[state]}
    </span>
  );
}
