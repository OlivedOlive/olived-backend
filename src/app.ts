import { randomUUID } from "node:crypto";
import express, { type ErrorRequestHandler, type Request, type Response } from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { allowedOrigins, type Config } from "./config.js";
import { enquirySchema, fieldErrors } from "./enquiry-schema.js";
import type { Mailer } from "./mailer.js";
import type { EnquiryStore } from "./storage.js";

export interface AppDeps {
  config: Config;
  store: EnquiryStore;
  mailer: Mailer;
  log?: Pick<Console, "info" | "warn" | "error">;
}

export function createApp({ config, store, mailer, log = console }: AppDeps) {
  const app = express();

  app.disable("x-powered-by");
  if (config.TRUST_PROXY) app.set("trust proxy", 1);

  app.use(helmet());
  app.use(
    cors({
      origin: allowedOrigins(config),
      methods: ["GET", "POST"],
      allowedHeaders: ["Content-Type"],
    }),
  );
  app.use(express.json({ limit: "20kb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  const enquiryLimiter = rateLimit({
    windowMs: config.RATE_LIMIT_WINDOW_MIN * 60 * 1000,
    limit: config.RATE_LIMIT_MAX,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { success: false, error: "Too many enquiries from this connection. Please try again later." },
  });

  app.post("/api/enquiries", enquiryLimiter, async (req: Request, res: Response) => {
    const body: unknown = req.body ?? {};

    // Honeypot: bots fill every field. Pretend success, store nothing.
    if (typeof body === "object" && body !== null && "website" in body && (body as { website?: unknown }).website) {
      res.status(200).json({ success: true, mailed: false });
      return;
    }

    const parsed = enquirySchema.safeParse(body);
    if (!parsed.success) {
      const fields = fieldErrors(parsed.error);
      res.status(422).json({
        success: false,
        error: "Please check the highlighted fields.",
        fields,
      });
      return;
    }

    const { website: _honeypot, ...data } = parsed.data;
    const enquiry = {
      id: randomUUID(),
      receivedAt: new Date().toISOString(),
      ...data,
      ...(config.STORE_IP ? { ip: req.ip } : {}),
    };

    try {
      await store.save(enquiry);
    } catch (err) {
      log.error("[enquiries] Could not save enquiry:", err);
      res.status(500).json({ success: false, error: "We could not save your enquiry. Please email Contact@olived.tn." });
      return;
    }

    const mailed = await mailer.sendEnquiry(enquiry);
    log.info(`[enquiries] ${enquiry.id} saved (source=${enquiry.source}, mailed=${mailed})`);

    res.status(201).json({ success: true, mailed, id: enquiry.id });
  });

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
