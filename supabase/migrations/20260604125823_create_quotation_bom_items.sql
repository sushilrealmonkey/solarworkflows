-- Storage foundation for generated quotation BOM rows.
-- No generation, quantity calculation, product assignment, pricing, or inventory reservation is added here.

create table if not exists public.quotation_bom_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.organizations(id) on delete cascade,
  quotation_id uuid not null references public.quotations(id) on delete cascade,
  bom_template_rule_id uuid not null references public.bom_template_lines(id) on delete restrict,
  product_category_id uuid not null references public.product_categories(id) on delete restrict,
  product_id uuid references public.products(id) on delete restrict,
  calculation_type public.bom_calculation_type not null,
  quantity numeric not null,
  unit text,
  is_required boolean not null default true,
  manually_modified boolean not null default false,
  is_auto_generated boolean not null default true,
  display_order integer not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists quotation_bom_items_tenant_id_idx
on public.quotation_bom_items (tenant_id);

create index if not exists quotation_bom_items_quotation_id_idx
on public.quotation_bom_items (quotation_id);

create index if not exists quotation_bom_items_rule_id_idx
on public.quotation_bom_items (bom_template_rule_id);

create index if not exists quotation_bom_items_category_id_idx
on public.quotation_bom_items (product_category_id);

create index if not exists quotation_bom_items_product_id_idx
on public.quotation_bom_items (product_id)
where product_id is not null;

create index if not exists quotation_bom_items_calculation_type_idx
on public.quotation_bom_items (calculation_type);

create index if not exists quotation_bom_items_display_order_idx
on public.quotation_bom_items (quotation_id, display_order);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'quotation_bom_items_quantity_positive_check'
      and conrelid = 'public.quotation_bom_items'::regclass
  ) then
    alter table public.quotation_bom_items
    add constraint quotation_bom_items_quantity_positive_check
    check (quantity > 0);
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'quotation_bom_items_display_order_positive_check'
      and conrelid = 'public.quotation_bom_items'::regclass
  ) then
    alter table public.quotation_bom_items
    add constraint quotation_bom_items_display_order_positive_check
    check (display_order > 0);
  end if;
end;
$$;

create or replace function public.set_quotation_bom_item_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_quotation public.quotations%rowtype;
  parent_rule public.bom_template_lines%rowtype;
  selected_category_tenant_id uuid;
  selected_product_tenant_id uuid;
  selected_product_category_id uuid;
begin
  new.unit := nullif(lower(btrim(coalesce(new.unit, ''))), '');
  new.notes := nullif(btrim(coalesce(new.notes, '')), '');
  new.is_required := coalesce(new.is_required, true);
  new.manually_modified := coalesce(new.manually_modified, false);
  new.is_auto_generated := coalesce(new.is_auto_generated, true);

  select *
  into parent_quotation
  from public.quotations
  where quotations.id = new.quotation_id;

  if parent_quotation.id is null then
    raise exception 'quotation_id must reference an existing quotation'
      using errcode = '23503';
  end if;

  if new.tenant_id is null then
    new.tenant_id := parent_quotation.organization_id;
  end if;

  if new.tenant_id <> parent_quotation.organization_id then
    raise exception 'quotation BOM item tenant_id must match the quotation organization'
      using errcode = '23503';
  end if;

  select *
  into parent_rule
  from public.bom_template_lines
  where bom_template_lines.id = new.bom_template_rule_id;

  if parent_rule.id is null then
    raise exception 'bom_template_rule_id must reference an existing BOM template rule'
      using errcode = '23503';
  end if;

  if parent_rule.tenant_id <> new.tenant_id then
    raise exception 'bom_template_rule_id must belong to the same tenant as the quotation BOM item'
      using errcode = '23503';
  end if;

  if parent_rule.calculation_type <> new.calculation_type then
    raise exception 'calculation_type must match the BOM template rule'
      using errcode = '23503';
  end if;

  if parent_quotation.bom_template_id is not null
    and parent_rule.bom_template_id <> parent_quotation.bom_template_id then
    raise exception 'bom_template_rule_id must belong to the quotation BOM template'
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
    raise exception 'product_category_id must belong to the same tenant as the quotation BOM item'
      using errcode = '23503';
  end if;

  if parent_rule.product_category_id <> new.product_category_id then
    raise exception 'product_category_id must match the BOM template rule category'
      using errcode = '23503';
  end if;

  if new.product_id is not null then
    select products.tenant_id, products.category_id
    into selected_product_tenant_id, selected_product_category_id
    from public.products
    where products.id = new.product_id;

    if selected_product_tenant_id is null then
      raise exception 'product_id must reference an existing product'
        using errcode = '23503';
    end if;

    if selected_product_tenant_id <> new.tenant_id then
      raise exception 'product_id must belong to the same tenant as the quotation BOM item'
        using errcode = '23503';
    end if;

    if selected_product_category_id <> new.product_category_id then
      raise exception 'product_id must belong to the selected product category'
        using errcode = '23503';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists set_quotation_bom_items_defaults on public.quotation_bom_items;

create trigger set_quotation_bom_items_defaults
before insert or update on public.quotation_bom_items
for each row
execute function public.set_quotation_bom_item_defaults();

drop trigger if exists set_quotation_bom_items_updated_at on public.quotation_bom_items;

create trigger set_quotation_bom_items_updated_at
before update on public.quotation_bom_items
for each row
execute function public.set_updated_at();

alter table public.quotation_bom_items enable row level security;

grant select, insert, update, delete on public.quotation_bom_items to authenticated;
grant select on public.products to authenticated;

drop policy if exists "Super admins can manage quotation BOM items" on public.quotation_bom_items;
drop policy if exists "Organization users can view quotation BOM items" on public.quotation_bom_items;
drop policy if exists "Organization users can create quotation BOM items" on public.quotation_bom_items;
drop policy if exists "Organization users can update quotation BOM items" on public.quotation_bom_items;
drop policy if exists "Organization users can delete quotation BOM items" on public.quotation_bom_items;

create policy "Super admins can manage quotation BOM items"
on public.quotation_bom_items
for all
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

create policy "Organization users can view quotation BOM items"
on public.quotation_bom_items
for select
to authenticated
using (
  tenant_id = public.current_user_organization_id()
  and public.user_has_permission('quotations', 'view')
);

create policy "Organization users can create quotation BOM items"
on public.quotation_bom_items
for insert
to authenticated
with check (
  tenant_id = public.current_user_organization_id()
  and (
    public.user_has_permission('quotations', 'create')
    or public.user_has_permission('quotations', 'update')
  )
);

create policy "Organization users can update quotation BOM items"
on public.quotation_bom_items
for update
to authenticated
using (
  tenant_id = public.current_user_organization_id()
  and public.user_has_permission('quotations', 'update')
)
with check (
  tenant_id = public.current_user_organization_id()
  and public.user_has_permission('quotations', 'update')
);

create policy "Organization users can delete quotation BOM items"
on public.quotation_bom_items
for delete
to authenticated
using (
  tenant_id = public.current_user_organization_id()
  and public.user_has_permission('quotations', 'update')
);

drop policy if exists "Tenant quotation users can view products" on public.products;

create policy "Tenant quotation users can view products"
on public.products
for select
to authenticated
using (
  tenant_id = public.current_user_organization_id()
  and public.user_has_permission('quotations', 'view')
);

revoke execute on function public.set_quotation_bom_item_defaults() from public, authenticated;

notify pgrst, 'reload schema';
