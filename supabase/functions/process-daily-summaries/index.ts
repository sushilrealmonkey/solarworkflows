import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

type DueRecipient = {
  company_id: string;
  organization_id: string;
  recipient_id: string;
  local_date: string;
  timezone: string;
};

type Snapshot = {
  overdue_followups: number;
  overdue_invoices: number;
  low_stock_items: number;
  new_enquiries_today: number;
};

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }
  if (
    request.headers.get("x-worker-secret") !==
      requireEnv("DAILY_SUMMARY_WORKER_SECRET")
  ) {
    return json({ error: "Unauthorized" }, 401);
  }

  const service = createClient(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } },
  );
  const { data, error } = await service.rpc(
    "list_due_daily_summary_recipients",
    { p_limit: 100 },
  );
  if (error) return json({ error: error.message }, 500);

  let queued = 0;
  let skipped = 0;
  for (const recipient of (data ?? []) as DueRecipient[]) {
    const idempotencyKey =
      `daily-summary:${recipient.recipient_id}:${recipient.local_date}`;
    const { data: existing } = await service
      .from("notification_events")
      .select("id")
      .eq("company_id", recipient.company_id)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (existing) {
      skipped += 1;
      continue;
    }

    try {
      const snapshot = await gatherCompanySnapshot(
        service,
        recipient.organization_id,
        recipient.local_date,
      );
      const summary = await generateSummary(snapshot, recipient.local_date);
      const { data: result, error: queueError } = await service.rpc(
        "queue_notification_event",
        {
          p_company_id: recipient.company_id,
          p_event_type: "requested_daily_summary",
          p_source_type: "daily_summary",
          p_source_record_id: recipient.local_date,
          p_idempotency_key: idempotencyKey,
          p_payload: {
            summary_date: formatDate(recipient.local_date),
            headline: summary.headline,
            summary: summary.summary,
          },
          p_notification_key: "requested_daily_summary",
          p_scheduled_at: new Date().toISOString(),
          p_recipient_id: recipient.recipient_id,
        },
      );
      if (queueError) throw new Error(queueError.message);
      queued += Number(
        (result as Array<{ delivery_count?: number }> | null)?.[0]
          ?.delivery_count ?? 0,
      );
    } catch (summaryError) {
      console.error("Daily summary generation failed", {
        companyId: recipient.company_id,
        recipientId: recipient.recipient_id,
        message: safeMessage(summaryError),
      });
    }
  }

  return json({ processed: data?.length ?? 0, queued, skipped });
});

async function gatherCompanySnapshot(
  service: ReturnType<typeof createClient>,
  organizationId: string,
  localDate: string,
): Promise<Snapshot> {
  const dayStart = `${localDate}T00:00:00+05:30`;
  const nextDate = new Date(`${localDate}T00:00:00Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  const nextLocalDate = nextDate.toISOString().slice(0, 10);
  const dayEnd = `${nextLocalDate}T00:00:00+05:30`;

  const [
    followups,
    invoices,
    inventory,
    enquiries,
  ] = await Promise.all([
    service.from("lead_followups")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .in("status", ["pending", "missed"])
      .lt("followup_date", dayEnd),
    service.from("invoices")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .gt("balance_due", 0)
      .lt("due_date", localDate)
      .not("status", "in", '("paid","cancelled")'),
    service.from("inventory_items")
      .select("id,current_stock,minimum_stock")
      .eq("organization_id", organizationId)
      .gt("minimum_stock", 0),
    service.from("leads")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .gte("created_at", dayStart)
      .lt("created_at", dayEnd),
  ]);

  const firstError = [
    followups.error,
    invoices.error,
    inventory.error,
    enquiries.error,
  ].find(Boolean);
  if (firstError) throw new Error(firstError.message);

  const lowStock = (inventory.data ?? []).filter((item) =>
    Number(item.current_stock ?? 0) <= Number(item.minimum_stock ?? 0)
  ).length;
  return {
    overdue_followups: followups.count ?? 0,
    overdue_invoices: invoices.count ?? 0,
    low_stock_items: lowStock,
    new_enquiries_today: enquiries.count ?? 0,
  };
}

async function generateSummary(snapshot: Snapshot, localDate: string) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireEnv("OPENAI_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: Deno.env.get("ASSISTANT_MODEL") || "gpt-5.6",
      max_completion_tokens: 600,
      messages: [
        {
          role: "system",
          content:
            "Write a concise operational WhatsApp summary from aggregate counts only. Do not invent details, names, amounts, advice, or promotions. The headline must be one short sentence. The summary must be one sentence under 350 characters.",
        },
        {
          role: "user",
          content: JSON.stringify({ local_date: localDate, ...snapshot }),
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "daily_whatsapp_summary",
          strict: true,
          schema: {
            type: "object",
            properties: {
              headline: { type: "string" },
              summary: { type: "string" },
            },
            required: ["headline", "summary"],
            additionalProperties: false,
          },
        },
      },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`OpenAI returned ${response.status}`);
  }
  const payload = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = payload.choices?.[0]?.message?.content;
  if (!raw) throw new Error("OpenAI returned no daily summary");
  const parsed = JSON.parse(raw) as { headline?: string; summary?: string };
  if (!parsed.headline?.trim() || !parsed.summary?.trim()) {
    throw new Error("OpenAI returned an invalid daily summary");
  }
  return {
    headline: parsed.headline.trim().slice(0, 200),
    summary: parsed.summary.trim().slice(0, 700),
  };
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(new Date(`${value}T00:00:00+05:30`));
}

function requireEnv(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
function safeMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
