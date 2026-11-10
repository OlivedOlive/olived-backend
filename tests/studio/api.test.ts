// Runs against a real MySQL database, which it EMPTIES. Set TEST_DATABASE_URL to enable it.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { hashPassword } from "../../src/modules/studio/auth/password.js";
import { loadConfig } from "../../src/config.js";
import { createDb, type Db } from "../../src/modules/studio/db.js";
import { handlers } from "../../src/modules/studio/jobs/handlers.js";
import { runNextJob } from "../../src/modules/studio/jobs/queue.js";

const url = process.env.TEST_DATABASE_URL;
const silent = { info() {}, warn() {}, error() {} };
const ORIGIN = "http://localhost:3100";
const colors = { primary: "#1c1a16", secondary: "#b08d57" };

describe.skipIf(!url)("API with MySQL", () => {
  let db: Db;
  let app: ReturnType<typeof createApp>;
  let templateId: string;
  let marketId: string;

  const client = () => request.agent(app);

  async function signUp(email: string) {
    const agent = client();
    await agent
      .post("/api/studio/auth/register")
      .send({ name: "Sam", company: `Company ${email}`, email, password: "long enough password" })
      .expect(201);
    return agent;
  }

  const newDesign = (agent: ReturnType<typeof client>, fields: Record<string, string> = {}) =>
    agent.post("/api/studio/designs").send({ name: "Spring", templateId, marketId, content: { fields, colors } }).expect(201);

  beforeAll(async () => {
    if (!new URL(url!).pathname.includes("test")) throw new Error("TEST_DATABASE_URL must name a test database");
    const config = loadConfig({ DATABASE_URL: url, FRONTEND_ORIGIN: ORIGIN, AUTH_RATE_LIMIT_MAX: "1000" });
    db = createDb(url!);
    app = createApp({ config, db, store: { save: async () => {} }, mailer: { sendEnquiry: async () => false }, log: silent });

    await db.auditLog.deleteMany();
    await db.job.deleteMany();
    await db.approval.deleteMany();
    await db.validationResult.deleteMany();
    await db.design.deleteMany();
    await db.user.deleteMany();
    await db.organization.deleteMany();
    await db.packagingTemplate.deleteMany();
    await db.productVariant.deleteMany();
    await db.product.deleteMany();
    await db.ruleSet.deleteMany();
    await db.market.deleteMany();

    const market = await db.market.create({ data: { code: "CA", name: "Canada", languages: ["en", "fr"] } });
    marketId = market.id;
    await db.ruleSet.create({
      data: {
        marketId,
        version: 1,
        status: "PUBLISHED",
        rules: { requiredFields: [{ key: "brandName", label: "Brand name" }] },
      },
    });
    const product = await db.product.create({
      data: {
        slug: "oil",
        name: "Oil",
        variants: {
          create: {
            sku: "OIL-500",
            name: "500 ml",
            volumeMl: 500,
            templates: { create: { kind: "BOTTLE_LABEL", name: "Label", widthMm: 120, heightMm: 90, zones: {} } },
          },
        },
      },
      include: { variants: { include: { templates: true } } },
    });
    templateId = product.variants[0]!.templates[0]!.id;
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  it("reports health", async () => {
    await request(app).get("/health").expect(200, { status: "ok" });
  });

  it("signs up, logs out and logs back in", async () => {
    const agent = await signUp("a@example.com");
    const me = await agent.get("/api/studio/auth/me").expect(200);
    expect(me.body.role).toBe("CLIENT_ADMIN");
    expect(JSON.stringify(me.body)).not.toContain("passwordHash");

    await agent.post("/api/studio/auth/logout").expect(200);
    await agent.get("/api/studio/auth/me").expect(401);

    await agent.post("/api/studio/auth/login").send({ email: "A@example.com", password: "nope" }).expect(401);
    await agent.post("/api/studio/auth/login").send({ email: "A@example.com", password: "long enough password" }).expect(200);
    await agent.get("/api/studio/auth/me").expect(200);
  });

  it("refuses a duplicate email and a weak password", async () => {
    await signUp("dup@example.com");
    const body = { name: "S", company: "C", email: "dup@example.com", password: "long enough password" };
    await client().post("/api/studio/auth/register").send(body).expect(409);
    const weak = await client().post("/api/studio/auth/register").send({ ...body, email: "w@example.com", password: "short" });
    expect(weak.status).toBe(400);
    expect(weak.body.fields.password).toBeDefined();
  });

  it("stores only a hash of the session token", async () => {
    const res = await client().post("/api/studio/auth/login").send({ email: "a@example.com", password: "long enough password" });
    const token = /olived_studio_session=([^;]+)/.exec(res.headers["set-cookie"]![0]!)![1]!;
    expect(res.headers["set-cookie"]![0]).toMatch(/HttpOnly/);
    expect(res.headers["set-cookie"]![0]).toMatch(/SameSite=Lax/);
    expect(await db.session.count({ where: { tokenHash: token } })).toBe(0);
  });

  it("requires a login for the catalog and designs", async () => {
    await request(app).get("/api/studio/catalog/products").expect(401);
    await request(app).get("/api/studio/designs").expect(401);
  });

  it("blocks changes sent from another website", async () => {
    await request(app).post("/api/studio/auth/logout").set("Origin", "https://evil.example").expect(403);
  });

  it("only lists markets with published rules", async () => {
    await db.market.create({ data: { code: "XX", name: "No rules", languages: ["en"] } });
    const agent = await signUp("markets@example.com");
    const res = await agent.get("/api/studio/catalog/markets").expect(200);
    expect(res.body.markets.map((m: { code: string }) => m.code)).toEqual(["CA"]);
  });

  it("keeps each organization's designs private", async () => {
    const owner = await signUp("owner@example.com");
    const other = await signUp("other@example.com");
    const { body } = await newDesign(owner);
    const id = body.design.id;
    const content = { fields: {}, colors };

    await owner.get(`/api/studio/designs/${id}`).expect(200);
    await other.get(`/api/studio/designs/${id}`).expect(404);
    await other.post(`/api/studio/designs/${id}/versions`).send({ content }).expect(404);
    await other.post(`/api/studio/designs/${id}/submit`).expect(404);
    expect((await other.get("/api/studio/designs").expect(200)).body.designs).toEqual([]);
  });

  it("sends a design back when it fails the market checks", async () => {
    const agent = await signUp("fail@example.com");
    const { body } = await newDesign(agent);
    await agent.post(`/api/studio/designs/${body.design.id}/submit`).expect(200);
    expect(await runNextJob(db, handlers)).toBe(true);

    const { design } = (await agent.get(`/api/studio/designs/${body.design.id}`).expect(200)).body;
    expect(design.status).toBe("CHANGES_REQUESTED");
    expect(design.versions[0].validationResults[0].issues).toEqual([
      { field: "brandName", message: "Brand name is required for this market." },
    ]);
  });

  it("runs the whole flow from draft to approval", async () => {
    const agent = await signUp("flow@example.com");
    const { body } = await newDesign(agent);
    const id = body.design.id;

    const saved = await agent
      .post(`/api/studio/designs/${id}/versions`)
      .send({ content: { fields: { brandName: "Zeta" }, colors } })
      .expect(201);
    expect(saved.body.version.number).toBe(2);

    await agent.post(`/api/studio/designs/${id}/submit`).expect(200);
    await agent.post(`/api/studio/designs/${id}/versions`).send({ content: { fields: {}, colors } }).expect(409);
    await agent.post(`/api/studio/designs/${id}/submit`).expect(409);

    // A client cannot review, even their own design.
    await agent.get("/api/studio/review/designs").expect(403);
    await agent.post(`/api/studio/review/designs/${id}/decision`).send({ decision: "APPROVED" }).expect(403);

    await db.user.create({
      data: {
        email: "reviewer@example.com",
        name: "Reviewer",
        passwordHash: await hashPassword("long enough password"),
        memberships: { create: { role: "OLIVED_REVIEWER", organization: { create: { name: "OLIVED" } } } },
      },
    });
    const reviewer = client();
    await reviewer.post("/api/studio/auth/login").send({ email: "reviewer@example.com", password: "long enough password" }).expect(200);

    // Not reviewable until the checks have passed.
    expect((await reviewer.get("/api/studio/review/designs").expect(200)).body.designs).toEqual([]);
    await reviewer.post(`/api/studio/review/designs/${id}/decision`).send({ decision: "APPROVED" }).expect(409);

    await runNextJob(db, handlers);
    const queue = (await reviewer.get("/api/studio/review/designs").expect(200)).body.designs;
    expect(queue.map((d: { id: string }) => d.id)).toEqual([id]);

    await reviewer.post(`/api/studio/review/designs/${id}/decision`).send({ decision: "APPROVED", comment: "Good" }).expect(200);
    await reviewer.post(`/api/studio/review/designs/${id}/decision`).send({ decision: "APPROVED" }).expect(409);

    expect((await agent.get(`/api/studio/designs/${id}`).expect(200)).body.design.status).toBe("APPROVED");
    expect(await db.auditLog.count({ where: { entityId: id } })).toBe(3);
  });

  it("shows the client why a reviewer asked for changes", async () => {
    const agent = await signUp("changes@example.com");
    const { body } = await newDesign(agent, { brandName: "Zeta" });
    const id = body.design.id;
    await agent.post(`/api/studio/designs/${id}/submit`).expect(200);
    await runNextJob(db, handlers);

    const reviewer = client();
    await reviewer.post("/api/studio/auth/login").send({ email: "reviewer@example.com", password: "long enough password" }).expect(200);
    await reviewer
      .post(`/api/studio/review/designs/${id}/decision`)
      .send({ decision: "CHANGES_REQUESTED", comment: "Logo too small" })
      .expect(200);

    const { design } = (await agent.get(`/api/studio/designs/${id}`).expect(200)).body;
    expect(design.status).toBe("CHANGES_REQUESTED");
    expect(design.versions[0].approvals).toEqual([{ decision: "CHANGES_REQUESTED", comment: "Logo too small" }]);

    const saved = await agent.post(`/api/studio/designs/${id}/versions`).send({ content: { fields: { brandName: "Zeta 2" }, colors } });
    expect(saved.status).toBe(201);
  });

  it("retries a failing job and gives up after the last attempt", async () => {
    const job = await db.job.create({ data: { type: "unknown", payload: {}, maxAttempts: 2 } });
    await runNextJob(db, handlers);
    const retry = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(retry.status).toBe("PENDING");
    expect(retry.runAt.getTime()).toBeGreaterThan(Date.now());

    await db.job.update({ where: { id: job.id }, data: { runAt: new Date() } });
    await runNextJob(db, handlers);
    const failed = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(failed.status).toBe("FAILED");
    expect(failed.lastError).toContain("No handler");
  });
});
