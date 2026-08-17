const CLARIFICATION_QUESTION =
  /^(which|what|when|where|who|how|do you mean|please (?:specify|provide|clarify)|could you (?:specify|provide|clarify))\b/i;

export function prepareAssistantReply(
  content: string,
  options: { allowClarification: boolean },
): string {
  const reply = content.trim();
  if (!reply) return "";

  if (options.allowClarification && isClarificationQuestion(reply)) {
    return reply;
  }

  return removeTrailingQuestions(reply);
}

function isClarificationQuestion(reply: string): boolean {
  if (reply.length > 180 || !reply.endsWith("?")) return false;
  if ((reply.match(/\?/g) ?? []).length !== 1) return false;
  if (/[.!]\s/.test(reply.slice(0, -1))) return false;
  return CLARIFICATION_QUESTION.test(reply);
}

function removeTrailingQuestions(content: string): string {
  let reply = content.trim();

  while (reply.endsWith("?")) {
    const lineBoundary = reply.lastIndexOf("\n");
    const sentenceBoundary = Math.max(
      reply.lastIndexOf(". "),
      reply.lastIndexOf("! "),
    );

    if (lineBoundary > sentenceBoundary) {
      reply = reply.slice(0, lineBoundary).trimEnd();
      continue;
    }

    if (sentenceBoundary >= 0) {
      reply = reply.slice(0, sentenceBoundary + 1).trimEnd();
      continue;
    }

    return "";
  }

  return reply;
}
