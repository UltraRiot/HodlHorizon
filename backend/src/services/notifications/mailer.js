// Minimal, provider-agnostic mail sending: reads plain SMTP credentials
// from env vars rather than baking in a specific vendor's SDK/API client.
// Gmail SMTP with an app password is the simplest zero-new-signup default
// (see backend/.env.example) - but this works unmodified against ANY
// provider that exposes an SMTP relay (SendGrid, Mailgun, Postmark, AWS
// SES, etc. all do), so moving off Gmail later is a change to the four
// SMTP_* env var VALUES, never a rewrite of this file.
import nodemailer from "nodemailer";

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  const port = Number(process.env.SMTP_PORT) || 587;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465, // implicit TLS on 465; STARTTLS (587/25) otherwise.
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  return transporter;
}

// Logged at most once per process, regardless of which piece of config is
// missing or how many emails are attempted in the meantime - a scan that
// schedules 5 articles with no SMTP configured should print this once,
// not five times.
let warnedMissingConfig = false;

// Sends one email. Deliberately swallows every failure (bad credentials,
// unreachable host, whatever) rather than throwing - a broken mail
// configuration must never block the article action that triggered this,
// see the try/catch here and the comment at the one call site in
// scanAndGenerate.js. Returns true/false so a caller COULD check, but
// isn't required to.
export async function sendMail({ subject, text, html }) {
  const to = process.env.ADMIN_ALERT_EMAIL;
  const host = process.env.SMTP_HOST;

  if (!to || !host) {
    if (!warnedMissingConfig) {
      console.warn(
        `Mailer: ${!to ? "ADMIN_ALERT_EMAIL" : "SMTP_HOST"} is not set - admin alert emails are disabled until it is (logged once per process, not on every attempt).`
      );
      warnedMissingConfig = true;
    }
    return false;
  }

  try {
    await getTransporter().sendMail({
      from: process.env.SMTP_USER ? `Hodl Horizon <${process.env.SMTP_USER}>` : "Hodl Horizon <no-reply@hodlhorizon.com>",
      to,
      subject,
      text,
      html,
    });
    return true;
  } catch (err) {
    console.error(`Mailer: failed to send "${subject}" - ${err.message}`);
    return false;
  }
}

// The one notification this file currently sends: fired the moment an
// article's status is set to "scheduled" (services/rss/scanAndGenerate.js).
// The delayed-auto-publish window only matters as a real review
// opportunity if someone actually knows it's open - this is that signal.
export async function sendScheduledArticleAlert({ articleId, title, categoryName, sourceName, sourceUrl, autoPublishAt }) {
  const adminUrl = `${process.env.FRONTEND_URL || "http://localhost:3000"}/admin/articles/${articleId}`;
  const publishTime = `${autoPublishAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC`;

  const subject = `[Hodl Horizon] Scheduled to auto-publish: "${title}"`;
  const text = `A single-source article just cleared every automated check and was scheduled to auto-publish.

Title: ${title}
Category: ${categoryName}
Source: ${sourceName} (${sourceUrl})
Auto-publishes at: ${publishTime}

Review, hold, or edit it here: ${adminUrl}

No action needed if this looks right - it publishes on its own at the time above.`;

  return sendMail({ subject, text });
}
