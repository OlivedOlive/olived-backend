import { randomUUID } from "node:crypto";
import express, { Router, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import type { Config } from "../../config.js";
import { enquirySchema, fieldErrors } from "./enquiry-schema.js";
import type { Mailer } from "./mailer.js";
import type { EnquiryStore } from "./storage.js";

export interface EnquiryDeps {
  config: Config;
  store: EnquiryStore;
  mailer: Mailer;
  log: Pick<Console, "info" | "warn" | "error">;
}

/** Quote requests from the website forms. Mounted at /api/enquiries. */
export function enquiryRoutes({ config, store, mailer, log }: EnquiryDeps) {
  const router = Router();

  const limiter = rateLimit({
    windowMs: config.RATE_LIMIT_WINDOW_MIN * 60 * 1000,
    limit: config.RATE_LIMIT_MAX,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { success: false, error: "Too many enquiries from this connection. Please try again later." },
  });

  router.use(express.json({ limit: "20kb" }));

  router.post("/", limiter, async (req: Request, res: Response) => {
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

  return router;
}
