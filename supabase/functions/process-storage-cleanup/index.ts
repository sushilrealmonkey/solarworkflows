import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type CleanupRow = {
  id: string;
  bucket_name: string;
  object_path: string;
};

Deno.serve(async (request) => {
  if (request.method !== "POST") return response({ error: "Method not allowed" }, 405);
  const configuredSecret = Deno.env.get("STORAGE_CLEANUP_SECRET")?.trim();
  if (!configuredSecret || request.headers.get("x-cleanup-secret") !== configuredSecret) {
    return response({ error: "Unauthorized" }, 401);
  }

  const url = requireEnv("SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const client = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data, error } = await client.rpc("claim_storage_cleanup", { batch_size: 25 });
  if (error) return response({ error: error.message }, 500);

  let completed = 0;
  let failed = 0;
  for (const row of (data ?? []) as CleanupRow[]) {
    const removeResult = await client.storage.from(row.bucket_name).remove([row.object_path]);
    const failure = removeResult.error?.message ?? null;
    const completion = await client.rpc("complete_storage_cleanup", {
      queue_id: row.id,
      failure_message: failure,
    });
    if (failure || completion.error) {
      failed += 1;
      if (completion.error && !failure) {
        await client.rpc("complete_storage_cleanup", {
          queue_id: row.id,
          failure_message: completion.error.message,
        });
      }
    } else {
      completed += 1;
    }
  }

  return response({ claimed: (data ?? []).length, completed, failed });
});

function requireEnv(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

