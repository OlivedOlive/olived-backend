import { randomInt } from "node:crypto";
import type { OlivedEmail } from "../../enquiries/mailer.js";

/** How long an emailed code works, and how many wrong codes end it. */
export const RESET_CODE_MINUTES = 15;
export const RESET_MAX_ATTEMPTS = 5;

/** A six-digit code, from a cryptographic random source. */
export const newResetCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** The email that carries the code to the account's own address. */
export function resetCodeEmail(user: { name: string; email: string }, code: string, siteUrl: string): OlivedEmail {
  const link = `${siteUrl}/studio/forgot?email=${encodeURIComponent(user.email)}`;
  const subject = `Your OLIVED Studio code: ${code}`;
  const text = [
    `Hello ${user.name},`,
    "",
    `Your code to set a new OLIVED Studio password is: ${code}`,
    "",
    `It works for ${RESET_CODE_MINUTES} minutes. Enter it on the page where you asked for it:`,
    link,
    "",
    "If you did not ask for a new password, ignore this email: your password stays the same.",
  ].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#F6F1E5;font-family:Arial,Helvetica,sans-serif;color:#243B2B">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F1E5;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FFFDF7;border:1px solid #E2D8C3;border-radius:14px;overflow:hidden">
<tr><td style="background:#3F5F2F;padding:16px 24px;color:#FFFFFF;font-size:13px;letter-spacing:.08em;text-transform:uppercase;font-weight:bold">OLIVED Studio</td></tr>
<tr><td style="padding:26px 24px">
<p style="margin:0 0 10px;font-size:15px">Hello ${escapeHtml(user.name)},</p>
<p style="margin:0 0 18px;font-size:15px;color:#4F5446">Here is your code to set a new password:</p>
<p style="margin:0 0 18px;text-align:center"><span style="display:inline-block;padding:14px 22px;border-radius:12px;background:#EEF2E2;border:1px solid #D9E2C6;font-family:'Courier New',monospace;font-size:32px;letter-spacing:10px;font-weight:bold;color:#3F5F2F">${code}</span></p>
<p style="margin:0 0 18px;font-size:14px;color:#6E6A5A">It works for ${RESET_CODE_MINUTES} minutes.</p>
<p style="margin:0"><a href="${escapeHtml(link)}" style="display:inline-block;background:#3F5F2F;color:#FFFFFF;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:10px">Set a new password</a></p>
</td></tr>
<tr><td style="padding:14px 24px;border-top:1px solid #E2D8C3;color:#8A8475;font-size:12px">If you did not ask for a new password, ignore this email: your password stays the same.</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, text, html, to: user.email };
}
