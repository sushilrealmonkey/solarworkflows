-- Rename the visible module label while preserving the stable module key.

insert into public.modules (
  module_key,
  module_name,
  description,
  sort_order,
  is_active
)
values (
  'product_master',
  'Products & Materials',
  'Central products and materials catalog used by inventory, purchases, quotations, projects, and reports',
  385,
  true
)
on conflict (module_key) do update
set module_name = excluded.module_name,
    description = excluded.description,
    sort_order = excluded.sort_order,
    is_active = true;

notify pgrst, 'reload schema';
