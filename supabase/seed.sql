insert into public.modules (module_key, module_name, description, sort_order, is_active)
values
  ('companies', 'Companies', 'Client company management', 10, true),
  ('users', 'Users', 'Company user management', 20, true),
  ('permissions', 'Permissions', 'Role and permission management', 30, true),
  ('domains', 'Domains', 'Subdomain and custom domain management', 40, true),
  ('clients', 'Clients', 'Solar customer records', 50, true),
  ('quotations', 'Quotations', 'Quote creation and tracking', 60, true),
  ('invoices', 'Invoices', 'Invoice creation and tracking', 70, true),
  ('payments', 'Payments', 'Payment tracking', 80, true),
  ('bank_financing', 'Bank Financing', 'Bank finance workflow tracking', 90, true),
  ('inventory', 'Inventory', 'Inventory and stock management', 100, true),
  ('purchases', 'Purchases', 'Purchase records and approvals', 110, true),
  ('vendors', 'Vendors', 'Vendor management', 120, true),
  ('projects', 'Projects', 'Solar project management', 130, true),
  ('project_stages', 'Project Stages', 'Project stage tracking', 140, true),
  ('expenses', 'Expenses', 'Company expense tracking', 150, true),
  ('contractors', 'Contractors', 'Contractor management', 160, true),
  ('contractor_payouts', 'Contractor Payouts', 'Contractor payout tracking', 170, true),
  ('discom_subsidy', 'DISCOM Subsidy', 'DISCOM and subsidy workflow tracking', 180, true),
  ('documents', 'Documents', 'Document storage and access', 190, true),
  ('dashboard_reports', 'Dashboard Reports', 'Dashboard and reporting access', 200, true),
  ('activity_logs', 'Activity Logs', 'Activity log access', 210, true),
  ('notifications', 'Notifications', 'Notification access and management', 220, true)
on conflict (module_key) do update
set
  module_name = excluded.module_name,
  description = excluded.description,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active;

insert into public.permissions (module_id, action_key, action_name)
select
  modules.id,
  actions.action_key,
  actions.action_name
from public.modules
cross join (
  values
    ('view', 'View'),
    ('create', 'Create'),
    ('edit', 'Edit'),
    ('delete', 'Delete'),
    ('export', 'Export'),
    ('approve', 'Approve')
) as actions(action_key, action_name)
where modules.module_key in (
  'companies',
  'users',
  'permissions',
  'domains',
  'clients',
  'quotations',
  'invoices',
  'payments',
  'bank_financing',
  'inventory',
  'purchases',
  'vendors',
  'projects',
  'project_stages',
  'expenses',
  'contractors',
  'contractor_payouts',
  'discom_subsidy',
  'documents',
  'dashboard_reports',
  'activity_logs',
  'notifications'
)
on conflict (module_id, action_key) do update
set action_name = excluded.action_name;
