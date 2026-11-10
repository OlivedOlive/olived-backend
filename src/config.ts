import "dotenv/config";
import { z } from "zod";

const boolFromEnv = z
  .enum(["true", "false", "1", "0", ""])
  .optional()
  .transform((v) => v === "true" || v === "1");

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    PORT: z.coerce.number().int().positive().default(4000),

    /** Comma-separated list of origins allowed to call the API (the Next.js site). */
    FRONTEND_ORIGIN: z.string().default("http://localhost:3000"),

    /** Set when running behind a reverse proxy (nginx, Render, Railway…) so rate limiting sees the real client IP. */
    TRUST_PROXY: boolFromEnv,

    // ---------- Enquiries (website quote forms) ----------

    /** Where enquiries are appended as JSON lines. Keep it outside any public web root. */
    DATA_DIR: z.string().default("data"),

    /** Store the submitter's IP address with each enquiry (personal data — off by default). */
    STORE_IP: boolFromEnv,

    // SMTP — if SMTP_HOST is empty, enquiries are still saved but no email is sent.
    SMTP_HOST: z.string().default(""),
    SMTP_PORT: z.coerce.number().int().positive().default(587),
    SMTP_SECURE: boolFromEnv,
    SMTP_USER: z.string().default(""),
    SMTP_PASS: z.string().default(""),

    /** Sender. A name only (or empty) sends from the SMTP_USER mailbox, which most providers require. */
    MAIL_FROM: z.string().default("OLIVED Website"),
    MAIL_TO: z.string().default("Contact@olived.tn"),

    /** Max enquiries per IP per window. */
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
    RATE_LIMIT_WINDOW_MIN: z.coerce.number().int().positive().default(15),

    // ---------- OLIVED Studio ----------

    /** MySQL database of the studio. Empty turns the studio off; enquiries keep working. */
    DATABASE_URL: z
      .string()
      .default("")
      .refine((v) => v === "" || v.startsWith("mysql://"), "must start with mysql://"),

    /** Days a studio login lasts without being used. Using the studio renews it. */
    SESSION_DAYS: z.coerce.number().int().positive().default(30),

    /** Makes the studio login cookie HTTPS only. Must be true in production. */
    COOKIE_SECURE: boolFromEnv,

    /** Studio sign-ups, and failed logins, allowed per IP address every 15 minutes. */
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),

    /** Wrong passwords for one account before it is locked for 15 minutes. */
    LOGIN_MAX_FAILURES: z.coerce.number().int().positive().default(5),
  })
  .refine((env) => env.NODE_ENV !== "production" || !env.DATABASE_URL || env.COOKIE_SECURE, {
    path: ["COOKIE_SECURE"],
    message: "must be true in production when the studio is on",
  });

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return parsed.data;
}

export function allowedOrigins(config: Config): string[] {
  return config.FRONTEND_ORIGIN.split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}
