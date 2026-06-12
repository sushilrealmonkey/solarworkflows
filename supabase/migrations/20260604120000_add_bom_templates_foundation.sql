-- BOM template foundation for future quotation generation.
-- This creates tenant-scoped template metadata and line rules only.

do $$
begin
  if not exists (
    select 1
    from pg_type
    where typname = 'bom_calculation_type'
      and typnamespace = 'public'::regnamespace
  ) then
    create type public.bom_calculation_type as enum (
      'fixed_quantity',
      'per_kw',
      'panel_count',
      'inverter_count',
      'manual'
    );
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_type
    where typname = 'bom_template_type'
      and typnamespace = 'public'::regnamespace
  ) then
    create type public.bom_template_type as enum (
      'residential',
      'commercial',
      'industrial',
      'ground_mount',
      'agricultural',
      'custom'
    );
  end if;
end;
$$;

create table if not exists public.bom_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  template_type public.bom_template_type not null,
  category_type public.product_category_type,
  category_id uuid references public.product_categories(id) on delete restrict,
  description text,
  is_active boolean not null default true,
  display_order integer default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bom_template_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.organizations(id) on delete cascade,
  bom_template_id uuid not null references public.bom_templates(id) on delete cascade,
  product_category_id uuid not null references public.product_categories(id) on delete restrict,
  product_subcategory_id uuid,
  calculation_type public.bom_calculation_type not null,
  formula_value numeric,
  fixed_quantity numeric,
  unit text not null,
  display_order integer not null default 1,
  is_required boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.bom_template_lines.product_subcategory_id is
  'Reserved nullable subcategory reference for future product master expansion.';

create unique index if not exists bom_templates_tenant_name_unique
on public.bom_templates (tenant_id, lower(btrim(name)));

create index if not exists bom_templates_tenant_id_idx
on public.bom_templates (tenant_id);

create index if not exists bom_templates_template_type_idx
on public.bom_templates (template_type);

create index if not exists bom_templates_category_type_idx
on public.bom_templates (category_type);

create index if not exists bom_templates_category_id_idx
on public.bom_templates (category_id);

create index if not exists bom_templates_is_active_idx
on public.bom_templates (is_active);

create index if not exists bom_templates_display_order_idx
on public.bom_templates (tenant_id, display_order);

create index if not exists bom_template_lines_tenant_id_idx
on public.bom_template_lines (tenant_id);

create index if not exists bom_template_lines_bom_template_id_idx
on public.bom_template_lines (bom_template_id);

create index if not exists bom_template_lines_product_category_id_idx
on public.bom_template_lines (product_category_id);

create index if not exists bom_template_lines_product_subcategory_id_idx
on public.bom_template_lines (product_subcategory_id)
where product_subcategory_id is not null;

create index if not exists bom_template_lines_calculation_type_idx
on public.bom_template_lines (calculation_type);

create index if not exists bom_template_lines_display_order_idx
on public.bom_template_lines (bom_template_id, display_order);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'bom_templates_display_order_positive_check'
      and conrelid = 'public.bom_templates'::regclass
  ) then
    alter table public.bom_templates
    add constraint bom_templates_display_order_positive_check
    check (display_order > 0);
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'bom_template_lines_display_order_positive_check'
      and conrelid = 'public.bom_template_lines'::regclass
  ) then
    alter table public.bom_template_lines
    add constraint bom_template_lines_display_order_positive_check
    check (display_order > 0);
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'bom_template_lines_quantity_values_positive_check'
      and conrelid = 'public.bom_template_lines'::regclass
  ) then
    alter table public.bom_template_lines
    add constraint bom_template_lines_quantity_values_positive_check
    check (
      (formula_value is null or formula_value > 0)
      and (fixed_quantity is null or fixed_quantity > 0)
    );
  end if;
end;
$$;

create or replace function public.set_bom_template_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_category_tenant_id uuid;
  selected_category_type public.product_category_type;
begin
  new.name := btrim(new.name);
  new.description := nullif(btrim(coalesce(new.description, '')), '');
  new.is_active := coalesce(new.is_active, true);

  if new.name = '' then
    raise exception 'BOM template name is required'
      using errcode = '23502';
  end if;

  if new.category_id is not null then
    select product_categories.tenant_id, product_categories.category_type
    into selected_category_tenant_id, selected_category_type
    from public.product_categories
    where product_categories.id = new.category_id;

    if selected_category_tenant_id is null then
      raise exception 'category_id must reference an existing product category'
        using errcode = '23503';
    end if;

    if selected_category_tenant_id <> new.tenant_id then
      raise exception 'category_id must belong to the same tenant as the BOM template'
        using errcode = '23503';
    end if;

    if new.category_type is null then
      new.category_type := selected_category_type;
    elsif new.category_type <> selected_category_type then
      raise exception 'category_type must match the selected product category'
        using errcode = '23503';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.set_bom_template_line_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_template_tenant_id uuid;
  selected_category_tenant_id uuid;
begin
  new.unit := lower(btrim(new.unit));
  new.notes := nullif(btrim(coalesce(new.notes, '')), '');
  new.is_required := coalesce(new.is_required, true);

  if new.unit = '' then
    raise exception 'Unit is required'
      using errcode = '23502';
  end if;

  select bom_templates.tenant_id
  into selected_template_tenant_id
  from public.bom_templates
  where bom_templates.id = new.bom_template_id;

  if selected_template_tenant_id is null then
    raise exception 'bom_template_id must reference an existing BOM template'
      using errcode = '23503';
  end if;

  if selected_template_tenant_id <> new.tenant_id then
    raise exception 'bom_template_id must belong to the same tenant as the BOM template line'
      using errcode = '23503';
  end if;

  select product_categories.tenant_id
  into selected_category_tenant_id
  from public.product_categories
  where product_categories.id = new.product_category_id;

  if selected_category_tenant_id is null then
    raise exception 'product_category_id must reference an existing product category'
      using errcode = '23503';
  end if;

  if selected_category_tenant_id <> new.tenant_id then
    raise exception 'product_category_id must belong to the same tenant as the BOM template line'
      using errcode = '23503';
  end if;

  return new;
end;
$$;

drop trigger if exists set_bom_templates_defaults on public.bom_templates;

create trigger set_bom_templates_defaults
before insert or update on public.bom_templates
for each row
execute function public.set_bom_template_defaults();

drop trigger if exists set_bom_templates_updated_at on public.bom_templates;

create trigger set_bom_templates_updated_at
before update on public.bom_templates
for each row
execute function public.set_updated_at();

drop trigger if exists set_bom_template_lines_defaults on public.bom_template_lines;

create trigger set_bom_template_lines_defaults
before insert or update on public.bom_template_lines
for each row
execute function public.set_bom_template_line_defaults();

drop trigger if exists set_bom_template_lines_updated_at on public.bom_template_lines;

create trigger set_bom_template_lines_updated_at
before update on public.bom_template_lines
for each row
execute function public.set_updated_at();

alter table public.bom_templates enable row level security;
alter table public.bom_template_lines enable row level security;

grant select, insert, update, delete on public.bom_templates to authenticated;
grant select, insert, update, delete on public.bom_template_lines to authenticated;

drop policy if exists "Super admins can manage BOM templates" on public.bom_templates;
drop policy if exists "Tenant users can view BOM templates" on public.bom_templates;
drop policy if exists "Tenant users can create BOM templates" on public.bom_templates;
drop policy if exists "Tenant users can update BOM templates" on public.bom_templates;
drop policy if exists "Tenant users can delete BOM templates" on public.bom_templates;

create policy "Super admins can manage BOM templates"
on public.bom_templates
for all
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

create policy "Tenant users can view BOM templates"
on public.bom_templates
for select
to authenticated
using (
  tenant_id = public.current_user_organization_id()
  and public.user_has_permission('product_master', 'view')
);

create policy "Tenant users can create BOM templates"
on public.bom_templates
for insert
to authenticated
with check (
  tenant_id = public.current_user_organization_id()
  and public.user_has_permission('product_master', 'create')
);

create policy "Tenant users can update BOM templates"
on public.bom_templates
for update
to authenticated
using (
  tenant_id = public.current_user_organization_id()
  and public.user_has_permission('product_master', 'update')
)
with check (
  tenant_id = public.current_user_organization_id()
  and public.user_has_permission('product_master', 'update')
);

create policy "Tenant users can delete BOM templates"
on public.bom_templates
for delete
to authenticated
using (
  tenant_id = public.current_user_organization_id()
  and public.user_has_permission('product_master', 'delete')
);

drop policy if exists "Super admins can manage BOM template lines" on public.bom_template_lines;
drop policy if exists "Tenant users can view BOM template lines" on public.bom_template_lines;
drop policy if exists "Tenant users can create BOM template lines" on public.bom_template_lines;
drop policy if exists "Tenant users can update BOM template lines" on public.bom_template_lines;
drop policy if exists "Tenant users can delete BOM template lines" on public.bom_template_lines;

create policy "Super admins can manage BOM template lines"
on public.bom_template_lines
for all
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

create policy "Tenant users can view BOM template lines"
on public.bom_template_lines
for select
to authenticated
using (
  tenant_id = public.current_user_organization_id()
  and public.user_has_permission('product_master', 'view')
);

create policy "Tenant users can create BOM template lines"
on public.bom_template_lines
for insert
to authenticated
with check (
  tenant_id = public.current_user_organization_id()
  and public.user_has_permission('product_master', 'create')
);

create policy "Tenant users can update BOM template lines"
on public.bom_template_lines
for update
to authenticated
using (
  tenant_id = public.current_user_organization_id()
  and public.user_has_permission('product_master', 'update')
)
with check (
  tenant_id = public.current_user_organization_id()
  and public.user_has_permission('product_master', 'update')
);

create policy "Tenant users can delete BOM template lines"
on public.bom_template_lines
for delete
to authenticated
using (
  tenant_id = public.current_user_organization_id()
  and public.user_has_permission('product_master', 'delete')
);

revoke execute on function public.set_bom_template_defaults() from public, authenticated;
revoke execute on function public.set_bom_template_line_defaults() from public, authenticated;

notify pgrst, 'reload schema';
