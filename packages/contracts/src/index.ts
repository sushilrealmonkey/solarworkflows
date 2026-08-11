export type MobileModuleKey = "dashboard" | "assistant" | "customers" | "leads" | "site_surveys" | "quotations" | "projects" | "b2b_sales" | "product_master" | "product_pricing" | "inventory" | "vendors" | "purchases" | "invoices" | "payments" | "documents" | "staff" | "reports" | "settings";
export type MobileActionKey = "view" | "create" | "update" | "delete" | "assign" | "update_status" | "update_technical" | "upload_evidence" | "fulfill" | "receive" | "correct_stock" | "view_financials" | "manage_pricing";
export type MobileRecordScope = "company" | "assigned_or_unassigned_created" | "related_operations" | "related_finance" | "assigned_field";
export interface ApiErrorBody { error: { code: string; message: string; requestId: string; details?: unknown } }
export interface CursorPage<T> { data: T[]; page: { nextCursor: string | null; hasMore: boolean }; meta: { requestId: string; fetchedAt: string } }
export interface MobilePermission { module: MobileModuleKey; actions: MobileActionKey[]; scopes: MobileRecordScope[] }
export type PlanAccessLevel = "full" | "read_only" | "locked";
export interface SessionContext {
  user: { id: string; profileId: string; fullName: string | null; phone: string | null };
  tenant: { companyId: string; organizationId: string; name: string; status: string };
  branding: { logoUrl: string | null; primaryColor: string; secondaryColor: string; accentColor: string; timezone: string; currency: string };
  roles: string[]; permissions: MobilePermission[];
  subscription: {
    status: string;
    writeAllowed: boolean;
    enabledModules: string[];
    moduleAccess: Record<string, PlanAccessLevel>;
    capabilityAccess: Record<string, PlanAccessLevel>;
    seatLimit: number | null;
    seatsUsed: number;
  } | null;
}
export interface MobileRecordSummary { id: string; code: string | null; title: string; subtitle: string | null; status: string | null; updatedAt: string }
export type MobileResource = "customers" | "enquiries" | "site-surveys" | "quotations" | "projects" | "documents";
