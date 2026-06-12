-- Adds nullable quotation template and grouped BOM item fields.
-- Existing quotation items remain valid because legacy item_name/description fields are kept.

alter table public.quotations add column if not exists template_type text;

alter table public.quotation_items add column if not exists section_name text;
alter table public.quotation_items add column if not exists material text;
alter table public.quotation_items add column if not exists specification text;
alter table public.quotation_items add column if not exists make text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'quotations_template_type_check'
      and conrelid = 'public.quotations'::regclass
  ) then
    alter table public.quotations
    add constraint quotations_template_type_check
    check (
      template_type is null
      or template_type in ('Standard Quotation', 'Technical & Commercial Proposal')
    );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'quotation_items_section_name_check'
      and conrelid = 'public.quotation_items'::regclass
  ) then
    alter table public.quotation_items
    add constraint quotation_items_section_name_check
    check (
      section_name is null
      or section_name in (
        'Solar Components',
        'Electrical & Accessories',
        'Civil & Mechanical Work',
        'EPC & DISCOM Charges'
      )
    );
  end if;
end;
$$;
