-- EPC admin WhatsApp numbers must be required and verification status must be
-- available to the platform company directory. This is intentionally read-only.

do $$
begin
  if pg_get_functiondef(
    'public.create_organization_with_admin(text,text,text,text,text,uuid)'::regprocedure
  ) not like '%Primary admin WhatsApp number is required%' then
    raise exception 'Invited EPC admins must require a WhatsApp number';
  end if;

  if pg_get_functiondef(
    'public.self_create_epc_workspace(text,text,text)'::regprocedure
  ) not like '%A WhatsApp number is required to create a workspace%' then
    raise exception 'Self-signup EPC admins must require a WhatsApp number';
  end if;

  if pg_get_functiondef(
    'public.platform_epc_company_directory()'::regprocedure
  ) not like '%phone_verified%' then
    raise exception 'The EPC company directory must expose WhatsApp verification status';
  end if;
end;
$$;
