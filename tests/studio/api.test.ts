// Runs against a real MySQL database, which it EMPTIES. Set TEST_DATABASE_URL to enable it.
import { tmpdir } from "node:os";
import path from "node:path";
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
/** The sales destination every design must name. */
const sales = { saleLocation: "Tunis", salesChannel: "Retail" };

describe.skipIf(!url)("API with MySQL", () => {
  let db: Db;
  let app: ReturnType<typeof createApp>;
  let config: ReturnType<typeof loadConfig>;
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
    agent
      .post("/api/studio/designs")
      .send({ name: "Spring", templateId, marketId, content: { fields: { ...sales, ...fields }, colors } })
      .expect(201);

  beforeAll(async () => {
    if (!new URL(url!).pathname.includes("test")) throw new Error("TEST_DATABASE_URL must name a test database");
    config = loadConfig({
      DATABASE_URL: url, FRONTEND_ORIGIN: ORIGIN, AUTH_RATE_LIMIT_MAX: "1000",
      STUDIO_FILES_DIR: path.join(tmpdir(), "olived-studio-test-files"),
    });
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
    await request(app).get("/api/studio/health").expect(200, { status: "ok" });
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

  it("keeps a login across server restarts and renews it while it is used", async () => {
    const agent = await signUp("stay@example.com");
    const { id: userId } = (await agent.get("/api/studio/auth/me").expect(200)).body.user;
    await db.session.deleteMany({ where: { userId } });
    const login = await request(app)
      .post("/api/studio/auth/login")
      .send({ email: "stay@example.com", password: "long enough password" })
      .expect(200);
    const cookie = String(login.headers["set-cookie"]).split(";")[0]!;

    // A new app on the same database, as after a restart: still logged in, nothing renewed yet.
    const restarted = createApp({ config, db, store: { save: async () => {} }, mailer: { sendEnquiry: async () => false }, log: silent });
    const fresh = await request(restarted).get("/api/studio/auth/me").set("Cookie", cookie).expect(200);
    expect(fresh.headers["set-cookie"]).toBeUndefined();

    // Past half its life, the next request pushes the expiry back to the full length.
    const soon = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await db.session.updateMany({ where: { userId }, data: { expiresAt: soon } });
    const renewed = await request(restarted).get("/api/studio/auth/me").set("Cookie", cookie).expect(200);
    expect(String(renewed.headers["set-cookie"])).toContain("olived_studio_session=");
    const session = await db.session.findFirstOrThrow({ where: { userId } });
    expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now() + (config.SESSION_DAYS - 1) * 24 * 60 * 60 * 1000);
  });

  it("locks one account after repeated wrong passwords, without affecting others", async () => {
    await signUp("locked@example.com");
    await signUp("unlocked@example.com");
    const tryLogin = (email: string, password: string) =>
      request(app).post("/api/studio/auth/login").send({ email, password });

    for (let i = 0; i < config.LOGIN_MAX_FAILURES; i++) await tryLogin("locked@example.com", "wrong").expect(401);
    // Even the right password is refused now, and the lockout message says why.
    const locked = await tryLogin("LOCKED@example.com", "long enough password").expect(429);
    expect(locked.body.error).toMatch(/wait 15 minutes/);

    await tryLogin("unlocked@example.com", "long enough password").expect(200);
  });

  it("refuses a common password, or one with the person's name", async () => {
    const base = { name: "Leila Trabelsi", company: "Leila Co", email: "leila@example.com" };
    const common = await client().post("/api/studio/auth/register").send({ ...base, password: "password123" }).expect(400);
    expect(common.body.fields.password).toMatch(/common/);
    const named = await client().post("/api/studio/auth/register").send({ ...base, password: "trabelsi-2026!" }).expect(400);
    expect(named.body.fields.password).toMatch(/name or email/);
  });

  it("refuses changes the browser marks as coming from another website", async () => {
    await request(app).post("/api/studio/auth/logout").set("Sec-Fetch-Site", "cross-site").expect(403);
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
      .send({ content: { fields: { brandName: "Zeta", ...sales }, colors } })
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

  it("restricts the admin dashboard and records decisions for the checked version", async () => {
    const buyer = await signUp("admin-flow-buyer@example.com");
    const { body } = await newDesign(buyer, { brandName: "Zeta" });
    const { id } = body.design;
    const path = `/api/studio/admin/designs/${id}/decision`;
    const validatePath = `/api/studio/admin/designs/${id}/validate`;
    await buyer.post(`/api/studio/designs/${id}/submit`).expect(200);
    await request(app).get("/api/studio/admin/designs").expect(401);
    await buyer.get("/api/studio/admin/designs").expect(403);
    await buyer.post(path).send({ decision: "APPROVED" }).expect(403);
    await buyer.post(validatePath).send({ versionId: "anything" }).expect(403);

    await db.user.create({
      data: {
        email: "dashboard-admin@example.com",
        name: "Dashboard Admin",
        passwordHash: await hashPassword("long enough password"),
        memberships: { create: { role: "OLIVED_ADMIN", organization: { create: { name: "OLIVED" } } } },
      },
    });
    const admin = client();
    await admin.post("/api/studio/auth/login")
      .send({ email: "dashboard-admin@example.com", password: "long enough password" }).expect(200);

    const pending = (await admin.get("/api/studio/admin/designs").expect(200)).body.designs;
    const version = pending.find((design: { id: string }) => design.id === id).versions[0];
    expect(version.validationResults).toEqual([]);
    await admin.post(path).send({ decision: "APPROVED", versionId: version.id }).expect(409);
    await admin.post(validatePath).send({ versionId: "outdated" }).expect(409);
    await admin.post(validatePath).send({ versionId: version.id }).expect(200, { passed: true });
    await admin.post(path).send({ decision: "APPROVED", versionId: "old-version" }).expect(409);
    await admin.post(path).send({ decision: "CHANGES_REQUESTED", versionId: version.id }).expect(400);
    await admin.post(path).send({ decision: "APPROVED", versionId: version.id, comment: "Ready for production review." }).expect(200);

    const { design } = (await buyer.get(`/api/studio/designs/${id}`).expect(200)).body;
    expect(design.status).toBe("APPROVED");
    expect(design.versions[0].approvals).toEqual([{ decision: "APPROVED", comment: "Ready for production review." }]);
  });

  it("pages the admin lists and filters designs by status", async () => {
    const admin = client();
    await admin.post("/api/studio/auth/login")
      .send({ email: "dashboard-admin@example.com", password: "long enough password" }).expect(200);

    const all = (await admin.get("/api/studio/admin/designs").expect(200)).body;
    expect(all.total).toBeGreaterThan(1);
    const first = (await admin.get("/api/studio/admin/designs?take=1").expect(200)).body;
    expect(first.designs).toHaveLength(1);
    expect(first.total).toBe(all.total);
    const second = (await admin.get("/api/studio/admin/designs?take=1&skip=1").expect(200)).body;
    expect(second.designs[0].id).not.toBe(first.designs[0].id);

    const approved = (await admin.get("/api/studio/admin/designs?status=APPROVED").expect(200)).body;
    expect(approved.designs.length).toBeGreaterThan(0);
    expect(approved.designs.every((d: { status: string }) => d.status === "APPROVED")).toBe(true);

    await admin.get("/api/studio/admin/designs?status=LOST").expect(400);
    await admin.get("/api/studio/admin/designs?take=500").expect(400);

    const users = (await admin.get("/api/studio/admin/users?take=2").expect(200)).body;
    expect(users.users).toHaveLength(2);
    expect(users.total).toBeGreaterThan(2);
  });

  it("keeps each company's logo library private, and refuses unsafe files", async () => {
    // A 1 x 1 transparent PNG.
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
    const owner = await signUp("logo-owner@example.com");
    const other = await signUp("logo-other@example.com");
    const upload = (agent: ReturnType<typeof client>, type: string, body: Buffer, name = "Logo%20%C3%A9t%C3%A9.png") =>
      agent.post("/api/studio/assets").set("Content-Type", type).set("X-File-Name", name).send(body);

    const created = await upload(owner, "image/png", png).expect(201);
    expect(created.body.asset).toMatchObject({ name: "Logo été.png", mimeType: "image/png", sizeBytes: png.length });
    const { url, id } = created.body.asset;
    expect((await owner.get("/api/studio/assets").expect(200)).body.assets.map((a: { id: string }) => a.id)).toEqual([id]);
    const file = await owner.get(url).expect(200);
    expect(file.headers["content-type"]).toBe("image/png");
    expect(file.headers["content-security-policy"]).toContain("sandbox");

    // Another company can neither list, read nor delete it.
    expect((await other.get("/api/studio/assets").expect(200)).body.assets).toEqual([]);
    await other.get(url).expect(404);
    await other.post(`${url}/delete`).expect(404);

    await upload(owner, "image/png", Buffer.from("not really a png")).expect(400);
    await upload(owner, "text/html", Buffer.from("<html>")).expect(400);
    const script = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect((await upload(owner, "image/svg+xml", script).expect(400)).body.error).toMatch(/scripts/);
    const handler = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect width="1" height="1"/></svg>');
    await upload(owner, "image/svg+xml", handler).expect(400);
    const plain = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#073b2f"/></svg>');
    await upload(owner, "image/svg+xml", plain, "mark.svg").expect(201);

    await owner.post(`${url}/delete`).expect(200);
    await owner.get(url).expect(404);
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
