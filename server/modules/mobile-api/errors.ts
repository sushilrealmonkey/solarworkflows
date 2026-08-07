export class MobileApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) { super(message); }
}
export function json(payload: unknown, status = 200, requestId?: string): Response {
  const headers: Record<string, string> = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
  if (requestId) headers["x-request-id"] = requestId;
  return new Response(JSON.stringify(payload), { status, headers });
}
export function errorResponse(error: unknown, requestId: string): Response {
  if (error instanceof MobileApiError) return json({ error: { code: error.code, message: error.message, requestId, details: error.details } }, error.status, requestId);
  console.error("Mobile API request failed", { requestId, error: error instanceof Error ? error.message : error });
  return json({ error: { code: "INTERNAL_ERROR", message: "The request could not be completed", requestId } }, 500, requestId);
}
