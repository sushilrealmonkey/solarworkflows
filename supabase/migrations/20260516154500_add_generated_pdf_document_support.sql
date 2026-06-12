-- Step 33 generated PDF document support.
-- Adds invoice links to documents and a documents:create-gated helper for
-- generated quotation and invoice PDF metadata.

alter table public.documents add column if not exists invoice_id uuid references public.invoices(id);

create index if not exists documents_invoice_id_idx
on public.documents (invoice_id);

create or replace function public.set_document_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_profile_id uuid;
begin
  new.status := coalesce(nullif(trim(new.status), ''), 'pending');

  if new.uploaded_by is null and auth.uid() is not null then
    select users_profile.id
    into current_profile_id
    from public.users_profile
    where users_profile.auth_user_id = auth.uid()
    limit 1;

    new.uploaded_by := current_profile_id;
  end if;

  if new.customer_id is not null and not exists (
    select 1
    from public.customers
    where customers.id = new.customer_id
      and customers.organization_id = new.organization_id
  ) then
    raise exception 'customer_id must belong to the same organization as the document'
      using errcode = '23503';
  end if;

  if new.lead_id is not null and not exists (
    select 1
    from public.leads
    where leads.id = new.lead_id
      and leads.organization_id = new.organization_id
  ) then
    raise exception 'lead_id must belong to the same organization as the document'
      using errcode = '23503';
  end if;

  if new.project_id is not null and not exists (
    select 1
    from public.projects
    where projects.id = new.project_id
      and projects.organization_id = new.organization_id
      and (
        new.customer_id is null
        or projects.customer_id = new.customer_id
      )
  ) then
    raise exception 'project_id must belong to the same organization and customer as the document'
      using errcode = '23503';
  end if;

  if new.quotation_id is not null and not exists (
    select 1
    from public.quotations
    where quotations.id = new.quotation_id
      and quotations.organization_id = new.organization_id
      and (
        new.customer_id is null
        or quotations.customer_id = new.customer_id
      )
  ) then
    raise exception 'quotation_id must belong to the same organization and customer as the document'
      using errcode = '23503';
  end if;

  if new.invoice_id is not null and not exists (
    select 1
    from public.invoices
    where invoices.id = new.invoice_id
      and invoices.organization_id = new.organization_id
      and (
        new.customer_id is null
        or invoices.customer_id = new.customer_id
      )
      and (
        new.project_id is null
        or invoices.project_id = new.project_id
      )
  ) then
    raise exception 'invoice_id must belong to the same organization, customer, and project as the document'
      using errcode = '23503';
  end if;

  if new.uploaded_by is not null and not exists (
    select 1
    from public.users_profile
    where users_profile.id = new.uploaded_by
      and users_profile.organization_id = new.organization_id
  ) then
    raise exception 'uploaded_by must belong to the same organization as the document'
      using errcode = '23503';
  end if;

  return new;
end;
$$;

create or replace function public.get_generated_document(target_file_path text)
returns public.documents
language plpgsql
security definer
set search_path = public
as $$
declare
  current_organization_id uuid;
  document_record public.documents%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to read generated documents'
      using errcode = '42501';
  end if;

  if not public.user_has_permission('documents', 'create') then
    raise exception 'Missing documents:create permission'
      using errcode = '42501';
  end if;

  current_organization_id := public.current_user_organization_id();

  select *
  into document_record
  from public.documents
  where documents.file_path = target_file_path
    and (
      public.is_super_admin()
      or documents.organization_id = current_organization_id
    )
  order by documents.updated_at desc nulls last, documents.created_at desc nulls last
  limit 1;

  return document_record;
end;
$$;

create or replace function public.get_business_document_settings()
returns public.organization_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  current_organization_id uuid;
  settings_record public.organization_settings%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to read document settings'
      using errcode = '42501';
  end if;

  if not public.user_has_permission('documents', 'create') then
    raise exception 'Missing documents:create permission'
      using errcode = '42501';
  end if;

  if not (
    public.user_has_permission('quotations', 'view')
    or public.user_has_permission('invoices', 'view')
  ) then
    raise exception 'Missing business document view permission'
      using errcode = '42501';
  end if;

  current_organization_id := public.current_user_organization_id();

  if current_organization_id is null then
    raise exception 'Current user is not assigned to an active organization'
      using errcode = '23502';
  end if;

  insert into public.organization_settings (organization_id)
  values (current_organization_id)
  on conflict (organization_id) do nothing;

  select *
  into settings_record
  from public.organization_settings
  where organization_settings.organization_id = current_organization_id
  limit 1;

  return settings_record;
end;
$$;

create or replace function public.upsert_generated_document(
  target_document_type text,
  target_document_name text,
  target_file_url text,
  target_file_path text,
  target_file_size bigint,
  target_mime_type text,
  target_customer_id uuid default null,
  target_project_id uuid default null,
  target_quotation_id uuid default null,
  target_invoice_id uuid default null,
  target_notes text default null
)
returns public.documents
language plpgsql
security definer
set search_path = public
as $$
declare
  current_organization_id uuid;
  current_profile_id uuid;
  document_record public.documents%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to save generated documents'
      using errcode = '42501';
  end if;

  if not public.user_has_permission('documents', 'create') then
    raise exception 'Missing documents:create permission'
      using errcode = '42501';
  end if;

  if target_document_type not in ('quotation_pdf', 'invoice_pdf') then
    raise exception 'Unsupported generated document type'
      using errcode = '22023';
  end if;

  current_organization_id := public.current_user_organization_id();

  if current_organization_id is null then
    raise exception 'Current user is not assigned to an active organization'
      using errcode = '23502';
  end if;

  select users_profile.id
  into current_profile_id
  from public.users_profile
  where users_profile.auth_user_id = auth.uid()
  limit 1;

  select *
  into document_record
  from public.documents
  where documents.organization_id = current_organization_id
    and documents.file_path = target_file_path
  order by documents.updated_at desc nulls last, documents.created_at desc nulls last
  limit 1
  for update;

  if found then
    update public.documents
    set
      customer_id = target_customer_id,
      project_id = target_project_id,
      quotation_id = target_quotation_id,
      invoice_id = target_invoice_id,
      document_type = target_document_type,
      document_name = nullif(trim(target_document_name), ''),
      file_url = target_file_url,
      file_path = target_file_path,
      file_size = target_file_size,
      mime_type = coalesce(nullif(trim(target_mime_type), ''), 'application/pdf'),
      notes = nullif(trim(target_notes), ''),
      uploaded_by = current_profile_id,
      status = 'pending',
      updated_at = now()
    where documents.id = document_record.id
    returning * into document_record;
  else
    insert into public.documents (
      organization_id,
      customer_id,
      project_id,
      quotation_id,
      invoice_id,
      document_type,
      document_name,
      file_url,
      file_path,
      file_size,
      mime_type,
      notes,
      uploaded_by,
      status
    )
    values (
      current_organization_id,
      target_customer_id,
      target_project_id,
      target_quotation_id,
      target_invoice_id,
      target_document_type,
      nullif(trim(target_document_name), ''),
      target_file_url,
      target_file_path,
      target_file_size,
      coalesce(nullif(trim(target_mime_type), ''), 'application/pdf'),
      nullif(trim(target_notes), ''),
      current_profile_id,
      'pending'
    )
    returning * into document_record;
  end if;

  return document_record;
end;
$$;

grant execute on function public.get_generated_document(text) to authenticated;
grant execute on function public.get_business_document_settings() to authenticated;
grant execute on function public.upsert_generated_document(text, text, text, text, bigint, text, uuid, uuid, uuid, uuid, text) to authenticated;
