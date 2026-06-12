import { supabase } from "./supabaseClient";

export type SyncedProfile = {
  id: string;
  auth_user_id: string | null;
  organization_id: string | null;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  status: string | null;
  is_super_admin: boolean | null;
};

export type LoginAccessResult =
  | { status: "active"; profile: SyncedProfile }
  | { status: "unassigned"; message: string }
  | { status: "inactive"; profile: SyncedProfile; message: string };

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function isValidLoginEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));
}

export function isValidPassword(password: string) {
  return password.length > 0;
}

export async function signInWithPasswordAndSyncProfile(
  email: string,
  password: string,
): Promise<LoginAccessResult> {
  if (!supabase) {
    throw new Error("Supabase environment variables are not configured.");
  }

  const normalizedEmail = normalizeEmail(email);

  if (!isValidLoginEmail(normalizedEmail)) {
    throw new Error("Enter a valid email address.");
  }

  if (!isValidPassword(password)) {
    throw new Error("Enter your password.");
  }

  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: normalizedEmail,
    password,
  });

  if (signInError) {
    throw new Error(mapPasswordError(signInError.message));
  }

  const { data: syncedProfile, error: syncError } = await supabase.rpc(
    "sync_auth_user_profile",
  );

  if (syncError) {
    await supabase.auth.signOut();
    return {
      status: "unassigned",
      message: "Access not assigned",
    };
  }

  const profile = syncedProfile as SyncedProfile | null;

  if (!profile) {
    await supabase.auth.signOut();
    return {
      status: "unassigned",
      message: "Access not assigned",
    };
  }

  if (profile.status !== "active") {
    await supabase.auth.signOut();
    return {
      status: "inactive",
      profile,
      message: "Account inactive",
    };
  }

  return {
    status: "active",
    profile,
  };
}

function mapPasswordError(message: string) {
  const normalizedMessage = message.toLowerCase();

  if (
    normalizedMessage.includes("invalid login") ||
    normalizedMessage.includes("invalid credentials")
  ) {
    return "Email or password is incorrect.";
  }

  if (normalizedMessage.includes("email not confirmed")) {
    return "This account email is not confirmed.";
  }

  return message || "Supabase auth error. Please try again.";
}
