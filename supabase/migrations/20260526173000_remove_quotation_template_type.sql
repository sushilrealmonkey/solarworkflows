-- Removes the quotation template switch.
-- Quotation records now use the proposal workflow directly without selecting a template.

alter table public.quotations
  drop constraint if exists quotations_template_type_check;

alter table public.quotations
  drop column if exists template_type;
