import { randomBytes } from "node:crypto";
import { z } from "zod";
import { loadConfig } from "../config.js";
import { hashPassword } from "../modules/studio/auth/password.js";
import { weakPasswordReason } from "../modules/studio/auth/password-policy.js";
import { createDb } from "../modules/studio/db.js";
import { isUniqueViolation } from "../modules/studio/errors.js";

async function createAdmin() {
  const email = z.email().max(254).safeParse(process.argv[2]?.trim().toLowerCase());
  if (!email.success) throw new Error("Usage: npm run admin:create -- admin@example.com");

  const config = loadConfig();
  if (!config.DATABASE_URL) throw new Error("Set DATABASE_URL to the Studio database first.");

  const name = "OLIVED Admin";
  const providedPassword = process.env.STUDIO_ADMIN_PASSWORD;
  const password = providedPassword ?? randomBytes(24).toString("base64url");
  if (password.length < 10 || password.length > 200) throw new Error("Use a password between 10 and 200 characters.");
  const reason = weakPasswordReason(password, { email: email.data, name });
  if (reason) throw new Error(reason);

  const db = createDb(config.DATABASE_URL);
  try {
    await db.user.create({
      data: {
        email: email.data,
        name,
        passwordHash: await hashPassword(password),
        memberships: { create: { role: "OLIVED_ADMIN", organization: { create: { name: "OLIVED" } } } },
      },
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new Error("This email already has a Studio account.");
    throw error;
  } finally {
    await db.$disconnect();
  }

  console.info(`Studio admin created for ${email.data}. Sign in at /studio/login.`);
  if (providedPassword === undefined) console.info(`Generated password: ${password}`);
}

try {
  await createAdmin();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
