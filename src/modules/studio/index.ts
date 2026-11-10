import express, { Router, type RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import { allowedOrigins, type Config } from "../../config.js";
import { loadAuth } from "./auth/session.js";
import type { Db } from "./db.js";
import { errorHandler, HttpError } from "./errors.js";
import { authRoutes } from "./routes/auth.js";
import { catalogRoutes } from "./routes/catalog.js";
import { designRoutes, reviewRoutes } from "./routes/designs.js";

/**
 * Second layer against cross-site requests (CSRF), on top of the SameSite cookie: a change must
 * come from the website, judged by the Origin header and, when the browser sends it, Sec-Fetch-Site.
 */
function rejectOtherOrigins(allowed: string[]): RequestHandler {
  return (req, _res, next) => {
    if (req.method === "GET" || req.method === "HEAD") return next();
    const { origin } = req.headers;
    const crossSite = req.headers["sec-fetch-site"] === "cross-site";
    if ((origin && !allowed.includes(origin)) || crossSite) {
      throw new HttpError(403, "This request is not allowed from another website.");
    }
    next();
  };
}

/** Caps the changes one account can make, so a single login cannot flood the server. */
function limitChangesPerUser(): RequestHandler {
  return rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skip: (req) => req.method === "GET" || req.method === "HEAD" || !req.auth,
    keyGenerator: (req) => `user:${req.auth?.user.id}`,
    message: { error: "You are making changes too quickly. Please wait a minute." },
  });
}

/**
 * OLIVED Studio: accounts, catalog, packaging designs and review. Mounted at /api/studio.
 * The website forwards its /api/studio/* requests here, so the login cookie stays on the site's own domain.
 */
export function studioRoutes(config: Config, db: Db) {
  const router = Router();

  router.get("/health", async (_req, res) => {
    await db.$queryRaw`SELECT 1`;
    res.json({ status: "ok" });
  });

  router.use(rejectOtherOrigins(allowedOrigins(config).map((o) => new URL(o).origin)));
  router.use(express.json({ limit: "200kb" }));
  router.use(loadAuth(db, config));
  router.use(limitChangesPerUser());

  router.use("/auth", authRoutes(db, config));
  router.use("/catalog", catalogRoutes(db));
  router.use("/designs", designRoutes(db));
  router.use("/review", reviewRoutes(db));

  router.use((_req, res) => {
    res.status(404).json({ error: "Not found." });
  });
  router.use(errorHandler);

  return router;
}

/** Answers every studio request while DATABASE_URL is empty. */
export const studioOff: RequestHandler = (_req, res) => {
  res.status(503).json({ error: "OLIVED Studio is not set up on this server yet." });
};

export { createDb, type Db } from "./db.js";
