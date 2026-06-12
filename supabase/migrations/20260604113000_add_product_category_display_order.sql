-- Adds display ordering for product categories across category lists and selectors.

alter table public.product_categories
add column if not exists display_order integer not null default 999;

update public.product_categories
set display_order = case
  when category_type = 'SOLAR_PANEL'::public.product_category_type then 1
  when category_type = 'INVERTER'::public.product_category_type then 2
  when category_type = 'STRUCTURE'::public.product_category_type then 3
  when category_type = 'DC_CABLE'::public.product_category_type then 4
  when category_type = 'AC_CABLE'::public.product_category_type then 5
  when category_type = 'EARTHING'::public.product_category_type then 6
  when category_type = 'PROTECTION_DEVICE'::public.product_category_type then 7
  when category_type = 'LIGHTNING_ARRESTOR'::public.product_category_type then 8
  when category_type = 'MONITORING_DEVICE'::public.product_category_type then 9
  when category_type = 'BATTERY'::public.product_category_type then 10
  when category_type = 'ACCESSORY'::public.product_category_type then 11
  else 999
end
where display_order = 999
  or display_order is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'product_categories_display_order_positive_check'
      and conrelid = 'public.product_categories'::regclass
  ) then
    alter table public.product_categories
    add constraint product_categories_display_order_positive_check
    check (display_order > 0);
  end if;
end;
$$;

create index if not exists product_categories_display_order_name_idx
on public.product_categories (tenant_id, display_order, name);

create or replace function public.set_product_category_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.name := btrim(new.name);
  new.description := nullif(btrim(coalesce(new.description, '')), '');

  if new.name = '' then
    raise exception 'Category name is required'
      using errcode = '23502';
  end if;

  if new.category_type is null then
    raise exception 'Category type is required'
      using errcode = '23502';
  end if;

  if new.display_order is null then
    raise exception 'Display order is required'
      using errcode = '23502';
  end if;

  if new.display_order <= 0 then
    raise exception 'Display order must be a positive integer'
      using errcode = '23514';
  end if;

  if tg_op = 'UPDATE'
    and old.category_type is distinct from new.category_type
    and not public.is_super_admin() then
    raise exception 'Only super admins can change category type'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create or replace function public.seed_default_product_categories(target_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if target_tenant_id is null then
    return;
  end if;

  insert into public.product_categories (
    tenant_id,
    name,
    category_type,
    display_order
  )
  select target_tenant_id, category_name, category_type, display_order
  from (
    values
      ('Solar Panels', 'SOLAR_PANEL'::public.product_category_type, 1),
      ('Inverters', 'INVERTER'::public.product_category_type, 2),
      ('Structure', 'STRUCTURE'::public.product_category_type, 3),
      ('DC Cable', 'DC_CABLE'::public.product_category_type, 4),
      ('AC Cable', 'AC_CABLE'::public.product_category_type, 5),
      ('Earthing', 'EARTHING'::public.product_category_type, 6),
      ('Protection Devices', 'PROTECTION_DEVICE'::public.product_category_type, 7),
      ('Lightning Arrestor', 'LIGHTNING_ARRESTOR'::public.product_category_type, 8),
      ('Monitoring Devices', 'MONITORING_DEVICE'::public.product_category_type, 9),
      ('Battery', 'BATTERY'::public.product_category_type, 10),
      ('Accessories', 'ACCESSORY'::public.product_category_type, 11),
      ('Other', 'OTHER'::public.product_category_type, 999)
  ) as default_categories(category_name, category_type, display_order)
  where not exists (
    select 1
    from public.product_categories
    where product_categories.tenant_id = target_tenant_id
      and (
        lower(btrim(product_categories.name)) = lower(btrim(category_name))
        or (
          product_categories.category_type = default_categories.category_type
          and default_categories.category_type <> 'OTHER'::public.product_category_type
        )
      )
  );

  update public.product_categories
  set display_order = default_categories.display_order
  from (
    values
      ('SOLAR_PANEL'::public.product_category_type, 1),
      ('INVERTER'::public.product_category_type, 2),
      ('STRUCTURE'::public.product_category_type, 3),
      ('DC_CABLE'::public.product_category_type, 4),
      ('AC_CABLE'::public.product_category_type, 5),
      ('EARTHING'::public.product_category_type, 6),
      ('PROTECTION_DEVICE'::public.product_category_type, 7),
      ('LIGHTNING_ARRESTOR'::public.product_category_type, 8),
      ('MONITORING_DEVICE'::public.product_category_type, 9),
      ('BATTERY'::public.product_category_type, 10),
      ('ACCESSORY'::public.product_category_type, 11),
      ('OTHER'::public.product_category_type, 999)
  ) as default_categories(category_type, display_order)
  where product_categories.tenant_id = target_tenant_id
    and product_categories.category_type = default_categories.category_type
    and (
      product_categories.display_order is null
      or product_categories.display_order = 999
      or product_categories.name in (
        'Solar Panels',
        'Inverters',
        'Structure',
        'DC Cable',
        'AC Cable',
        'Earthing',
        'Protection Devices',
        'Lightning Arrestor',
        'Monitoring Devices',
        'Battery',
        'Accessories',
        'Other'
      )
    );
end;
$$;

select public.seed_default_product_categories(organizations.id)
from public.organizations;

notify pgrst, 'reload schema';
