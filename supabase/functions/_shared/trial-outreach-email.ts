export type TrialOutreachEmailInput = {
  touchpointKey: string;
  language: "en" | "hi";
  firstName: string;
  companyName: string;
  trialEndDate: string;
  nextStepUrl: string;
  supportPhone: string;
  progress: string;
  blocker: string | null;
};

export type TrialOutreachEmail = {
  subject: string;
  html: string;
  text: string;
};

export function renderTrialOutreachEmail(
  input: TrialOutreachEmailInput,
): TrialOutreachEmail {
  const firstName = escapeHtml(input.firstName.trim() || "there");
  const companyName = escapeHtml(input.companyName.trim() || "your solar team");
  const trialEndDate = escapeHtml(input.trialEndDate.trim() || "the date shown in your workspace");
  const nextStepUrl = escapeHtml(input.nextStepUrl.trim());
  const progress = escapeHtml(input.progress.trim() || "Your workspace is ready for its first real workflow.");
  const supportPhone = escapeHtml(input.supportPhone.trim());

  const copy = input.language === "hi"
    ? hindiCopy(input.touchpointKey)
    : englishCopy(input.touchpointKey);

  const text = `Hi ${input.language === "hi" ? "" : firstName},\n\n${copy.text}\n\n${progress}`;
  const html = `<!doctype html>
<html lang="${input.language === "hi" ? "hi" : "en"}">
  <body style="margin:0;background:#fff8f1;color:#17211f;font-family:Arial,sans-serif;line-height:1.6">
    <div style="max-width:640px;margin:0 auto;padding:28px 18px">
      <div style="border-radius:18px;background:#06173f;color:#fff;padding:28px 26px">
        <p style="margin:0;color:#fed7aa;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase">Bizlee trial support</p>
        <h1 style="margin:12px 0 0;font-size:26px;line-height:1.2">${escapeHtml(copy.heading)}</h1>
      </div>
      <div style="background:#fff;border:1px solid #eadfd2;border-top:0;padding:28px 26px">
        <p style="margin-top:0">Hi ${firstName},</p>
        <p>${copy.html}</p>
        <div style="margin:22px 0;padding:16px;border-radius:12px;background:#fff8f1;border:1px solid #f1dfc8">
          <strong>${companyName}</strong><br />
          ${progress}
        </div>
        <p><a href="${nextStepUrl}" style="display:inline-block;background:#ea580c;color:#fff;text-decoration:none;border-radius:10px;padding:12px 18px;font-weight:700">${escapeHtml(copy.cta)}</a></p>
        <p style="font-size:13px;color:#68737a">Your trial is active through <strong>${trialEndDate}</strong>. Reply to this email or call ${supportPhone} if you would like us to complete the setup with you.</p>
      </div>
    </div>
  </body>
</html>`;

  return { subject: copy.subject, html, text };
}

function englishCopy(key: string) {
  const common = {
    cta: "Open your workspace",
    subject: "Let’s get your first solar workflow moving",
    heading: "We can help you reach your first result",
  };

  switch (key) {
    case "trial_activation_three_days":
      return {
        ...common,
        subject: `Three days left to finish your Bizlee setup`,
        heading: "Three days left — we can finish this together",
        cta: "Finish setup",
        html: `You have three days left in your trial. The fastest path is to create one lead or customer and complete one workflow. We can guide you live if you reply with “help”.`,
        text: `You have three days left in your trial. The fastest path is to create one lead or customer and complete one workflow. We can guide you live if you reply with “help”.`,
      };
    case "trial_activation_one_day":
      return {
        ...common,
        subject: `Your Bizlee trial ends tomorrow`,
        heading: "Your trial ends tomorrow",
        cta: "Keep using Bizlee",
        html: `Your workspace is still available today. If you share one real enquiry with us, we can help you complete the first workflow before access changes tomorrow.`,
        text: `Your workspace is still available today. If you share one real enquiry with us, we can help you complete the first workflow before access changes tomorrow.`,
      };
    case "trial_activation_expired":
      return {
        ...common,
        subject: "Your Bizlee trial has ended — your workspace is still here",
        heading: "Your trial has ended",
        cta: "Reactivate your workspace",
        html: `Your trial has ended, but your workspace and saved information remain available. Choose a plan to continue working, or reply if you want a quick walkthrough first.`,
        text: `Your trial has ended, but your workspace and saved information remain available. Choose a plan to continue working, or reply if you want a quick walkthrough first.`,
      };
    case "trial_activation_blocker_check":
      return {
        ...common,
        subject: "What stopped you from getting started?",
        heading: "One quick question",
        cta: "Open your workspace",
        html: `What stopped you from getting started: setup, lack of time, or not knowing what to do next? Reply with one word and we will respond with the right help.`,
        text: `What stopped you from getting started: setup, lack of time, or not knowing what to do next? Reply with one word and we will respond with the right help.`,
      };
    case "trial_activation_assisted_setup":
      return {
        ...common,
        subject: "Send us one enquiry and we’ll help set it up",
        heading: "Let us do the first workflow with you",
        cta: "Start assisted setup",
        html: `Send us one real enquiry or customer requirement. We will show you how to turn it into a useful Bizlee workflow in a short setup call.`,
        text: `Send us one real enquiry or customer requirement. We will show you how to turn it into a useful Bizlee workflow in a short setup call.`,
      };
    case "trial_activation_midpoint":
      return {
        ...common,
        subject: "You are halfway through your Bizlee trial",
        heading: "Let’s make the second half useful",
        cta: "Complete the next step",
        html: `You are halfway through the trial. Focus on one real customer or enquiry today; that is enough to see how Bizlee fits your solar sales process.`,
        text: `You are halfway through the trial. Focus on one real customer or enquiry today; that is enough to see how Bizlee fits your solar sales process.`,
      };
    case "trial_activation_use_case":
      return {
        ...common,
        subject: "A practical Bizlee workflow for your solar team",
        heading: "A practical next step for your team",
        cta: "Try the workflow",
        html: `Start with the workflow that matches your day: capture an enquiry, schedule a site survey, prepare a quotation, or track an installation project.`,
        text: `Start with the workflow that matches your day: capture an enquiry, schedule a site survey, prepare a quotation, or track an installation project.`,
      };
    case "trial_activation_setup_help":
      return {
        ...common,
        subject: "Your next Bizlee step is ready",
        heading: "One small step gets you moving",
        cta: "Take the next step",
        html: `Open your workspace and create your first lead or customer. If you already logged in, continue with the workflow shown in your dashboard.`,
        text: `Open your workspace and create your first lead or customer. If you already logged in, continue with the workflow shown in your dashboard.`,
      };
    default:
      return {
        ...common,
        subject: "Welcome — let’s get your first Bizlee result",
        heading: "Your first result can start today",
        cta: "Open your workspace",
        html: `Your Bizlee trial is ready. Start by creating one real lead or customer, then complete one workflow with it.`,
        text: `Your Bizlee trial is ready. Start by creating one real lead or customer, then complete one workflow with it.`,
      };
  }
}

function hindiCopy(key: string) {
  const common = {
    cta: "वर्कस्पेस खोलें",
    subject: "अपने पहले सोलर वर्कफ़्लो से शुरुआत करें",
    heading: "हम आपकी पहली मदद करेंगे",
    html: "एक वास्तविक लीड या ग्राहक बनाकर एक छोटा वर्कफ़्लो पूरा करें। जरूरत हो तो हम आपके साथ सेटअप कर देंगे।",
    text: "एक वास्तविक लीड या ग्राहक बनाकर एक छोटा वर्कफ़्लो पूरा करें। जरूरत हो तो हम आपके साथ सेटअप कर देंगे।",
  };

  if (key === "trial_activation_three_days") {
    return { ...common, subject: "आपके ट्रायल में तीन दिन बाकी हैं", heading: "तीन दिन बाकी हैं — साथ में सेटअप करें", cta: "सेटअप पूरा करें" };
  }
  if (key === "trial_activation_one_day") {
    return { ...common, subject: "आपका Bizlee ट्रायल कल समाप्त होगा", heading: "आपका ट्रायल कल समाप्त होगा", cta: "Bizlee जारी रखें" };
  }
  if (key === "trial_activation_expired") {
    return { ...common, subject: "आपका Bizlee ट्रायल समाप्त हो गया है", heading: "आपका ट्रायल समाप्त हो गया है", cta: "वर्कस्पेस फिर से शुरू करें" };
  }
  if (key === "trial_activation_blocker_check") {
    return { ...common, subject: "शुरुआत करने में क्या रुकावट आई?", heading: "एक छोटा सवाल", cta: "वर्कस्पेस खोलें", html: "सेटअप, समय की कमी या अगला कदम समझ में न आना — किस वजह से शुरुआत नहीं हो पाई? एक शब्द में जवाब दें।", text: "सेटअप, समय की कमी या अगला कदम समझ में न आना — किस वजह से शुरुआत नहीं हो पाई? एक शब्द में जवाब दें।" };
  }
  return common;
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
