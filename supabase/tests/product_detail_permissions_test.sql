begin;

do $$
begin
  if not has_column_privilege(
    'authenticated',
    'public.products',
    'serial_number',
    'select'
  ) then
    raise exception 'authenticated tenants cannot select the product serial number used by product details';
  end if;

  if not has_column_privilege(
    'authenticated',
    'public.products',
    'product_name',
    'select'
  ) then
    raise exception 'authenticated tenants lost access to public product detail columns';
  end if;

  if has_column_privilege(
    'authenticated',
    'public.products',
    'purchase_price',
    'select'
  ) then
    raise exception 'authenticated tenants can select protected product purchase pricing';
  end if;

  if has_column_privilege(
    'authenticated',
    'public.products',
    'selling_price',
    'select'
  ) then
    raise exception 'authenticated tenants can select protected product selling pricing';
  end if;
end;
$$;

rollback;
