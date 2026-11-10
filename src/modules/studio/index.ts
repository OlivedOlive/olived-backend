import express, { Router, type RequestHandler } from "express";
import { allowedOrigins, type Config } from "../../config.js";
import { loadAuth } from "./auth/session.js";
import type { Db } from "./db.js";
import { errorHandler, HttpError } from "./errors.js";
import { authRoutes } from "./routes/auth.js";
import { catalogRoutes } from "./routes/catalog.js";
import { designRoutes, reviewRoutes } from "./routes/designs.js";

/** Second layer against cross-site requests, on top of the SameSite cookie. */
function rejectOtherOrigins(allowed: string[]): RequestHandler {
  return (req, _res, next) => {
    const { origin } = req.headers;
    if (req.method !== "GET" && req.method !== "HEAD" && origin && !allowed.includes(origin)) {
      throw new HttpError(403, "This request is not allowed from another website.");
    }
    next();
  };
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
  router.use(loadAuth(db));

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
