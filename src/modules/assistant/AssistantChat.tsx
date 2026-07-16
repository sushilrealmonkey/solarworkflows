import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Link } from "react-router-dom";
import { streamAssistantChat } from "./assistantApi";
import type { ChatMessage } from "./types";

export function useAssistantChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const send = useCallback(
    async (content: string) => {
      const trimmed = content.trim();
      if (!trimmed || abortRef.current) return;

      setError(null);
      setStreaming(true);

      const history: ChatMessage[] = [
        ...messages,
        { role: "user", content: trimmed },
      ];
      setMessages([...history, { role: "assistant", content: "" }]);

      const controller = new AbortController();
      abortRef.current = controller;

      const appendToReply = (text: string) => {
        setMessages((current) => {
          const next = [...current];
          const last = next[next.length - 1];
          if (last?.role === "assistant") {
            next[next.length - 1] = { ...last, content: last.content + text };
          }
          return next;
        });
      };

      try {
        await streamAssistantChat(
          history,
          (event) => {
            if (event.type === "text") {
              setActiveTool(null);
              appendToReply(event.text);
            } else if (event.type === "tool") {
              setActiveTool(event.name);
            } else if (event.type === "error") {
              setError(event.message);
            }
          },
          controller.signal,
        );
      } catch (streamError) {
        if (!controller.signal.aborted) {
          setError(
            streamError instanceof Error
              ? streamError.message
              : "The assistant is unavailable right now.",
          );
        }
      } finally {
        abortRef.current = null;
        setActiveTool(null);
        setStreaming(false);
        // Drop an empty assistant bubble if the stream failed before any text.
        setMessages((current) => {
          const last = current[current.length - 1];
          if (last?.role === "assistant" && last.content === "") {
            return current.slice(0, -1);
          }
          return current;
        });
      }
    },
    [messages],
  );

  return { messages, streaming, activeTool, error, send };
}

const toolLabels: Record<string, string> = {
  get_due_followups: "Checking follow-ups",
  get_recent_enquiries: "Checking enquiries",
  get_stale_enquiries: "Checking enquiries",
  get_low_stock: "Checking inventory",
  get_stock_risk: "Checking inventory",
  get_overdue_invoices: "Checking payments",
  get_project_statuses: "Checking projects",
  get_upcoming_surveys: "Checking site surveys",
  get_quotation_pipeline: "Checking quotations",
  get_dashboard_summary: "Checking totals",
  search_records: "Searching records",
};

type AssistantChatProps = {
  messages: ChatMessage[];
  streaming: boolean;
  activeTool: string | null;
  error: string | null;
  onSend: (content: string) => void;
};

export function AssistantChat({
  messages,
  streaming,
  activeTool,
  error,
  onSend,
}: AssistantChatProps) {
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, activeTool]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim() || streaming) return;
    onSend(draft);
    setDraft("");
  }

  return (
    <section className="flex flex-col rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="max-h-[28rem] min-h-[8rem] space-y-4 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <p className="text-sm text-slate-500">
            Ask anything about your business — enquiries, follow-ups, stock,
            quotations, projects, or payments.
          </p>
        ) : (
          messages.map((message, index) => (
            <div
              key={index}
              className={
                message.role === "user"
                  ? "ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-slate-900 px-4 py-2.5 text-sm text-white"
                  : "max-w-[95%] text-sm leading-6 text-slate-800"
              }
            >
              <MessageText content={message.content} />
            </div>
          ))
        )}
        {activeTool ? (
          <p className="text-xs font-medium text-slate-500">
            {toolLabels[activeTool] ?? "Looking that up"}…
          </p>
        ) : null}
        {error ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}
        <div ref={endRef} />
      </div>
      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 border-t border-slate-200 p-3"
      >
        <input
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ask anything about your business…"
          className="h-11 flex-1 rounded-full border border-slate-300 px-4 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={streaming || !draft.trim()}
          className="inline-flex h-11 items-center rounded-full bg-slate-900 px-5 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {streaming ? "Thinking…" : "Ask"}
        </button>
      </form>
    </section>
  );
}

// Minimal renderer for assistant replies: preserves line breaks, renders
// **bold**, and turns [label](/path) into in-app links so record references
// are tappable. External URLs are rendered as plain text on purpose.
function MessageText({ content }: { content: string }) {
  const lines = content.split("\n");

  return (
    <div className="space-y-1 whitespace-pre-wrap break-words">
      {lines.map((line, lineIndex) => (
        <p key={lineIndex} className="min-h-[0.5rem]">
          {renderInline(line)}
        </p>
      ))}
    </div>
  );
}

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /\[([^\]]+)\]\((\/[^)\s]*)\)|\*\*([^*]+)\*\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    if (match[1] && match[2]) {
      nodes.push(
        <Link
          key={key++}
          to={match[2]}
          className="font-medium text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900"
        >
          {match[1]}
        </Link>,
      );
    } else if (match[3]) {
      nodes.push(
        <strong key={key++} className="font-semibold">
          {match[3]}
        </strong>,
      );
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}
