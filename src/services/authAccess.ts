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

let otpVerification:
  | {
      tokenHash: string;
      type: "invite" | "recovery";
      promise: Promise<void>;
    }
  | null = null;

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function isValidLoginEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));
}

export function isValidPassword(password: string) {
  return password.length > 0;
}

export function isValidNewPassword(password: string) {
  return password.length >= 8;
}

export function verifyInviteToken(
  tokenHash: string,
  type: "invite" | "recovery",
) {
  if (!supabase) {
    return Promise.reject(
      new Error("Supabase environment variables are not configured."),
    );
  }

  const normalizedTokenHash = tokenHash.trim();

  if (!normalizedTokenHash) {
    return Promise.reject(new Error("The invite token is missing."));
  }

  if (
    otpVerification?.tokenHash === normalizedTokenHash &&
    otpVerification.type === type
  ) {
    return otpVerification.promise;
  }

  const promise = (async () => {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: normalizedTokenHash,
      type,
    });

    if (error) {
      throw new Error(mapInviteError(error.message));
    }
  })().catch((error: unknown) => {
    if (otpVerification?.tokenHash === normalizedTokenHash) {
      otpVerification = null;
    }

    throw error;
  });

  otpVerification = {
    tokenHash: normalizedTokenHash,
    type,
    promise,
  };

  return promise;
}

export async function sendPasswordResetLink(
  email: string,
  redirectTo: string,
) {
  if (!supabase) {
    throw new Error("Supabase environment variables are not configured.");
  }

  const normalizedEmail = normalizeEmail(email);

  if (!isValidLoginEmail(normalizedEmail)) {
    throw new Error("Enter a valid email address.");
  }

  const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
    redirectTo,
  });

  if (error) {
    throw new Error(mapPasswordResetError(error.message));
  }
}

export async function syncCurrentAuthUserProfile(): Promise<LoginAccessResult> {
  if (!supabase) {
    throw new Error("Supabase environment variables are not configured.");
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

  return syncCurrentAuthUserProfile();
}

export async function completeInvitedPassword(
  password: string,
): Promise<LoginAccessResult> {
  if (!supabase) {
    throw new Error("Supabase environment variables are not configured.");
  }

  if (!isValidNewPassword(password)) {
    throw new Error("Use at least 8 characters for your password.");
  }

  const { error } = await supabase.auth.updateUser({
    password,
  });

  if (error) {
    throw new Error(mapPasswordError(error.message));
  }

  return syncCurrentAuthUserProfile();
}

export async function completePasswordReset(password: string) {
  if (!supabase) {
    throw new Error("Supabase environment variables are not configured.");
  }

  if (!isValidNewPassword(password)) {
    throw new Error("Use at least 8 characters for your password.");
  }

  const { error } = await supabase.auth.updateUser({
    password,
  });

  if (error) {
    throw new Error(mapPasswordError(error.message));
  }

  await supabase.auth.signOut();
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

  if (normalizedMessage.includes("user already registered")) {
    return "This email is already registered. Sign in instead.";
  }

  return message || "Supabase auth error. Please try again.";
}

function mapInviteError(message: string) {
  const normalizedMessage = message.toLowerCase();

  if (
    normalizedMessage.includes("expired") ||
    normalizedMessage.includes("invalid")
  ) {
    return "This invite link is invalid or has already been used. Ask your administrator to send a new setup email.";
  }

  return message || "The invitation could not be verified. Please request a new setup email.";
}

function mapPasswordResetError(message: string) {
  const normalizedMessage = message.toLowerCase();

  if (normalizedMessage.includes("rate limit")) {
    return "Please wait a moment before requesting another reset link.";
  }

  return message || "The password reset email could not be sent. Please try again.";
}
