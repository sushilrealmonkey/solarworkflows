alter table public.whatsapp_outreach_settings
  add column daily_campaign_limit integer not null default 10
    check (daily_campaign_limit between 1 and 100),
  add column daily_message_limit integer not null default 100
    check (daily_message_limit between 1 and 10000);
