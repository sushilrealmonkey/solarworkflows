const jwtFutureRetryDelaysMs = [1_000, 2_000, 4_000, 8_000] as const;

/**
 * PostgREST can briefly reject a freshly issued Supabase token when its
 * validator clock is behind the Auth service clock. Replay only that specific
 * response; other authentication and API failures must remain unchanged.
 */
export async function fetchWithJwtFutureRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    const response = await globalThis.fetch(cloneRequestInput(input), init);

    if (
      !(await isJwtIssuedAtFutureResponse(response)) ||
      attempt >= jwtFutureRetryDelaysMs.length
    ) {
      return response;
    }

    await wait(jwtFutureRetryDelaysMs[attempt]);
  }
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

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, milliseconds);
  });
}
