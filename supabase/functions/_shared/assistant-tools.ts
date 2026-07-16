import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

// Fixed, typed tool surface for the AI assistant. Every executor runs on the
// caller-JWT client, so RLS decides what each user can see; a user without a
// module's view permission simply gets zero rows back. The model never writes
// SQL and never sees a connection.

export type ToolResult = {
  content: string;
  isError?: boolean;
};

type ToolExecutor = (
  client: SupabaseClient,
  input: Record<string, unknown>,
  localDate: string,
) => Promise<unknown>;

const ROW_LIMIT = 25;

export const toolDefinitions = [
  {
    name: "get_due_followups",
    description:
      "List pending or missed lead follow-ups with the linked enquiry. Call this for anything about follow-ups, callbacks, or reminders.",
    input_schema: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          enum: ["overdue", "today", "week"],
          description:
            "overdue = before today, today = due today, week = next 7 days including today",
        },
      },
      required: ["scope"],
      additionalProperties: false,
    },
  },
  {
    name: "get_recent_enquiries",
    description:
      "List enquiries (leads) created in the last N days, optionally filtered by status.",
    input_schema: {
      type: "object",
      properties: {
        days: {
          type: "integer",
          enum: [1, 3, 7, 14, 30, 90],
          description: "Look-back window in days",
        },
        status: {
          type: "string",
          enum: [
            "new",
            "contacted",
            "site_visit_scheduled",
            "qualified",
            "quotation_sent",
            "converted",
            "lost",
          ],
        },
      },
      required: ["days"],
      additionalProperties: false,
    },
  },
  {
    name: "get_stale_enquiries",
    description:
      "List open enquiries (not converted or lost) with no activity for at least N days. Activity is approximated by the record's last update. Use this to find leads at risk of going cold.",
    input_schema: {
      type: "object",
      properties: {
        days: {
          type: "integer",
          enum: [3, 5, 7, 14, 30],
          description: "Minimum days without activity",
        },
      },
      required: ["days"],
      additionalProperties: false,
    },
  },
  {
    name: "get_low_stock",
    description:
      "List active inventory items at or below their minimum stock level.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "get_stock_risk",
    description:
      "Compare current stock against active project reservations per inventory item. Flags items where reserved quantity exceeds or nearly exhausts available stock. Use this for questions about whether stock can cover committed projects.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "get_overdue_invoices",
    description:
      "List invoices and proforma invoices with an outstanding balance past their due date, plus totals. Returns nothing for users without invoice access.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "get_project_statuses",
    description:
      "Count installation projects by status and list recent projects, optionally filtered to one status.",
    input_schema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: [
            "created",
            "material_pending",
            "material_dispatched",
            "installation_scheduled",
            "installation_in_progress",
            "installation_completed",
            "inspection_pending",
            "inspection_completed",
            "net_metering_pending",
            "commissioned",
            "cancelled",
            "on_hold",
          ],
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "get_upcoming_surveys",
    description:
      "List site surveys scheduled from today onward (scheduled, in progress, or rescheduled).",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "get_quotation_pipeline",
    description:
      "Count quotations by status and list recent quotations with amounts, optionally filtered to one status.",
    input_schema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["draft", "sent", "accepted", "rejected", "expired", "cancelled"],
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "get_dashboard_summary",
    description:
      "Headline totals for the organization: customers, leads, projects, quotations, project value, received and due amounts, low stock count.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "search_records",
    description:
      "Find enquiries, customers, quotations, or projects by code or name fragment. Use this when the user references a specific record.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Code or name fragment, e.g. 'LD-0042' or 'Sharma'",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
];

function isoDayStart(localDate: string) {
  return `${localDate}T00:00:00`;
}

function addDays(localDate: string, days: number) {
  const date = new Date(`${localDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function getDueFollowups(
  client: SupabaseClient,
  input: Record<string, unknown>,
  localDate: string,
) {
  const scope = String(input.scope ?? "today");
  let query = client
    .from("lead_followups")
    .select(
      "id, followup_type, followup_date, status, notes, lead:leads(id, lead_code, full_name, phone, city, status), assigned_staff:users_profile!lead_followups_assigned_to_fkey(full_name)",
    )
    .in("status", ["pending", "missed"])
    .order("followup_date", { ascending: true })
    .limit(ROW_LIMIT);

  if (scope === "overdue") {
    query = query.lt("followup_date", isoDayStart(localDate));
  } else if (scope === "today") {
    query = query
      .gte("followup_date", isoDayStart(localDate))
      .lt("followup_date", isoDayStart(addDays(localDate, 1)));
  } else {
    query = query
      .gte("followup_date", isoDayStart(localDate))
      .lt("followup_date", isoDayStart(addDays(localDate, 7)));
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return { scope, count: data?.length ?? 0, followups: data ?? [] };
}

async function getRecentEnquiries(
  client: SupabaseClient,
  input: Record<string, unknown>,
  localDate: string,
) {
  const days = Number(input.days ?? 7);
  let query = client
    .from("leads")
    .select(
      "id, lead_code, full_name, phone, city, status, priority, estimated_load_kw, source, created_at",
    )
    .gte("created_at", isoDayStart(addDays(localDate, -days)))
    .order("created_at", { ascending: false })
    .limit(ROW_LIMIT);

  if (typeof input.status === "string" && input.status) {
    query = query.eq("status", input.status);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return { days, count: data?.length ?? 0, enquiries: data ?? [] };
}

async function getStaleEnquiries(
  client: SupabaseClient,
  input: Record<string, unknown>,
  localDate: string,
) {
  const days = Number(input.days ?? 7);
  const { data, error } = await client
    .from("leads")
    .select(
      "id, lead_code, full_name, phone, city, status, priority, estimated_load_kw, updated_at, created_at",
    )
    .not("status", "in", "(converted,lost)")
    .lt("updated_at", isoDayStart(addDays(localDate, -days)))
    .order("updated_at", { ascending: true })
    .limit(ROW_LIMIT);

  if (error) throw new Error(error.message);
  return {
    days,
    note: "Staleness is based on the enquiry record's last update.",
    count: data?.length ?? 0,
    enquiries: data ?? [],
  };
}

async function getLowStock(client: SupabaseClient) {
  const { data, error } = await client
    .from("inventory_items")
    .select(
      "id, item_code, item_name, item_category, unit, current_stock, minimum_stock",
    )
    .eq("status", "active")
    .order("item_name", { ascending: true });

  if (error) throw new Error(error.message);

  const low = (data ?? []).filter(
    (item) => Number(item.current_stock ?? 0) <= Number(item.minimum_stock ?? 0),
  );
  return { count: low.length, items: low.slice(0, ROW_LIMIT) };
}

async function getStockRisk(client: SupabaseClient) {
  const { data, error } = await client
    .from("inventory_reservations")
    .select(
      "quantity, status, project:projects(project_code, project_name), inventory_item:inventory_items(id, item_code, item_name, unit, current_stock)",
    )
    .in("status", ["active", "partial", "shortage"])
    .limit(200);

  if (error) throw new Error(error.message);

  const byItem = new Map<
    string,
    {
      item_code: string;
      item_name: string;
      unit: string | null;
      current_stock: number;
      reserved: number;
      projects: string[];
    }
  >();

  for (const row of data ?? []) {
    const item = row.inventory_item as unknown as {
      id: string;
      item_code: string;
      item_name: string;
      unit: string | null;
      current_stock: number;
    } | null;
    if (!item) continue;

    const entry = byItem.get(item.id) ?? {
      item_code: item.item_code,
      item_name: item.item_name,
      unit: item.unit,
      current_stock: Number(item.current_stock ?? 0),
      reserved: 0,
      projects: [],
    };
    entry.reserved += Number(row.quantity ?? 0);
    const project = row.project as unknown as { project_code: string } | null;
    if (project?.project_code && !entry.projects.includes(project.project_code)) {
      entry.projects.push(project.project_code);
    }
    byItem.set(item.id, entry);
  }

  const items = [...byItem.values()]
    .map((entry) => ({
      ...entry,
      shortfall: Math.max(0, entry.reserved - entry.current_stock),
    }))
    .sort((a, b) => b.shortfall - a.shortfall);

  return {
    at_risk: items.filter((item) => item.shortfall > 0).slice(0, ROW_LIMIT),
    covered: items.filter((item) => item.shortfall === 0).slice(0, ROW_LIMIT),
  };
}

async function getOverdueInvoices(client: SupabaseClient, localDate: string) {
  const [invoices, proformas] = await Promise.all([
    client
      .from("invoices")
      .select(
        "id, invoice_code, invoice_date, due_date, total_amount, amount_paid, balance_due, status, customer:customers(id, customer_code, full_name, business_name, phone)",
      )
      .gt("balance_due", 0)
      .lt("due_date", localDate)
      .not("status", "in", "(paid,cancelled)")
      .order("due_date", { ascending: true })
      .limit(ROW_LIMIT),
    client
      .from("proforma_invoices")
      .select(
        "id, proforma_code, due_date, total_amount, amount_paid, balance_due, status, customer:customers(id, customer_code, full_name, business_name, phone)",
      )
      .gt("balance_due", 0)
      .lt("due_date", localDate)
      .not("status", "in", "(paid,cancelled,converted)")
      .order("due_date", { ascending: true })
      .limit(ROW_LIMIT),
  ]);

  if (invoices.error) throw new Error(invoices.error.message);
  if (proformas.error) throw new Error(proformas.error.message);

  const sum = (rows: { balance_due: unknown }[]) =>
    rows.reduce((total, row) => total + Number(row.balance_due ?? 0), 0);

  return {
    invoices: invoices.data ?? [],
    proforma_invoices: proformas.data ?? [],
    total_overdue_balance:
      sum(invoices.data ?? []) + sum(proformas.data ?? []),
  };
}

async function getProjectStatuses(
  client: SupabaseClient,
  input: Record<string, unknown>,
) {
  const { data, error } = await client
    .from("projects")
    .select(
      "id, project_code, project_name, project_status, priority, system_capacity_kw, expected_completion_date, created_at, customer:customers(full_name, business_name, city)",
    )
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) throw new Error(error.message);

  const counts: Record<string, number> = {};
  for (const project of data ?? []) {
    const status = String(project.project_status ?? "unknown");
    counts[status] = (counts[status] ?? 0) + 1;
  }

  const filter = typeof input.status === "string" ? input.status : null;
  const projects = (data ?? [])
    .filter((project) => !filter || project.project_status === filter)
    .slice(0, ROW_LIMIT);

  return { counts, projects };
}

async function getUpcomingSurveys(client: SupabaseClient, localDate: string) {
  const { data, error } = await client
    .from("site_surveys")
    .select(
      "id, survey_status, scheduled_date, scheduled_time, lead:leads(id, lead_code, full_name, phone, city), assigned_staff:users_profile!site_surveys_assigned_to_fkey(full_name)",
    )
    .in("survey_status", ["scheduled", "in_progress", "rescheduled"])
    .gte("scheduled_date", localDate)
    .order("scheduled_date", { ascending: true })
    .order("scheduled_time", { ascending: true })
    .limit(ROW_LIMIT);

  if (error) throw new Error(error.message);
  return { count: data?.length ?? 0, surveys: data ?? [] };
}

async function getQuotationPipeline(
  client: SupabaseClient,
  input: Record<string, unknown>,
) {
  const { data, error } = await client
    .from("quotations")
    .select(
      "id, quotation_code, status, quotation_date, valid_until, system_capacity_kw, total_amount, net_payable_amount, sent_at, accepted_at, customer:customers(full_name, business_name, city), lead:leads(full_name, city)",
    )
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) throw new Error(error.message);

  const counts: Record<string, number> = {};
  for (const quotation of data ?? []) {
    const status = String(quotation.status ?? "unknown");
    counts[status] = (counts[status] ?? 0) + 1;
  }

  const filter = typeof input.status === "string" ? input.status : null;
  const quotations = (data ?? [])
    .filter((quotation) => !filter || quotation.status === filter)
    .slice(0, ROW_LIMIT);

  return { counts, quotations };
}

async function getDashboardSummary(client: SupabaseClient) {
  const { data, error } = await client.rpc("dashboard_summary");
  if (error) throw new Error(error.message);
  return { summary: data ?? [] };
}

async function searchRecords(
  client: SupabaseClient,
  input: Record<string, unknown>,
) {
  const raw = String(input.query ?? "").trim();
  if (!raw) return { results: [] };
  // Escape PostgREST ilike wildcards so user text is matched literally.
  const term = `%${raw.replace(/[%_]/g, "\\$&")}%`;
  const perTable = 5;

  const [leads, customers, quotations, projects] = await Promise.all([
    client
      .from("leads")
      .select("id, lead_code, full_name, phone, city, status")
      .or(`lead_code.ilike.${term},full_name.ilike.${term}`)
      .limit(perTable),
    client
      .from("customers")
      .select("id, customer_code, full_name, business_name, phone, city")
      .or(
        `customer_code.ilike.${term},full_name.ilike.${term},business_name.ilike.${term}`,
      )
      .limit(perTable),
    client
      .from("quotations")
      .select("id, quotation_code, status, total_amount")
      .ilike("quotation_code", term)
      .limit(perTable),
    client
      .from("projects")
      .select("id, project_code, project_name, project_status")
      .or(`project_code.ilike.${term},project_name.ilike.${term}`)
      .limit(perTable),
  ]);

  for (const result of [leads, customers, quotations, projects]) {
    if (result.error) throw new Error(result.error.message);
  }

  return {
    enquiries: leads.data ?? [],
    customers: customers.data ?? [],
    quotations: quotations.data ?? [],
    projects: projects.data ?? [],
  };
}

const executors: Record<string, ToolExecutor> = {
  get_due_followups: getDueFollowups,
  get_recent_enquiries: getRecentEnquiries,
  get_stale_enquiries: getStaleEnquiries,
  get_low_stock: (client) => getLowStock(client),
  get_stock_risk: (client) => getStockRisk(client),
  get_overdue_invoices: (client, _input, localDate) =>
    getOverdueInvoices(client, localDate),
  get_project_statuses: getProjectStatuses,
  get_upcoming_surveys: (client, _input, localDate) =>
    getUpcomingSurveys(client, localDate),
  get_quotation_pipeline: getQuotationPipeline,
  get_dashboard_summary: (client) => getDashboardSummary(client),
  search_records: searchRecords,
};

export async function executeTool(
  client: SupabaseClient,
  name: string,
  input: Record<string, unknown>,
  localDate: string,
): Promise<ToolResult> {
  const executor = executors[name];

  if (!executor) {
    return { content: `Unknown tool: ${name}`, isError: true };
  }

  try {
    const result = await executor(client, input ?? {}, localDate);
    return { content: JSON.stringify(result) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { content: `Tool ${name} failed: ${message}`, isError: true };
  }
}
