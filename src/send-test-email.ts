/**
 * Sends one sample enquiry email with the settings in .env, so the mail setup can be
 * checked without submitting the website form.  Usage:  npm run mail:test
 */
import { randomUUID } from "node:crypto";
import { loadConfig } from "./config.js";
import { createMailer } from "./mailer.js";

const config = loadConfig();

if (!config.SMTP_HOST) {
  console.error("SMTP_HOST is empty in .env — nothing to test.");
  process.exit(1);
}
if (!config.SMTP_PASS) {
  console.error("SMTP_PASS is empty in .env — add the mailbox password first.");
  process.exit(1);
}

const mailer = createMailer(config);
console.info(`Sending a test enquiry via ${config.SMTP_HOST}:${config.SMTP_PORT} to ${config.MAIL_TO}…`);

const ok = await mailer.sendEnquiry({
  id: randomUUID(),
  receivedAt: new Date().toISOString(),
  source: "contact",
  fullName: "Test — OLIVED website",
  company: "Mail configuration check",
  email: config.SMTP_USER || "test@example.com",
  phone: "",
  country: "Tunisia",
  interests: ["bulk"],
  volume: "",
  oilCategory: "",
  organicPreference: "",
  format: "",
  targetSpec: "",
  message: "This is a test sent by `npm run mail:test`. If you received it, website enquiries will be emailed.",
});

if (ok) {
  console.info(`✓ Sent. Check the inbox of ${config.MAIL_TO}.`);
  process.exit(0);
} else {
  console.error("✗ Sending failed — see the error above.");
  process.exit(1);
}
