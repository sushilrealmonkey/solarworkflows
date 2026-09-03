# Behavior-driven trial engagement

Trial engagement does not use a blanket day-by-day campaign. The trial welcome
email remains the initial touch, while all later touchpoints are produced from
observable account behavior. Each intervention is stored with its trigger,
evidence, channel, priority, delivery state, and staff outcome.

## Evidence collected

- Portal session starts and page views.
- Safe client error names, without raw error messages or customer data.
- Existing database audit events for CRM, quotations, projects, payments,
  inventory, products, follow-ups, and onboarding changes.
- Trial milestones: setup completion, enquiries, follow-ups, products,
  quotations, team invitations, last activity, and intent score.

The `portal_activity_events` table is company-scoped. Users can append only
their own safe portal events through a controlled RPC; platform outreach staff
can read the evidence. Business record changes enter the same stream through
database audit triggers.

## Intervention rules

| Evidence | Intervention |
| --- | --- |
| Trial activated with no login after 24 hours | WhatsApp and telecaller task |
| Login recorded but setup incomplete after 24 hours | WhatsApp setup nudge |
| Setup complete but no enquiry after 24 hours | Telecaller task |
| Enquiry without a follow-up | In-app follow-up prompt |
| No products after three days | In-app product-setup prompt |
| Products added but no quotation after 24 hours | In-app first-quotation guidance |
| No meaningful activity for 48 hours | Re-engagement WhatsApp |
| Three or more sessions and two or more enquiries | High-intent signal |
| Quotation created | Value-reached signal |
| Team member invited | Adoption signal |
| Active with five days remaining | High-priority conversion call |
| Inactive with five days remaining | High-priority rescue WhatsApp and call |
| Client error in the last 24 hours | Urgent founder/product-support task |

The worker creates each one only when its trigger is met. A dedupe key prevents
repeated prompts for the same condition; the inactivity rule can re-open after
another 48-hour inactive period. WhatsApp still requires verified recipient
consent and an active approved Meta template. The new behavior templates are
inserted as drafts and therefore cannot send until approval.

## Staff workflow

The Trial Engagement queue shows behavior evidence and live tasks per company.
The detail view includes the intervention timeline, staff outcomes, and recent
portal activity. Call tasks are assigned to platform staff; support escalations
are assigned to a super-admin/founder queue. Completing, rescheduling, pausing,
or recording a blocker remains fully auditable.
