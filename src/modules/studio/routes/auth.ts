import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { DUMMY_HASH, hashPassword, verifyPassword } from "../auth/password.js";
import { newResetCode, RESET_CODE_MINUTES, RESET_MAX_ATTEMPTS, resetCodeEmail } from "../auth/password-reset.js";
import type { Mailer } from "../../enquiries/mailer.js";
import { allowedOrigins } from "../../../config.js";
import { weakPasswordReason } from "../auth/password-policy.js";
import { authOf, clearSessionCookie, requireAuth, startSession } from "../auth/session.js";
import type { Config } from "../../../config.js";
import type { Db } from "../db.js";
import { HttpError, isUniqueViolation } from "../errors.js";
import { logger } from "../../../shared/logger.js";

const email = z.email("Enter a valid email address").max(254).toLowerCase();

const registerSchema = z
  .object({
    name: z.string().trim().min(1, "Enter your name").max(120),
    company: z.string().trim().min(1, "Enter your company").max(160),
    email,
    password: z.string().min(10, "Use at least 10 characters").max(200),
  })
  .superRefine((input, ctx) => {
    const reason = weakPasswordReason(input.password, input);
    if (reason) ctx.addIssue({ code: "custom", path: ["password"], message: reason });
  });

const loginSchema = z.object({ email, password: z.string().max(200) });
const forgotSchema = z.object({ email });
const newPassword = z.string().min(10, "Use at least 10 characters").max(200);
const resetSchema = z.object({
  email,
  code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code from the email"),
  password: newPassword,
});
const changeSchema = z.object({ current: z.string().max(200), password: newPassword });
const WRONG_CODE = "This code is wrong or has expired. Check the email, or ask for a new code.";

export function authRoutes(db: Db, config: Config, mailer?: Mailer) {
  const router = Router();
  const window = 15 * 60 * 1000;
  const common = { windowMs: window, standardHeaders: "draft-8", legacyHeaders: false } as const;

  // Per connection. Behind the website every visitor shares its address unless TRUST_PROXY is set
  // behind a proxy that adds X-Forwarded-For, so the per-account limit below is the real guard.
  const signUpLimiter = rateLimit({
    ...common,
    limit: config.AUTH_RATE_LIMIT_MAX,
    message: { error: "Too many sign-ups from this connection. Please try again later." },
  });
  const loginIpLimiter = rateLimit({
    ...common,
    limit: config.AUTH_RATE_LIMIT_MAX,
    skipSuccessfulRequests: true,
    message: { error: "Too many attempts. Please try again later." },
  });

  // Per account: wrong passwords for one email lock that email for the window, whatever the
  // address they come from. Successful logins do not count.
  const accountLimiter = rateLimit({
    ...common,
    limit: config.LOGIN_MAX_FAILURES,
    skipSuccessfulRequests: true,
    keyGenerator: (req) => `account:${String(req.body?.email ?? "").trim().toLowerCase()}`,
    handler: (req, res, _next, options) => {
      logger.warn(`[studio] Login locked for 15 minutes after repeated wrong passwords: ${String(req.body?.email ?? "")}`);
      res.status(options.statusCode).json({
        error: "Too many wrong passwords for this account. Please wait 15 minutes and try again.",
      });
    },
  });

  router.post("/register", signUpLimiter, async (req, res) => {
    const input = registerSchema.parse(req.body);
    const passwordHash = await hashPassword(input.password);
    try {
      const user = await db.user.create({
        data: {
          email: input.email,
          name: input.name,
          passwordHash,
          memberships: { create: { role: "CLIENT_ADMIN", organization: { create: { name: input.company } } } },
        },
      });
      await startSession(db, config, res, user.id);
      logger.info(`[studio] New account: ${input.email} (${input.company})`);
      res.status(201).json({ success: true });
    } catch (err) {
      if (isUniqueViolation(err)) {
        logger.warn(`[studio] Sign-up refused, email already used: ${input.email}`);
        throw new HttpError(409, "An account with this email already exists.");
      }
      throw err;
    }
  });

  router.post("/login", loginIpLimiter, accountLimiter, async (req, res) => {
    const input = loginSchema.parse(req.body);
    const user = await db.user.findUnique({ where: { email: input.email } });
    const valid = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !valid) {
      logger.warn(`[studio] Failed login: ${input.email}`);
      throw new HttpError(401, "Wrong email or password.");
    }
    await startSession(db, config, res, user.id);
    logger.info(`[studio] Logged in: ${user.email}`);
    res.json({ success: true });
  });

  // Codes by email: a few per connection and per account, so the form cannot flood an inbox.
  const forgotLimiter = rateLimit({
    ...common,
    limit: 5,
    keyGenerator: (req) => `forgot:${String(req.body?.email ?? "").trim().toLowerCase()}`,
    message: { error: "Too many codes asked for this account. Please wait 15 minutes." },
  });
  const resetIpLimiter = rateLimit({ ...common, limit: config.AUTH_RATE_LIMIT_MAX, message: { error: "Too many attempts. Please try again later." } });

  /**
   * Sends a code to set a new password. The answer is the same whether or not the email has an
   * account, so the form does not tell who uses the Studio.
   */
  router.post("/forgot", resetIpLimiter, forgotLimiter, async (req, res) => {
    const input = forgotSchema.parse(req.body);
    const user = await db.user.findUnique({ where: { email: input.email }, select: { id: true, name: true, email: true } });
    if (user) {
      const code = newResetCode();
      await db.$transaction([
        db.passwordReset.deleteMany({ where: { userId: user.id } }),
        db.passwordReset.create({ data: { userId: user.id, codeHash: await hashPassword(code), expiresAt: new Date(Date.now() + RESET_CODE_MINUTES * 60_000) } }),
      ]);
      const sent = mailer?.send ? await mailer.send(resetCodeEmail(user, code, allowedOrigins(config)[0] ?? "")) : false;
      logger.info(`[studio] Password code ${sent ? "emailed" : "NOT emailed"} to ${user.email}`);
      // Without SMTP on a development machine, the code is in the log so the flow can still be tried.
      if (!sent && config.NODE_ENV !== "production") logger.warn(`[studio] Development only, code for ${user.email}: ${code}`);
    } else {
      logger.info(`[studio] Password code asked for an unknown email: ${input.email}`);
    }
    res.json({ success: true });
  });

  /** Sets a new password with the emailed code, ends every other login and logs in. */
  router.post("/reset", resetIpLimiter, async (req, res) => {
    const input = resetSchema.parse(req.body);
    const user = await db.user.findUnique({ where: { email: input.email }, select: { id: true, name: true, email: true } });
    const reset = user && await db.passwordReset.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });
    if (!user || !reset || reset.expiresAt < new Date() || reset.attempts >= RESET_MAX_ATTEMPTS) {
      await verifyPassword(input.code, DUMMY_HASH); // Same time whatever went wrong.
      throw new HttpError(400, WRONG_CODE);
    }
    if (!(await verifyPassword(input.code, reset.codeHash))) {
      const attempts = reset.attempts + 1;
      if (attempts >= RESET_MAX_ATTEMPTS) await db.passwordReset.deleteMany({ where: { userId: user.id } });
      else await db.passwordReset.update({ where: { id: reset.id }, data: { attempts } });
      logger.warn(`[studio] Wrong password code for ${user.email} (${attempts}/${RESET_MAX_ATTEMPTS})`);
      throw new HttpError(400, attempts >= RESET_MAX_ATTEMPTS ? "Too many wrong codes. Ask for a new code." : WRONG_CODE);
    }
    const weak = weakPasswordReason(input.password, user);
    if (weak) throw new HttpError(400, "Please check the highlighted fields.", { password: weak });
    await db.$transaction([
      db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(input.password) } }),
      db.passwordReset.deleteMany({ where: { userId: user.id } }),
      db.session.deleteMany({ where: { userId: user.id } }),
      db.auditLog.create({ data: { userId: user.id, action: "user.password_reset", entityType: "user", entityId: user.id } }),
    ]);
    await startSession(db, config, res, user.id);
    logger.info(`[studio] Password set with an emailed code: ${user.email}`);
    res.json({ success: true });
  });

  /** Changes the password of the signed-in user, who confirms the current one; other logins end. */
  router.post("/password", requireAuth, loginIpLimiter, async (req, res) => {
    const input = changeSchema.parse(req.body);
    const { user, sessionId } = authOf(req);
    const stored = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordHash: true } });
    if (!(await verifyPassword(input.current, stored.passwordHash))) {
      throw new HttpError(400, "Please check the highlighted fields.", { current: "This is not your current password." });
    }
    const weak = weakPasswordReason(input.password, user);
    if (weak) throw new HttpError(400, "Please check the highlighted fields.", { password: weak });
    await db.$transaction([
      db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(input.password) } }),
      db.session.deleteMany({ where: { userId: user.id, id: { not: sessionId } } }),
      db.auditLog.create({ data: { userId: user.id, action: "user.password_changed", entityType: "user", entityId: user.id } }),
    ]);
    logger.info(`[studio] Password changed: ${user.email}`);
    res.json({ success: true });
  });

  router.post("/logout", requireAuth, async (req, res) => {
    await db.session.delete({ where: { id: authOf(req).sessionId } });
    logger.info(`[studio] Logged out: ${authOf(req).user.email}`);
    clearSessionCookie(config, res);
    res.json({ success: true });
  });

  router.get("/me", requireAuth, (req, res) => {
    const { user, organization, role } = authOf(req);
    res.json({ user, organization, role });
  });

  return router;
}
