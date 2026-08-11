-- Record-scoped CRM/ERP authorization.
-- Functional permissions, row scope, field projection, and subscription
-- entitlement are independent boundaries. Field users never read the base
-- projects/site_surveys tables; they use the safe RPCs defined below.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

alter table public.projects
  add column if not exists company_id uuid references public.companies(id) on delete cascade,
  add column if not exists field_released_at timestamptz,
  add column if not exists field_notes text;

alter table public.site_surveys
  add column if not exists company_id uuid references public.companies(id) on delete cascade;

alter table public.quotations
  add column if not exists company_id uuid references public.companies(id) on delete cascade,
  add column if not exists assigned_to uuid references public.users_profile(id) on delete set null;

alter table public.b2b_sales
  add column if not exists assigned_to uuid references public.users_profile(id) on delete set null;

alter table public.documents
  add column if not exists company_id uuid references public.companies(id) on delete cascade,
  add column if not exists b2b_sale_id uuid references public.b2b_sales(id) on delete set null;

update public.projects
set company_id = organizations.company_id
from public.organizations
where projects.organization_id = organizations.id
  and projects.company_id is distinct from organizations.company_id;

update public.projects
set field_released_at = coalesce(updated_at, created_at, now())
where field_released_at is null
  and project_status in (
    'installation_scheduled','installation_in_progress','installation_completed',
    'inspection_pending','inspection_completed','net_metering_pending','commissioned'
  );

update public.site_surveys
set company_id = organizations.company_id
from public.organizations
where site_surveys.organization_id = organizations.id
  and site_surveys.company_id is distinct from organizations.company_id;

-- Tenant and owner columns are authorization metadata, not commercial terms.
-- Existing non-draft quotations are immutable through normal writes, so pause
-- that guard only for this migration's one-time metadata backfill.
drop trigger if exists protect_quotation_commercial_history on public.quotations;

update public.quotations
set company_id = organizations.company_id
from public.organizations
where quotations.organization_id = organizations.id
  and quotations.company_id is distinct from organizations.company_id;

-- Verified/generated files stay immutable to application users. Temporarily
-- pause the evidence guard only while adding their tenant authorization key.
drop trigger if exists protect_verified_document_evidence on public.documents;

update public.documents
set company_id = organizations.company_id
from public.organizations
where documents.organization_id = organizations.id
  and documents.company_id is distinct from organizations.company_id;

create trigger protect_verified_document_evidence
before update on public.documents
for each row
execute function public.protect_document_evidence();

update public.quotations q
set assigned_to = coalesce(
  (select c.assigned_to from public.customers c where c.id = q.customer_id),
  (select l.assigned_to from public.leads l where l.id = q.lead_id),
  q.created_by
)
where q.assigned_to is null;

create trigger protect_quotation_commercial_history
before update on public.quotations
for each row
execute function public.protect_non_draft_commercial_record();

update public.b2b_sales s
set assigned_to = coalesce(c.assigned_to, s.created_by)
from public.customers c
where c.id = s.customer_id
  and s.assigned_to is null;

do $$
begin
  if exists (select 1 from public.projects where company_id is null) then
    raise exception 'Cannot enforce projects.company_id: unresolved tenant rows exist';
  end if;
  if exists (select 1 from public.site_surveys where company_id is null) then
    raise exception 'Cannot enforce site_surveys.company_id: unresolved tenant rows exist';
  end if;
  if exists (select 1 from public.quotations where company_id is null) then
    raise exception 'Cannot enforce quotations.company_id: unresolved tenant rows exist';
  end if;
  if exists (select 1 from public.documents where company_id is null) then
    raise exception 'Cannot enforce documents.company_id: unresolved tenant rows exist';
  end if;
end;
$$;

alter table public.projects alter column company_id set not null;
alter table public.site_surveys alter column company_id set not null;
alter table public.quotations alter column company_id set not null;
alter table public.documents alter column company_id set not null;

create index if not exists projects_company_status_idx
  on public.projects (company_id, project_status);
create index if not exists projects_field_release_idx
  on public.projects (organization_id, field_released_at)
  where field_released_at is not null;
create index if not exists site_surveys_company_assignee_status_idx
  on public.site_surveys (company_id, assigned_to, survey_status);
create index if not exists quotations_assigned_to_idx
  on public.quotations (organization_id, assigned_to);
create index if not exists b2b_sales_assigned_to_idx
  on public.b2b_sales (organization_id, assigned_to);
create index if not exists documents_company_id_idx on public.documents (company_id);
create index if not exists documents_b2b_sale_id_idx on public.documents (b2b_sale_id)
  where b2b_sale_id is not null;

create table if not exists public.project_staff_assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  user_profile_id uuid not null references public.users_profile(id) on delete restrict,
  assignment_type text not null default 'installation'
    check (assignment_type = 'installation'),
  assigned_by uuid not null references public.users_profile(id) on delete restrict,
  assigned_at timestamptz not null default now(),
  is_active boolean not null default true,
  unassigned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((is_active and unassigned_at is null) or (not is_active and unassigned_at is not null))
);

create unique index if not exists project_staff_assignments_active_unique
  on public.project_staff_assignments (project_id, user_profile_id, assignment_type)
  where is_active;
create index if not exists project_staff_assignments_user_active_idx
  on public.project_staff_assignments (user_profile_id, project_id)
  where is_active;
create index if not exists project_staff_assignments_tenant_idx
  on public.project_staff_assignments (company_id, organization_id, project_id);

create table if not exists public.role_module_scopes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  module_key text not null,
  scope_key text not null check (scope_key in (
    'company',
    'assigned_or_unassigned_created',
    'related_operations',
    'related_finance',
    'assigned_field'
  )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (role_id, module_key)
);

create index if not exists role_module_scopes_role_module_idx
  on public.role_module_scopes (role_id, module_key, scope_key);
create index if not exists role_module_scopes_tenant_idx
  on public.role_module_scopes (company_id, organization_id);

alter table public.project_staff_assignments enable row level security;
alter table public.role_module_scopes enable row level security;

create or replace function private.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public, private
as $$
  select users_profile.id
  from public.users_profile
  where users_profile.auth_user_id = (select auth.uid())
    and users_profile.status = 'active'
  limit 1;
$$;

create or replace function private.has_role(target_role_key text)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select exists (
    select 1
    from public.users_profile up
    join public.user_roles ur
      on ur.user_profile_id = up.id or ur.user_id = up.auth_user_id
    join public.roles r on r.id = ur.role_id
    where up.auth_user_id = (select auth.uid())
      and up.status = 'active'
      and r.organization_id = up.organization_id
      and r.role_key = target_role_key
  );
$$;

create or replace function private.has_record_scope(target_module text, target_scope text)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select exists (
    select 1
    from public.users_profile up
    join public.user_roles ur
      on ur.user_profile_id = up.id or ur.user_id = up.auth_user_id
    join public.roles r on r.id = ur.role_id and r.organization_id = up.organization_id
    join public.role_module_scopes rms
      on rms.role_id = r.id
     and rms.organization_id = up.organization_id
     and rms.company_id = up.company_id
    where up.auth_user_id = (select auth.uid())
      and up.status = 'active'
      and rms.module_key = target_module
      and rms.scope_key = target_scope
  );
$$;

create or replace function private.is_assigned_field_survey(target_survey_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select exists (
    select 1
    from public.site_surveys s
    join public.users_profile up
      on up.id = s.assigned_to
     and up.organization_id = s.organization_id
     and up.company_id = s.company_id
    where s.id = target_survey_id
      and up.id = private.current_profile_id()
      and private.has_role('field_staff')
  );
$$;

create or replace function private.is_assigned_released_field_project(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select exists (
    select 1
    from public.projects p
    join public.project_staff_assignments psa
      on psa.project_id = p.id
     and psa.company_id = p.company_id
     and psa.organization_id = p.organization_id
     and psa.assignment_type = 'installation'
     and psa.is_active
    where p.id = target_project_id
      and p.field_released_at is not null
      and psa.user_profile_id = private.current_profile_id()
      and private.has_role('field_staff')
  );
$$;

create or replace function private.validate_project_staff_assignment()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if not exists (
    select 1 from public.projects p
    where p.id = new.project_id
      and p.company_id = new.company_id
      and p.organization_id = new.organization_id
  ) then
    raise exception 'Project assignment tenant does not match the project' using errcode = '23503';
  end if;

  if not exists (
    select 1
    from public.users_profile up
    join public.user_roles ur on ur.user_profile_id = up.id or ur.user_id = up.auth_user_id
    join public.roles r on r.id = ur.role_id
    where up.id = new.user_profile_id
      and up.status = 'active'
      and up.company_id = new.company_id
      and up.organization_id = new.organization_id
      and r.organization_id = new.organization_id
      and r.role_key = 'field_staff'
  ) then
    raise exception 'Installation assignee must be active Field Staff in the same tenant'
      using errcode = '23503';
  end if;

  if not exists (
    select 1 from public.users_profile up
    where up.id = new.assigned_by
      and up.company_id = new.company_id
      and up.organization_id = new.organization_id
  ) then
    raise exception 'assigned_by must belong to the same tenant' using errcode = '23503';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_project_staff_assignment on public.project_staff_assignments;
create trigger validate_project_staff_assignment
before insert or update on public.project_staff_assignments
for each row execute function private.validate_project_staff_assignment();

create or replace function private.validate_survey_field_assignment()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.assigned_to is not null and not exists (
    select 1
    from public.users_profile up
    join public.user_roles ur on ur.user_profile_id = up.id or ur.user_id = up.auth_user_id
    join public.roles r on r.id = ur.role_id
    where up.id = new.assigned_to
      and up.status = 'active'
      and up.organization_id = new.organization_id
      and up.company_id = new.company_id
      and r.organization_id = new.organization_id
      and r.role_key = 'field_staff'
  ) then
    raise exception 'Survey assignee must be active Field Staff in the same tenant'
      using errcode = '23503';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_survey_field_assignment on public.site_surveys;
create trigger validate_survey_field_assignment
before insert or update of assigned_to on public.site_surveys
for each row execute function private.validate_survey_field_assignment();

drop trigger if exists audit_project_staff_assignments_changes on public.project_staff_assignments;
create trigger audit_project_staff_assignments_changes
after insert or update or delete on public.project_staff_assignments
for each row execute function public.audit_table_change('project_staff_assignments');

create or replace function private.release_project_for_field_work()
returns trigger
language plpgsql
set search_path = public, private
as $$
begin
  if new.project_status = 'installation_scheduled'
    and new.field_released_at is null then
    if tg_op = 'INSERT' or old.project_status is distinct from new.project_status then
      new.field_released_at := now();
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists release_project_for_field_work on public.projects;
create trigger release_project_for_field_work
before insert or update of project_status on public.projects
for each row execute function private.release_project_for_field_work();

create or replace function private.guard_project_release_fields()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if old.field_released_at is distinct from new.field_released_at then
    raise exception 'field_released_at is workflow-managed' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_project_release_fields on public.projects;
create trigger guard_project_release_fields
before update on public.projects
for each row execute function private.guard_project_release_fields();

-- Explicit Data API exposure. RLS still controls every row.
revoke all on public.role_module_scopes, public.project_staff_assignments
  from public, anon, authenticated;
grant select on public.role_module_scopes, public.project_staff_assignments to authenticated;
grant all on public.role_module_scopes, public.project_staff_assignments to service_role;

insert into public.permissions (module_id, action_key, action_name)
select m.id, a.action_key, a.action_name
from public.modules m
join (
  values
    ('site_surveys', 'assign', 'Assign'),
    ('site_surveys', 'update_status', 'Update status'),
    ('site_surveys', 'update_technical', 'Update technical fields'),
    ('site_surveys', 'upload_evidence', 'Upload evidence'),
    ('projects', 'assign', 'Assign'),
    ('projects', 'update_status', 'Update status'),
    ('b2b_sales', 'fulfill', 'Fulfil'),
    ('purchases', 'receive', 'Receive'),
    ('inventory', 'correct_stock', 'Correct stock'),
    ('projects', 'view_financials', 'View financials'),
    ('inventory', 'view_financials', 'View valuation'),
    ('product_pricing', 'manage_pricing', 'Manage pricing')
) a(module_key, action_key, action_name) on a.module_key = m.module_key
on conflict (module_id, action_key) do update set action_name = excluded.action_name;

create or replace function public.seed_epc_standard_roles(target_organization_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  role_record record;
  target_role_id uuid;
  target_company_id uuid;
begin
  if target_organization_id is null then
    raise exception 'target_organization_id is required' using errcode = '23502';
  end if;

  select company_id into target_company_id
  from public.organizations where id = target_organization_id;
  if target_company_id is null then
    raise exception 'Organization must be linked to a company before roles are seeded'
      using errcode = '23503';
  end if;

  for role_record in
    select * from (values
      ('admin', 'Admin', 'Company-wide administration, assignment, audit, and exception correction.', 10),
      ('sales_team', 'Sales', 'Own CRM and commercial pipeline with related status and collection summaries.', 20),
      ('backend_team', 'Backend', 'Company-wide operational fulfilment without accounting mutation.', 30),
      ('accounts', 'Accounts', 'Company-wide finance with read-only operational context.', 40),
      ('field_staff', 'Field Staff', 'Assigned site surveys and released installation work only.', 50)
    ) standard_roles(role_key, role_name, description, sort_order)
    order by sort_order
  loop
    insert into public.roles (
      company_id, organization_id, role_key, role_name, description, is_system_role
    ) values (
      target_company_id, target_organization_id, role_record.role_key,
      role_record.role_name, role_record.description, true
    )
    on conflict (organization_id, role_key) where role_key is not null do update
    set company_id = excluded.company_id,
        role_name = excluded.role_name,
        description = excluded.description,
        is_system_role = true,
        updated_at = now()
    returning id into target_role_id;

    delete from public.role_permissions where role_id = target_role_id;
    delete from public.role_module_scopes where role_id = target_role_id;

    if role_record.role_key = 'admin' then
      insert into public.role_permissions (role_id, permission_id)
      select target_role_id, p.id
      from public.permissions p join public.modules m on m.id = p.module_id
      where m.is_active
      on conflict (role_id, permission_id) do nothing;

      insert into public.role_module_scopes (
        company_id, organization_id, role_id, module_key, scope_key
      )
      select target_company_id, target_organization_id, target_role_id, m.module_key, 'company'
      from public.modules m where m.is_active
      on conflict (role_id, module_key) do update set scope_key = excluded.scope_key;
    else
      insert into public.role_permissions (role_id, permission_id)
      select target_role_id, p.id
      from public.permissions p
      join public.modules m on m.id = p.module_id
      join (
        values
          -- Sales
          ('sales_team','dashboard','view'),
          ('sales_team','assistant','view'),
          ('sales_team','leads','view'),('sales_team','leads','create'),('sales_team','leads','update'),
          ('sales_team','customers','view'),('sales_team','customers','create'),('sales_team','customers','update'),
          ('sales_team','site_surveys','view'),
          ('sales_team','quotations','view'),('sales_team','quotations','create'),('sales_team','quotations','update'),
          ('sales_team','projects','view'),
          ('sales_team','b2b_sales','view'),('sales_team','b2b_sales','create'),('sales_team','b2b_sales','update'),
          ('sales_team','product_master','view'),
          ('sales_team','documents','view'),('sales_team','documents','create'),
          ('sales_team','reports','view'),
          -- Backend
          ('backend_team','dashboard','view'),('backend_team','assistant','view'),
          ('backend_team','leads','view'),('backend_team','customers','view'),
          ('backend_team','site_surveys','view'),('backend_team','site_surveys','create'),
          ('backend_team','site_surveys','update'),('backend_team','site_surveys','assign'),
          ('backend_team','site_surveys','update_status'),
          ('backend_team','projects','view'),('backend_team','projects','create'),
          ('backend_team','projects','update'),('backend_team','projects','assign'),
          ('backend_team','projects','update_status'),
          ('backend_team','b2b_sales','fulfill'),
          ('backend_team','product_master','view'),('backend_team','product_master','create'),('backend_team','product_master','update'),
          ('backend_team','inventory','view'),('backend_team','inventory','create'),('backend_team','inventory','update'),
          ('backend_team','inventory','correct_stock'),
          ('backend_team','vendors','view'),('backend_team','vendors','create'),('backend_team','vendors','update'),
          ('backend_team','purchases','view'),('backend_team','purchases','create'),('backend_team','purchases','update'),
          ('backend_team','purchases','receive'),
          ('backend_team','documents','view'),('backend_team','documents','create'),('backend_team','documents','update'),
          ('backend_team','reports','view'),
          -- Accounts
          ('accounts','dashboard','view'),('accounts','assistant','view'),
          ('accounts','customers','view'),('accounts','quotations','view'),('accounts','projects','view'),
          ('accounts','b2b_sales','view'),('accounts','product_master','view'),
          ('accounts','product_pricing','view'),('accounts','product_pricing','create'),
          ('accounts','product_pricing','update'),('accounts','product_pricing','manage_pricing'),
          ('accounts','inventory','view_financials'),
          ('accounts','vendors','view'),('accounts','purchases','view'),
          ('accounts','invoices','view'),('accounts','invoices','create'),('accounts','invoices','update'),
          ('accounts','payments','view'),('accounts','payments','create'),('accounts','payments','update'),
          ('accounts','documents','view'),('accounts','documents','create'),('accounts','documents','update'),
          ('accounts','reports','view'),
          -- Field Staff: no generic update permission.
          ('field_staff','dashboard','view'),
          ('field_staff','site_surveys','view'),('field_staff','site_surveys','update_status'),
          ('field_staff','site_surveys','update_technical'),('field_staff','site_surveys','upload_evidence'),
          ('field_staff','projects','view'),('field_staff','projects','update_status')
      ) allowed(role_key, module_key, action_key)
        on allowed.role_key = role_record.role_key
       and allowed.module_key = m.module_key
       and allowed.action_key = p.action_key
      where m.is_active
      on conflict (role_id, permission_id) do nothing;

      insert into public.role_module_scopes (
        company_id, organization_id, role_id, module_key, scope_key
      )
      select target_company_id, target_organization_id, target_role_id,
             scoped.module_key, scoped.scope_key
      from (values
        ('sales_team','dashboard','assigned_or_unassigned_created'),
        ('sales_team','assistant','assigned_or_unassigned_created'),
        ('sales_team','leads','assigned_or_unassigned_created'),
        ('sales_team','customers','assigned_or_unassigned_created'),
        ('sales_team','site_surveys','related_operations'),
        ('sales_team','quotations','assigned_or_unassigned_created'),
        ('sales_team','projects','related_operations'),
        ('sales_team','b2b_sales','assigned_or_unassigned_created'),
        ('sales_team','product_master','company'),
        ('sales_team','invoices','related_finance'),('sales_team','payments','related_finance'),
        ('sales_team','documents','related_operations'),('sales_team','reports','assigned_or_unassigned_created'),
        ('backend_team','dashboard','company'),('backend_team','assistant','related_operations'),
        ('backend_team','leads','related_operations'),('backend_team','customers','related_operations'),
        ('backend_team','site_surveys','company'),('backend_team','quotations','related_operations'),
        ('backend_team','projects','company'),('backend_team','b2b_sales','related_operations'),
        ('backend_team','product_master','company'),('backend_team','product_pricing','related_operations'),
        ('backend_team','inventory','company'),('backend_team','vendors','company'),
        ('backend_team','purchases','company'),('backend_team','documents','related_operations'),
        ('backend_team','reports','company'),
        ('accounts','dashboard','company'),('accounts','assistant','related_finance'),
        ('accounts','customers','related_finance'),('accounts','quotations','company'),
        ('accounts','projects','related_finance'),('accounts','b2b_sales','company'),
        ('accounts','product_master','company'),('accounts','product_pricing','company'),
        ('accounts','inventory','company'),('accounts','vendors','related_finance'),
        ('accounts','purchases','company'),('accounts','invoices','company'),
        ('accounts','payments','company'),('accounts','documents','related_finance'),
        ('accounts','reports','company'),
        ('field_staff','dashboard','assigned_field'),
        ('field_staff','site_surveys','assigned_field'),('field_staff','projects','assigned_field')
      ) scoped(role_key, module_key, scope_key)
      where scoped.role_key = role_record.role_key
      on conflict (role_id, module_key) do update set scope_key = excluded.scope_key;
    end if;
  end loop;
end;
$$;

select public.seed_epc_standard_roles(id) from public.organizations;

create or replace function public.user_has_permission(module text, action text)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select public.is_super_admin()
    or (
      public.user_has_role_permission($1, $2)
      and case
        when $2 in ('view', 'view_financials')
          then public.subscription_module_access($1) in ('full', 'read_only')
        else public.subscription_can_write_module($1)
      end
    );
$$;

create or replace function public.get_current_user_permissions()
returns table(module_key text, action_key text, record_scope text)
language sql
stable
security definer
set search_path = public, private
as $$
  with allowed as (
    select distinct m.module_key, p.action_key, rms.scope_key,
      case rms.scope_key
        when 'company' then 50
        when 'related_finance' then 40
        when 'related_operations' then 30
        when 'assigned_or_unassigned_created' then 20
        when 'assigned_field' then 10
        else 0
      end as scope_rank
    from public.users_profile up
    join public.user_roles ur
      on ur.user_profile_id = up.id or ur.user_id = up.auth_user_id
    join public.roles r on r.id = ur.role_id and r.organization_id = up.organization_id
    join public.role_permissions rp on rp.role_id = r.id
    join public.permissions p on p.id = rp.permission_id
    join public.modules m on m.id = p.module_id and m.is_active
    left join public.role_module_scopes rms
      on rms.role_id = r.id and rms.module_key = m.module_key
    where up.auth_user_id = (select auth.uid()) and up.status = 'active'
      and public.user_has_permission(m.module_key, p.action_key)
  ), ranked as (
    select allowed.*,
      row_number() over (partition by module_key, action_key order by scope_rank desc) as row_no
    from allowed
  )
  select ranked.module_key, ranked.action_key, coalesce(ranked.scope_key, 'company')
  from ranked where row_no = 1
  order by ranked.module_key, ranked.action_key;
$$;

create or replace function public.get_current_user_role_keys()
returns table(role_key text)
language sql
stable
security definer
set search_path = public, private
as $$
  select distinct r.role_key
  from public.users_profile up
  join public.user_roles ur
    on ur.user_profile_id = up.id or ur.user_id = up.auth_user_id
  join public.roles r on r.id = ur.role_id and r.organization_id = up.organization_id
  where up.auth_user_id = (select auth.uid())
    and up.status = 'active'
    and r.role_key in ('admin','sales_team','backend_team','accounts','field_staff')
  order by r.role_key;
$$;

revoke execute on function public.get_current_user_permissions() from public, anon;
revoke execute on function public.get_current_user_role_keys() from public, anon;
grant execute on function public.get_current_user_permissions() to authenticated;
grant execute on function public.get_current_user_role_keys() to authenticated;

create or replace function private.set_company_from_organization()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  resolved_company_id uuid;
begin
  select company_id into resolved_company_id
  from public.organizations where id = new.organization_id;
  if resolved_company_id is null then
    raise exception 'Organization is not linked to a company' using errcode = '23503';
  end if;
  if new.company_id is not null and new.company_id <> resolved_company_id then
    raise exception 'company_id must match organization_id' using errcode = '23503';
  end if;
  new.company_id := resolved_company_id;
  return new;
end;
$$;

do $triggers$
declare target_table text;
begin
  foreach target_table in array array['projects','site_surveys','quotations','documents'] loop
    execute format('drop trigger if exists set_%I_company_id on public.%I', target_table, target_table);
    execute format(
      'create trigger set_%I_company_id before insert or update of organization_id, company_id on public.%I
       for each row execute function private.set_company_from_organization()',
      target_table, target_table
    );
  end loop;
end;
$triggers$;

create or replace function private.set_commercial_owner()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.assigned_to is null then
    select coalesce(c.assigned_to, l.assigned_to, new.created_by)
      into new.assigned_to
    from public.customers c
    left join public.leads l on l.id = new.lead_id
    where c.id = new.customer_id;
  end if;
  return new;
end;
$$;

drop trigger if exists set_quotation_commercial_owner on public.quotations;
create trigger set_quotation_commercial_owner
before insert on public.quotations
for each row execute function private.set_commercial_owner();

create or replace function private.set_b2b_sales_owner()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.assigned_to is null then
    select coalesce(c.assigned_to, new.created_by) into new.assigned_to
    from public.customers c where c.id = new.customer_id;
  end if;
  return new;
end;
$$;

drop trigger if exists set_b2b_sales_owner on public.b2b_sales;
create trigger set_b2b_sales_owner
before insert on public.b2b_sales
for each row execute function private.set_b2b_sales_owner();

create or replace function private.guard_commercial_owner()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if old.assigned_to is distinct from new.assigned_to
    and not (public.is_super_admin() or private.has_role('admin') or private.has_role('backend_team')) then
    raise exception 'Only Admin or Backend may reassign commercial ownership'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_quotation_owner on public.quotations;
create trigger guard_quotation_owner before update on public.quotations
for each row execute function private.guard_commercial_owner();
drop trigger if exists guard_b2b_sales_owner on public.b2b_sales;
create trigger guard_b2b_sales_owner before update on public.b2b_sales
for each row execute function private.guard_commercial_owner();

create or replace function private.sales_owns_customer(target_customer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select exists (
    select 1 from public.customers c
    where c.id = target_customer_id
      and (c.assigned_to = private.current_profile_id()
        or (c.assigned_to is null and c.created_by = private.current_profile_id()))
  );
$$;

create or replace function private.sales_owns_lead(target_lead_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select exists (
    select 1 from public.leads l
    where l.id = target_lead_id
      and (l.assigned_to = private.current_profile_id()
        or (l.assigned_to is null and l.created_by = private.current_profile_id()))
  );
$$;

create or replace function private.sales_owns_project(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select exists (
    select 1 from public.projects p
    left join public.quotations q on q.id = p.quotation_id
    where p.id = target_project_id
      and (
        q.assigned_to = private.current_profile_id()
        or private.sales_owns_customer(p.customer_id)
        or private.sales_owns_lead(p.lead_id)
      )
  );
$$;

create or replace function private.can_access_document_record(target_document_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select exists (
    select 1 from public.documents d
    where d.id = target_document_id
      and d.organization_id = public.current_user_organization_id()
      and (
        private.has_record_scope('documents','company')
        or (private.has_record_scope('documents','related_operations') and (
          (
            private.has_role('sales_team')
            and d.invoice_id is null and d.proforma_invoice_id is null
            and d.purchase_order_id is null
            and d.document_type not in ('invoice_pdf','payment_receipt','bank_loan_document')
            and (private.sales_owns_customer(d.customer_id)
              or private.sales_owns_lead(d.lead_id)
              or private.sales_owns_project(d.project_id)
              or exists (select 1 from public.quotations q where q.id = d.quotation_id
                and q.assigned_to = private.current_profile_id()))
          )
          or (
            private.has_role('backend_team')
            and d.invoice_id is null and d.proforma_invoice_id is null
            and d.document_type not in ('invoice_pdf','payment_receipt','bank_loan_document')
            and (d.project_id is not null or d.quotation_id is not null
              or d.purchase_order_id is not null or d.document_type in ('site_photo','installation_photo'))
          )
        ))
        or (private.has_record_scope('documents','related_finance') and (
          d.invoice_id is not null or d.proforma_invoice_id is not null
          or d.purchase_order_id is not null or d.b2b_sale_id is not null
          or d.document_type in ('invoice_pdf','payment_receipt','bank_loan_document')
        ))
      )
  );
$$;

create or replace function public.set_project_field_assignments(
  target_project_id uuid,
  target_user_profile_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  project_record public.projects%rowtype;
  actor_profile_id uuid := private.current_profile_id();
  assignee_id uuid;
  next_ids uuid[] := coalesce(target_user_profile_ids, array[]::uuid[]);
begin
  if auth.uid() is null or actor_profile_id is null then
    raise exception 'Active authentication is required' using errcode = '42501';
  end if;
  if not (public.is_super_admin() or public.user_has_permission('projects','assign')) then
    raise exception 'Project assignment permission is required' using errcode = '42501';
  end if;

  select * into project_record from public.projects
  where id = target_project_id for update;
  if not found then raise exception 'Project not found' using errcode = 'P0002'; end if;
  if not public.is_super_admin()
    and project_record.organization_id <> public.current_user_organization_id() then
    raise exception 'Project belongs to another tenant' using errcode = '42501';
  end if;

  update public.project_staff_assignments
  set is_active = false, unassigned_at = now(), updated_at = now()
  where project_id = target_project_id and is_active
    and not (user_profile_id = any(next_ids));

  foreach assignee_id in array next_ids loop
    if not exists (
      select 1 from public.project_staff_assignments
      where project_id = target_project_id
        and user_profile_id = assignee_id
        and assignment_type = 'installation'
        and is_active
    ) then
      insert into public.project_staff_assignments (
        company_id, organization_id, project_id, user_profile_id, assigned_by
      ) values (
        project_record.company_id, project_record.organization_id,
        project_record.id, assignee_id, actor_profile_id
      );
    end if;
  end loop;
end;
$$;

create or replace function public.get_field_staff_options(target_project_id uuid default null)
returns table(id uuid, full_name text, phone text, is_assigned boolean)
language sql
stable
security definer
set search_path = public, private
as $$
  select distinct up.id, up.full_name, up.phone,
    case when target_project_id is null then false else exists (
      select 1 from public.project_staff_assignments psa
      where psa.project_id = target_project_id and psa.user_profile_id = up.id
        and psa.is_active and psa.assignment_type = 'installation'
    ) end
  from public.users_profile up
  join public.user_roles ur on ur.user_profile_id = up.id or ur.user_id = up.auth_user_id
  join public.roles r on r.id = ur.role_id and r.organization_id = up.organization_id
  where up.organization_id = public.current_user_organization_id()
    and up.company_id = public.get_current_user_company_id()
    and up.status = 'active'
    and r.role_key = 'field_staff'
    and (public.is_super_admin()
      or public.user_has_permission('projects','assign')
      or public.user_has_permission('site_surveys','assign'))
  order by up.full_name;
$$;

drop policy if exists "Scoped users can view project staff assignments" on public.project_staff_assignments;
create policy "Scoped users can view project staff assignments"
on public.project_staff_assignments for select to authenticated
using (
  public.is_super_admin()
  or (
    company_id = public.get_current_user_company_id()
    and organization_id = public.current_user_organization_id()
    and (
      public.user_has_permission('projects','assign')
      or user_profile_id = private.current_profile_id()
    )
  )
);

drop policy if exists "Admins can view role module scopes" on public.role_module_scopes;
create policy "Admins can view role module scopes"
on public.role_module_scopes for select to authenticated
using (
  public.is_super_admin()
  or (organization_id = public.current_user_organization_id()
      and public.user_has_permission('settings','view'))
);

revoke execute on function public.set_project_field_assignments(uuid, uuid[]) from public, anon;
revoke execute on function public.get_field_staff_options(uuid) from public, anon;
grant execute on function public.set_project_field_assignments(uuid, uuid[]) to authenticated;
grant execute on function public.get_field_staff_options(uuid) to authenticated;

create or replace function public.get_field_site_surveys(target_survey_id uuid default null)
returns setof jsonb
language sql
stable
security definer
set search_path = public, private
as $$
  select jsonb_build_object(
    'id', s.id,
    'company_id', s.company_id,
    'organization_id', s.organization_id,
    'survey_code', s.survey_code,
    'scheduled_date', s.scheduled_date,
    'scheduled_time', s.scheduled_time,
    'survey_status', s.survey_status,
    'completed_at', s.completed_at,
    'assigned_to', s.assigned_to,
    'contact_name', coalesce(c.full_name, l.full_name),
    'contact_phone', coalesce(c.phone, l.phone),
    'site_address', coalesce(
      nullif(concat_ws(', ', c.address_line_1, c.address_line_2, c.city, c.district, c.state, c.pincode), ''),
      nullif(concat_ws(', ', l.address, l.city, l.district, l.state, l.pincode), '')
    ),
    'roof_type', s.roof_type,
    'roof_area_sqft', s.roof_area_sqft,
    'shadow_free_area_sqft', s.shadow_free_area_sqft,
    'recommended_capacity_kw', s.recommended_capacity_kw,
    'sanctioned_load_kw', s.sanctioned_load_kw,
    'phase_type', s.phase_type,
    'latitude', s.latitude,
    'longitude', s.longitude,
    'address_notes', s.address_notes,
    'remarks', s.remarks,
    'site_photos', coalesce(s.site_photos, '[]'::jsonb),
    'electricity_bill_url', s.electricity_bill_url,
    'created_at', s.created_at,
    'updated_at', s.updated_at
  )
  from public.site_surveys s
  left join public.customers c on c.id = s.customer_id and c.organization_id = s.organization_id
  left join public.leads l on l.id = s.lead_id and l.organization_id = s.organization_id
  where (target_survey_id is null or s.id = target_survey_id)
    and public.user_has_permission('site_surveys','view')
    and private.is_assigned_field_survey(s.id)
  order by s.scheduled_date desc nulls last, s.created_at desc;
$$;

create or replace function public.get_field_projects(target_project_id uuid default null)
returns setof jsonb
language sql
stable
security definer
set search_path = public, private
as $$
  select jsonb_build_object(
    'id', p.id,
    'company_id', p.company_id,
    'organization_id', p.organization_id,
    'project_code', p.project_code,
    'project_name', p.project_name,
    'project_status', p.project_status,
    'field_released_at', p.field_released_at,
    'customer_name', c.full_name,
    'customer_phone', c.phone,
    'installation_address', coalesce(
      p.installation_address,
      nullif(concat_ws(', ', c.address_line_1, c.address_line_2, c.city, c.district, c.state, c.pincode), '')
    ),
    'system_capacity_kw', p.system_capacity_kw,
    'start_date', p.start_date,
    'expected_completion_date', p.expected_completion_date,
    'field_notes', p.field_notes,
    'assigned_team', coalesce((
      select jsonb_agg(jsonb_build_object('id', up.id, 'name', up.full_name) order by up.full_name)
      from public.project_staff_assignments psa
      join public.users_profile up on up.id = psa.user_profile_id
      where psa.project_id = p.id and psa.is_active
        and psa.assignment_type = 'installation'
    ), '[]'::jsonb),
    'created_at', p.created_at,
    'updated_at', p.updated_at
  )
  from public.projects p
  join public.customers c on c.id = p.customer_id and c.organization_id = p.organization_id
  where (target_project_id is null or p.id = target_project_id)
    and public.user_has_permission('projects','view')
    and private.is_assigned_released_field_project(p.id)
  order by p.expected_completion_date asc nulls last, p.created_at desc;
$$;

create or replace function public.get_scoped_site_survey_summaries(target_survey_id uuid default null)
returns setof jsonb
language sql
stable
security definer
set search_path = public, private
as $$
  select jsonb_build_object(
    'id', s.id,
    'organization_id', s.organization_id,
    'survey_code', s.survey_code,
    'scheduled_date', s.scheduled_date,
    'scheduled_time', s.scheduled_time,
    'survey_status', s.survey_status,
    'completed_at', s.completed_at,
    'contact_name', coalesce(c.full_name, l.full_name),
    'updated_at', s.updated_at
  )
  from public.site_surveys s
  left join public.customers c on c.id = s.customer_id and c.organization_id = s.organization_id
  left join public.leads l on l.id = s.lead_id and l.organization_id = s.organization_id
  where (target_survey_id is null or s.id = target_survey_id)
    and s.organization_id = public.current_user_organization_id()
    and public.user_has_permission('site_surveys','view')
    and private.has_record_scope('site_surveys','related_operations')
    and (private.sales_owns_customer(s.customer_id) or private.sales_owns_lead(s.lead_id))
  order by s.created_at desc;
$$;

create or replace function public.get_scoped_project_summaries(target_project_id uuid default null)
returns setof jsonb
language sql
stable
security definer
set search_path = public, private
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', p.id,
    'organization_id', p.organization_id,
    'project_code', p.project_code,
    'project_name', p.project_name,
    'project_status', p.project_status,
    'customer_name', c.full_name,
    'system_capacity_kw', case when private.has_role('sales_team') then p.system_capacity_kw else null end,
    'expected_completion_date', p.expected_completion_date,
    'assigned_manager_name', manager.full_name,
    'created_at', p.created_at,
    'updated_at', p.updated_at
  ))
  from public.projects p
  join public.customers c on c.id = p.customer_id and c.organization_id = p.organization_id
  left join public.users_profile manager on manager.id = p.assigned_project_manager
  where (target_project_id is null or p.id = target_project_id)
    and p.organization_id = public.current_user_organization_id()
    and public.user_has_permission('projects','view')
    and (
      (private.has_record_scope('projects','related_operations') and private.sales_owns_project(p.id))
      or (private.has_record_scope('projects','related_finance') and exists (
        select 1 from public.invoices i where i.project_id = p.id
        union all
        select 1 from public.payments pay where pay.project_id = p.id
      ))
    )
  order by p.created_at desc;
$$;

create or replace function public.update_field_site_survey_status(
  target_survey_id uuid,
  new_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare survey_record public.site_surveys%rowtype;
begin
  if not public.user_has_permission('site_surveys','update_status') then
    raise exception 'Site survey status permission is required' using errcode = '42501';
  end if;
  select * into survey_record from public.site_surveys
  where id = target_survey_id for update;
  if not found or not private.is_assigned_field_survey(target_survey_id) then
    raise exception 'Assigned site survey not found' using errcode = '42501';
  end if;
  if not (
    (survey_record.survey_status in ('scheduled','rescheduled') and new_status = 'in_progress')
    or (survey_record.survey_status = 'in_progress' and new_status = 'completed')
  ) then
    raise exception 'Unsupported Field Staff survey transition: % -> %', survey_record.survey_status, new_status
      using errcode = '23514';
  end if;
  update public.site_surveys
  set survey_status = new_status,
      completed_at = case when new_status = 'completed' then coalesce(completed_at, now()) else completed_at end,
      updated_at = now()
  where id = target_survey_id
  returning * into survey_record;
  return jsonb_build_object('id', survey_record.id, 'survey_status', survey_record.survey_status,
    'completed_at', survey_record.completed_at, 'updated_at', survey_record.updated_at);
end;
$$;

create or replace function public.update_field_site_survey_technical(
  target_survey_id uuid,
  technical_patch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare survey_record public.site_surveys%rowtype;
declare unknown_keys text[];
begin
  if not public.user_has_permission('site_surveys','update_technical') then
    raise exception 'Site survey technical permission is required' using errcode = '42501';
  end if;
  select array_agg(key) into unknown_keys
  from jsonb_object_keys(coalesce(technical_patch, '{}'::jsonb)) key
  where key not in ('roof_type','roof_area_sqft','shadow_free_area_sqft','recommended_capacity_kw',
                    'sanctioned_load_kw','phase_type','latitude','longitude','address_notes','remarks');
  if unknown_keys is not null then
    raise exception 'Protected survey fields cannot be updated: %', array_to_string(unknown_keys, ', ')
      using errcode = '42501';
  end if;
  select * into survey_record from public.site_surveys where id = target_survey_id for update;
  if not found or not private.is_assigned_field_survey(target_survey_id) then
    raise exception 'Assigned site survey not found' using errcode = '42501';
  end if;
  if survey_record.survey_status in ('completed','cancelled') then
    raise exception 'Completed or cancelled surveys are read-only' using errcode = '23514';
  end if;
  update public.site_surveys set
    roof_type = case when technical_patch ? 'roof_type' then nullif(technical_patch->>'roof_type','') else roof_type end,
    roof_area_sqft = case when technical_patch ? 'roof_area_sqft' then nullif(technical_patch->>'roof_area_sqft','')::numeric else roof_area_sqft end,
    shadow_free_area_sqft = case when technical_patch ? 'shadow_free_area_sqft' then nullif(technical_patch->>'shadow_free_area_sqft','')::numeric else shadow_free_area_sqft end,
    recommended_capacity_kw = case when technical_patch ? 'recommended_capacity_kw' then nullif(technical_patch->>'recommended_capacity_kw','')::numeric else recommended_capacity_kw end,
    sanctioned_load_kw = case when technical_patch ? 'sanctioned_load_kw' then nullif(technical_patch->>'sanctioned_load_kw','')::numeric else sanctioned_load_kw end,
    phase_type = case when technical_patch ? 'phase_type' then nullif(technical_patch->>'phase_type','') else phase_type end,
    latitude = case when technical_patch ? 'latitude' then nullif(technical_patch->>'latitude','')::numeric else latitude end,
    longitude = case when technical_patch ? 'longitude' then nullif(technical_patch->>'longitude','')::numeric else longitude end,
    address_notes = case when technical_patch ? 'address_notes' then nullif(technical_patch->>'address_notes','') else address_notes end,
    remarks = case when technical_patch ? 'remarks' then nullif(technical_patch->>'remarks','') else remarks end,
    updated_at = now()
  where id = target_survey_id returning * into survey_record;
  return to_jsonb(survey_record) - array['lead_id','customer_id','created_by','archive_reason','archived_by'];
end;
$$;

create or replace function public.register_field_survey_evidence(
  target_survey_id uuid,
  evidence_kind text,
  evidence jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare survey_record public.site_surveys%rowtype;
begin
  if not public.user_has_permission('site_surveys','upload_evidence') then
    raise exception 'Survey evidence permission is required' using errcode = '42501';
  end if;
  select * into survey_record from public.site_surveys where id = target_survey_id for update;
  if not found or not private.is_assigned_field_survey(target_survey_id) then
    raise exception 'Assigned site survey not found' using errcode = '42501';
  end if;
  if survey_record.survey_status in ('completed','cancelled') then
    raise exception 'Completed or cancelled surveys are read-only' using errcode = '23514';
  end if;
  if evidence_kind = 'photo' then
    update public.site_surveys set site_photos = coalesce(site_photos,'[]'::jsonb) || jsonb_build_array(evidence), updated_at = now()
    where id = target_survey_id returning * into survey_record;
  elsif evidence_kind = 'document' then
    update public.site_surveys set electricity_bill_url = evidence->>'file_path', updated_at = now()
    where id = target_survey_id returning * into survey_record;
  else
    raise exception 'Evidence kind must be photo or document' using errcode = '22023';
  end if;
  return jsonb_build_object('id', survey_record.id, 'site_photos', survey_record.site_photos,
    'electricity_bill_url', survey_record.electricity_bill_url, 'updated_at', survey_record.updated_at);
end;
$$;

create or replace function public.update_field_project_status(
  target_project_id uuid,
  new_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare project_record public.projects%rowtype;
begin
  if not public.user_has_permission('projects','update_status') then
    raise exception 'Installation status permission is required' using errcode = '42501';
  end if;
  select * into project_record from public.projects where id = target_project_id for update;
  if not found or not private.is_assigned_released_field_project(target_project_id) then
    raise exception 'Assigned released project not found' using errcode = '42501';
  end if;
  if not (
    (project_record.project_status = 'installation_scheduled' and new_status = 'installation_in_progress')
    or (project_record.project_status = 'installation_in_progress' and new_status = 'installation_completed')
  ) then
    raise exception 'Unsupported Field Staff installation transition: % -> %', project_record.project_status, new_status
      using errcode = '23514';
  end if;
  update public.projects
  set project_status = new_status,
      completed_at = case when new_status = 'installation_completed' then coalesce(completed_at, now()) else completed_at end,
      updated_at = now()
  where id = target_project_id returning * into project_record;
  return jsonb_build_object('id', project_record.id, 'project_status', project_record.project_status,
    'completed_at', project_record.completed_at, 'updated_at', project_record.updated_at);
end;
$$;

revoke execute on function public.get_field_site_surveys(uuid) from public, anon;
revoke execute on function public.get_field_projects(uuid) from public, anon;
revoke execute on function public.get_scoped_project_summaries(uuid) from public, anon;
revoke execute on function public.get_scoped_site_survey_summaries(uuid) from public, anon;
revoke execute on function public.update_field_site_survey_status(uuid,text) from public, anon;
revoke execute on function public.update_field_site_survey_technical(uuid,jsonb) from public, anon;
revoke execute on function public.register_field_survey_evidence(uuid,text,jsonb) from public, anon;
revoke execute on function public.update_field_project_status(uuid,text) from public, anon;
grant execute on function public.get_field_site_surveys(uuid) to authenticated;
grant execute on function public.get_field_projects(uuid) to authenticated;
grant execute on function public.get_scoped_project_summaries(uuid) to authenticated;
grant execute on function public.get_scoped_site_survey_summaries(uuid) to authenticated;
grant execute on function public.update_field_site_survey_status(uuid,text) to authenticated;
grant execute on function public.update_field_site_survey_technical(uuid,jsonb) to authenticated;
grant execute on function public.register_field_survey_evidence(uuid,text,jsonb) to authenticated;
grant execute on function public.update_field_project_status(uuid,text) to authenticated;

-- Base-table RLS is intentionally unavailable to assigned_field scopes. Safe
-- RPC projections above are the only Field Staff read path.
do $policies$
declare policy_record record;
declare table_name text;
begin
  foreach table_name in array array['projects','site_surveys','leads','customers','quotations','b2b_sales','documents'] loop
    for policy_record in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = table_name
    loop
      execute format('drop policy if exists %I on public.%I', policy_record.policyname, table_name);
    end loop;
  end loop;
end;
$policies$;

create policy "Scoped project reads" on public.projects for select to authenticated
using (
  public.is_super_admin()
  or (
    company_id = public.get_current_user_company_id()
    and organization_id = public.current_user_organization_id()
    and public.user_has_permission('projects','view')
    and private.has_record_scope('projects','company')
  )
);
create policy "Scoped project creates" on public.projects for insert to authenticated
with check (
  company_id = public.get_current_user_company_id()
  and organization_id = public.current_user_organization_id()
  and public.user_has_permission('projects','create')
  and private.has_record_scope('projects','company')
);
create policy "Scoped project updates" on public.projects for update to authenticated
using (
  (public.is_super_admin()) or (
    company_id = public.get_current_user_company_id()
    and organization_id = public.current_user_organization_id()
    and public.user_has_permission('projects','update')
    and private.has_record_scope('projects','company')
  )
) with check (
  (public.is_super_admin()) or (
    company_id = public.get_current_user_company_id()
    and organization_id = public.current_user_organization_id()
    and public.user_has_permission('projects','update')
    and private.has_record_scope('projects','company')
  )
);
create policy "Admin project lifecycle" on public.projects for delete to authenticated
using (public.is_super_admin() or (
  organization_id = public.current_user_organization_id()
  and private.has_role('admin')
  and public.user_has_permission('projects','delete')
));

create policy "Scoped survey reads" on public.site_surveys for select to authenticated
using (
  public.is_super_admin()
  or (
    company_id = public.get_current_user_company_id()
    and organization_id = public.current_user_organization_id()
    and public.user_has_permission('site_surveys','view')
    and private.has_record_scope('site_surveys','company')
  )
);
create policy "Scoped survey creates" on public.site_surveys for insert to authenticated
with check (
  company_id = public.get_current_user_company_id()
  and organization_id = public.current_user_organization_id()
  and public.user_has_permission('site_surveys','create')
  and private.has_record_scope('site_surveys','company')
);
create policy "Scoped survey updates" on public.site_surveys for update to authenticated
using (
  public.is_super_admin() or (
    company_id = public.get_current_user_company_id()
    and organization_id = public.current_user_organization_id()
    and public.user_has_permission('site_surveys','update')
    and private.has_record_scope('site_surveys','company')
  )
) with check (
  public.is_super_admin() or (
    company_id = public.get_current_user_company_id()
    and organization_id = public.current_user_organization_id()
    and public.user_has_permission('site_surveys','update')
    and private.has_record_scope('site_surveys','company')
  )
);
create policy "Admin survey lifecycle" on public.site_surveys for delete to authenticated
using (public.is_super_admin() or (
  organization_id = public.current_user_organization_id()
  and private.has_role('admin')
  and public.user_has_permission('site_surveys','delete')
));

create policy "Scoped lead reads" on public.leads for select to authenticated
using (
  public.is_super_admin() or (
    organization_id = public.current_user_organization_id()
    and public.user_has_permission('leads','view')
    and (
      private.has_record_scope('leads','company')
      or (private.has_record_scope('leads','assigned_or_unassigned_created')
          and (assigned_to = private.current_profile_id()
            or (assigned_to is null and created_by = private.current_profile_id())))
      or (private.has_record_scope('leads','related_operations') and (
        exists (select 1 from public.site_surveys s where s.lead_id = leads.id)
        or exists (select 1 from public.projects p where p.lead_id = leads.id)
      ))
    )
  )
);
create policy "Scoped lead creates" on public.leads for insert to authenticated
with check (organization_id = public.current_user_organization_id()
  and public.user_has_permission('leads','create')
  and (assigned_to = private.current_profile_id()
    or (assigned_to is null and created_by = private.current_profile_id())
    or private.has_record_scope('leads','company')));
create policy "Scoped lead updates" on public.leads for update to authenticated
using (organization_id = public.current_user_organization_id()
  and public.user_has_permission('leads','update')
  and (private.has_record_scope('leads','company')
    or assigned_to = private.current_profile_id()
    or (assigned_to is null and created_by = private.current_profile_id())))
with check (organization_id = public.current_user_organization_id()
  and public.user_has_permission('leads','update')
  and (private.has_record_scope('leads','company')
    or assigned_to = private.current_profile_id()
    or (assigned_to is null and created_by = private.current_profile_id())));
create policy "Admin lead lifecycle" on public.leads for delete to authenticated
using (public.is_super_admin() or (organization_id = public.current_user_organization_id()
  and private.has_role('admin') and public.user_has_permission('leads','delete')));

create policy "Scoped customer reads" on public.customers for select to authenticated
using (
  public.is_super_admin() or (
    organization_id = public.current_user_organization_id()
    and public.user_has_permission('customers','view')
    and (
      private.has_record_scope('customers','company')
      or (private.has_record_scope('customers','assigned_or_unassigned_created')
        and (assigned_to = private.current_profile_id()
          or (assigned_to is null and created_by = private.current_profile_id())))
      or (private.has_record_scope('customers','related_operations') and (
        exists (select 1 from public.site_surveys s where s.customer_id = customers.id)
        or exists (select 1 from public.projects p where p.customer_id = customers.id)
        or exists (select 1 from public.b2b_sales b where b.customer_id = customers.id and b.status <> 'draft')
      ))
      or (private.has_record_scope('customers','related_finance') and (
        exists (select 1 from public.invoices i where i.customer_id = customers.id)
        or exists (select 1 from public.payments pay where pay.customer_id = customers.id)
        or exists (select 1 from public.quotations q where q.customer_id = customers.id)
      ))
    )
  )
);
create policy "Scoped customer creates" on public.customers for insert to authenticated
with check (organization_id = public.current_user_organization_id()
  and public.user_has_permission('customers','create')
  and (assigned_to = private.current_profile_id()
    or (assigned_to is null and created_by = private.current_profile_id())
    or private.has_record_scope('customers','company')));
create policy "Scoped customer updates" on public.customers for update to authenticated
using (organization_id = public.current_user_organization_id()
  and public.user_has_permission('customers','update')
  and (private.has_record_scope('customers','company')
    or assigned_to = private.current_profile_id()
    or (assigned_to is null and created_by = private.current_profile_id())))
with check (organization_id = public.current_user_organization_id()
  and public.user_has_permission('customers','update')
  and (private.has_record_scope('customers','company')
    or assigned_to = private.current_profile_id()
    or (assigned_to is null and created_by = private.current_profile_id())));
create policy "Admin customer lifecycle" on public.customers for delete to authenticated
using (public.is_super_admin() or (organization_id = public.current_user_organization_id()
  and private.has_role('admin') and public.user_has_permission('customers','delete')));

create policy "Scoped quotation reads" on public.quotations for select to authenticated
using (
  public.is_super_admin() or (
    organization_id = public.current_user_organization_id()
    and company_id = public.get_current_user_company_id()
    and public.user_has_permission('quotations','view')
    and (
      private.has_record_scope('quotations','company')
      or (private.has_record_scope('quotations','assigned_or_unassigned_created')
        and (assigned_to = private.current_profile_id()
          or (assigned_to is null and created_by = private.current_profile_id())))
      or (private.has_record_scope('quotations','related_operations') and status = 'accepted')
    )
  )
);
create policy "Scoped quotation creates" on public.quotations for insert to authenticated
with check (organization_id = public.current_user_organization_id()
  and company_id = public.get_current_user_company_id()
  and public.user_has_permission('quotations','create')
  and (private.has_record_scope('quotations','company')
    or assigned_to = private.current_profile_id()
    or (assigned_to is null and created_by = private.current_profile_id())));
create policy "Scoped quotation updates" on public.quotations for update to authenticated
using (organization_id = public.current_user_organization_id()
  and public.user_has_permission('quotations','update')
  and (private.has_record_scope('quotations','company') or assigned_to = private.current_profile_id()))
with check (organization_id = public.current_user_organization_id()
  and public.user_has_permission('quotations','update')
  and (private.has_record_scope('quotations','company') or assigned_to = private.current_profile_id()));
create policy "Admin quotation lifecycle" on public.quotations for delete to authenticated
using (public.is_super_admin() or (organization_id = public.current_user_organization_id()
  and private.has_role('admin') and public.user_has_permission('quotations','delete')));

create policy "Scoped sales order reads" on public.b2b_sales for select to authenticated
using (
  public.is_super_admin() or (
    organization_id = public.current_user_organization_id()
    and company_id = public.get_current_user_company_id()
    and public.user_has_permission('b2b_sales','view')
    and (
      private.has_record_scope('b2b_sales','company')
      or (private.has_record_scope('b2b_sales','assigned_or_unassigned_created')
        and (assigned_to = private.current_profile_id()
          or (assigned_to is null and created_by = private.current_profile_id())))
      or (private.has_record_scope('b2b_sales','related_operations') and status in ('confirmed','dispatched'))
    )
  )
);
create policy "Scoped sales order creates" on public.b2b_sales for insert to authenticated
with check (organization_id = public.current_user_organization_id()
  and company_id = public.get_current_user_company_id()
  and public.user_has_permission('b2b_sales','create')
  and (private.has_record_scope('b2b_sales','company')
    or assigned_to = private.current_profile_id()
    or (assigned_to is null and created_by = private.current_profile_id())));
create policy "Scoped sales order updates" on public.b2b_sales for update to authenticated
using (organization_id = public.current_user_organization_id()
  and public.user_has_permission('b2b_sales','update')
  and (private.has_record_scope('b2b_sales','company') or assigned_to = private.current_profile_id()))
with check (organization_id = public.current_user_organization_id()
  and public.user_has_permission('b2b_sales','update')
  and (private.has_record_scope('b2b_sales','company') or assigned_to = private.current_profile_id()));
create policy "Admin sales order lifecycle" on public.b2b_sales for delete to authenticated
using (public.is_super_admin() or (organization_id = public.current_user_organization_id()
  and private.has_role('admin') and public.user_has_permission('b2b_sales','delete')));

create policy "Scoped document reads" on public.documents for select to authenticated
using (
  public.is_super_admin()
  or (public.user_has_permission('documents','view')
      and private.can_access_document_record(id))
);
create policy "Scoped document creates" on public.documents for insert to authenticated
with check (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('documents','create')
  and (
    private.has_record_scope('documents','company')
    or (private.has_record_scope('documents','related_operations') and (
      (private.has_role('sales_team')
        and invoice_id is null and proforma_invoice_id is null and purchase_order_id is null
        and document_type not in ('invoice_pdf','payment_receipt','bank_loan_document')
        and (private.sales_owns_customer(customer_id) or private.sales_owns_lead(lead_id)
          or private.sales_owns_project(project_id)))
      or (private.has_role('backend_team')
        and invoice_id is null and proforma_invoice_id is null
        and document_type not in ('invoice_pdf','payment_receipt','bank_loan_document')
        and (project_id is not null or quotation_id is not null or purchase_order_id is not null
          or document_type in ('site_photo','installation_photo')))
    ))
    or (private.has_record_scope('documents','related_finance') and (
      invoice_id is not null or proforma_invoice_id is not null or purchase_order_id is not null
      or b2b_sale_id is not null or document_type in ('invoice_pdf','payment_receipt','bank_loan_document')
    ))
  )
);
create policy "Scoped document updates" on public.documents for update to authenticated
using (public.user_has_permission('documents','update') and private.can_access_document_record(id))
with check (organization_id = public.current_user_organization_id()
  and public.user_has_permission('documents','update')
  and private.can_access_document_record(id));
create policy "Admin document lifecycle" on public.documents for delete to authenticated
using (public.is_super_admin() or (organization_id = public.current_user_organization_id()
  and private.has_role('admin') and public.user_has_permission('documents','delete')));

create or replace function private.field_can_access_survey_object(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, storage, private
as $$
declare survey_id_text text := split_part(object_name, '/', 3);
begin
  if split_part(object_name, '/', 1) <> public.current_user_organization_id()::text
    or split_part(object_name, '/', 2) <> 'site-surveys'
    or split_part(object_name, '/', 4) not in ('photos','documents')
    or survey_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return false;
  end if;
  return private.is_assigned_field_survey(survey_id_text::uuid);
end;
$$;

drop policy if exists "Organization users can read organization document files" on storage.objects;
create policy "Organization users can read organization document files"
on storage.objects for select to authenticated
using (
  bucket_id = 'organization-documents'
  and (
    public.is_super_admin()
    or (
      split_part(name, '/', 1) = public.current_user_organization_id()::text
      and (
        exists (
          select 1 from public.documents d
          where d.file_path = storage.objects.name
            and private.can_access_document_record(d.id)
        )
        or public.user_has_permission('site_surveys','update')
        or (public.user_has_permission('site_surveys','upload_evidence')
            and private.field_can_access_survey_object(name))
      )
    )
  )
);

drop policy if exists "Organization users can upload organization document files" on storage.objects;
create policy "Organization users can upload organization document files"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'organization-documents'
  and split_part(name, '/', 1) = public.current_user_organization_id()::text
  and (
    public.is_super_admin()
    or public.user_has_permission('documents','create')
    or public.user_has_permission('site_surveys','create')
    or public.user_has_permission('site_surveys','update')
    or (public.user_has_permission('site_surveys','upload_evidence')
        and private.field_can_access_survey_object(name))
  )
);

drop function if exists public.get_settings_roles();
create or replace function public.get_settings_roles()
returns table(
  id uuid, organization_id uuid, role_key text, role_name text,
  description text, is_system_role boolean, permission_count bigint,
  permission_ids uuid[]
)
language plpgsql
security definer
set search_path = public, private
as $$
declare current_organization_id uuid;
begin
  current_organization_id := public.require_settings_update();
  if current_organization_id is not null then
    perform public.seed_epc_standard_roles(current_organization_id);
  end if;
  return query
  select r.id, r.organization_id, r.role_key, r.role_name, r.description,
    coalesce(r.is_system_role,false), count(rp.permission_id),
    coalesce(array_agg(rp.permission_id order by rp.permission_id)
      filter (where rp.permission_id is not null), array[]::uuid[])
  from public.roles r
  left join public.role_permissions rp on rp.role_id = r.id
  where (current_organization_id is null or r.organization_id = current_organization_id)
    and (public.is_super_admin() or (
      coalesce(r.is_system_role,false)
      and r.role_key in ('admin','sales_team','backend_team','accounts','field_staff')
    ))
  group by r.id
  order by case r.role_key
    when 'admin' then 10 when 'sales_team' then 20 when 'backend_team' then 30
    when 'accounts' then 40 when 'field_staff' then 50 else 100 end, r.role_name;
end;
$$;

create or replace function public.create_settings_staff(
  full_name text, phone text, email text, role_id uuid,
  status text default 'invited'
)
returns public.users_profile
language plpgsql
security definer
set search_path = public, private
as $$
#variable_conflict use_column
declare
  current_organization_id uuid;
  normalized_status text := coalesce(nullif(trim(create_settings_staff.status), ''), 'invited');
  normalized_email text := nullif(lower(trim(create_settings_staff.email)), '');
  created_profile public.users_profile%rowtype;
begin
  current_organization_id := public.require_settings_update();
  if current_organization_id is null then
    raise exception 'organization_id is required to create staff' using errcode = '23502';
  end if;
  perform public.seed_epc_standard_roles(current_organization_id);
  if normalized_status not in ('invited','active','inactive') then
    raise exception 'Invalid staff status' using errcode = '22023';
  end if;
  if normalized_email is null
    or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Staff email is required' using errcode = '23502';
  end if;
  if exists (select 1 from public.users_profile
    where organization_id = current_organization_id and lower(users_profile.email) = normalized_email) then
    raise exception 'A staff profile already exists for this email' using errcode = '23505';
  end if;
  if create_settings_staff.role_id is not null and not exists (
    select 1 from public.roles r
    where r.id = create_settings_staff.role_id
      and r.organization_id = current_organization_id
      and coalesce(r.is_system_role,false)
      and r.role_key in ('admin','sales_team','backend_team','accounts','field_staff')
  ) then
    raise exception 'Role must be a standard role in the current organization' using errcode = '42501';
  end if;
  insert into public.users_profile (
    company_id, organization_id, full_name, phone, email, status, is_super_admin, invited_at
  ) select o.company_id, current_organization_id,
      nullif(trim(create_settings_staff.full_name),''),
      nullif(trim(create_settings_staff.phone),''), normalized_email,
      normalized_status, false, now()
    from public.organizations o where o.id = current_organization_id
  returning * into created_profile;
  if create_settings_staff.role_id is not null then
    insert into public.user_roles (user_profile_id, role_id)
    values (created_profile.id, create_settings_staff.role_id)
    on conflict (user_profile_id, role_id) where user_profile_id is not null do nothing;
  end if;
  return created_profile;
end;
$$;

create or replace function public.update_settings_staff(
  target_profile_id uuid, full_name text, phone text, email text,
  role_id uuid, status text
)
returns public.users_profile
language plpgsql
security definer
set search_path = public, private
as $$
#variable_conflict use_column
declare
  current_organization_id uuid;
  target_profile public.users_profile%rowtype;
  normalized_status text := coalesce(nullif(trim(update_settings_staff.status), ''), 'invited');
begin
  current_organization_id := public.require_settings_update();
  select * into target_profile from public.users_profile
  where id = update_settings_staff.target_profile_id for update;
  if not found then raise exception 'Staff profile not found' using errcode = 'P0002'; end if;
  if current_organization_id is not null and target_profile.organization_id <> current_organization_id then
    raise exception 'Cannot update staff for another organization' using errcode = '42501';
  end if;
  if target_profile.auth_user_id = auth.uid() and normalized_status <> 'active' then
    raise exception 'You cannot deactivate your own account' using errcode = '42501';
  end if;
  if normalized_status not in ('invited','active','inactive') then
    raise exception 'Invalid staff status' using errcode = '22023';
  end if;
  perform public.seed_epc_standard_roles(target_profile.organization_id);
  if update_settings_staff.role_id is not null and not exists (
    select 1 from public.roles r
    where r.id = update_settings_staff.role_id
      and r.organization_id = target_profile.organization_id
      and coalesce(r.is_system_role,false)
      and r.role_key in ('admin','sales_team','backend_team','accounts','field_staff')
  ) then
    raise exception 'Role must be a standard role in the staff organization' using errcode = '42501';
  end if;
  update public.users_profile set
    full_name = nullif(trim(update_settings_staff.full_name),''),
    phone = nullif(trim(update_settings_staff.phone),''),
    email = nullif(lower(trim(update_settings_staff.email)),''),
    status = normalized_status,
    is_super_admin = target_profile.is_super_admin,
    updated_at = now()
  where id = update_settings_staff.target_profile_id returning * into target_profile;
  if target_profile.auth_user_id is not null then
    update public.profiles set status = normalized_status, updated_at = now()
    where id = target_profile.auth_user_id;
  end if;
  delete from public.user_roles
  where user_profile_id = update_settings_staff.target_profile_id
     or user_id = target_profile.auth_user_id;
  if update_settings_staff.role_id is not null then
    insert into public.user_roles (user_profile_id,user_id,role_id)
    values (update_settings_staff.target_profile_id,target_profile.auth_user_id,update_settings_staff.role_id)
    on conflict (user_profile_id, role_id) where user_profile_id is not null do nothing;
  end if;
  if normalized_status = 'inactive' and target_profile.auth_user_id is not null then
    delete from auth.sessions where user_id = target_profile.auth_user_id;
  end if;
  return target_profile;
end;
$$;

revoke execute on function public.get_settings_roles() from anon;
grant execute on function public.get_settings_roles() to authenticated;

-- Replace company-wide fan-out with recipient-specific delivery based on the
-- same role scope used by the record. This function remains internal.
create or replace function public.publish_in_app_notification(
  p_company_id uuid,
  p_event_type text,
  p_source_type text,
  p_source_record_id text,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  inserted_event_id uuid;
  event_module text := p_payload ->> 'module';
  source_id uuid := case
    when coalesce(p_source_record_id, '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then p_source_record_id::uuid else null end;
begin
  if p_company_id is null or nullif(btrim(p_event_type), '') is null
    or jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) <> 'object' then
    raise exception 'Invalid in-app notification event' using errcode = '22023';
  end if;

  insert into public.notification_events (
    company_id, event_type, source_type, source_record_id,
    idempotency_key, payload, occurred_at
  ) values (
    p_company_id, btrim(p_event_type), nullif(btrim(p_source_type), ''),
    nullif(btrim(p_source_record_id), ''), 'in_app:' || gen_random_uuid()::text,
    coalesce(p_payload, '{}'::jsonb), now()
  ) returning id into inserted_event_id;

  insert into public.in_app_notification_receipts (
    company_id, event_id, recipient_user_profile_id
  )
  select distinct p_company_id, inserted_event_id, up.id
  from public.users_profile up
  join public.user_roles ur on ur.user_profile_id = up.id or ur.user_id = up.auth_user_id
  join public.roles r on r.id = ur.role_id and r.organization_id = up.organization_id
  join public.role_module_scopes rms on rms.role_id = r.id and rms.module_key = event_module
  join public.modules m on m.module_key = event_module
  join public.permissions perm on perm.module_id = m.id and perm.action_key = 'view'
  join public.role_permissions rp on rp.role_id = r.id and rp.permission_id = perm.id
  where up.company_id = p_company_id and up.status = 'active' and up.auth_user_id is not null
    and (
      rms.scope_key = 'company'
      or (rms.scope_key = 'assigned_field' and (
        (p_source_type = 'site_surveys' and exists (
          select 1 from public.site_surveys s where s.id = source_id and s.assigned_to = up.id
        ))
        or (p_source_type = 'projects' and exists (
          select 1 from public.projects p
          join public.project_staff_assignments psa on psa.project_id = p.id and psa.is_active
          where p.id = source_id and p.field_released_at is not null and psa.user_profile_id = up.id
        ))
      ))
      or (rms.scope_key = 'assigned_or_unassigned_created' and (
        (p_source_type = 'leads' and exists (select 1 from public.leads x where x.id = source_id and (x.assigned_to = up.id or (x.assigned_to is null and x.created_by = up.id))))
        or (p_source_type = 'customers' and exists (select 1 from public.customers x where x.id = source_id and (x.assigned_to = up.id or (x.assigned_to is null and x.created_by = up.id))))
        or (p_source_type = 'quotations' and exists (select 1 from public.quotations x where x.id = source_id and (x.assigned_to = up.id or (x.assigned_to is null and x.created_by = up.id))))
        or (p_source_type = 'b2b_sales' and exists (select 1 from public.b2b_sales x where x.id = source_id and (x.assigned_to = up.id or (x.assigned_to is null and x.created_by = up.id))))
      ))
      or (rms.scope_key = 'related_operations' and (
        (p_source_type = 'site_surveys' and exists (
          select 1 from public.site_surveys s
          left join public.customers c on c.id = s.customer_id
          left join public.leads l on l.id = s.lead_id
          where s.id = source_id and (c.assigned_to = up.id or l.assigned_to = up.id)
        ))
        or (p_source_type = 'projects' and exists (
          select 1 from public.projects p
          left join public.customers c on c.id = p.customer_id
          left join public.leads l on l.id = p.lead_id
          left join public.quotations q on q.id = p.quotation_id
          where p.id = source_id and (c.assigned_to = up.id or l.assigned_to = up.id or q.assigned_to = up.id)
        ))
      ))
      or (rms.scope_key = 'related_finance' and p_source_type = 'projects' and exists (
        select 1 from public.invoices i where i.project_id = source_id
        union all select 1 from public.payments pay where pay.project_id = source_id
      ))
    )
  on conflict do nothing;

  return inserted_event_id;
end;
$$;

revoke all on function public.publish_in_app_notification(uuid,text,text,text,jsonb)
  from public, anon, authenticated;

create or replace function private.notify_project_field_assignment()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare project_record public.projects%rowtype;
begin
  if new.is_active and (tg_op = 'INSERT' or not coalesce(old.is_active,false)) then
    select * into project_record from public.projects where id = new.project_id;
    if project_record.field_released_at is not null then
      perform public.publish_in_app_notification(
        new.company_id, 'project_assignment_changed', 'projects', new.project_id::text,
        jsonb_build_object(
          'title','Installation assigned',
          'message','You were assigned to an installation project',
          'module','projects',
          'record_label',coalesce(project_record.project_code, project_record.project_name, 'Project'),
          'destination_route','/projects/' || new.project_id::text
        )
      );
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists notify_project_field_assignment on public.project_staff_assignments;
create trigger notify_project_field_assignment
after insert or update of is_active on public.project_staff_assignments
for each row execute function private.notify_project_field_assignment();

notify pgrst, 'reload schema';
