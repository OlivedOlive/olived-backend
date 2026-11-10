import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { renderEnquiryEmail, resolveFrom, type Mailer } from "../src/modules/enquiries/mailer.js";
import type { EnquiryStore, StoredEnquiry } from "../src/modules/enquiries/storage.js";

const silent = { info() {}, warn() {}, error() {} };

function setup(overrides: Partial<{ mailed: boolean; storeFails: boolean; max: string }> = {}) {
  const saved: StoredEnquiry[] = [];
  const store: EnquiryStore = {
    async save(e) {
      if (overrides.storeFails) throw new Error("disk full");
      saved.push(e);
    },
  };
  const mailer: Mailer = { sendEnquiry: async () => overrides.mailed ?? true };
  const config = loadConfig({ NODE_ENV: "test", RATE_LIMIT_MAX: overrides.max ?? "100" });
  const app = createApp({ config, store, mailer, log: silent });
  return { app, saved };
}

const base = {
  fullName: "Jane Buyer",
  company: "Acme Foods",
  email: "jane@acme.example",
  country: "Germany",
};

describe("POST /api/enquiries", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it("accepts a valid home enquiry and returns JSON", async () => {
    const res = await request(ctx.app)
      .post("/api/enquiries")
      .send({ ...base, source: "home", interests: ["bulk"], volume: "20 – 100 MT", message: "Hello" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ success: true, mailed: true });
    expect(ctx.saved).toHaveLength(1);
    expect(ctx.saved[0]).toMatchObject({ fullName: "Jane Buyer", interests: ["bulk"] });
    expect(ctx.saved[0]).not.toHaveProperty("ip");
  });

  it("keeps every selected interest and the phone number (contact form)", async () => {
    const res = await request(ctx.app)
      .post("/api/enquiries")
      .send({ ...base, source: "contact", phone: "+49 30 1234", interests: ["bulk", "distributor"] });

    expect(res.status).toBe(201);
    expect(ctx.saved[0]).toMatchObject({ phone: "+49 30 1234", interests: ["bulk", "distributor"] });
  });

  it("requires at least one enquiry type on the contact form", async () => {
    const res = await request(ctx.app).post("/api/enquiries").send({ ...base, source: "contact" });
    expect(res.status).toBe(422);
    expect(res.body.fields).toHaveProperty("interests");
  });

  it("requires the bulk-specific fields on the bulk form", async () => {
    const res = await request(ctx.app).post("/api/enquiries").send({ ...base, source: "bulk" });
    expect(res.status).toBe(422);
    expect(Object.keys(res.body.fields)).toEqual(
      expect.arrayContaining(["oilCategory", "organicPreference", "volume", "format", "targetSpec", "message"]),
    );
  });

  it("stores the bulk-specific fields", async () => {
    const res = await request(ctx.app).post("/api/enquiries").send({
      ...base,
      source: "bulk",
      oilCategory: "Extra Virgin Olive Oil",
      organicPreference: "Organic",
      volume: "2 flexitanks",
      format: "Flexitank",
      targetSpec: "Acidity < 0.3%",
      message: "Please quote CIF Hamburg",
    });
    expect(res.status).toBe(201);
    expect(ctx.saved[0]).toMatchObject({ format: "Flexitank", targetSpec: "Acidity < 0.3%" });
  });

  it("rejects an invalid email with a field error", async () => {
    const res = await request(ctx.app)
      .post("/api/enquiries")
      .send({ ...base, source: "home", email: "not-an-email" });
    expect(res.status).toBe(422);
    expect(res.body.fields.email).toBe("A valid email is required");
  });

  it("strips line breaks from single-line fields", async () => {
    await request(ctx.app)
      .post("/api/enquiries")
      .send({ ...base, source: "home", company: "Acme\r\nBcc: victim@example.com" });
    expect(ctx.saved[0]!.company).toBe("AcmeBcc: victim@example.com");
  });

  it("silently drops honeypot submissions", async () => {
    const res = await request(ctx.app)
      .post("/api/enquiries")
      .send({ ...base, source: "home", website: "http://spam.example" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(ctx.saved).toHaveLength(0);
  });

  it("still succeeds when email is not configured, reporting mailed=false", async () => {
    const { app } = setup({ mailed: false });
    const res = await request(app).post("/api/enquiries").send({ ...base, source: "home" });
    expect(res.status).toBe(201);
    expect(res.body.mailed).toBe(false);
  });

  it("returns a JSON 500 when the enquiry cannot be saved", async () => {
    const { app } = setup({ storeFails: true });
    const res = await request(app).post("/api/enquiries").send({ ...base, source: "home" });
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });

  it("returns JSON for malformed bodies", async () => {
    const res = await request(ctx.app)
      .post("/api/enquiries")
      .set("Content-Type", "application/json")
      .send("{not json");
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("rate-limits repeated submissions", async () => {
    const { app } = setup({ max: "2" });
    const send = () => request(app).post("/api/enquiries").send({ ...base, source: "home" });
    await send();
    await send();
    const third = await send();
    expect(third.status).toBe(429);
    expect(third.body.success).toBe(false);
  });
});

describe("renderEnquiryEmail", () => {
  it("escapes HTML from user input", () => {
    const { html, subject } = renderEnquiryEmail({
      id: "x",
      receivedAt: "2026-11-04T00:00:00Z",
      source: "home",
      fullName: "<script>alert(1)</script>",
      company: "Acme",
      email: "a@b.co",
      phone: "",
      country: "FR",
      interests: [],
      volume: "",
      oilCategory: "",
      organicPreference: "",
      format: "",
      targetSpec: "",
      message: "<b>hi</b>",
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(subject).toBe("New enquiry — Acme (FR)");
  });
});

describe("resolveFrom", () => {
  const user = "Contact@olived.tn";

  it("sends from the SMTP mailbox when MAIL_FROM is only a name", () => {
    expect(resolveFrom({ MAIL_FROM: "OLIVED Website", SMTP_USER: user })).toEqual({
      name: "OLIVED Website",
      address: user,
    });
  });

  it("accepts a quoted name with an address", () => {
    expect(resolveFrom({ MAIL_FROM: '"OLIVED Website" <sales@olived.tn>', SMTP_USER: user })).toEqual({
      name: "OLIVED Website",
      address: "sales@olived.tn",
    });
  });

  it("accepts a bare address and falls back to a default name", () => {
    expect(resolveFrom({ MAIL_FROM: "sales@olived.tn", SMTP_USER: user })).toEqual({
      name: "OLIVED Website",
      address: "sales@olived.tn",
    });
    expect(resolveFrom({ MAIL_FROM: "", SMTP_USER: user })).toEqual({ name: "OLIVED Website", address: user });
  });
});

describe(".env.example", () => {
  it("is a valid configuration as copied, so the README quick start boots", () => {
    const env = parse(readFileSync(new URL("../.env.example", import.meta.url)));
    const config = loadConfig(env);
    expect(config.PORT).toBe(4000);
    expect(config.FRONTEND_ORIGIN).toBe("http://localhost:3000");
    expect(config.SMTP_HOST).toBe("");
  });
});

describe("GET /api/health", () => {
  it("responds ok", async () => {
    const res = await request(setup().app).get("/api/health");
    expect(res.body).toEqual({ ok: true });
  });
});

describe("OLIVED Studio without a database", () => {
  it("answers 503 and leaves the enquiries working", async () => {
    const { app } = setup();
    const res = await request(app).get("/api/studio/auth/me");
    expect(res.status).toBe(503);
    expect((await request(app).post("/api/enquiries").send({ ...base, source: "home" })).status).toBe(201);
  });
});
