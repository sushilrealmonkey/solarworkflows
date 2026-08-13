update public.subscription_plans
set
  price_paise = 89900,
  yearly_price_paise = 988900,
  updated_at = now()
where plan_key = 'starter';
