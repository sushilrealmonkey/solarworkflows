export type LifecycleModuleKey =
  | "customers"
  | "leads"
  | "site_surveys"
  | "quotations"
  | "projects"
  | "payments"
  | "b2b_sales"
  | "proforma_invoices"
  | "invoices"
  | "purchase_orders"
  | "vendors"
  | "inventory_items"
  | "documents"
  | "products"
  | "product_categories"
  | "bom_templates";

export type LifecycleAction = "archive" | "restore" | "delete";
export type ArchiveScope = "active" | "archived" | "all";

export type ArchiveMetadata = {
  archived_at?: string | null;
  archived_by?: string | null;
  archive_reason?: string | null;
};

export type LifecycleDependency = {
  kind: "owned" | "open" | "historical";
  module_key: string;
  count: number;
  route: string | null;
  guidance: string;
  record_id: string | null;
  label: string | null;
};

export type LifecyclePreview = {
  allowed: boolean;
  module_key: LifecycleModuleKey;
  record_id: string;
  label: string;
  action: LifecycleAction;
  business_status: string;
  archived_at: string | null;
  recommended_action: string;
  owned_child_count: number;
  blocking_dependency_count: number;
  dependencies: LifecycleDependency[];
  guidance: string;
  confirmation: string;
};

