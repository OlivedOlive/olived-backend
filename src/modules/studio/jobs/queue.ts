import type { Db } from "../db.js";
import type { Job, Prisma } from "../../../generated/prisma/client.js";
import { logger } from "../../../shared/logger.js";

/** A job left RUNNING this long belongs to a worker that died, so it is run again. */
const STALE_AFTER_MS = 10 * 60 * 1000;

export type JobHandler = (payload: Prisma.JsonValue, db: Db) => Promise<void>;

export function enqueue(tx: Prisma.TransactionClient, type: string, payload: Prisma.InputJsonValue) {
  return tx.job.create({ data: { type, payload } });
}

async function claimNext(db: Db): Promise<Job | null> {
  const now = new Date();
  return db.$transaction(async (tx) => {
    // SKIP LOCKED lets several workers run without taking the same job.
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM jobs
      WHERE status = 'PENDING' AND runAt <= ${now}
      ORDER BY runAt
      LIMIT 1
      FOR UPDATE SKIP LOCKED`;
    const id = rows[0]?.id;
    if (!id) return null;
    return tx.job.update({
      where: { id },
      data: { status: "RUNNING", lockedAt: now, attempts: { increment: 1 } },
    });
  });
}

export async function requeueStaleJobs(db: Db) {
  await db.job.updateMany({
    where: { status: "RUNNING", lockedAt: { lt: new Date(Date.now() - STALE_AFTER_MS) } },
    data: { status: "PENDING", lockedAt: null },
  });
}

/** Runs one job, if one is due. Returns false when there was nothing to do. */
export async function runNextJob(db: Db, handlers: Record<string, JobHandler>): Promise<boolean> {
  const job = await claimNext(db);
  if (!job) return false;

  try {
    const handler = handlers[job.type];
    if (!handler) throw new Error(`No handler for job type ${job.type}`);
    logger.info(`[worker] Job started: ${job.type} (${job.id}), attempt ${job.attempts}`);
    await handler(job.payload, db);
    await db.job.update({ where: { id: job.id }, data: { status: "DONE", lockedAt: null, lastError: null } });
    logger.info(`[worker] Job done: ${job.type} (${job.id})`);
  } catch (err) {
    const giveUp = job.attempts >= job.maxAttempts;
    logger.error(`[worker] Job failed: ${job.type} (${job.id}), attempt ${job.attempts}${giveUp ? ", giving up" : ", will retry"}:`, err);
    await db.job.update({
      where: { id: job.id },
      data: {
        status: giveUp ? "FAILED" : "PENDING",
        lockedAt: null,
        lastError: String(err),
        runAt: new Date(Date.now() + 2 ** job.attempts * 30_000),
      },
    });
  }
  return true;
}
