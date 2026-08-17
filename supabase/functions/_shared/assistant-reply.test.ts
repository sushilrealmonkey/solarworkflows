import { prepareAssistantReply } from "./assistant-reply.ts";

Deno.test("removes an optional closing question from an answer", () => {
  const reply = prepareAssistantReply(
    "Total overdue balance is ₹9.62L. Would you like a contact list?",
    { allowClarification: true },
  );

  if (reply !== "Total overdue balance is ₹9.62L.") {
    throw new Error(`Unexpected reply: ${reply}`);
  }
});

Deno.test("removes a closing question on its own line", () => {
  const reply = prepareAssistantReply(
    "- INV-0001: ₹2.1L\n- INV-0003: ₹5L\nWould you like more details?",
    { allowClarification: false },
  );

  if (reply !== "- INV-0001: ₹2.1L\n- INV-0003: ₹5L") {
    throw new Error(`Unexpected reply: ${reply}`);
  }
});

Deno.test("allows one genuine clarification as the entire first reply", () => {
  const reply = prepareAssistantReply("Which invoice should I open?", {
    allowClarification: true,
  });

  if (reply !== "Which invoice should I open?") {
    throw new Error(`Unexpected reply: ${reply}`);
  }
});

Deno.test("blocks optional offer questions even on the first reply", () => {
  const reply = prepareAssistantReply("Would you like the detailed list?", {
    allowClarification: true,
  });

  if (reply !== "") {
    throw new Error(`Unexpected reply: ${reply}`);
  }
});

Deno.test("does not allow clarification after business data was fetched", () => {
  const reply = prepareAssistantReply("Which format do you prefer?", {
    allowClarification: false,
  });

  if (reply !== "") {
    throw new Error(`Unexpected reply: ${reply}`);
  }
});
