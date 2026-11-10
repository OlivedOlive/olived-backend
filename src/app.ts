import express, { type ErrorRequestHandler } from "express";
import cors from "cors";
import helmet from "helmet";
import { allowedOrigins, type Config } from "./config.js";
import { enquiryRoutes } from "./modules/enquiries/index.js";
import type { Mailer } from "./modules/enquiries/mailer.js";
import type { EnquiryStore } from "./modules/enquiries/storage.js";
import { studioOff, studioRoutes, type Db } from "./modules/studio/index.js";
import { logger, requestLogger, type Log } from "./shared/logger.js";

export interface AppDeps {
  config: Config;
  store: EnquiryStore;
  mailer: Mailer;
  /** Studio database. Without it the studio answers 503 and the enquiries keep working. */
  db?: Db;
  log?: Log;
}

/**
 * The OLIVED API. Each module owns its routes under /api:
 *   /api/enquiries  website quote forms   (modules/enquiries)
 *   /api/studio     OLIVED Studio         (modules/studio)
 */
export function createApp({ config, store, mailer, db, log = logger }: AppDeps) {
  const app = express();

  app.disable("x-powered-by");
  if (config.TRUST_PROXY) app.set("trust proxy", 1);

  app.use(requestLogger(log));
  app.use(helmet());
  app.use(
    cors({
      origin: allowedOrigins(config),
      methods: ["GET", "POST"],
      allowedHeaders: ["Content-Type"],
    }),
  );

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use("/api/enquiries", enquiryRoutes({ config, store, mailer, log }));
  app.use("/api/studio", db ? studioRoutes(config, db) : studioOff);

  app.use((_req, res) => {
    res.status(404).json({ success: false, error: "Not found" });
  });

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    // Malformed JSON or oversized body from express.json()
    const status = typeof err?.status === "number" ? err.status : 500;
    if (status >= 500) log.error("[server] Unhandled error:", err);
    res.status(status).json({
      success: false,
      error: status === 413 ? "Request is too large." : status < 500 ? "Invalid request." : "Server error.",
    });
  };
  app.use(onError);

  return app;
}
