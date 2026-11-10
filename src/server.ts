import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createMailer } from "./modules/enquiries/mailer.js";
import { createFileStore } from "./modules/enquiries/storage.js";
import { createDb } from "./modules/studio/index.js";
import { logger } from "./shared/logger.js";

const config = loadConfig();

if (!config.DATABASE_URL) {
  logger.warn("[studio] DATABASE_URL is empty: OLIVED Studio is off. Enquiries still work.");
}

const app = createApp({
  config,
  store: createFileStore(config.DATA_DIR),
  mailer: createMailer(config),
  db: config.DATABASE_URL ? createDb(config.DATABASE_URL) : undefined,
});

// Express 5 reports bind failures (port in use) here instead of throwing.
app.listen(config.PORT, (err) => {
  if (err) throw err;
  logger.info(`OLIVED API listening on http://localhost:${config.PORT} (${config.NODE_ENV})`);
});
