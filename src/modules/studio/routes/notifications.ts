import { Router } from "express";
import { z } from "zod";
import { authOf, requireAuth } from "../auth/session.js";
import type { Db } from "../db.js";
import { HttpError } from "../errors.js";
import { onMessage } from "../notifications.js";

const listSchema = z.object({ take: z.coerce.number().int().min(1).max(100).default(30) });
const readSchema = z.object({ ids: z.array(z.string().min(1).max(40)).max(200).optional() });
export const messageSchema = z.object({ body: z.string().trim().min(1, "Write a message.").max(4000, "Keep the message under 4000 characters.") });

/** The signed-in user's notifications: newest first, with the number still unread. */
export function notificationRoutes(db: Db) {
  const router = Router();
  router.use(requireAuth);

  router.get("/", async (req, res) => {
    const { take } = listSchema.parse(req.query);
    const userId = authOf(req).user.id;
    const [notifications, unread] = await Promise.all([
      db.notification.findMany({
        where: { userId }, orderBy: { createdAt: "desc" }, take,
        select: { id: true, type: true, title: true, body: true, link: true, readAt: true, createdAt: true, designId: true },
      }),
      db.notification.count({ where: { userId, readAt: null } }),
    ]);
    res.json({ notifications, unread });
  });

  /** Marks some notifications as read, or all of them without `ids`. Only the user's own. */
  router.post("/read", async (req, res) => {
    const { ids } = readSchema.parse(req.body ?? {});
    const userId = authOf(req).user.id;
    const { count } = await db.notification.updateMany({
      where: { userId, readAt: null, ...(ids ? { id: { in: ids } } : {}) },
      data: { readAt: new Date() },
    });
    res.json({ updated: count });
  });

  return router;
}

const messageView = { id: true, authorName: true, fromStaff: true, body: true, createdAt: true } as const;

/** The conversation of a design, oldest first. */
export const listMessages = (db: Db, designId: string) =>
  db.designMessage.findMany({ where: { designId }, orderBy: { createdAt: "asc" }, take: 500, select: messageView });

/** Adds a message to a design's conversation and tells the other side. */
export async function postMessage(db: Db, designId: string, author: { id: string; name: string }, fromStaff: boolean, body: string) {
  const design = await db.design.findUnique({ where: { id: designId }, select: { id: true } });
  if (!design) throw new HttpError(404, "Design not found.");
  const message = await db.designMessage.create({
    data: { designId, authorId: author.id, authorName: author.name.slice(0, 120), fromStaff, body },
    select: messageView,
  });
  await onMessage(db, designId, author, fromStaff, body);
  return message;
}
