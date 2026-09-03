export type PasswordSetupLinkKind = "token" | "error" | "none";
export type PasswordSetupVerificationStatus =
  | "pending"
  | "verifying"
  | "complete";

export function isPasswordSetupLinkAwaitingVerification(
  linkKind: PasswordSetupLinkKind,
  verificationStatus: PasswordSetupVerificationStatus,
) {
  return linkKind === "token" && verificationStatus === "pending";
}

export function shouldRedirectReadyPasswordSetupUser(
  isReady: boolean,
  linkKind: PasswordSetupLinkKind,
) {
  return isReady && linkKind === "none";
}

export function hasVerifiedPasswordSetupSession({
  hasSession,
  isVerifying,
  linkKind,
  verificationStatus,
}: {
  hasSession: boolean;
  isVerifying: boolean;
  linkKind: PasswordSetupLinkKind;
  verificationStatus: PasswordSetupVerificationStatus;
}) {
  return (
    hasSession &&
    !isVerifying &&
    (linkKind !== "token" || verificationStatus === "complete")
  );
}
