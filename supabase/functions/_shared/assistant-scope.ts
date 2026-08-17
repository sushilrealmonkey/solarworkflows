export const ASSISTANT_SCOPE_MESSAGE =
  "I can only help with your Bizlee business data.";

type ScopeMessage = {
  role: "user" | "assistant";
  content: string;
};

const BUSINESS_TERMS =
  /\b(bizlee|business|enquir(?:y|ies)|lead|follow[ -]?up|callback|site survey|survey|quotation|quote|project|inventory|stock|material|product|purchase|supplier|invoice|payment|customer|sales|pipeline|dispatch|installation|solar|epc|overdue|receivable|collection)\b|\b(?:LD|QT|PRJ|INV)-\d+\b/i;

const DAILY_OPERATIONS_QUESTIONS = [
  /\b(today|daily)\b.*\b(brief|summary|priority|priorities|attention|urgent|action)\b/i,
  /\b(what|anything)\b.*\b(need|needs|urgent|attention|today)\b/i,
  /\bhow (?:are we|is everything) doing\b/i,
];

const EXTERNAL_TOPICS =
  /\b(weather|news|politics|election|sports?|recipe|movie|music|celebrity|general knowledge|stock market|crypto(?:currency)?|bitcoin|internet|web search|search the web|browse the web|programming|write code|coding)\b/i;

const CONTEXT_FOLLOW_UP =
  /^(?:yes|no|why|how|when|which|who|show me|show more|more|details?|explain|open it|open that|what about that|and that)[?.! ]*$/i;

export function isTenantBusinessRequest(messages: ScopeMessage[]): boolean {
  const latestUserIndex = messages.findLastIndex(
    (message) => message.role === "user",
  );

  if (latestUserIndex < 0) return false;

  const latest = messages[latestUserIndex].content.trim();
  if (!latest || EXTERNAL_TOPICS.test(latest)) return false;
  if (BUSINESS_TERMS.test(latest)) return true;
  if (DAILY_OPERATIONS_QUESTIONS.some((pattern) => pattern.test(latest))) {
    return true;
  }

  if (!CONTEXT_FOLLOW_UP.test(latest)) return false;

  return messages
    .slice(0, latestUserIndex)
    .some((message) => BUSINESS_TERMS.test(message.content));
}
