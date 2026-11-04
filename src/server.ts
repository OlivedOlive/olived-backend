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

app.listen(config.PORT, () => {
  console.info(`OLIVED API listening on http://localhost:${config.PORT} (${config.NODE_ENV})`);
});
