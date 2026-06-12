-- Step 27 documents module foundation.
-- Stores metadata for files uploaded to Supabase Storage. The storage bucket is
-- intentionally managed outside this migration so teams can choose private
-- bucket policies per deployment.

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid references public.customers(id),
  lead_id uuid references public.leads(id),
  project_id uuid references public.projects(id),
  quotation_id uuid references public.quotations(id),
  document_type text not null,
  document_name text not null,
  file_url text not null,
  file_path text not null,
  file_size bigint,
  mime_type text,
  expiry_date date,
  notes text,
  status text default 'pending',
  rejection_note text,
  uploaded_by uuid references public.users_profile(id),
  verified_by uuid references public.users_profile(id),
  verified_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.documents add column if not exists id uuid default gen_random_uuid();
alter table public.documents add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.documents add column if not exists customer_id uuid references public.customers(id);
alter table public.documents add column if not exists lead_id uuid references public.leads(id);
alter table public.documents add column if not exists project_id uuid references public.projects(id);
alter table public.documents add column if not exists quotation_id uuid references public.quotations(id);
alter table public.documents add column if not exists document_type text;
alter table public.documents add column if not exists document_name text;
alter table public.documents add column if not exists file_url text;
alter table public.documents add column if not exists file_path text;
alter table public.documents add column if not exists file_size bigint;
alter table public.documents add column if not exists mime_type text;
alter table public.documents add column if not exists expiry_date date;
alter table public.documents add column if not exists notes text;
alter table public.documents add column if not exists status text default 'pending';
alter table public.documents add column if not exists rejection_note text;
alter table public.documents add column if not exists uploaded_by uuid references public.users_profile(id);
alter table public.documents add column if not exists verified_by uuid references public.users_profile(id);
alter table public.documents add column if not exists verified_at timestamptz;
alter table public.documents add column if not exists created_at timestamptz default now();
alter table public.documents add column if not exists updated_at timestamptz default now();

alter table public.documents alter column id set default gen_random_uuid();
alter table public.documents alter column organization_id set not null;
alter table public.documents alter column document_type set not null;
alter table public.documents alter column document_name set not null;
alter table public.documents alter column file_url set not null;
alter table public.documents alter column file_path set not null;
alter table public.documents alter column status set default 'pending';
alter table public.documents alter column created_at set default now();
alter table public.documents alter column updated_at set default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'documents_document_type_check'
      and conrelid = 'public.documents'::regclass
  ) then
    alter table public.documents
    add constraint documents_document_type_check
    check (
      document_type in (
        'aadhaar',
        'pan',
        'electricity_bill',
        'property_document',
        'quotation_pdf',
        'invoice_pdf',
        'payment_receipt',
        'site_photo',
        'installation_photo',
        'subsidy_document',
        'bank_loan_document',
        'agreement',
        'other'
      )
    );
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'documents_status_check'
      and conrelid = 'public.documents'::regclass
  ) then
    alter table public.documents
    add constraint documents_status_check
    check (status in ('pending', 'verified', 'rejected', 'expired'));
  end if;
end;
$$;

create index if not exists documents_organization_id_idx
on public.documents (organization_id);

create index if not exists documents_customer_id_idx
on public.documents (customer_id);

create index if not exists documents_lead_id_idx
on public.documents (lead_id);

create index if not exists documents_project_id_idx
on public.documents (project_id);

create index if not exists documents_quotation_id_idx
on public.documents (quotation_id);

create index if not exists documents_document_type_idx
on public.documents (document_type);

create index if not exists documents_status_idx
on public.documents (status);

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

drop trigger if exists set_documents_defaults on public.documents;

create trigger set_documents_defaults
before insert or update on public.documents
for each row
execute function public.set_document_defaults();

drop trigger if exists set_documents_updated_at on public.documents;

create trigger set_documents_updated_at
before update on public.documents
for each row
execute function public.set_updated_at();

create or replace function public.verify_document(document_id uuid)
returns public.documents
language plpgsql
security definer
set search_path = public
as $$
declare
  document_record public.documents%rowtype;
  current_profile_id uuid;
begin
  select *
  into document_record
  from public.documents
  where documents.id = document_id
  for update;

  if not found then
    raise exception 'Document not found'
      using errcode = 'P0002';
  end if;

  if not public.is_super_admin()
    and (
      document_record.organization_id <> public.current_user_organization_id()
      or not public.user_has_permission('documents', 'update')
    ) then
    raise exception 'Missing permission to verify document'
      using errcode = '42501';
  end if;

  select users_profile.id
  into current_profile_id
  from public.users_profile
  where users_profile.auth_user_id = auth.uid()
  limit 1;

  update public.documents
  set
    status = 'verified',
    verified_by = current_profile_id,
    verified_at = now(),
    rejection_note = null,
    updated_at = now()
  where documents.id = document_id
  returning * into document_record;

  return document_record;
end;
$$;

create or replace function public.reject_document(document_id uuid, rejection_note text)
returns public.documents
language plpgsql
security definer
set search_path = public
as $$
declare
  document_record public.documents%rowtype;
  current_profile_id uuid;
begin
  select *
  into document_record
  from public.documents
  where documents.id = document_id
  for update;

  if not found then
    raise exception 'Document not found'
      using errcode = 'P0002';
  end if;

  if not public.is_super_admin()
    and (
      document_record.organization_id <> public.current_user_organization_id()
      or not public.user_has_permission('documents', 'update')
    ) then
    raise exception 'Missing permission to reject document'
      using errcode = '42501';
  end if;

  select users_profile.id
  into current_profile_id
  from public.users_profile
  where users_profile.auth_user_id = auth.uid()
  limit 1;

  update public.documents
  set
    status = 'rejected',
    verified_by = current_profile_id,
    verified_at = now(),
    rejection_note = nullif(trim(rejection_note), ''),
    updated_at = now()
  where documents.id = document_id
  returning * into document_record;

  return document_record;
end;
$$;

grant execute on function public.verify_document(uuid) to authenticated;
grant execute on function public.reject_document(uuid, text) to authenticated;

alter table public.documents enable row level security;

drop policy if exists "Super admins can manage documents" on public.documents;
drop policy if exists "Organization users can view documents" on public.documents;
drop policy if exists "Organization users can create documents" on public.documents;
drop policy if exists "Organization users can update documents" on public.documents;
drop policy if exists "Organization users can delete documents" on public.documents;

create policy "Super admins can manage documents"
on public.documents
for all
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

create policy "Organization users can view documents"
on public.documents
for select
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('documents', 'view')
);

create policy "Organization users can create documents"
on public.documents
for insert
to authenticated
with check (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('documents', 'create')
);

create policy "Organization users can update documents"
on public.documents
for update
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('documents', 'update')
)
with check (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('documents', 'update')
);

create policy "Organization users can delete documents"
on public.documents
for delete
to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.user_has_permission('documents', 'delete')
);
