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

export type SignupResult =
  | LoginAccessResult
  | { status: "confirmation_required"; message: string };

export type WorkspaceOnboardingInput = {
  workspaceName: string;
  fullName: string;
  phone: string;
};

export type WorkspaceOnboardingResult = {
  organization_id: string;
  company_id: string;
  workspace_slug: string;
  admin_role_id: string;
  admin_profile_id: string;
};

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

export function normalizePhone(phone: string) {
  return phone.trim().replace(/\s+/g, " ");
}

export function isValidPhoneNumber(phone: string) {
  return /^[0-9+() -]{6,20}$/.test(normalizePhone(phone));
}

export function normalizeSmsPhone(phone: string) {
  return normalizePhone(phone).replace(/[() .-]/g, "");
}

export function isValidSmsPhone(phone: string) {
  return /^\+[1-9]\d{7,14}$/.test(normalizeSmsPhone(phone));
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
    if (!syncError.message.toLowerCase().includes("no invited user profile")) {
      throw new Error(syncError.message);
    }

    return {
      status: "unassigned",
      message: "Workspace setup required",
    };
  }

  const profile = syncedProfile as SyncedProfile | null;

  if (!profile) {
    return {
      status: "unassigned",
      message: "Workspace setup required",
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

export async function signUpWithPasswordAndSyncProfile(
  email: string,
  password: string,
  emailRedirectTo: string,
): Promise<SignupResult> {
  if (!supabase) {
    throw new Error("Supabase environment variables are not configured.");
  }

  const normalizedEmail = normalizeEmail(email);

  if (!isValidLoginEmail(normalizedEmail)) {
    throw new Error("Enter a valid email address.");
  }

  if (!isValidNewPassword(password)) {
    throw new Error("Use at least 8 characters for your password.");
  }

  const { data, error } = await supabase.auth.signUp({
    email: normalizedEmail,
    password,
    options: {
      emailRedirectTo,
    },
  });

  if (error) {
    throw new Error(mapPasswordError(error.message));
  }

  if (!data.session) {
    return {
      status: "confirmation_required",
      message:
        "Check your inbox and confirm your email address to finish creating your account.",
    };
  }

  return syncCurrentAuthUserProfile();
}

export async function requestPhoneSignupOtp(phone: string) {
  if (!supabase) {
    throw new Error("Supabase environment variables are not configured.");
  }

  const normalizedPhone = normalizeSmsPhone(phone);

  if (!isValidSmsPhone(normalizedPhone)) {
    throw new Error("Enter a mobile number with its country code.");
  }

  const { error } = await supabase.auth.signInWithOtp({
    phone: normalizedPhone,
    options: {
      shouldCreateUser: true,
    },
  });

  if (error) {
    throw new Error(mapPhoneAuthError(error.message));
  }
}

export async function verifyPhoneSignupOtpAndSyncProfile(
  phone: string,
  token: string,
): Promise<LoginAccessResult> {
  if (!supabase) {
    throw new Error("Supabase environment variables are not configured.");
  }

  const normalizedPhone = normalizeSmsPhone(phone);
  const normalizedToken = token.trim();

  if (!isValidSmsPhone(normalizedPhone)) {
    throw new Error("Enter a mobile number with its country code.");
  }

  if (!/^\d{6}$/.test(normalizedToken)) {
    throw new Error("Enter the 6-digit SMS code.");
  }

  const { error } = await supabase.auth.verifyOtp({
    phone: normalizedPhone,
    token: normalizedToken,
    type: "sms",
  });

  if (error) {
    throw new Error(mapPhoneAuthError(error.message));
  }

  return syncCurrentAuthUserProfile();
}

export async function signInWithGoogle(redirectTo: string) {
  if (!supabase) {
    throw new Error("Supabase environment variables are not configured.");
  }

  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
    },
  });

  if (error) {
    throw new Error(mapOAuthError(error.message));
  }
}

export async function createEpcWorkspaceForCurrentUser(
  input: WorkspaceOnboardingInput,
): Promise<WorkspaceOnboardingResult> {
  if (!supabase) {
    throw new Error("Supabase environment variables are not configured.");
  }

  const workspaceName = input.workspaceName.trim().replace(/\s+/g, " ");
  const fullName = input.fullName.trim().replace(/\s+/g, " ");
  const phone = normalizePhone(input.phone);

  if (workspaceName.length < 2 || workspaceName.length > 120) {
    throw new Error("Workspace name must be between 2 and 120 characters.");
  }

  if (fullName.length < 2 || fullName.length > 120) {
    throw new Error("Full name must be between 2 and 120 characters.");
  }

  if (phone && !isValidPhoneNumber(phone)) {
    throw new Error("Enter a valid phone number.");
  }

  const { data, error } = await supabase.rpc("self_create_epc_workspace", {
    workspace_name: workspaceName,
    admin_full_name: fullName,
    admin_phone: phone || null,
  });

  if (error) {
    throw new Error(mapWorkspaceOnboardingError(error.message));
  }

  if (!data || typeof data !== "object") {
    throw new Error("The workspace could not be created. Please try again.");
  }

  return data as WorkspaceOnboardingResult;
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

function mapOAuthError(message: string) {
  const normalizedMessage = message.toLowerCase();

  if (
    normalizedMessage.includes("provider is not enabled") ||
    normalizedMessage.includes("unsupported provider")
  ) {
    return "Google login is not enabled for this Supabase project yet.";
  }

  return message || "Google login could not be started. Please try again.";
}

function mapPhoneAuthError(message: string) {
  const normalizedMessage = message.toLowerCase();

  if (
    normalizedMessage.includes("provider is not enabled") ||
    normalizedMessage.includes("unsupported provider") ||
    normalizedMessage.includes("sms provider")
  ) {
    return "SMS signup is not enabled for this Supabase project yet.";
  }

  if (normalizedMessage.includes("rate limit")) {
    return "Please wait before requesting another SMS code.";
  }

  if (
    normalizedMessage.includes("invalid phone") ||
    normalizedMessage.includes("phone number")
  ) {
    return "Enter a valid mobile number with its country code.";
  }

  if (
    normalizedMessage.includes("token") ||
    normalizedMessage.includes("otp") ||
    normalizedMessage.includes("expired")
  ) {
    return "That SMS code is invalid or expired. Request a new code.";
  }

  return message || "SMS verification could not be completed. Please try again.";
}

function mapWorkspaceOnboardingError(message: string) {
  const normalizedMessage = message.toLowerCase();

  if (
    normalizedMessage.includes("verified email or phone") ||
    normalizedMessage.includes("verified email address")
  ) {
    return "Verify your email address or mobile number before creating a workspace.";
  }

  if (normalizedMessage.includes("already has workspace access")) {
    return "This account already has workspace access. Refresh and sign in again.";
  }

  if (normalizedMessage.includes("email is already assigned")) {
    return "This email is already assigned to a workspace. Sign in or ask an administrator for help.";
  }

  if (normalizedMessage.includes("phone number is already assigned")) {
    return "This phone number is already assigned to another account.";
  }

  return message || "The workspace could not be created. Please try again.";
}
