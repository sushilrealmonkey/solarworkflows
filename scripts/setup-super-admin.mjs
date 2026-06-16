import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const envFiles = [".env.local", ".env"];

for (const file of envFiles) {
  if (!existsSync(file)) {
    continue;
  }

  const lines = readFileSync(file, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    const value = rawValue.replace(/^["']|["']$/g, "");

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = normalizeEmail(process.env.SUPER_ADMIN_EMAIL ?? "");
const fullName = process.env.SUPER_ADMIN_FULL_NAME?.trim() || "Super Admin";
const providedPassword = process.env.SUPER_ADMIN_PASSWORD?.trim();
const password = providedPassword || generatePassword();

if (!supabaseUrl) {
  fail("Set SUPABASE_URL or VITE_SUPABASE_URL before running this script.");
}

if (!serviceRoleKey) {
  fail("Set SUPABASE_SERVICE_ROLE_KEY before running this script.");
}

if (!email) {
  fail("Set SUPER_ADMIN_EMAIL before running this script.");
}

const adminClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

const user = await upsertAuthUser();
await upsertSuperAdminProfile(user.id);

console.log("Super admin credentials are ready.");
console.log(`Email: ${email}`);
console.log(`Password: ${password}`);
console.log(`Auth user ID: ${user.id}`);

async function upsertAuthUser() {
  const existingUser = await findUserByEmail(email);

  if (existingUser) {
    const { data, error } = await adminClient.auth.admin.updateUserById(
      existingUser.id,
      {
        email,
        password,
        email_confirm: true,
        user_metadata: {
          ...existingUser.user_metadata,
          full_name: fullName,
        },
      },
    );

    if (error) {
      fail(error.message);
    }

    return data.user;
  }

  const { data, error } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: fullName,
    },
  });

  if (error) {
    fail(error.message);
  }

  return data.user;
}

async function findUserByEmail(targetEmail) {
  let page = 1;
  const perPage = 100;

  while (page <= 100) {
    const { data, error } = await adminClient.auth.admin.listUsers({
      page,
      perPage,
    });

    if (error) {
      fail(error.message);
    }

    const user = data.users.find(
      (candidate) => normalizeEmail(candidate.email ?? "") === targetEmail,
    );

    if (user) {
      return user;
    }

    if (data.users.length < perPage) {
      return null;
    }

    page += 1;
  }

  fail("Could not find user by email within the first 10,000 auth users.");
}

async function upsertSuperAdminProfile(userId) {
  const profilePayload = {
    auth_user_id: userId,
    full_name: fullName,
    email,
    status: "active",
    is_super_admin: true,
    email_verified: true,
    onboarded_at: new Date().toISOString(),
  };

  const { data: existingProfiles, error: findProfileError } = await adminClient
    .from("users_profile")
    .select("id")
    .or(`auth_user_id.eq.${userId},email.eq.${email}`)
    .limit(1);

  if (findProfileError) {
    fail(findProfileError.message);
  }

  if (existingProfiles?.[0]?.id) {
    const { error } = await adminClient
      .from("users_profile")
      .update(profilePayload)
      .eq("id", existingProfiles[0].id);

    if (error) {
      fail(error.message);
    }
  } else {
    const { error } = await adminClient
      .from("users_profile")
      .insert(profilePayload);

    if (error) {
      fail(error.message);
    }
  }

  const legacyProfilePayload = {
    id: userId,
    full_name: fullName,
    email,
    status: "active",
    is_super_admin: true,
  };

  const { error: profileError } = await adminClient
    .from("profiles")
    .upsert(legacyProfilePayload, { onConflict: "id" });

  if (profileError) {
    fail(profileError.message);
  }

  const { error: platformAdminError } = await adminClient
    .from("platform_admins")
    .upsert(
      {
        id: userId,
        user_id: userId,
        full_name: fullName,
        email,
        status: "active",
      },
      { onConflict: "id" },
    );

  if (platformAdminError) {
    fail(platformAdminError.message);
  }
}

function normalizeEmail(value) {
  return value.trim().toLowerCase();
}

function generatePassword() {
  return `SW-${randomBytes(18).toString("base64url")}`;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
