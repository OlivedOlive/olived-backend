import { allowedOrigins, type Config } from "../../config.js";
import type { Mailer, OlivedEmail } from "../enquiries/mailer.js";
import { logger } from "../../shared/logger.js";
import type { Db } from "./db.js";

const STAFF = ["OLIVED_ADMIN", "OLIVED_REVIEWER"] as const;

type Note = { type: string; title: string; body?: string | null; designId: string };
type Recipient = { userId: string; link: string };

/** Studio page of a design for the person who opens it: the admin detail, the review queue or the editor. */
const staffLink = (role: string, designId: string) => (role === "OLIVED_ADMIN" ? `/studio/admin/designs/${designId}` : "/studio/review");
/** Decisions and replies open on the last step, where the decision and the conversation are. */
const clientLink = (designId: string) => `/studio/designs/${designId}?step=review#messages`;

/** Everyone at OLIVED who reviews designs, except the person who acted. */
async function staff(db: Db, designId: string, except?: string): Promise<Recipient[]> {
  const members = await db.membership.findMany({ where: { role: { in: [...STAFF] } }, select: { userId: true, role: true } });
  const seen = new Map<string, Recipient>();
  for (const m of members) {
    if (m.userId === except) continue;
    // An admin who is also a reviewer gets the admin page.
    if (!seen.has(m.userId) || m.role === "OLIVED_ADMIN") seen.set(m.userId, { userId: m.userId, link: staffLink(m.role, designId) });
  }
  return [...seen.values()];
}

/** Everyone in the client's company, except the person who acted. */
async function client(db: Db, organizationId: string, designId: string, except?: string): Promise<Recipient[]> {
  const members = await db.membership.findMany({ where: { organizationId }, select: { userId: true } });
  return [...new Set(members.map((m) => m.userId))].filter((id) => id !== except).map((userId) => ({ userId, link: clientLink(designId) }));
}

async function write(db: Db, recipients: Recipient[], note: Note) {
  if (!recipients.length) return;
  await db.notification.createMany({
    data: recipients.map((r) => ({ userId: r.userId, link: r.link, type: note.type, title: note.title.slice(0, 200), body: note.body ?? null, designId: note.designId })),
  });
}

/** Notifications must never break the action that caused them: failures are logged. */
async function safely(what: string, run: () => Promise<void>) {
  try {
    await run();
  } catch (error) {
    logger.error(`[studio] Could not ${what}:`, error);
  }
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** The email to the OLIVED inbox when a client sends a design for review. */
export function designSubmittedEmail(design: {
  id: string; name: string;
  organization: { name: string };
  createdBy: { name: string; email: string };
  market: { name: string; code: string };
  template: { name: string; widthMm: unknown; heightMm: unknown; variant: { name: string; product: { name: string } } };
  versions: { number: number; content: unknown }[];
}, submittedBy: { name: string; email: string }, siteUrl: string): OlivedEmail {
  const version = design.versions[0];
  const fields = ((version?.content as { fields?: Record<string, string> } | undefined)?.fields) ?? {};
  const link = `${siteUrl}/studio/admin/designs/${design.id}`;
  const rows: [string, string][] = ([
    ["Design", design.name],
    ["Company", design.organization.name],
    ["Sent by", `${submittedBy.name} <${submittedBy.email}>`],
    ["Created by", `${design.createdBy.name} <${design.createdBy.email}>`],
    ["Product", design.template.variant.product.name],
    ["Bottle", design.template.variant.name],
    ["Packaging", design.template.name],
    ["Label size", Number(design.template.widthMm) ? `${Number(design.template.widthMm)} × ${Number(design.template.heightMm)} mm` : ""],
    ["Market", `${design.market.name} (${design.market.code})`],
    ["Sold at", fields.saleLocation ?? ""],
    ["Sales channel", fields.salesChannel ?? ""],
    ["Barcode", fields.barcode && !/\[/.test(fields.barcode) ? fields.barcode : ""],
    ["Version", version ? String(version.number) : ""],
  ] as [string, string][]).filter(([, value]) => value);
  const subject = `New design to review: ${design.name} · ${design.organization.name} · ${design.market.name}`;
  const text = [
    "A client sent a packaging design for review in OLIVED Studio.",
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    "",
    `The market check runs now; open the design to see the result and to approve it or ask for changes:`,
    link,
  ].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#F6F1E5;font-family:Arial,Helvetica,sans-serif;color:#243B2B">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F1E5;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#FFFDF7;border:1px solid #E2D8C3;border-radius:14px;overflow:hidden">
<tr><td style="background:#3F5F2F;padding:18px 24px;color:#FFFFFF;font-size:13px;letter-spacing:.08em;text-transform:uppercase;font-weight:bold">OLIVED Studio · New design to review</td></tr>
<tr><td style="padding:24px">
<h1 style="margin:0 0 6px;font-family:Georgia,serif;font-weight:normal;font-size:24px;color:#243B2B">${escapeHtml(design.name)}</h1>
<p style="margin:0 0 18px;color:#6E6A5A;font-size:14px">${escapeHtml(design.organization.name)} sent this design for ${escapeHtml(design.market.name)}.</p>
<table role="presentation" width="100%" cellpadding="8" cellspacing="0" style="font-size:14px;border-collapse:collapse">
${rows.map(([k, v]) => `<tr><td style="color:#6E6A5A;border-bottom:1px solid #EDE8DC;width:150px">${escapeHtml(k)}</td><td style="border-bottom:1px solid #EDE8DC">${escapeHtml(v)}</td></tr>`).join("\n")}
</table>
<p style="margin:22px 0 8px;font-size:14px;color:#6E6A5A">The market check runs now. Open the design to see the result, then approve it or ask for changes.</p>
<p style="margin:0"><a href="${escapeHtml(link)}" style="display:inline-block;background:#3F5F2F;color:#FFFFFF;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:10px">Open the design</a></p>
</td></tr>
<tr><td style="padding:14px 24px;border-top:1px solid #E2D8C3;color:#8A8475;font-size:12px">Reply to this email to write to ${escapeHtml(submittedBy.name)} directly.</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, text, html, replyTo: { name: submittedBy.name, address: submittedBy.email } };
}

/** What happens when a client sends a design: the OLIVED team is told in the Studio and by email. */
export async function onDesignSubmitted(db: Db, mailer: Mailer | undefined, config: Config, designId: string, by: { id: string; name: string; email: string }) {
  const design = await db.design.findUnique({
    where: { id: designId },
    include: {
      organization: { select: { name: true } }, createdBy: { select: { name: true, email: true } }, market: { select: { name: true, code: true } },
      template: { include: { variant: { include: { product: true } } } },
      versions: { orderBy: { number: "desc" }, take: 1, select: { number: true, content: true } },
    },
  });
  if (!design) return;
  await safely("notify the OLIVED team of a new design", async () => {
    await write(db, await staff(db, designId, by.id), {
      type: "design.submitted", designId,
      title: `New design to review: ${design.name}`,
      body: `${design.organization.name} · ${design.market.name} · sent by ${by.name}`,
    });
  });
  if (mailer?.send) {
    await safely("email the new design", async () => {
      const sent = await mailer.send!(designSubmittedEmail(design, by, allowedOrigins(config)[0] ?? ""));
      if (sent) logger.info(`[studio] Design ${designId} emailed to ${config.MAIL_TO}`);
    });
  }
}

/** What happens after a decision: the client's company is told, with the team's message. */
export async function onDecision(db: Db, designId: string, decision: "APPROVED" | "CHANGES_REQUESTED", comment: string | undefined, by: string) {
  await safely("notify the client of a decision", async () => {
    const design = await db.design.findUnique({ where: { id: designId }, select: { name: true, organizationId: true } });
    if (!design) return;
    await write(db, await client(db, design.organizationId, designId, by), {
      type: decision === "APPROVED" ? "design.approved" : "design.changes", designId,
      title: decision === "APPROVED" ? `Approved: ${design.name}` : `Changes requested: ${design.name}`,
      body: comment || (decision === "APPROVED" ? "The OLIVED team approved your design for printing." : "The OLIVED team asked for changes."),
    });
  });
}

/** A new message on a design: the other side of the conversation is told. */
export async function onMessage(db: Db, designId: string, author: { id: string; name: string }, fromStaff: boolean, body: string) {
  await safely("notify a new message", async () => {
    const design = await db.design.findUnique({ where: { id: designId }, select: { name: true, organizationId: true } });
    if (!design) return;
    const recipients = fromStaff ? await client(db, design.organizationId, designId, author.id) : await staff(db, designId, author.id);
    await write(db, recipients, {
      type: "design.message", designId,
      title: fromStaff ? `OLIVED replied about ${design.name}` : `New message about ${design.name}`,
      body: `${author.name}: ${body.length > 240 ? `${body.slice(0, 237)}…` : body}`,
    });
  });
}
