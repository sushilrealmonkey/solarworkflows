import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import {
  chooseDailyTrialFallback,
  hasDailySummaryInsights,
  isActiveTrial,
  type DailySummaryMessage,
  type DailySummarySnapshot,
  type TrialSubscription,
} from "../_shared/daily-summary-fallback.ts";

type DueCompany = {
  company_id: string;
  organization_id: string;
  local_date: string;
};

type Snapshot = DailySummarySnapshot;

type GenerationMode = "ai" | "operational_fallback" | "trial_fallback";

type CompanyResult = {
  aiFailures?: number;
  aiGenerated?: number;
  error?: string;
  noInsights?: number;
  operationalFallbacks?: number;
  queued?: number;
  queueFailures?: number;
  skipped?: number;
  trialFallbacks?: number;
};

// Keep the scheduled worker within its HTTP execution budget while avoiding a
// single slow model request from blocking all other companies.
const COMPANY_CONCURRENCY = 8;
const OPENAI_TIMEOUT_MS = 10_000;

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
    { p_limit: 5000 },
  );
  if (error) return json({ error: error.message }, 500);

  const totals = {
    aiFailures: 0,
    aiGenerated: 0,
    errors: new Set<string>(),
    noInsights: 0,
    operationalFallbacks: 0,
    queued: 0,
    queueFailures: 0,
    skipped: 0,
    trialFallbacks: 0,
  };
  const companies = (data ?? []) as DueCompany[];
  for (let offset = 0; offset < companies.length; offset += COMPANY_CONCURRENCY) {
    const results = await Promise.all(
      companies.slice(offset, offset + COMPANY_CONCURRENCY).map((company) =>
        processCompanySummary(service, company)
      ),
    );
    for (const result of results) {
      totals.aiFailures += result.aiFailures ?? 0;
      totals.aiGenerated += result.aiGenerated ?? 0;
      totals.noInsights += result.noInsights ?? 0;
      totals.operationalFallbacks += result.operationalFallbacks ?? 0;
      totals.queued += result.queued ?? 0;
      totals.queueFailures += result.queueFailures ?? 0;
      totals.skipped += result.skipped ?? 0;
      totals.trialFallbacks += result.trialFallbacks ?? 0;
      if (result.error) totals.errors.add(result.error);
    }
  }

  return json({
    processed: companies.length,
    queued: totals.queued,
    skipped: totals.skipped,
    no_insights: totals.noInsights,
    ai_generated: totals.aiGenerated,
    ai_failures: totals.aiFailures,
    operational_fallbacks: totals.operationalFallbacks,
    trial_fallbacks: totals.trialFallbacks,
    queue_failures: totals.queueFailures,
    error_samples: [...totals.errors].slice(0, 5),
  });
});

async function processCompanySummary(
  service: ReturnType<typeof createClient>,
  company: DueCompany,
): Promise<CompanyResult> {
  const idempotencyKey =
    `daily-summary:${company.company_id}:${company.local_date}`;
  const { data: existing, error: existingError } = await service
    .from("notification_events")
    .select("id")
    .eq("company_id", company.company_id)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existingError) {
    return { error: `event_lookup:${safeMessage(existingError)}` };
  }
  if (existing) return { skipped: 1 };

  try {
    const snapshot = await gatherCompanySnapshot(
      service,
      company.organization_id,
      company.local_date,
    );
    let summary: DailySummaryMessage;
    let generationMode: GenerationMode;
    let aiFailure: string | null = null;

    if (hasDailySummaryInsights(snapshot)) {
      try {
        summary = await generateSummary(snapshot, company.local_date);
        generationMode = "ai";
      } catch (error) {
        aiFailure = safeMessage(error);
        summary = buildOperationalFallback(snapshot);
        generationMode = "operational_fallback";
        console.error("Daily summary AI generation failed; using fallback", {
          companyId: company.company_id,
          organizationId: company.organization_id,
          message: aiFailure,
        });
      }
    } else {
      summary = await getTrialFallbackSummary(
        service,
        company.company_id,
        company.local_date,
      );
      if (!summary) return { noInsights: 1 };
      generationMode = "trial_fallback";
    }

    const { data: result, error: queueError } = await service.rpc(
      "queue_notification_event",
      {
        p_company_id: company.company_id,
        p_event_type: "requested_daily_summary",
        p_source_type: "daily_summary",
        p_source_record_id: company.local_date,
        p_idempotency_key: idempotencyKey,
        p_payload: {
          summary_date: formatDate(company.local_date),
          headline: summary.headline,
          summary: summary.summary,
        },
        p_notification_key: "requested_daily_summary",
        p_scheduled_at: new Date().toISOString(),
      },
    );
    if (queueError) {
      return {
        error: `queue:${safeMessage(queueError)}`,
        queueFailures: 1,
        ...(aiFailure ? { aiFailures: 1 } : {}),
      };
    }

    const queued = Number(
      (result as Array<{ delivery_count?: number }> | null)?.[0]
        ?.delivery_count ?? 0,
    );
    return {
      queued,
      ...(generationMode === "ai" ? { aiGenerated: 1 } : {}),
      ...(generationMode === "operational_fallback"
        ? { aiFailures: 1, operationalFallbacks: 1, error: `ai:${aiFailure}` }
        : {}),
      ...(generationMode === "trial_fallback" ? { trialFallbacks: 1 } : {}),
    };
  } catch (error) {
    const message = safeMessage(error);
    console.error("Daily summary processing failed", {
      companyId: company.company_id,
      organizationId: company.organization_id,
      message,
    });
    return { error: `processing:${message}` };
  }
}

async function getTrialFallbackSummary(
  service: ReturnType<typeof createClient>,
  companyId: string,
  localDate: string,
): Promise<DailySummaryMessage | null> {
  const { data, error } = await service
    .from("company_subscriptions")
    .select("status, trial_ends_at")
    .eq("company_id", companyId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!isActiveTrial(data as TrialSubscription | null)) return null;

  return chooseDailyTrialFallback(companyId, localDate);
}

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
      model: Deno.env.get("DAILY_SUMMARY_MODEL") ||
        Deno.env.get("ASSISTANT_MODEL") || "gpt-4o-mini",
      max_completion_tokens: 220,
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
    signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`OpenAI ${response.status}: ${errorDetail(body)}`);
  }
  const payload = JSON.parse(body) as {
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

function buildOperationalFallback(snapshot: Snapshot): DailySummaryMessage {
  const actions: string[] = [];
  if (snapshot.overdue_followups > 0) {
    actions.push(`${snapshot.overdue_followups} follow-up${plural(snapshot.overdue_followups)} need attention`);
  }
  if (snapshot.overdue_invoices > 0) {
    actions.push(`${snapshot.overdue_invoices} overdue invoice${plural(snapshot.overdue_invoices)} need review`);
  }
  if (snapshot.low_stock_items > 0) {
    actions.push(`${snapshot.low_stock_items} low-stock item${plural(snapshot.low_stock_items)} need replenishment`);
  }
  if (snapshot.new_enquiries_today > 0) {
    actions.push(`${snapshot.new_enquiries_today} new ${snapshot.new_enquiries_today === 1 ? "enquiry" : "enquiries"} arrived today`);
  }
  return {
    headline: "Your daily operations update",
    summary: `${actions.join(". ")}.`,
  };
}

function plural(count: number) {
  return count === 1 ? "" : "s";
}

function errorDetail(body: string) {
  try {
    const parsed = JSON.parse(body) as {
      error?: { code?: string; message?: string; type?: string };
    };
    return [parsed.error?.code, parsed.error?.type, parsed.error?.message]
      .filter(Boolean)
      .join(" | ")
      .slice(0, 300) || "request failed";
  } catch {
    return body.replace(/\s+/g, " ").slice(0, 300) || "request failed";
  }
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
