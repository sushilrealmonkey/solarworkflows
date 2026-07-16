export type BriefSeverity = "critical" | "attention" | "info";

export type BriefRef = {
  label: string;
  path: string;
};

export type BriefCardData = {
  severity: BriefSeverity;
  title: string;
  body: string;
  prompts: string[];
  refs: BriefRef[];
};

export type DailyBrief = {
  headline: string;
  cards: BriefCardData[];
};

export type BriefResponse = {
  brief: DailyBrief;
  brief_date: string;
  cached: boolean;
};

export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type ChatStreamEvent =
  | { type: "text"; text: string }
  | { type: "tool"; name: string }
  | { type: "usage"; input_tokens: number; output_tokens: number }
  | { type: "done" }
  | { type: "error"; message: string };
