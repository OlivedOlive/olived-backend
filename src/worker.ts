import { setTimeout as sleep } from "node:timers/promises";
import { loadConfig } from "./config.js";
import { createDb } from "./modules/studio/db.js";
import { handlers } from "./modules/studio/jobs/handlers.js";
import { requeueStaleJobs, runNextJob } from "./modules/studio/jobs/queue.js";
import { logger } from "./shared/logger.js";

const POLL_MS = 2000;
const CLEANUP_MS = 60 * 60 * 1000;

const config = loadConfig();
if (!config.DATABASE_URL) {
  console.error("DATABASE_URL is empty in .env. Set it to the OLIVED Studio MySQL database first.");
  process.exit(1);
}
const db = createDb(config.DATABASE_URL);

let running = true;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    running = false;
  });
}

logger.info("[worker] OLIVED Studio worker started, waiting for jobs");
let nextCleanup = 0;

while (running) {
  try {
    if (Date.now() >= nextCleanup) {
      await requeueStaleJobs(db);
      const { count } = await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
      if (count) logger.info(`[worker] Removed ${count} expired login(s)`);
      nextCleanup = Date.now() + CLEANUP_MS;
    }
    const didWork = await runNextJob(db, handlers);
    if (!didWork) await sleep(POLL_MS);
  } catch (err) {
    // A database restart should pause the worker, not stop it.
    logger.error("[worker] Error:", err);
    await sleep(POLL_MS);
  }
}

await db.$disconnect();
logger.info("[worker] OLIVED Studio worker stopped");
