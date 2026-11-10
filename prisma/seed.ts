// Sample data so the app can be tried. Replace it with the real catalog and verified market rules.
// Safe to run more than once.
import { hashPassword } from "../src/modules/studio/auth/password.js";
import { loadConfig } from "../src/config.js";
import { createDb } from "../src/modules/studio/db.js";

const config = loadConfig();
if (!config.DATABASE_URL) {
  console.error("DATABASE_URL is empty in .env. Set it to the OLIVED Studio MySQL database first.");
  process.exit(1);
}
const db = createDb(config.DATABASE_URL);

const zones = {
  editable: ["brandName", "productName", "logo", "colors"],
  locked: ["legalText", "netQuantity", "importer"],
};

async function seedCatalog() {
  const product = await db.product.upsert({
    where: { slug: "sample-extra-virgin-olive-oil" },
    update: {},
    create: {
      slug: "sample-extra-virgin-olive-oil",
      name: "Extra Virgin Olive Oil (sample)",
      description: "Sample product. Replace with the OLIVED catalog.",
    },
  });

  for (const volumeMl of [250, 500, 750]) {
    const sku = `SAMPLE-EVOO-${volumeMl}`;
    const variant = await db.productVariant.upsert({
      where: { sku },
      update: {},
      create: { productId: product.id, sku, name: `${volumeMl} ml glass bottle`, volumeMl },
    });
    if ((await db.packagingTemplate.count({ where: { variantId: variant.id } })) > 0) continue;

    await db.packagingTemplate.createMany({
      data: [
        { variantId: variant.id, kind: "BOTTLE_LABEL", name: "Bottle label", widthMm: 120, heightMm: 90, zones },
        { variantId: variant.id, kind: "SHIPPING_CARTON", name: "Shipping carton", widthMm: 300, heightMm: 200, zones },
      ],
    });
  }
}

async function seedMarket() {
  const market = await db.market.upsert({
    where: { code: "CA" },
    update: {},
    create: { code: "CA", name: "Canada (sample rules)", languages: ["en", "fr"] },
  });
  await db.ruleSet.upsert({
    where: { marketId_version: { marketId: market.id, version: 1 } },
    update: {},
    create: {
      marketId: market.id,
      version: 1,
      status: "PUBLISHED",
      publishedAt: new Date(),
      sourceNotes: "SAMPLE ONLY. Not checked against any regulation. Replace before real use.",
      rules: {
        requiredFields: [
          { key: "brandName", label: "Brand name" },
          { key: "productNameEn", label: "Product name (English)" },
          { key: "productNameFr", label: "Product name (French)" },
          { key: "netQuantity", label: "Net quantity" },
          { key: "importer", label: "Importer name and address" },
        ],
      },
    },
  });
}

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

await seedCatalog();
await seedMarket();
await seedAdmin();
await db.$disconnect();
console.info("Seed finished");
