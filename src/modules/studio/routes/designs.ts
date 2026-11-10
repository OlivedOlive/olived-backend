import { Router } from "express";
import { z } from "zod";
import { authOf, requireAuth, requireReviewer } from "../auth/session.js";
import type { Db } from "../db.js";
import { designsFor, reviewQueue } from "../designs/repository.js";
import { designContentSchema } from "../designs/validate.js";
import { logger } from "../../../shared/logger.js";

const createSchema = z.object({
  name: z.string().trim().min(1, "Give this design a name").max(160),
  templateId: z.string().min(1, "Choose a packaging"),
  marketId: z.string().min(1, "Choose a market"),
  content: designContentSchema,
});

const versionSchema = z.object({ content: designContentSchema });

const decisionSchema = z.object({
  decision: z.enum(["APPROVED", "CHANGES_REQUESTED"]),
  comment: z.string().trim().max(2000).optional(),
});

export function designRoutes(db: Db) {
  const router = Router();
  router.use(requireAuth);

  router.get("/", async (req, res) => {
    res.json({ designs: await designsFor(db, authOf(req).organization.id).list() });
  });

  router.post("/", async (req, res) => {
    const { organization, user } = authOf(req);
    const design = await designsFor(db, organization.id).create(createSchema.parse(req.body), user.id);
    logger.info(`[studio] Design created: "${design.name}" (${design.id}) by ${user.email}, ${organization.name}`);
    res.status(201).json({ design });
  });

  router.get("/:id", async (req, res) => {
    res.json({ design: await designsFor(db, authOf(req).organization.id).find(req.params.id) });
  });

  router.post("/:id/versions", async (req, res) => {
    const { organization, user } = authOf(req);
    const { content } = versionSchema.parse(req.body);
    const version = await designsFor(db, organization.id).addVersion(req.params.id, content, user.id);
    logger.info(`[studio] Design saved: ${req.params.id}, version ${version.number}, by ${user.email}`);
    res.status(201).json({ version });
  });

  router.post("/:id/submit", async (req, res) => {
    const { organization, user } = authOf(req);
    const design = await designsFor(db, organization.id).submit(req.params.id, user.id);
    logger.info(`[studio] Design submitted for review: ${req.params.id} by ${user.email}`);
    res.json({ design });
  });

  return router;
}

export function reviewRoutes(db: Db) {
  const router = Router();
  router.use(requireReviewer);

  router.get("/designs", async (_req, res) => {
    res.json({ designs: await reviewQueue(db).list() });
  });

  router.post("/designs/:id/decision", async (req, res) => {
    const { decision, comment } = decisionSchema.parse(req.body);
    await reviewQueue(db).decide(req.params.id, decision, comment, authOf(req).user.id);
    logger.info(`[studio] Review: ${req.params.id} ${decision} by ${authOf(req).user.email}`);
    res.json({ success: true });
  });

  return router;
}
