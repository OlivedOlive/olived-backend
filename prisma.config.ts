import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // The fallback lets `prisma generate` run during installs, before a .env exists.
    url: process.env.DATABASE_URL ?? "mysql://unset:unset@127.0.0.1:3306/unset",
  },
});
