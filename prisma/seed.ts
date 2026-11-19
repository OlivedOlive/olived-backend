// OLIVED product references and market completeness checklists.
// Safe to run more than once.
import { hashPassword } from "../src/modules/studio/auth/password.js";
import { loadConfig } from "../src/config.js";
import { createDb } from "../src/modules/studio/db.js";
import { seedStudioCatalog } from "./studio-catalog.js";

const config = loadConfig();
if (!config.DATABASE_URL) {
  console.error("DATABASE_URL is empty in .env. Set it to the OLIVED Studio MySQL database first.");
  process.exit(1);
}
const db = createDb(config.DATABASE_URL);

/** Creates an OLIVED admin when SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD are set. */
async function seedAdmin() {
  const email = process.env.SEED_ADMIN_EMAIL?.toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) return;
  if (await db.user.findUnique({ where: { email } })) return;

  await db.user.create({
    data: {
      email,
      name: "OLIVED Admin",
      passwordHash: await hashPassword(password),
      memberships: { create: { role: "OLIVED_ADMIN", organization: { create: { name: "OLIVED" } } } },
    },
  });
  console.info(`Created admin ${email}`);
}

await seedStudioCatalog(db);
await seedAdmin();
await db.$disconnect();
console.info("Seed finished");
