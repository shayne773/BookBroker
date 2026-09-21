// Outgoing email. Every message the API sends goes through `mail`, which wraps
// the official Resend SDK.
//
// RESEND_API_KEY switches real delivery on. Without it (local development,
// tests, CI) nothing is sent: the recipient, subject and link are logged to the
// console instead, so the confirm and reset flows still work end to end.
//
// EMAIL_FROM is the sender. It defaults to Resend's shared test sender, which
// can only deliver to the Resend account owner's own address; mail to anyone
// else needs a domain verified in Resend and an EMAIL_FROM on that domain.
//
// Links point at the front end, whose base URL comes from FRONTEND_BASE_URL and
// never from the request's Host header, which the caller controls.

import { Resend } from "resend";

export const DEFAULT_EMAIL_FROM = "BookBroker <onboarding@resend.dev>";
export const DEFAULT_DEV_FRONTEND_BASE_URL = "http://localhost:3000";

export function resolveFrontEndBaseUrl(env = process.env) {
  const configured = String(env.FRONTEND_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (configured) return configured;

  if (env.NODE_ENV === "production") {
    throw new Error(
      "FRONTEND_BASE_URL must be set in production. " +
        "Set it to the deployed front end so emailed links point there."
    );
  }
  return DEFAULT_DEV_FRONTEND_BASE_URL;
}

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// One short black-and-white message: the wordmark, one sentence, one link, and
// what to do if the reader did not ask for it.
export function renderEmail({ sentence, action, link }) {
  const ignore = "If you did not ask for this, you can ignore this email.";

  const text = `BookBroker\n\n${sentence}\n\n${action}: ${link}\n\n${ignore}\n`;

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:32px 16px;background:#ffffff;color:#111111;font-family:Helvetica,Arial,sans-serif;">
    <div style="max-width:480px;margin:0 auto;">
      <p style="margin:0 0 24px;font-family:Georgia,serif;font-size:20px;font-weight:600;">BookBroker</p>
      <p style="margin:0 0 24px;font-size:16px;line-height:1.5;">${escapeHtml(sentence)}</p>
      <p style="margin:0 0 32px;"><a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 20px;background:#111111;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;">${escapeHtml(action)}</a></p>
      <p style="margin:0;color:#666666;font-size:13px;line-height:1.5;">${escapeHtml(ignore)}</p>
    </div>
  </body>
</html>`;

  return { text, html };
}

let client = null;
let clientKey = null;
const resendClient = (apiKey) => {
  if (clientKey !== apiKey) {
    client = new Resend(apiKey);
    clientKey = apiKey;
  }
  return client;
};

export const mail = {
  /**
   * Send one message, or log it when no API key is configured.
   * Rejects when Resend refuses the message.
   */
  async deliver({ to, subject, text, html, link }, env = process.env) {
    const apiKey = env.RESEND_API_KEY;
    if (!apiKey) {
      console.log(`[mail] RESEND_API_KEY is not set; not sending.\n  to: ${to}\n  subject: ${subject}\n  link: ${link}`);
      return;
    }

    const { error } = await resendClient(apiKey).emails.send({
      from: env.EMAIL_FROM || DEFAULT_EMAIL_FROM,
      to,
      subject,
      text,
      html,
    });
    if (error) {
      throw new Error(`Resend refused the message: ${error.name ?? "error"}: ${error.message ?? ""}`);
    }
  },

  sendEmailConfirmation(to, link) {
    return mail.deliver({
      to,
      subject: "Confirm your email for BookBroker",
      link,
      ...renderEmail({
        sentence: "Confirm this is your email address to finish creating your BookBroker account.",
        action: "Confirm email",
        link,
      }),
    });
  },

  sendPasswordReset(to, link) {
    return mail.deliver({
      to,
      subject: "Reset your BookBroker password",
      link,
      ...renderEmail({
        sentence: "Use this link to choose a new password for your BookBroker account.",
        action: "Reset password",
        link,
      }),
    });
  },
};
