import nodemailer from "nodemailer";

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  const port = Number(process.env.SMTP_PORT) || 587;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  return transporter;
}

let warnedMissingConfig = false;

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
