import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { DUMMY_HASH, hashPassword, verifyPassword } from "../auth/password.js";
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

export function authRoutes(db: Db, config: Config) {
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
