-- Browser-side quotation counts are only a preview and can be stale when two
-- users create quotations at the same time. Keep the unique-code guarantee in
-- the database and advance a generated code when a stale preview collides.

create or replace function public.generate_quotation_code(
  target_organization_id uuid,
  target_prefix text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_prefix text;
  next_number bigint;
begin
  if target_organization_id is null then
    raise exception 'organization_id is required to generate a quotation code'
      using errcode = '23502';
  end if;

  normalized_prefix := upper(
    regexp_replace(
      coalesce(nullif(trim(target_prefix), ''), 'QUO'),
      '[^A-Za-z0-9]+',
      '',
      'g'
    )
  );

  if normalized_prefix = '' then
    normalized_prefix := 'QUO';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'quotation:' || target_organization_id::text || ':' || normalized_prefix,
      0
    )
  );

  select coalesce(
    max(
      case
        when split_part(quotations.quotation_code, '-', 1) = normalized_prefix
          and split_part(quotations.quotation_code, '-', 2) ~ '^[0-9]+$'
        then split_part(quotations.quotation_code, '-', 2)::bigint
        else 0
      end
    ),
    0
  ) + 1
  into next_number
  from public.quotations
  where quotations.organization_id = target_organization_id;

  return normalized_prefix || '-' || lpad(next_number::text, 4, '0');
end;
$$;

-- Preserve the existing one-argument database API for callers that use the
-- default QUO prefix.
create or replace function public.generate_quotation_code(
  target_organization_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.generate_quotation_code(target_organization_id, 'QUO');
end;
$$;

create or replace function public.set_quotation_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  configured_prefix text;
  requested_code text;
  requested_prefix text;
begin
  if new.organization_id is null then
    raise exception 'organization_id is required to generate a quotation code'
      using errcode = '23502';
  end if;

  requested_code := nullif(trim(new.quotation_code), '');

  select organization_settings.quotation_prefix
  into configured_prefix
  from public.organization_settings
  where organization_settings.organization_id = new.organization_id
  limit 1;

  if requested_code is null then
    new.quotation_code := public.generate_quotation_code(
      new.organization_id,
      configured_prefix
    );
    return new;
  end if;

  -- The UI may submit a stale auto-generated value. Serialize the duplicate
  -- check with the generator, then advance only generated-looking codes. A
  -- deliberately entered non-standard duplicate still fails visibly instead
  -- of being silently rewritten.
  if requested_code ~ '^[A-Za-z0-9]+-[0-9]+$' then
    requested_prefix := upper(split_part(requested_code, '-', 1));

    perform pg_advisory_xact_lock(
      hashtextextended(
        'quotation:' || new.organization_id::text || ':' || requested_prefix,
        0
      )
    );

    if exists (
      select 1
      from public.quotations
      where quotations.organization_id = new.organization_id
        and quotations.quotation_code = requested_code
    ) then
      new.quotation_code := public.generate_quotation_code(
        new.organization_id,
        requested_prefix
      );
    end if;
  end if;

  return new;
end;
$$;

notify pgrst, 'reload schema';
