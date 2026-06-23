-- Keep the newer organization-facing app model connected to the older
-- company_id tenant model required by company-scoped business tables.

alter table public.organizations
add column if not exists company_id uuid references public.companies(id) on delete set null;

create index if not exists organizations_company_id_idx
on public.organizations (company_id);

-- Reuse an existing company when the legacy company slug/subdomain matches the
-- organization; otherwise create a neutral backing company for the organization.
update public.organizations
set company_id = companies.id
from public.companies
where organizations.company_id is null
  and (
    companies.company_slug = organizations.slug
    or (
      organizations.subdomain is not null
      and companies.default_subdomain = organizations.subdomain
    )
  );

insert into public.companies (
  company_name,
  company_slug,
  owner_email,
  owner_phone,
  status,
  created_at,
  updated_at
)
select
  organizations.name,
  'org-' || organizations.id::text,
  organization_settings.contact_email,
  organization_settings.contact_phone,
  coalesce(organizations.status, 'active'),
  coalesce(organizations.created_at, now()),
  now()
from public.organizations
left join public.organization_settings
  on organization_settings.organization_id = organizations.id
where organizations.company_id is null
on conflict (company_slug) do update
set
  company_name = excluded.company_name,
  owner_email = coalesce(public.companies.owner_email, excluded.owner_email),
  owner_phone = coalesce(public.companies.owner_phone, excluded.owner_phone),
  status = coalesce(public.companies.status, excluded.status),
  updated_at = now();

update public.organizations
set company_id = companies.id
from public.companies
where organizations.company_id is null
  and companies.company_slug = 'org-' || organizations.id::text;

update public.users_profile
set
  company_id = organizations.company_id,
  updated_at = now()
from public.organizations
where users_profile.organization_id = organizations.id
  and organizations.company_id is not null
  and users_profile.company_id is distinct from organizations.company_id;

update public.profiles
set
  company_id = organizations.company_id,
  updated_at = now()
from public.organizations
where profiles.organization_id = organizations.id
  and organizations.company_id is not null
  and profiles.company_id is distinct from organizations.company_id;

update public.roles
set
  company_id = organizations.company_id,
  updated_at = now()
from public.organizations
where roles.organization_id = organizations.id
  and organizations.company_id is not null
  and roles.company_id is distinct from organizations.company_id;

create or replace function public.get_current_user_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select users_profile.company_id
      from public.users_profile
      where users_profile.auth_user_id = auth.uid()
        and users_profile.status = 'active'
      limit 1
    ),
    (
      select profiles.company_id
      from public.profiles
      where profiles.id = auth.uid()
      limit 1
    )
  );
$$;

create or replace function public.create_organization_with_admin(
  organization_name text,
  organization_slug text,
  admin_full_name text,
  admin_phone text,
  admin_email text default null,
  admin_auth_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  new_company_id uuid := gen_random_uuid();
  new_organization_id uuid;
  admin_role_id uuid;
  admin_profile_id uuid;
  normalized_slug text;
  normalized_admin_email text;
  normalized_admin_phone text;
  admin_profile_status text := 'pending_auth_invite';
begin
  if not public.is_super_admin() then
    raise exception 'Only super admins can create organizations'
      using errcode = '42501';
  end if;

  normalized_slug := lower(trim(organization_slug));
  normalized_admin_email := nullif(lower(trim(admin_email)), '');
  normalized_admin_phone := nullif(trim(admin_phone), '');

  if normalized_admin_email is null then
    raise exception 'Primary admin email is required'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.users_profile
    where lower(users_profile.email) = normalized_admin_email
  ) then
    raise exception 'A user profile already exists for this admin email'
      using errcode = '23505';
  end if;

  if normalized_admin_phone is not null and exists (
    select 1
    from public.users_profile
    where users_profile.phone = normalized_admin_phone
  ) then
    raise exception 'A user profile already exists for this admin phone'
      using errcode = '23505';
  end if;

  insert into public.companies (
    id,
    company_name,
    company_slug,
    owner_name,
    owner_phone,
    owner_email,
    status
  )
  values (
    new_company_id,
    organization_name,
    'org-' || new_company_id::text,
    admin_full_name,
    normalized_admin_phone,
    normalized_admin_email,
    'active'
  );

  insert into public.organizations (name, slug, subdomain, status, company_id)
  values (organization_name, normalized_slug, normalized_slug, 'active', new_company_id)
  returning id into new_organization_id;

  insert into public.organization_settings (organization_id, contact_email, contact_phone)
  values (new_organization_id, normalized_admin_email, normalized_admin_phone)
  on conflict (organization_id) do nothing;

  perform public.seed_epc_standard_roles(new_organization_id);

  update public.roles
  set company_id = new_company_id
  where roles.organization_id = new_organization_id
    and roles.company_id is distinct from new_company_id;

  select roles.id
  into admin_role_id
  from public.roles
  where roles.organization_id = new_organization_id
    and roles.role_key = 'admin'
  limit 1;

  if admin_role_id is null then
    raise exception 'Admin role could not be created'
      using errcode = 'P0002';
  end if;

  insert into public.users_profile (
    auth_user_id,
    organization_id,
    company_id,
    full_name,
    phone,
    email,
    status,
    is_super_admin,
    invited_at,
    phone_verified,
    email_verified
  )
  values (
    admin_auth_user_id,
    new_organization_id,
    new_company_id,
    admin_full_name,
    normalized_admin_phone,
    normalized_admin_email,
    'invited',
    false,
    now(),
    false,
    false
  )
  on conflict (phone) where phone is not null do update
  set
    auth_user_id = coalesce(public.users_profile.auth_user_id, excluded.auth_user_id),
    organization_id = excluded.organization_id,
    company_id = excluded.company_id,
    full_name = excluded.full_name,
    email = excluded.email,
    status = 'invited',
    is_super_admin = false,
    updated_at = now()
  returning id into admin_profile_id;

  insert into public.user_roles (user_profile_id, user_id, role_id)
  values (admin_profile_id, null, admin_role_id)
  on conflict (user_profile_id, role_id) where user_profile_id is not null do nothing;

  if admin_auth_user_id is not null then
    admin_profile_status := 'invite_sent_pending_password';
  end if;

  return jsonb_build_object(
    'organization_id', new_organization_id,
    'organization_slug', normalized_slug,
    'company_id', new_company_id,
    'admin_role_id', admin_role_id,
    'admin_profile_id', admin_profile_id,
    'admin_auth_user_id', admin_auth_user_id,
    'admin_profile_status', admin_profile_status
  );
end;
$$;

grant execute on function public.create_organization_with_admin(text, text, text, text, text, uuid) to authenticated;

notify pgrst, 'reload schema';
