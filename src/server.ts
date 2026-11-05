import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createMailer } from "./mailer.js";
import { createFileStore } from "./storage.js";

const config = loadConfig();

const app = createApp({
  config,
  store: createFileStore(config.DATA_DIR),
  mailer: createMailer(config),
});

// Express 5 reports bind failures (port in use) here instead of throwing.
app.listen(config.PORT, (err) => {
  if (err) throw err;
  console.info(`OLIVED API listening on http://localhost:${config.PORT} (${config.NODE_ENV})`);
});
