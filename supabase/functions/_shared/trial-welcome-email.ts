export type TrialWelcomeEmailInput = {
  userName: string | null;
  trialEndDate: string;
  workspaceUrl: string;
  supportEmail?: string | null;
};

export type RenderedEmail = {
  subject: string;
  html: string;
  text: string;
};

export function renderTrialWelcomeEmail(
  input: TrialWelcomeEmailInput,
): RenderedEmail {
  const workspaceUrl = normalizeHttpUrl(input.workspaceUrl);
  const logoUrl = new URL("/bizlee-logo.png", `${workspaceUrl}/`).toString();
  const userName = escapeHtml(normalizeName(input.userName) ?? "there");
  const trialEndDate = escapeHtml(input.trialEndDate.trim() || "the date shown in your workspace");
  const supportEmail = normalizeEmail(input.supportEmail);
  const supportHtml = supportEmail
    ? `Need a hand getting started? Reply to this email or reach us at <a href="mailto:${escapeHtml(supportEmail)}" style="color:#0f766e;font-weight:700;text-decoration:none;">${escapeHtml(supportEmail)}</a>.`
    : "Need a hand getting started? Reply to this email and the Bizlee team will help you.";
  const supportText = supportEmail
    ? `Need help? Reply to this email or contact ${supportEmail}.`
    : "Need help? Reply to this email and the Bizlee team will help you.";

  return {
    subject: "Welcome to Bizlee — your trial is ready",
    html: `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no">
  <title>Welcome to Bizlee</title>
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
  <style>
    table,td,a,p,h1,h2{font-family:Arial,Helvetica,sans-serif}
    table,td{border-collapse:collapse;mso-table-lspace:0;mso-table-rspace:0}
    img{border:0;height:auto;line-height:100%;outline:none;text-decoration:none}
    a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important}
    @media only screen and (max-width:620px){
      .email-shell{padding:0!important}.email-card{border-left:0!important;border-right:0!important;border-radius:0!important}
      .mobile-pad{padding-left:22px!important;padding-right:22px!important}.mobile-title{font-size:30px!important;line-height:36px!important}
      .mobile-block{display:block!important;width:100%!important}.mobile-step{padding:0 0 18px!important}
    }
  </style>
</head>
<body style="margin:0;padding:0;width:100%;background-color:#fff8f1;color:#17211f;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;line-height:1px;mso-hide:all;">Your Bizlee trial is active. Open your workspace and start turning enquiries into completed solar projects.</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background-color:#fff8f1;">
    <tr><td class="email-shell" align="center" style="padding:32px 12px;">
      <!--[if mso]><table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
      <table class="email-card" role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;overflow:hidden;border:1px solid #f0dfd2;border-radius:22px;background-color:#ffffff;box-shadow:0 16px 48px rgba(6,23,63,.10);">
        <tr><td class="mobile-pad" style="padding:24px 38px;border-top:5px solid #f97316;background-color:#ffffff;">
          <img src="${escapeHtml(logoUrl)}" width="162" alt="Bizlee" style="display:block;width:162px;max-width:100%;height:auto;">
        </td></tr>
        <tr><td class="mobile-pad" style="padding:46px 38px 42px;background-color:#06173f;color:#ffffff;">
          <span style="display:inline-block;padding:7px 12px;border:1px solid #9a5d39;border-radius:999px;background-color:#2a2140;color:#fed7aa;font-size:12px;font-weight:700;line-height:16px;letter-spacing:.08em;text-transform:uppercase;">Your trial is ready</span>
          <h1 class="mobile-title" style="margin:20px 0 0;max-width:480px;color:#ffffff;font-size:38px;font-weight:700;line-height:45px;letter-spacing:-.02em;">Welcome to Bizlee, ${userName}.</h1>
          <p style="margin:18px 0 0;max-width:490px;color:#dbe4f3;font-size:17px;line-height:28px;">Your workspace is open. Bring your leads, quotations, projects, and team into one clear place from day one.</p>
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-top:28px;"><tr><td align="center" bgcolor="#f97316" style="border-radius:11px;">
            <!--[if mso]><v:roundrect href="${escapeHtml(workspaceUrl)}" style="height:50px;v-text-anchor:middle;width:188px;" arcsize="22%" stroke="f" fillcolor="#f97316"><w:anchorlock/><center style="color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;">Open Bizlee</center></v:roundrect><![endif]-->
            <!--[if !mso]><!--><a href="${escapeHtml(workspaceUrl)}" style="display:inline-block;padding:15px 24px;border-radius:11px;background-color:#f97316;color:#ffffff;font-size:15px;font-weight:700;line-height:20px;text-decoration:none;">Open Bizlee&nbsp;&nbsp;&rarr;</a><!--<![endif]-->
          </td></tr></table>
        </td></tr>
        <tr><td class="mobile-pad" style="padding:34px 38px 8px;background-color:#ffffff;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border:1px solid #f4d2b8;border-radius:14px;background-color:#fff8f1;"><tr>
            <td width="54" valign="middle" style="padding:17px 0 17px 18px;"><div style="width:40px;height:40px;border-radius:10px;background-color:#ffedd5;color:#c2410c;font-size:21px;font-weight:700;line-height:40px;text-align:center;">&#9728;</div></td>
            <td valign="middle" style="padding:17px 18px 17px 12px;"><p style="margin:0;color:#06173f;font-size:13px;font-weight:700;line-height:18px;letter-spacing:.04em;text-transform:uppercase;">Trial access</p><p style="margin:4px 0 0;color:#5e6879;font-size:14px;line-height:21px;">Your trial is active through <strong style="color:#17211f;">${trialEndDate}</strong>.</p></td>
          </tr></table>
        </td></tr>
        <tr><td class="mobile-pad" style="padding:32px 38px 12px;background-color:#ffffff;">
          <p style="margin:0;color:#f97316;font-size:12px;font-weight:700;line-height:18px;letter-spacing:.09em;text-transform:uppercase;">A simple way to begin</p>
          <h2 style="margin:7px 0 0;color:#06173f;font-size:23px;font-weight:700;line-height:30px;">Get value from your first session</h2>
        </td></tr>
        <tr><td class="mobile-pad" style="padding:12px 38px 16px;background-color:#ffffff;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
            <td class="mobile-block mobile-step" width="33.33%" valign="top" style="padding-right:14px;"><div style="width:30px;height:30px;border-radius:9px;background-color:#06173f;color:#ffffff;font-size:13px;font-weight:700;line-height:30px;text-align:center;">01</div><p style="margin:11px 0 0;color:#06173f;font-size:14px;font-weight:700;line-height:20px;">Add a lead</p><p style="margin:5px 0 0;color:#687386;font-size:13px;line-height:20px;">Keep every enquiry and follow-up easy to find.</p></td>
            <td class="mobile-block mobile-step" width="33.33%" valign="top" style="padding-right:14px;"><div style="width:30px;height:30px;border-radius:9px;background-color:#0f766e;color:#ffffff;font-size:13px;font-weight:700;line-height:30px;text-align:center;">02</div><p style="margin:11px 0 0;color:#06173f;font-size:14px;font-weight:700;line-height:20px;">Create a quote</p><p style="margin:5px 0 0;color:#687386;font-size:13px;line-height:20px;">Turn an opportunity into a polished next step.</p></td>
            <td class="mobile-block mobile-step" width="33.33%" valign="top"><div style="width:30px;height:30px;border-radius:9px;background-color:#f97316;color:#ffffff;font-size:13px;font-weight:700;line-height:30px;text-align:center;">03</div><p style="margin:11px 0 0;color:#06173f;font-size:14px;font-weight:700;line-height:20px;">Move work forward</p><p style="margin:5px 0 0;color:#687386;font-size:13px;line-height:20px;">Give your team one clear view of every project.</p></td>
          </tr></table>
        </td></tr>
        <tr><td class="mobile-pad" style="padding:18px 38px 38px;background-color:#ffffff;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-top:1px solid #e8edf4;"><tr><td style="padding-top:22px;"><p style="margin:0;color:#5e6879;font-size:14px;line-height:23px;">${supportHtml}</p></td></tr></table></td></tr>
        <tr><td class="mobile-pad" style="padding:24px 38px 28px;background-color:#f5f7fb;text-align:center;"><p style="margin:0;color:#06173f;font-size:13px;font-weight:700;line-height:20px;">Bizlee &middot; Built for solar teams</p><p style="margin:6px 0 0;color:#7b8493;font-size:12px;line-height:19px;">You received this email because you started a Bizlee trial.</p></td></tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td></tr>
  </table>
</body>
</html>`,
    text: [
      `Welcome to Bizlee, ${normalizeName(input.userName) ?? "there"}.`,
      "",
      "Your workspace is open. Bring your leads, quotations, projects, and team into one clear place from day one.",
      `Your trial is active through ${input.trialEndDate.trim() || "the date shown in your workspace"}.`,
      "",
      `Open Bizlee: ${workspaceUrl}`,
      "",
      "Start by adding a lead, creating a quote, and giving your team one clear view of every project.",
      supportText,
    ].join("\n"),
  };
}

function normalizeHttpUrl(value: string) {
  const url = new URL(value.trim());
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("workspaceUrl must use http or https");
  }
  return url.toString().replace(/\/$/, "");
}

function normalizeName(value: string | null) {
  const normalized = (value ?? "").trim().replace(/\s+/g, " ");
  return normalized || null;
}

function normalizeEmail(value: string | null | undefined) {
  const normalized = (value ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : null;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character]!);
}
