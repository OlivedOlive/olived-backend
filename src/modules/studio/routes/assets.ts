import { randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import express, { Router } from "express";
import { authOf, requireAuth } from "../auth/session.js";
import type { Config } from "../../../config.js";
import type { Db } from "../db.js";
import { HttpError } from "../errors.js";
import { logger } from "../../../shared/logger.js";

/** The largest logo or image a company can upload. */
export const MAX_ASSET_BYTES = 5 * 1024 * 1024;

const TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
} as const;
type ImageType = keyof typeof TYPES;

/** The file really is the image type it claims to be (checked from its first bytes, not its name). */
function matchesType(type: ImageType, data: Buffer) {
  if (type === "image/png") return data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (type === "image/jpeg") return data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  if (type === "image/webp") return data.subarray(0, 4).toString("latin1") === "RIFF" && data.subarray(8, 12).toString("latin1") === "WEBP";
  return /<svg[\s>]/i.test(data.subarray(0, 4096).toString("utf8"));
}

/**
 * An SVG may carry scripts or load other files. Logos need neither, so anything that could run or
 * fetch is refused rather than cleaned. Files are also served with a sandboxing policy (see below).
 */
function unsafeSvg(data: Buffer) {
  const text = data.toString("utf8");
  return /<script|<foreignObject|<iframe|<embed|<object|\son[a-z]+\s*=|javascript:|<!ENTITY|(href|src)\s*=\s*["']\s*(https?:|\/\/|data:text)/i.test(text);
}

const assetView = (asset: { id: string; name: string; mimeType: string; sizeBytes: number; createdAt: Date }) => ({
  id: asset.id,
  name: asset.name,
  mimeType: asset.mimeType,
  sizeBytes: asset.sizeBytes,
  createdAt: asset.createdAt,
  url: `/api/studio/assets/${asset.id}`,
});

/**
 * Each company's library of logos and images, reused across its designs. Files are stored on disk in
 * STUDIO_FILES_DIR, outside any public folder; only the company and OLIVED staff can read them.
 */
export function assetRoutes(db: Db, config: Config) {
  const router = Router();
  const folder = path.resolve(config.STUDIO_FILES_DIR);
  router.use(requireAuth);

  router.get("/", async (req, res) => {
    const assets = await db.brandAsset.findMany({
      where: { organizationId: authOf(req).organization.id },
      orderBy: { createdAt: "desc" },
    });
    res.json({ assets: assets.map(assetView) });
  });

  router.post("/", express.raw({ type: Object.keys(TYPES), limit: MAX_ASSET_BYTES }), async (req, res) => {
    const type = (req.headers["content-type"] ?? "").split(";")[0]!.trim() as ImageType;
    const data = req.body as unknown;
    if (!(type in TYPES) || !Buffer.isBuffer(data) || data.length === 0) {
      throw new HttpError(400, "Upload a PNG, JPEG, WebP or SVG image.");
    }
    if (!matchesType(type, data)) throw new HttpError(400, "This file is not the image type it claims to be.");
    if (type === "image/svg+xml" && unsafeSvg(data)) {
      throw new HttpError(400, "This SVG contains scripts or links to other files. Export the logo again as a plain SVG.");
    }
    const raw = String(req.headers["x-file-name"] ?? "");
    let name = "Logo";
    try {
      name = decodeURIComponent(raw).replace(/[\u0000-\u001f]/g, "").trim().slice(0, 160) || name;
    } catch {
      // A badly encoded name only loses the name.
    }

    const { organization, user } = authOf(req);
    const storageKey = `${randomBytes(16).toString("hex")}.${TYPES[type]}`;
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, storageKey), data, { flag: "wx" });
    try {
      const asset = await db.brandAsset.create({
        data: { organizationId: organization.id, name, storageKey, mimeType: type, sizeBytes: data.length },
      });
      logger.info(`[studio] Asset uploaded: "${name}" (${asset.id}, ${data.length} bytes) by ${user.email}`);
      res.status(201).json({ asset: assetView(asset) });
    } catch (error) {
      await unlink(path.join(folder, storageKey)).catch(() => {});
      throw error;
    }
  });

  router.get("/:id", async (req, res) => {
    const { organization, role } = authOf(req);
    const staff = role === "OLIVED_REVIEWER" || role === "OLIVED_ADMIN";
    // OLIVED staff see every company's images, to review their designs.
    const asset = await db.brandAsset.findFirst({
      where: staff ? { id: req.params.id } : { id: req.params.id, organizationId: organization.id },
    });
    if (!asset) throw new HttpError(404, "Image not found.");
    const file = await readFile(path.join(folder, path.basename(asset.storageKey))).catch(() => null);
    if (!file) throw new HttpError(404, "Image not found.");
    res.set({
      "Content-Type": asset.mimeType,
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      // Opened directly, an image (an SVG in particular) can never run anything.
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    });
    res.send(file);
  });

  router.post("/:id/delete", async (req, res) => {
    const { organization } = authOf(req);
    const asset = await db.brandAsset.findFirst({ where: { id: req.params.id, organizationId: organization.id } });
    if (!asset) throw new HttpError(404, "Image not found.");
    await db.brandAsset.delete({ where: { id: asset.id } });
    await unlink(path.join(folder, path.basename(asset.storageKey))).catch(() => {});
    res.json({ success: true });
  });

  return router;
}
