import { Router } from "express";
import { z } from "zod";
import { authOf, requireAdmin, requireAuth, requireReviewer } from "../auth/session.js";
import type { Db } from "../db.js";
import { designsFor, reviewQueue } from "../designs/repository.js";
import { contextFor, designContentSchema, evaluateChecks, rulesSchema } from "../designs/validate.js";
import { handlers } from "../jobs/handlers.js";
import { runNextJob } from "../jobs/queue.js";
import { addAdminOverviewRoutes } from "./admin-overview.js";
import { HttpError } from "../errors.js";
import { Prisma } from "../../../generated/prisma/client.js";
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
  versionId: z.string().min(1).optional(),
});

/** Paging for the admin lists. A page is at most 100 rows, so one request stays small. */
const pageSchema = z.object({
  take: z.coerce.number().int().min(1).max(100).default(20),
  skip: z.coerce.number().int().min(0).default(0),
});
const adminDesignsSchema = pageSchema.extend({
  status: z.enum(["DRAFT", "SUBMITTED", "CHANGES_REQUESTED", "APPROVED"]).optional(),
  q: z.string().trim().max(160).optional().transform((v) => v || undefined),
  market: z.string().trim().toUpperCase().regex(/^[A-Z]{2,8}$/).optional(),
  sort: z.enum(["recent", "oldest", "name"]).optional(),
});

const adminDecisionSchema = decisionSchema.extend({
  versionId: z.string().min(1),
}).refine(
  ({ decision, comment }) => decision !== "CHANGES_REQUESTED" || Boolean(comment),
  { path: ["comment"], message: "Explain the changes the client needs to make." },
);

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

  /** Runs the market's checks on unsaved content, for the editor's live checklist. Changes nothing. */
  router.post("/:id/check", async (req, res) => {
    const { content } = versionSchema.parse(req.body);
    const design = await designsFor(db, authOf(req).organization.id).find(req.params.id);
    const ruleSet = design.market.ruleSets[0];
    if (!ruleSet) throw new HttpError(409, "This market has no published rules.");
    res.json({ results: evaluateChecks(content, rulesSchema.parse(ruleSet.rules), contextFor(design.template)) });
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
    const { decision, comment, versionId } = decisionSchema.parse(req.body);
    await reviewQueue(db).decide(req.params.id, decision, comment, authOf(req).user.id, versionId);
    logger.info(`[studio] Review: ${req.params.id} ${decision} by ${authOf(req).user.email}`);
    res.json({ success: true });
  });

  return router;
}

export function adminRoutes(db: Db) {
  const router = Router();
  router.use(requireAdmin);
  addAdminOverviewRoutes(router, db);
  router.get("/designs", async (req, res) => {
    res.json(await reviewQueue(db).listForAdmin(adminDesignsSchema.parse(req.query)));
  });
  router.get("/users", async (req, res) => {
    const { take, skip } = pageSchema.parse(req.query);
    const [users, total] = await Promise.all([db.user.findMany({
      orderBy: { createdAt: "desc" },
      take,
      skip,
      select: {
        id: true, name: true, email: true, createdAt: true,
        memberships: { select: { role: true, organization: { select: { name: true } } } },
        designsCreated: {
          orderBy: { updatedAt: "desc" },
          select: { id: true, name: true, status: true, market: { select: { name: true } } },
        },
        _count: { select: { designsCreated: true, versions: true, approvals: true } },
      },
    }), db.user.count()]);
    res.json({ users, total });
  });
  router.post("/users/:id/delete", async (req, res) => {
    const actor = authOf(req).user.id;
    if (req.params.id === actor) throw new HttpError(409, "You cannot delete your own admin account.");
    try {
      await db.$transaction(async (tx) => {
        // Lock the user before checking references or membership. Foreign keys also prevent newly
        // written designs from being lost if a client saves while this operation is running.
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${req.params.id} FOR UPDATE`;
        const target = await tx.user.findUnique({ where: { id: req.params.id }, select: {
          id: true,
          memberships: { select: { role: true } },
          _count: { select: { designsCreated: true, versions: true, approvals: true } },
        } });
        if (!target) throw new HttpError(404, "User not found.");
        if (target.memberships.some(({ role }) => role === "OLIVED_ADMIN" || role === "OLIVED_REVIEWER")) {
          throw new HttpError(409, "Staff accounts are protected from deletion here.");
        }
        if (Object.values(target._count).some(Boolean)) {
          throw new HttpError(409, "This user has linked designs or reviews. Remove the appropriate designs first.");
        }
        await tx.user.delete({ where: { id: target.id } });
        await tx.auditLog.create({ data: { userId: actor, action: "user.deleted", entityType: "user", entityId: target.id } });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
        throw new HttpError(409, "This user has linked records and could not be deleted.");
      }
      throw error;
    }
    res.json({ success: true });
  });
  router.post("/designs/:id/delete", async (req, res) => {
    const actor = authOf(req).user.id;
    await db.$transaction(async (tx) => {
      const design = await tx.design.findUnique({ where: { id: req.params.id }, select: { id: true, organizationId: true } });
      if (!design || (await tx.design.deleteMany({ where: { id: design.id } })).count === 0) throw new HttpError(404, "Design not found.");
      await tx.auditLog.create({ data: {
        userId: actor, organizationId: design.organizationId, action: "design.deleted", entityType: "design", entityId: design.id,
      } });
    });
    res.json({ success: true });
  });
  router.post("/designs/:id/validate", async (req, res) => {
    const { versionId } = z.object({ versionId: z.string().min(1) }).parse(req.body);
    const design = await db.design.findFirst({
      where: { id: req.params.id, status: "SUBMITTED" },
      select: { versions: { orderBy: { number: "desc" }, take: 1, select: { id: true } } },
    });
    if (design?.versions[0]?.id !== versionId) {
      throw new HttpError(409, "This version is no longer waiting for validation. Refresh the dashboard.");
    }
    await runNextJob(db, handlers, versionId);
    const result = await db.validationResult.findFirst({ where: { versionId }, select: { passed: true } });
    if (!result) throw new HttpError(409, "Validation is running or its next retry is pending. Refresh in a moment.");
    res.json(result);
  });
  router.post("/designs/:id/decision", async (req, res) => {
    const { decision, comment, versionId } = adminDecisionSchema.parse(req.body);
    const { user } = authOf(req);
    await reviewQueue(db).decide(req.params.id, decision, comment, user.id, versionId);
    logger.info(`[studio] Admin review: ${req.params.id} ${decision} by ${user.email}`);
    res.json({ success: true });
  });
  return router;
}
