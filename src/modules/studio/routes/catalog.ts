import { Router } from "express";
import { requireAuth } from "../auth/session.js";
import type { Db } from "../db.js";

export function catalogRoutes(db: Db) {
  const router = Router();
  router.use(requireAuth);

  router.get("/products", async (_req, res) => {
    const products = await db.product.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      include: {
        variants: {
          where: { active: true },
          orderBy: { volumeMl: "asc" },
          include: { templates: { where: { active: true }, orderBy: { name: "asc" } } },
        },
      },
    });
    res.json({ products });
  });

  /** Only markets a client can design for: active, with published rules. */
  router.get("/markets", async (_req, res) => {
    const markets = await db.market.findMany({
      where: { active: true, ruleSets: { some: { status: "PUBLISHED" } } },
      orderBy: { name: "asc" },
      select: { id: true, code: true, name: true, languages: true },
    });
    res.json({ markets });
  });

  return router;
}
