import type { Db } from "../db.js";
import { HttpError, isUniqueViolation } from "../errors.js";
import { type DesignStatus, Prisma } from "../../../generated/prisma/client.js";
import { enqueue } from "../jobs/queue.js";
import type { DesignContent } from "./validate.js";

const EDITABLE: DesignStatus[] = ["DRAFT", "CHANGES_REQUESTED"];

const latestVersion = {
  orderBy: { number: "desc" },
  take: 1,
  include: {
    validationResults: { orderBy: { createdAt: "desc" }, take: 1 },
    approvals: { orderBy: { createdAt: "desc" }, take: 1, select: { decision: true, comment: true } },
  },
} satisfies Prisma.Design$versionsArgs;

const designDetails = {
  market: { include: { ruleSets: { where: { status: "PUBLISHED" }, orderBy: { version: "desc" }, take: 1 } } },
  template: { include: { variant: { include: { product: true } } } },
  versions: latestVersion,
} satisfies Prisma.DesignInclude;

/**
 * All client access to designs goes through here. MySQL has no row-level security, so this is
 * what keeps each organization's designs private: every query below filters on organizationId.
 */
export function designsFor(db: Db, organizationId: string) {
  async function find(id: string) {
    const design = await db.design.findFirst({ where: { id, organizationId }, include: designDetails });
    if (!design) throw new HttpError(404, "Design not found.");
    return design;
  }

  /** Locks the design row, so saving and submitting cannot overlap. */
  async function lockEditable(tx: Prisma.TransactionClient, id: string, data: Prisma.DesignUpdateManyMutationInput) {
    const { count } = await tx.design.updateMany({
      where: { id, organizationId, status: { in: EDITABLE } },
      data,
    });
    if (count === 0) throw new HttpError(409, "This design can no longer be changed.");
  }

  return {
    list: () =>
      db.design.findMany({
        where: { organizationId },
        orderBy: { updatedAt: "desc" },
        include: { market: true, template: { include: { variant: { include: { product: true } } } } },
      }),

    find,

    async create(input: { name: string; templateId: string; marketId: string; content: DesignContent }, userId: string) {
      const [template, ruleSet] = await Promise.all([
        db.packagingTemplate.findFirst({ where: { id: input.templateId, active: true } }),
        db.ruleSet.findFirst({ where: { marketId: input.marketId, status: "PUBLISHED", market: { active: true } } }),
      ]);
      if (!template) throw new HttpError(400, "This packaging is not available.");
      if (!ruleSet) throw new HttpError(400, "This market is not available yet.");

      return db.$transaction(async (tx) => {
        const design = await tx.design.create({
          data: {
            organizationId,
            createdById: userId,
            templateId: input.templateId,
            marketId: input.marketId,
            name: input.name,
            versions: { create: { number: 1, content: input.content, createdById: userId } },
          },
        });
        await tx.auditLog.create({
          data: { organizationId, userId, action: "design.created", entityType: "design", entityId: design.id },
        });
        return design;
      });
    },

    async addVersion(id: string, content: DesignContent, userId: string) {
      await find(id);
      try {
        return await db.$transaction(async (tx) => {
          await lockEditable(tx, id, { updatedAt: new Date() });
          const last = await tx.designVersion.findFirst({ where: { designId: id }, orderBy: { number: "desc" } });
          return tx.designVersion.create({
            data: { designId: id, number: (last?.number ?? 0) + 1, content, createdById: userId },
          });
        });
      } catch (err) {
        if (isUniqueViolation(err)) throw new HttpError(409, "This design was just saved elsewhere. Please reload.");
        throw err;
      }
    },

    async submit(id: string, userId: string) {
      const design = await find(id);
      const version = design.versions[0];
      if (!version) throw new HttpError(409, "This design has nothing to submit.");

      await db.$transaction(async (tx) => {
        await lockEditable(tx, id, { status: "SUBMITTED" });
        await enqueue(tx, "design.validate", { versionId: version.id });
        await tx.auditLog.create({
          data: {
            organizationId,
            userId,
            action: "design.submitted",
            entityType: "design",
            entityId: id,
            details: { version: version.number },
          },
        });
      });
      return find(id);
    },
  };
}

/** For the OLIVED team only: these read across all organizations. */
export function reviewQueue(db: Db) {
  return {
    async list() {
      const designs = await db.design.findMany({
        where: { status: "SUBMITTED" },
        orderBy: { updatedAt: "asc" },
        include: { ...designDetails, organization: true },
      });
      return designs.filter((d) => d.versions[0]?.validationResults[0]?.passed);
    },

    async decide(id: string, decision: "APPROVED" | "CHANGES_REQUESTED", comment: string | undefined, reviewerId: string) {
      const design = await db.design.findUnique({ where: { id }, include: { versions: latestVersion } });
      const version = design?.versions[0];
      if (!design || !version) throw new HttpError(404, "Design not found.");
      if (!version.validationResults[0]?.passed) throw new HttpError(409, "This version has not passed the market checks.");

      await db.$transaction(async (tx) => {
        const { count } = await tx.design.updateMany({ where: { id, status: "SUBMITTED" }, data: { status: decision } });
        if (count === 0) throw new HttpError(409, "This design is not waiting for review.");
        await tx.approval.create({ data: { versionId: version.id, reviewerId, decision, comment: comment ?? null } });
        await tx.auditLog.create({
          data: {
            organizationId: design.organizationId,
            userId: reviewerId,
            action: "design.reviewed",
            entityType: "design",
            entityId: id,
            details: { decision, version: version.number },
          },
        });
      });
    },
  };
}
