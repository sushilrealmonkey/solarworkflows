export type StaffOption = {
  id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  status: string | null;
  organization_id: string | null;
};

export type Customer = {
  id: string;
  organization_id: string;
  customer_code: string | null;
  full_name: string;
  phone: string;
  alternate_phone: string | null;
  email: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
  city: string | null;
  district: string | null;
  state: string | null;
  pincode: string | null;
  customer_type: string | null;
  lead_source: string | null;
  status: string | null;
  notes: string | null;
  created_by: string | null;
  assigned_to: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type Lead = {
  id: string;
  organization_id: string;
  lead_code: string | null;
  customer_id: string | null;
  full_name: string;
  phone: string;
  alternate_phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  district: string | null;
  state: string | null;
  pincode: string | null;
  lead_source: string | null;
  requirement_type: string | null;
  estimated_load_kw: number | null;
  electricity_bill_amount: number | null;
  offered_price: number | null;
  offered_price_updated_at: string | null;
  property_type: string | null;
  roof_type: string | null;
  status: string | null;
  priority: string | null;
  assigned_to: string | null;
  notes: string | null;
  created_by: string | null;
  converted_customer_id: string | null;
  converted_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type LeadActionState = {
  hasSiteSurvey: boolean;
  hasQuotation: boolean;
};

export type LeadFollowup = {
  id: string;
  organization_id: string;
  lead_id: string;
  followup_type: string;
  followup_date: string;
  next_followup_date: string | null;
  status: string | null;
  notes: string | null;
  created_by: string | null;
  assigned_to: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type LeadFollowupWithLead = LeadFollowup & {
  lead?: {
    id: string;
    lead_code: string | null;
    full_name: string;
    phone: string;
    city: string | null;
  } | null;
};

export type CustomerFormValues = {
  full_name: string;
  phone: string;
  alternate_phone: string;
  email: string;
  address_line_1: string;
  address_line_2: string;
  city: string;
  district: string;
  state: string;
  pincode: string;
  customer_type: string;
  lead_source: string;
  status: string;
  assigned_to: string;
  notes: string;
};

export type LeadFormValues = {
  full_name: string;
  phone: string;
  alternate_phone: string;
  email: string;
  address: string;
  city: string;
  district: string;
  state: string;
  pincode: string;
  lead_source: string;
  requirement_type: string;
  estimated_load_kw: string;
  electricity_bill_amount: string;
  offered_price: string;
  property_type: string;
  roof_type: string;
  status: string;
  priority: string;
  assigned_to: string;
  notes: string;
};

export type LeadFollowupFormValues = {
  followup_type: string;
  followup_date: string;
  followup_time: string;
  next_followup_date: string;
  next_followup_time: string;
  status: string;
  assigned_to: string;
  notes: string;
};
