import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../../src/modules/studio/auth/password.js";
import { loadConfig } from "../../src/config.js";
import { checkDesign } from "../../src/modules/studio/designs/validate.js";

describe("passwords", () => {
  it("accepts the right password and rejects others", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash).not.toContain("correct");
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });

  it("rejects a malformed stored hash", async () => {
    expect(await verifyPassword("anything", "not-a-hash")).toBe(false);
  });
});

describe("market checks", () => {
  const rules = { requiredFields: [{ key: "brandName", label: "Brand name" }] };
  const colors = { primary: "#000000", secondary: "#ffffff" };

  it("reports a missing or blank field", () => {
    expect(checkDesign({ fields: {}, colors }, rules)).toHaveLength(1);
    expect(checkDesign({ fields: { brandName: "   " }, colors }, rules)).toEqual([
      { field: "brandName", message: "Brand name is required for this market." },
    ]);
  });

  it("passes when every required field is filled", () => {
    expect(checkDesign({ fields: { brandName: "Zeta" }, colors }, rules)).toEqual([]);
  });
});

describe("config", () => {
  const env = { DATABASE_URL: "mysql://u:p@localhost:3306/db" };

  it("turns the studio off without a database, and accepts only a MySQL address", () => {
    expect(loadConfig({}).DATABASE_URL).toBe("");
    expect(() => loadConfig({ DATABASE_URL: "postgres://u:p@localhost/db" })).toThrow(/DATABASE_URL/);
  });

  it("refuses production without HTTPS-only cookies", () => {
    expect(() => loadConfig({ ...env, NODE_ENV: "production" })).toThrow(/COOKIE_SECURE/);
    expect(loadConfig({ ...env, NODE_ENV: "production", COOKIE_SECURE: "true" }).COOKIE_SECURE).toBe(true);
  });
});
