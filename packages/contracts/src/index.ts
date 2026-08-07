export type MobileModuleKey = "dashboard" | "customers" | "leads" | "site_surveys" | "quotations" | "projects" | "documents";
export type MobileActionKey = "view" | "create" | "update" | "delete";
export interface ApiErrorBody { error: { code: string; message: string; requestId: string; details?: unknown } }
export interface CursorPage<T> { data: T[]; page: { nextCursor: string | null; hasMore: boolean }; meta: { requestId: string; fetchedAt: string } }
export interface MobilePermission { module: MobileModuleKey; actions: MobileActionKey[] }
export interface SessionContext {
  user: { id: string; profileId: string; fullName: string | null; phone: string | null };
  tenant: { companyId: string; organizationId: string; name: string; status: string };
  branding: { logoUrl: string | null; primaryColor: string; secondaryColor: string; accentColor: string; timezone: string; currency: string };
  roles: string[]; permissions: MobilePermission[];
  subscription: { status: string; writeAllowed: boolean; enabledModules: string[] } | null;
}
export interface MobileRecordSummary { id: string; code: string | null; title: string; subtitle: string | null; status: string | null; updatedAt: string }
export type MobileResource = "customers" | "enquiries" | "site-surveys" | "quotations" | "projects" | "documents";
