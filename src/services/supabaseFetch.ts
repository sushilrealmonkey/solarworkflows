const jwtFutureRetryDelaysMs = [1_000, 2_000, 4_000, 8_000] as const;
const readResponseCacheTtlMs = 10_000;
type SessionRefresh = () => Promise<string | null>;

let sessionRefresh: SessionRefresh | null = null;
let pendingSessionRefresh: Promise<string | null> | null = null;
const pendingReadRequests = new Map<string, Promise<Response>>();
const cachedReadResponses = new Map<
  string,
  { expiresAt: number; response: Response }
>();

// These RPCs are read-only projections. Keeping the allow-list explicit makes
// it impossible for a write RPC to be coalesced by accident.
const readOnlyRpcNames = new Set([
  "dashboard_summary",
  "get_business_document_settings",
  "get_current_subscription_access",
  "get_current_user_permissions",
  "get_current_user_role_keys",
  "get_current_user_role_names",
  "get_field_projects",
  "get_field_site_surveys",
  "get_field_staff_options",
  "get_generated_document",
  "get_organization_settings",
  "get_payment_due_items",
  "get_settings_roles",
  "get_settings_staff",
  "inventory_batch_history",
  "inventory_item_public_rows",
  "inventory_low_stock_report",
  "lead_status_report",
  "list_my_in_app_notifications",
  "my_in_app_notification_unread_count",
  "payment_report",
  "platform_dashboard_summary",
  "platform_epc_company_detail",
  "platform_epc_company_directory",
  "preview_record_lifecycle",
  "product_bank_public_page",
  "product_bank_public_rows",
  "product_bank_filter_options",
  "product_catalog_public_rows",
  "product_category_public_rows",
  "project_status_report",
  "purchase_order_public_rows",
  "purchase_vendor_options",
  "sales_report",
]);

/**
 * PostgREST can briefly reject a freshly issued Supabase token when its
 * validator clock is behind the Auth service clock. Replay only that specific
 * response; other authentication and API failures must remain unchanged.
 */
export async function fetchWithJwtFutureRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const requestKey = await readRequestKey(input, init);

  if (!requestKey) {
    // A successful write may affect any previously loaded workspace data.
    // Clearing this small, short-lived cache avoids stale records while still
    // making immediate back-navigation fast.
    cachedReadResponses.clear();
    return fetchWithJwtFutureRetryOnce(input, init);
  }

  const cachedResponse = cachedReadResponses.get(requestKey);
  if (cachedResponse && cachedResponse.expiresAt > Date.now()) {
    return cachedResponse.response.clone();
  }
  if (cachedResponse) cachedReadResponses.delete(requestKey);

  let pending = pendingReadRequests.get(requestKey);
  if (!pending) {
    pending = fetchWithJwtFutureRetryOnce(input, init);
    pendingReadRequests.set(requestKey, pending);
    void pending.then(
      () => pendingReadRequests.delete(requestKey),
      () => pendingReadRequests.delete(requestKey),
    );
  }

  const response = await pending;
  if (response.ok) {
    cachedReadResponses.set(requestKey, {
      expiresAt: Date.now() + readResponseCacheTtlMs,
      response: response.clone(),
    });
  }

  // Response bodies are single-use. Each caller receives its own clone while
  // the underlying network request remains shared or cached.
  return response.clone();
}

async function fetchWithJwtFutureRetryOnce(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  let retryInit = init;
  let attemptedSessionRefresh = false;

  for (let attempt = 0; ; attempt += 1) {
    const response = await globalThis.fetch(
      cloneRequestInput(input),
      retryInit,
    );

    if (
      !(await isJwtIssuedAtFutureResponse(response)) ||
      attempt >= jwtFutureRetryDelaysMs.length
    ) {
      return response;
    }

    if (!attemptedSessionRefresh) {
      attemptedSessionRefresh = true;
      const accessToken = await refreshSession();

      if (accessToken) {
        retryInit = withAccessToken(input, retryInit, accessToken);
      }
    }

    await wait(jwtFutureRetryDelaysMs[attempt]);
  }
}

async function readRequestKey(input: RequestInfo | URL, init?: RequestInit) {
  const request = typeof Request !== "undefined" && input instanceof Request
    ? input
    : null;
  const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
  const url = typeof input === "string"
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;
  const parsedUrl = new URL(url, globalThis.location?.origin);
  const isGetOrHead = method === "GET" || method === "HEAD";
  const rpcName = parsedUrl.pathname.match(/\/rest\/v1\/rpc\/([^/]+)$/)?.[1];
  const isApprovedReadRpc = method === "POST" &&
    Boolean(rpcName && readOnlyRpcNames.has(rpcName));

  if (!isGetOrHead && !isApprovedReadRpc) return null;

  const headers = new Headers(init?.headers ?? request?.headers);
  const body = typeof init?.body === "string"
    ? init.body
    : request && method === "POST"
      ? await request.clone().text()
      : "";

  // Keep auth and representation context in the key so results cannot cross
  // users or queries that request a different response shape. Entries are
  // held only in memory for a few seconds.
  const representation = [
    "Accept",
    "Accept-Profile",
    "Content-Profile",
    "Prefer",
    "Range",
    "Range-Unit",
  ].map((name) => `${name}=${headers.get(name) ?? ""}`).join(";");
  return `${method}:${parsedUrl.toString()}:${headers.get("Authorization") ?? ""}:${representation}:${body}`;
}

export function clearSupabaseReadCache() {
  cachedReadResponses.clear();
}

export function registerSupabaseSessionRefresh(refresh: SessionRefresh | null) {
  sessionRefresh = refresh;
}

export function isJwtIssuedAtFutureMessage(message: string) {
  return message.toLowerCase().includes("jwt issued at future");
}

async function isJwtIssuedAtFutureResponse(response: Response) {
  if (response.status !== 401) {
    return false;
  }

  const payload = (await response.clone().json().catch(() => null)) as
    | { code?: unknown; message?: unknown }
    | null;

  return Boolean(
    payload &&
      (payload.code === "PGRST303" ||
        (typeof payload.message === "string" &&
          isJwtIssuedAtFutureMessage(payload.message))),
  );
}

function cloneRequestInput(input: RequestInfo | URL): RequestInfo | URL {
  return typeof Request !== "undefined" && input instanceof Request
    ? input.clone()
    : input;
}

async function refreshSession() {
  if (!sessionRefresh) {
    return null;
  }

  if (!pendingSessionRefresh) {
    pendingSessionRefresh = sessionRefresh()
      .catch(() => null)
      .finally(() => {
        pendingSessionRefresh = null;
      });
  }

  return pendingSessionRefresh;
}

function withAccessToken(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  accessToken: string,
): RequestInit {
  const headers = new Headers(
    init?.headers ??
      (typeof Request !== "undefined" && input instanceof Request
        ? input.headers
        : undefined),
  );
  headers.set("Authorization", `Bearer ${accessToken}`);

  return { ...init, headers };
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, milliseconds);
  });
}
