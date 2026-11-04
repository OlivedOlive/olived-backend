import nodemailer from "nodemailer";
import type { Config } from "./config.js";
import type { StoredEnquiry } from "./storage.js";

export interface Mailer {
  /** Returns true when the email was handed to the SMTP server. */
  sendEnquiry(enquiry: StoredEnquiry): Promise<boolean>;
}

const SOURCE_LABEL: Record<StoredEnquiry["source"], string> = {
  home: "Home page — export enquiry",
  contact: "Contact page — quote request",
  bulk: "Bulk page — bulk offer request",
};

const INTEREST_LABEL: Record<string, string> = {
  bulk: "Bulk olive oil",
  packaged: "Packaged / ORZETA",
  distributor: "Become a distributor",
};

function rows(e: StoredEnquiry): Array<[string, string]> {
  const all: Array<[string, string]> = [
    ["Source", SOURCE_LABEL[e.source]],
    ["Full name", e.fullName],
    ["Company", e.company],
    ["Email", e.email],
    ["Phone", e.phone],
    ["Country / destination", e.country],
    ["Sourcing need", e.interests.map((i) => INTEREST_LABEL[i] ?? i).join(", ")],
    ["Olive oil category", e.oilCategory],
    ["Conventional / organic", e.organicPreference],
    ["Estimated volume", e.volume],
    ["Preferred format", e.format],
    ["Target specification", e.targetSpec],
  ];
  return all.filter(([, v]) => v !== "");
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function renderEnquiryEmail(e: StoredEnquiry) {
  const subject = `New enquiry — ${e.company} (${e.country})`;

  const text = [
    "New enquiry from the OLIVED website",
    "----------------------------------------",
    ...rows(e).map(([k, v]) => `${k}: ${v}`),
    "",
    "Message:",
    e.message || "(none)",
    "----------------------------------------",
    `Reference: ${e.id} · ${e.receivedAt}`,
  ].join("\n");

  const html = `
<div style="font-family:Arial,sans-serif;color:#1C1A16;max-width:640px">
  <h2 style="font-weight:normal;color:#B08D57;margin:0 0 16px">New enquiry from the OLIVED website</h2>
  <table cellpadding="6" style="border-collapse:collapse;width:100%;font-size:14px">
    ${rows(e)
      .map(
        ([k, v]) =>
          `<tr><td style="color:#6B6560;border-bottom:1px solid #EDE8DC;width:180px">${escapeHtml(k)}</td><td style="border-bottom:1px solid #EDE8DC">${escapeHtml(v)}</td></tr>`,
      )
      .join("")}
  </table>
  <h3 style="font-weight:normal;margin:24px 0 8px">Message</h3>
  <p style="white-space:pre-wrap;font-size:14px;line-height:1.6">${escapeHtml(e.message || "(none)")}</p>
  <p style="color:#9E9890;font-size:12px;margin-top:24px">Reference ${escapeHtml(e.id)} · ${escapeHtml(e.receivedAt)}</p>
</div>`;

  return { subject, text, html };
}

export function createMailer(config: Config, log: Pick<Console, "warn" | "error"> = console): Mailer {
  if (!config.SMTP_HOST) {
    log.warn("[mailer] SMTP_HOST is not set — enquiries will be saved but not emailed.");
    return { sendEnquiry: async () => false };
  }

  const transport = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
  });

  return {
    async sendEnquiry(enquiry) {
      const { subject, text, html } = renderEnquiryEmail(enquiry);
      try {
        await transport.sendMail({
          from: config.MAIL_FROM,
          to: config.MAIL_TO,
          replyTo: { name: enquiry.fullName, address: enquiry.email },
          subject,
          text,
          html,
        });
        return true;
      } catch (err) {
        log.error("[mailer] Failed to send enquiry email:", err);
        return false;
      }
    },
  };
}
