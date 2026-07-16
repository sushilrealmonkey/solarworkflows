import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
import { fetchDailyBrief } from "./assistantApi";
import { AssistantChat, useAssistantChat } from "./AssistantChat";
import { BriefCard } from "./BriefCard";
import type { BriefResponse } from "./types";

export function TodayPage() {
  const { profile } = useAuth();
  const [brief, setBrief] = useState<BriefResponse | null>(null);
  const [briefLoading, setBriefLoading] = useState(true);
  const [briefRefreshing, setBriefRefreshing] = useState(false);
  const [briefError, setBriefError] = useState<string | null>(null);
  const chat = useAssistantChat();
  const chatRef = useRef<HTMLDivElement | null>(null);
  const loadedRef = useRef(false);

  const loadBrief = useCallback(async (force: boolean) => {
    try {
      if (force) {
        setBriefRefreshing(true);
      } else {
        setBriefLoading(true);
      }
      setBriefError(null);
      const response = await fetchDailyBrief(force);
      setBrief(response);
    } catch (error) {
      setBriefError(
        error instanceof Error
          ? error.message
          : "The brief is unavailable right now.",
      );
    } finally {
      setBriefLoading(false);
      setBriefRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    void loadBrief(false);
  }, [loadBrief]);

  function handlePrompt(prompt: string) {
    chat.send(prompt);
    chatRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const firstName = profile?.full_name?.split(" ")[0];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-normal text-slate-950 sm:text-3xl">
            {firstName ? `Good day, ${firstName}` : "Today"}
          </h1>
          <p className="max-w-3xl text-sm leading-6 text-slate-600 sm:text-base">
            {brief?.brief.headline ??
              "Your assistant reads today's business data and flags what needs attention."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadBrief(true)}
          disabled={briefLoading || briefRefreshing}
          className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {briefRefreshing ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      {briefLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((index) => (
            <div
              key={index}
              className="h-28 animate-pulse rounded-2xl border border-slate-200 bg-slate-100"
            />
          ))}
        </div>
      ) : briefError ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-700">
          <p>{briefError}</p>
          <p className="mt-2 text-slate-500">
            You can still use the chat below, or head to the{" "}
            <Link to="/dashboard" className="font-medium text-sky-700 underline">
              dashboard
            </Link>
            .
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {(brief?.brief.cards ?? []).map((card, index) => (
            <BriefCard
              key={`${card.title}-${index}`}
              card={card}
              onPrompt={handlePrompt}
              disabled={chat.streaming}
            />
          ))}
        </div>
      )}

      <div ref={chatRef} className="scroll-mt-4">
        <AssistantChat
          messages={chat.messages}
          streaming={chat.streaming}
          activeTool={chat.activeTool}
          error={chat.error}
          onSend={chat.send}
        />
      </div>
    </div>
  );
}
