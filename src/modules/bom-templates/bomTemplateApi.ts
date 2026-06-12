import type { UserProfile } from "../../app/AuthProvider";
import { supabase } from "../../services/supabaseClient";
import type {
  BomTemplate,
  BomTemplateFormValues,
  BomTemplateRule,
  BomTemplateRuleFormValues,
} from "./types";

function requireSupabase() {
  if (!supabase) {
    throw new Error("Supabase environment variables are not configured.");
  }

  return supabase;
}

function requireTenant(profile: UserProfile | null) {
  if (!profile?.organization_id) {
    throw new Error("No organization is assigned to this user.");
  }

  return profile.organization_id;
}

function nullable(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function bomTemplatePayload(values: BomTemplateFormValues) {
  return {
    display_order: Number(values.display_order),
    name: values.name.trim(),
    template_type: values.template_type,
    description: nullable(values.description),
    is_active: values.is_active,
  };
}

function ruleNumberValue(value: string) {
  const trimmed = value.trim();
  return trimmed ? Number(trimmed) : null;
}

function bomTemplateRulePayload(values: BomTemplateRuleFormValues) {
  const isFixedQuantity = values.calculation_type === "fixed_quantity";
  const isPerKw = values.calculation_type === "per_kw";

  return {
    display_order: Number(values.display_order),
    product_category_id: values.product_category_id,
    calculation_type: values.calculation_type,
    unit: "unit",
    formula_value: isPerKw ? ruleNumberValue(values.formula_value) : null,
    fixed_quantity: isFixedQuantity
      ? ruleNumberValue(values.fixed_quantity)
      : null,
    is_required: values.is_required,
  };
}

const bomTemplateSelect = "*";
const bomTemplateRuleSelect = "*";

export async function fetchBomTemplates(profile: UserProfile | null) {
  const client = requireSupabase();
  let query = client
    .from("bom_templates")
    .select(bomTemplateSelect)
    .order("display_order", { ascending: true })
    .order("name", { ascending: true });

  if (!profile?.is_super_admin) {
    query = query.eq("tenant_id", requireTenant(profile));
  } else if (profile.organization_id) {
    query = query.eq("tenant_id", profile.organization_id);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as BomTemplate[];
}

export async function fetchBomTemplate(
  profile: UserProfile | null,
  id: string,
) {
  const client = requireSupabase();
  let query = client.from("bom_templates").select(bomTemplateSelect).eq("id", id);

  if (!profile?.is_super_admin) {
    query = query.eq("tenant_id", requireTenant(profile));
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data as BomTemplate | null;
}

export async function createBomTemplate(
  profile: UserProfile | null,
  values: BomTemplateFormValues,
) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("bom_templates")
    .insert({
      tenant_id: requireTenant(profile),
      ...bomTemplatePayload(values),
    })
    .select(bomTemplateSelect)
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as BomTemplate;
}

export async function updateBomTemplate(
  profile: UserProfile | null,
  id: string,
  values: BomTemplateFormValues,
) {
  const client = requireSupabase();
  let query = client
    .from("bom_templates")
    .update(bomTemplatePayload(values))
    .eq("id", id);

  if (!profile?.is_super_admin) {
    query = query.eq("tenant_id", requireTenant(profile));
  }

  const { data, error } = await query.select(bomTemplateSelect).single();

  if (error) {
    throw new Error(error.message);
  }

  return data as BomTemplate;
}

export async function updateBomTemplateActiveState(
  profile: UserProfile | null,
  id: string,
  isActive: boolean,
) {
  const client = requireSupabase();
  let query = client
    .from("bom_templates")
    .update({ is_active: isActive })
    .eq("id", id);

  if (!profile?.is_super_admin) {
    query = query.eq("tenant_id", requireTenant(profile));
  }

  const { data, error } = await query.select(bomTemplateSelect).single();

  if (error) {
    throw new Error(error.message);
  }

  return data as BomTemplate;
}

export async function fetchBomTemplateRules(
  profile: UserProfile | null,
  template: BomTemplate,
) {
  const client = requireSupabase();
  let query = client
    .from("bom_template_lines")
    .select(bomTemplateRuleSelect)
    .eq("bom_template_id", template.id)
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (!profile?.is_super_admin) {
    query = query.eq("tenant_id", requireTenant(profile));
  } else {
    query = query.eq("tenant_id", template.tenant_id);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as BomTemplateRule[];
}

export async function createBomTemplateRule(
  profile: UserProfile | null,
  template: BomTemplate,
  values: BomTemplateRuleFormValues,
) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("bom_template_lines")
    .insert({
      tenant_id: requireTenant(profile),
      bom_template_id: template.id,
      ...bomTemplateRulePayload(values),
    })
    .select(bomTemplateRuleSelect)
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as BomTemplateRule;
}

export async function updateBomTemplateRule(
  profile: UserProfile | null,
  rule: BomTemplateRule,
  values: BomTemplateRuleFormValues,
) {
  const client = requireSupabase();
  let query = client
    .from("bom_template_lines")
    .update(bomTemplateRulePayload(values))
    .eq("id", rule.id);

  if (!profile?.is_super_admin) {
    query = query.eq("tenant_id", requireTenant(profile));
  }

  const { data, error } = await query.select(bomTemplateRuleSelect).single();

  if (error) {
    throw new Error(error.message);
  }

  return data as BomTemplateRule;
}

export async function deleteBomTemplateRule(
  profile: UserProfile | null,
  rule: BomTemplateRule,
) {
  const client = requireSupabase();
  let query = client.from("bom_template_lines").delete().eq("id", rule.id);

  if (!profile?.is_super_admin) {
    query = query.eq("tenant_id", requireTenant(profile));
  }

  const { error } = await query;

  if (error) {
    throw new Error(error.message);
  }
}

export async function reorderBomTemplateRules(
  profile: UserProfile | null,
  orderedRules: BomTemplateRule[],
) {
  const client = requireSupabase();
  await Promise.all(
    orderedRules.map(async (rule, index) => {
      let query = client
        .from("bom_template_lines")
        .update({ display_order: index + 1 })
        .eq("id", rule.id);

      if (!profile?.is_super_admin) {
        query = query.eq("tenant_id", requireTenant(profile));
      }

      const { error } = await query;

      if (error) {
        throw new Error(error.message);
      }
    }),
  );
}

export async function deleteBomTemplate(
  profile: UserProfile | null,
  template: BomTemplate,
) {
  const client = requireSupabase();

  const { count, error: countError } = await client
    .from("bom_template_lines")
    .select("id", { count: "exact", head: true })
    .eq("bom_template_id", template.id)
    .eq("tenant_id", template.tenant_id);

  if (countError) {
    throw new Error(countError.message);
  }

  if ((count ?? 0) > 0) {
    throw new Error(
      "This BOM template already has BOM rules and cannot be deleted safely.",
    );
  }

  let query = client.from("bom_templates").delete().eq("id", template.id);

  if (!profile?.is_super_admin) {
    query = query.eq("tenant_id", requireTenant(profile));
  }

  const { error } = await query;

  if (error) {
    throw new Error(error.message);
  }
}
