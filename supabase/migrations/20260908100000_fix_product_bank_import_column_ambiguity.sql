-- The RPC returns product_bank_id, which is also a Products table column.
-- Recompile it with column precedence so the partial unique index can be used
-- safely by its ON CONFLICT clause.
do $$
declare
  function_definition text;
begin
  select pg_get_functiondef('public.import_product_bank_products(uuid[])'::regprocedure)
  into function_definition;

  if position('#variable_conflict use_column' in function_definition) = 0 then
    function_definition := replace(
      function_definition,
      E'AS $function$\ndeclare',
      E'AS $function$\n#variable_conflict use_column\ndeclare'
    );

    if position('#variable_conflict use_column' in function_definition) = 0 then
      raise exception 'Could not apply the Product Bank import conflict-resolution directive';
    end if;
  end if;

  execute function_definition;
end;
$$;

revoke all on function public.import_product_bank_products(uuid[]) from public, anon;
grant execute on function public.import_product_bank_products(uuid[]) to authenticated;

notify pgrst, 'reload schema';
