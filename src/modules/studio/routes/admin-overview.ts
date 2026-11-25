import type { Router } from "express";
import { z } from "zod";
import type { Db } from "../db.js";

const DAY = 24 * 60 * 60 * 1000;

const organizationsSchema = z.object({
  take: z.coerce.number().int().min(1).max(100).default(20),
  skip: z.coerce.number().int().min(0).default(0),
  q: z.string().trim().max(160).optional(),
});

/** Counts from a groupBy as a plain record, with every expected key present. */
function tally<K extends string>(keys: readonly K[], rows: { key: K; count: number }[]) {
  return Object.fromEntries(keys.map((key) => [key, rows.find((row) => row.key === key)?.count ?? 0])) as Record<K, number>;
}

/**
 * Read-only figures for the admin dashboard: the design pipeline, users, organisations and the state of
 * the system (markets and their rules, background jobs, uploads, recent activity). Mounted on the admin
 * router, so only OLIVED admins reach it.
 */
export function addAdminOverviewRoutes(router: Router, db: Db) {
  router.get("/overview", async (_req, res) => {
    const now = Date.now();
    const month = new Date(now - 30 * DAY);
    const week = new Date(now - 7 * DAY);
    const pingStart = performance.now();
    await db.$queryRaw`SELECT 1`;
    const databaseMs = Math.round((performance.now() - pingStart) * 10) / 10;

    const [
      statusRows, designsTotal, designsThisMonth, marketRows, checks, decisions,
      usersTotal, usersThisWeek, staff, organizations, organizationsThisMonth,
      markets, products, templates, jobRows, failedJobs, assets, activity,
    ] = await Promise.all([
      db.design.groupBy({ by: ["status"], _count: { _all: true } }),
      db.design.count(),
      db.design.count({ where: { createdAt: { gte: month } } }),
      db.design.groupBy({ by: ["marketId"], _count: { _all: true } }),
      db.validationResult.groupBy({ by: ["passed"], _count: { _all: true } }),
      db.approval.groupBy({ by: ["decision"], where: { createdAt: { gte: month } }, _count: { _all: true } }),
      db.user.count(),
      db.user.count({ where: { createdAt: { gte: week } } }),
      db.membership.count({ where: { role: { in: ["OLIVED_ADMIN", "OLIVED_REVIEWER"] } } }),
      db.organization.count(),
      db.organization.count({ where: { createdAt: { gte: month } } }),
      db.market.findMany({
        orderBy: { name: "asc" },
        select: {
          id: true, code: true, name: true, active: true,
          ruleSets: { where: { status: "PUBLISHED" }, orderBy: { version: "desc" }, take: 1, select: { version: true, rules: true, publishedAt: true } },
          _count: { select: { designs: true } },
        },
      }),
      db.product.count(),
      db.packagingTemplate.count(),
      db.job.groupBy({ by: ["status"], _count: { _all: true } }),
      db.job.findMany({
        where: { status: "FAILED" }, orderBy: { updatedAt: "desc" }, take: 5,
        select: { id: true, type: true, attempts: true, lastError: true, updatedAt: true },
      }),
      db.brandAsset.aggregate({ _count: { _all: true }, _sum: { sizeBytes: true } }),
      db.auditLog.findMany({
        orderBy: { createdAt: "desc" }, take: 12,
        select: {
          id: true, action: true, entityType: true, createdAt: true,
          user: { select: { name: true, email: true } }, organization: { select: { name: true } },
        },
      }),
    ]);

    const marketName = new Map(markets.map((m) => [m.id, m.name]));
    res.json({
      designs: {
        total: designsTotal,
        thisMonth: designsThisMonth,
        byStatus: tally(["DRAFT", "SUBMITTED", "CHANGES_REQUESTED", "APPROVED"] as const,
          statusRows.map((row) => ({ key: row.status, count: row._count._all }))),
        byMarket: marketRows
          .map((row) => ({ market: marketName.get(row.marketId) ?? "Unknown", count: row._count._all }))
          .sort((a, b) => b.count - a.count),
        checks: tally(["passed", "failed"] as const, checks.map((row) => ({ key: row.passed ? "passed" : "failed", count: row._count._all }))),
        decisionsThisMonth: tally(["APPROVED", "CHANGES_REQUESTED"] as const,
          decisions.map((row) => ({ key: row.decision, count: row._count._all }))),
      },
      users: { total: usersTotal, thisWeek: usersThisWeek, staff },
      organizations: { total: organizations, thisMonth: organizationsThisMonth },
      system: {
        databaseMs,
        node: process.version,
        uptimeSeconds: Math.round(process.uptime()),
        environment: process.env.NODE_ENV ?? "development",
        catalog: { products, templates },
        markets: markets.map((m) => {
          const rules = (m.ruleSets[0]?.rules ?? {}) as { draft?: boolean; templateVersion?: number };
          return {
            code: m.code, name: m.name, active: m.active, designs: m._count.designs,
            ruleVersion: m.ruleSets[0]?.version ?? null, publishedAt: m.ruleSets[0]?.publishedAt ?? null,
            draft: Boolean(rules.draft), templateVersion: rules.templateVersion ?? null,
          };
        }),
        jobs: tally(["PENDING", "RUNNING", "DONE", "FAILED"] as const, jobRows.map((row) => ({ key: row.status, count: row._count._all }))),
        failedJobs: failedJobs.map((job) => ({ ...job, lastError: job.lastError?.slice(0, 300) ?? null })),
        assets: { count: assets._count._all, bytes: assets._sum.sizeBytes ?? 0 },
      },
      activity,
    });
  });

  router.get("/organizations", async (req, res) => {
    const { take, skip, q } = organizationsSchema.parse(req.query);
    const where = q ? { name: { contains: q } } : {};
    const [organizations, total] = await Promise.all([
      db.organization.findMany({
        where, orderBy: { createdAt: "desc" }, take, skip,
        select: {
          id: true, name: true, country: true, createdAt: true,
          _count: { select: { memberships: true, designs: true, brandAssets: true } },
          memberships: { take: 6, orderBy: { createdAt: "asc" }, select: { role: true, user: { select: { name: true, email: true } } } },
          designs: { take: 4, orderBy: { updatedAt: "desc" }, select: { id: true, name: true, status: true, updatedAt: true, market: { select: { name: true } } } },
        },
      }),
      db.organization.count({ where }),
    ]);
    const statusRows = organizations.length ? await db.design.groupBy({
      by: ["organizationId", "status"],
      where: { organizationId: { in: organizations.map((o) => o.id) } },
      _count: { _all: true },
    }) : [];
    res.json({
      total,
      organizations: organizations.map((organization) => ({
        ...organization,
        designStatus: tally(["DRAFT", "SUBMITTED", "CHANGES_REQUESTED", "APPROVED"] as const, statusRows
          .filter((row) => row.organizationId === organization.id)
          .map((row) => ({ key: row.status, count: row._count._all }))),
      })),
    });
  });
}
