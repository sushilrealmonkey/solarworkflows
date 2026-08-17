import { env } from "../../config/env";
import { supabase } from "../../services/supabaseClient";
import type { BriefResponse, ChatMessage, ChatStreamEvent } from "./types";

export const ASSISTANT_UNAVAILABLE_MESSAGE =
  "Bizlee AI is temporarily unavailable. Please try again shortly.";

function requireSupabase() {
  if (!supabase) {
    throw new Error("Supabase environment variables are not configured.");
  }

  return supabase;
}

function localDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export async function fetchDailyBrief(force = false): Promise<BriefResponse> {
  const client = requireSupabase();
  const { data, error } = await client.functions.invoke("assistant-brief", {
    body: {
      local_date: localDate(),
      force,
    },
  });

  if (error) {
    throw new Error(await getFunctionErrorMessage(error));
  }

  return data as BriefResponse;
}

// functions.invoke buffers the whole response, so the chat endpoint is called
// with fetch directly to read the SSE stream incrementally.
export async function streamAssistantChat(
  messages: ChatMessage[],
  onEvent: (event: ChatStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const client = requireSupabase();
  const { data: sessionData } = await client.auth.getSession();
  const accessToken = sessionData.session?.access_token;

  if (!accessToken) {
    throw new Error("You need to be signed in to use the assistant.");
  }

  const response = await fetch(`${env.supabaseUrl}/functions/v1/assistant-chat`, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      apikey: env.supabaseAnonKey,
    },
    body: JSON.stringify({
      messages,
      local_date: localDate(),
    }),
  });

  if (!response.ok || !response.body) {
    let message = ASSISTANT_UNAVAILABLE_MESSAGE;
    try {
      const payload = await response.json();
      if (response.status < 500 && payload?.error) {
        message = String(payload.error);
      }
    } catch {
      // keep the default message
    }
    throw new Error(message);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const chunk = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");

      const line = chunk.trim();
      if (!line.startsWith("data:")) continue;

      try {
          const event = JSON.parse(line.slice(5).trim()) as ChatStreamEvent;
          onEvent(
            event.type === "error"
              ? { type: "error", message: ASSISTANT_UNAVAILABLE_MESSAGE }
              : event,
          );
      } catch {
        // ignore malformed chunks
      }
    }
  }
}

async function getFunctionErrorMessage(error: unknown): Promise<string> {
  const fallback = ASSISTANT_UNAVAILABLE_MESSAGE;

  if (error && typeof error === "object" && "context" in error) {
    const context = (error as { context?: Response }).context;
    if (context instanceof Response) {
      try {
        const payload = await context.json();
        if (context.status < 500 && payload?.error) return String(payload.error);
      } catch {
        return fallback;
      }
    }
  }

  return fallback;
}
