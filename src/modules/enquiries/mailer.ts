import nodemailer from "nodemailer";
import type { Config } from "../../config.js";
import type { StoredEnquiry } from "./storage.js";

/** An email to the OLIVED inbox (MAIL_TO), for example a design sent for review. */
export type OlivedEmail = {
  subject: string; text: string; html: string; replyTo?: { name: string; address: string };
  /** Another recipient than MAIL_TO, for example a user's own address for a password code. */
  to?: string;
};

export interface Mailer {
  /** Returns true when the email was handed to the SMTP server. */
  sendEnquiry(enquiry: StoredEnquiry): Promise<boolean>;
  /** Sends an email to MAIL_TO, or to `to`. Returns true when it was handed to the SMTP server. */
  send?(email: OlivedEmail): Promise<boolean>;
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

/**
 * Sender for outgoing mail. MAIL_FROM may be `Name <address>` or just `Name`/empty;
 * without an address, the authenticated mailbox (SMTP_USER) is used.
 */
export function resolveFrom(config: Pick<Config, "MAIL_FROM" | "SMTP_USER">): { name: string; address: string } {
  const raw = config.MAIL_FROM.trim().replace(/^"|"$/g, "");
  const match = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (match) return { name: match[1]!.trim() || "OLIVED Website", address: match[2]!.trim() };
  if (raw.includes("@")) return { name: "OLIVED Website", address: raw };
  return { name: raw || "OLIVED Website", address: config.SMTP_USER };
}

export function createMailer(config: Config, log: Pick<Console, "warn" | "error"> = console): Mailer {
  if (!config.SMTP_HOST) {
    log.warn(
      "[mailer] SMTP_HOST is not set in .env — enquiries are saved to data/enquiries.jsonl but NOT emailed.",
    );
    return {
      sendEnquiry: async () => false,
      send: async (email) => {
        log.warn(`[mailer] Not emailed (SMTP_HOST is not set): "${email.subject}"`);
        return false;
      },
    };
  }

  if (config.SMTP_USER && !config.SMTP_PASS) {
    log.error("[mailer] SMTP_USER is set but SMTP_PASS is empty in .env — the SMTP login will fail.");
  }

  const from = resolveFrom(config);
  // Most hosted mailboxes (Hostinger included) refuse to send "from" an address other than
  // the one you log in with — flag it at startup instead of failing on the first enquiry.
  if (config.SMTP_USER && from.address.toLowerCase() !== config.SMTP_USER.toLowerCase()) {
    log.warn(
      `[mailer] MAIL_FROM (${from.address}) differs from SMTP_USER (${config.SMTP_USER}). ` +
        "Your provider may reject it unless it is an alias of that mailbox.",
    );
  }

  const transport = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    // Port 465 is implicit TLS; 587 upgrades with STARTTLS.
    secure: config.SMTP_SECURE || config.SMTP_PORT === 465,
    auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  // Check the SMTP connection at startup so a wrong host or password shows up in the
  // log immediately, not only when a buyer submits the form.
  transport
    .verify()
    .then(() => log.warn(`[mailer] SMTP ready (${config.SMTP_HOST}:${config.SMTP_PORT}) — enquiries go to ${config.MAIL_TO}.`))
    .catch((err: unknown) =>
      log.error(
        `[mailer] Cannot connect to SMTP ${config.SMTP_HOST}:${config.SMTP_PORT}. Check SMTP_* in .env ` +
          "(Hostinger: smtp.hostinger.com, port 465, full email address as SMTP_USER, mailbox password as SMTP_PASS).",
        err,
      ),
    );

  return {
    async sendEnquiry(enquiry) {
      const { subject, text, html } = renderEnquiryEmail(enquiry);
      try {
        await transport.sendMail({
          from,
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
    async send(email) {
      const to = email.to ?? config.MAIL_TO;
      try {
        const info = await transport.sendMail({ from, to, replyTo: email.replyTo, subject: email.subject, text: email.text, html: email.html });
        // What the mail server answered, so the terminal shows whether the email really left.
        const refused = (info.rejected ?? []).map(String);
        if (refused.length) {
          log.error(`[mailer] ✉ REFUSED by ${config.SMTP_HOST} for ${refused.join(", ")}: "${email.subject}" (${info.response})`);
          return false;
        }
        log.warn(`[mailer] ✉ Sent to ${to}: "${email.subject}" · ${config.SMTP_HOST} answered: ${info.response} · id ${info.messageId}`);
        return true;
      } catch (err) {
        const reason = err instanceof Error ? err.message.split(/\r?\n/)[0] : String(err);
        log.error(`[mailer] ✉ FAILED to send to ${to}: "${email.subject}" · ${reason}`);
        return false;
      }
    },
  };
}
