const VERIFY_TOKEN_ENV_NAME = "META_WHATSAPP_WEBHOOK_VERIFY_TOKEN";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);

  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const expectedToken = process.env[VERIFY_TOKEN_ENV_NAME];

  if (
    mode === "subscribe" &&
    token &&
    expectedToken &&
    token === expectedToken &&
    challenge
  ) {
    return new Response(challenge, {
      status: 200,
      headers: {
        "Content-Type": "text/plain",
      },
    });
  }

  return new Response("Webhook verification failed", {
    status: 403,
  });
}

export async function POST(request: Request): Promise<Response> {
  try {
    const payload: unknown = await request.json();

    console.info(
      "Meta WhatsApp webhook:",
      JSON.stringify(payload, null, 2),
    );

    // Incoming messages and message status updates will be processed here.

    return Response.json(
      { received: true },
      { status: 200 },
    );
  } catch (error) {
    console.error("WhatsApp webhook error:", error);

    return Response.json(
      { received: false },
      { status: 400 },
    );
  }
}
