-- Ensure the product-backed BOM rules relationship exists even if product_id
-- was created separately before the product foreign key was registered.

alter table public.bom_template_lines
add column if not exists product_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'bom_template_lines_product_id_fkey'
      and conrelid = 'public.bom_template_lines'::regclass
  ) then
    alter table public.bom_template_lines
    add constraint bom_template_lines_product_id_fkey
    foreign key (product_id)
    references public.products(id)
    on delete restrict
    not valid;
  end if;
end;
$$;

create index if not exists bom_template_lines_product_id_idx
on public.bom_template_lines (product_id);

notify pgrst, 'reload schema';
