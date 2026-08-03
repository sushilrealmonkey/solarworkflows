export type PlatformStaffRole = "backend_staff";

export type PlatformStaff = {
  id: string;
  full_name: string | null;
  email: string | null;
  status: string | null;
  platform_role: PlatformStaffRole;
  invited_at: string | null;
  last_login_at: string | null;
};
