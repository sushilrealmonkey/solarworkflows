import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  GET as verifyWhatsAppWebhook,
  POST as receiveWhatsAppWebhook,
} from "./modules/whatsapp/webhook.js";

const WHATSAPP_WEBHOOK_PATH = "/api/webhooks/whatsapp";
const MAX_WEBHOOK_BODY_BYTES = 1_000_000;
const DIST_DIRECTORY = resolve(
  fileURLToPath(new URL("../dist", import.meta.url)),
);
const INDEX_FILE = resolve(DIST_DIRECTORY, "index.html");
const PORT = parsePort(process.env.PORT);

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

class PayloadTooLargeError extends Error {}

function parsePort(rawPort: string | undefined): number {
  const parsedPort = Number(rawPort ?? "3000");

  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65_535) {
    throw new Error(`Invalid PORT value: ${rawPort}`);
  }

  return parsedPort;
}

function getRequestUrl(request: IncomingMessage): URL {
  const forwardedProtocol = request.headers["x-forwarded-proto"];
  const protocol =
    (Array.isArray(forwardedProtocol)
      ? forwardedProtocol[0]
      : forwardedProtocol?.split(",")[0]
    )?.trim() || "http";
  const host = request.headers.host ?? `localhost:${PORT}`;

  return new URL(request.url ?? "/", `${protocol}://${host}`);
}

function toFetchHeaders(headers: IncomingHttpHeaders): Headers {
  const fetchHeaders = new Headers();

  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        fetchHeaders.append(name, item);
      }
    } else if (value !== undefined) {
      fetchHeaders.set(name, value);
    }
  }

  return fetchHeaders;
}

async function readRequestBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;

    if (size > MAX_WEBHOOK_BODY_BYTES) {
      throw new PayloadTooLargeError();
    }

    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
}

async function sendFetchResponse(
  response: Response,
  serverResponse: ServerResponse,
): Promise<void> {
  serverResponse.statusCode = response.status;
  response.headers.forEach((value, name) => {
    serverResponse.setHeader(name, value);
  });

  const body = Buffer.from(await response.arrayBuffer());
  serverResponse.end(body);
}

function sendJson(
  response: ServerResponse,
  status: number,
  payload: unknown,
): void {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

async function handleWhatsAppWebhook(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
): Promise<void> {
  if (request.method !== "GET" && request.method !== "POST") {
    response.writeHead(405, {
      Allow: "GET, POST",
      "Content-Type": "text/plain; charset=utf-8",
    });
    response.end("Method not allowed");
    return;
  }

  const requestInit: RequestInit = {
    method: request.method,
    headers: toFetchHeaders(request.headers),
  };

  if (request.method === "POST") {
    requestInit.body = await readRequestBody(request);
  }

  const fetchRequest = new Request(requestUrl, requestInit);
  const fetchResponse =
    request.method === "GET"
      ? await verifyWhatsAppWebhook(fetchRequest)
      : await receiveWhatsAppWebhook(fetchRequest);

  await sendFetchResponse(fetchResponse, response);
}

function isPathInsideDist(filePath: string): boolean {
  return (
    filePath === DIST_DIRECTORY ||
    filePath.startsWith(`${DIST_DIRECTORY}${sep}`)
  );
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

function serveFile(
  request: IncomingMessage,
  response: ServerResponse,
  filePath: string,
): void {
  const contentType =
    CONTENT_TYPES[extname(filePath).toLowerCase()] ??
    "application/octet-stream";

  response.writeHead(200, {
    "Cache-Control": filePath === INDEX_FILE
      ? "no-cache"
      : "public, max-age=31536000, immutable",
    "Content-Type": contentType,
  });

  if (request.method === "HEAD") {
    response.end();
    return;
  }

  createReadStream(filePath).pipe(response);
}

async function serveFrontend(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
): Promise<void> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, {
      Allow: "GET, HEAD",
      "Content-Type": "text/plain; charset=utf-8",
    });
    response.end("Method not allowed");
    return;
  }

  let pathname: string;

  try {
    pathname = decodeURIComponent(requestUrl.pathname);
  } catch {
    response.writeHead(400, {
      "Content-Type": "text/plain; charset=utf-8",
    });
    response.end("Invalid URL");
    return;
  }

  const requestedFile = resolve(DIST_DIRECTORY, `.${pathname}`);

  if (!isPathInsideDist(requestedFile)) {
    response.writeHead(403, {
      "Content-Type": "text/plain; charset=utf-8",
    });
    response.end("Forbidden");
    return;
  }

  if (await isFile(requestedFile)) {
    serveFile(request, response, requestedFile);
    return;
  }

  if (extname(pathname)) {
    response.writeHead(404, {
      "Content-Type": "text/plain; charset=utf-8",
    });
    response.end("Not found");
    return;
  }

  serveFile(request, response, INDEX_FILE);
}

const server = createServer(async (request, response) => {
  try {
    const requestUrl = getRequestUrl(request);

    if (requestUrl.pathname === WHATSAPP_WEBHOOK_PATH) {
      await handleWhatsAppWebhook(request, response, requestUrl);
      return;
    }

    if (requestUrl.pathname.startsWith("/api/")) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }

    await serveFrontend(request, response, requestUrl);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      sendJson(response, 413, { received: false });
      return;
    }

    console.error("Server request error:", error);

    if (!response.headersSent) {
      sendJson(response, 500, { error: "Internal server error" });
    } else {
      response.end();
    }
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.info(`Server listening on port ${PORT}`);
});
