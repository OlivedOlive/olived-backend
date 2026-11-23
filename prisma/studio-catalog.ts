import type { Db } from "../src/modules/studio/db.js";
import { MARKET_TEMPLATES, rulesFor, TEMPLATE_VERSION } from "../src/modules/studio/markets/templates.js";

const formats = [
  { name: "Marasca glass", volumes: [[250, 24], [500, 12], [750, 6], [1000, 6]] },
  { name: "Dorica glass", volumes: [[250, 24], [500, 12], [750, 6]] },
  { name: "PET", volumes: [[1000, 6], [3000, 2], [5000, 2]] },
  { name: "Tin", volumes: [[1000, 6], [3000, 2], [5000, 2]] },
] as const;

const products = [
  { slug: "orzeta-sun", name: "ORZETA Sun", description: "Tunisian extra virgin olive oil for everyday cooking.", formats },
  { slug: "orzeta-grove", name: "ORZETA Grove", description: "Tunisian extra virgin olive oil for finishing.", formats },
  { slug: "orzeta-organic", name: "ORZETA Organic", description: "Organic line. Confirm certification and marks for the destination.", formats },
  { slug: "oussoul", name: "Oussoul / أصول", description: "Tunisian extra virgin olive oil in the black and gold Oussoul presentation.", formats: [{ name: "Glass", volumes: [[750, null]] as const }] },
  { slug: "private-evoo", name: "Private label · Extra virgin olive oil", description: "Build a label under your own brand from an OLIVED packaging format.", formats },
  { slug: "private-organic", name: "Private label · Organic extra virgin olive oil", description: "Private-label organic oil. Confirm availability and certification with OLIVED.", formats },
];

export async function seedStudioCatalog(db: Db) {
  for (const { slug, name, description, formats: available } of products) {
    const product = await db.product.upsert({
      where: { slug }, update: { name, description }, create: { slug, name, description },
    });
    for (const format of available) {
      for (const [volumeMl, caseCount] of format.volumes) {
        const sku = `${slug}-${format.name.toLowerCase().replaceAll(" ", "-")}-${volumeMl}`;
        const variantName = `${format.name} · ${volumeMl} mL`;
        const variant = await db.productVariant.upsert({
          where: { sku }, update: { name: variantName }, create: { sku, productId: product.id, volumeMl, name: variantName },
        });
        const reference = format.name === "Marasca glass" && volumeMl === 750;
        const existingTemplate = await db.packagingTemplate.findFirst({ where: { variantId: variant.id }, select: { id: true, zones: true } });
        if (existingTemplate) {
          // Keep the dimensions (existing designs were drawn on them) but follow the catalog's case count.
          const zones = { ...(existingTemplate.zones as Record<string, unknown>), format: format.name, caseCount };
          await db.packagingTemplate.update({ where: { id: existingTemplate.id }, data: { zones } });
          continue;
        }
        await db.packagingTemplate.create({
          data: {
            variantId: variant.id,
            kind: format.name === "Tin" ? "TIN" : "BOTTLE_LABEL",
            name: "Unit label, retail box and shipping case",
            widthMm: reference ? 170 : 100,
            heightMm: reference ? 171 : 100,
            bleedMm: 0,
            zones: { format: format.name, caseCount, geometry: reference ? "artwork-reference" : "illustrative" },
          },
        });
      }
    }
  }

  // Each market's rules come from its label template. A newer template version is published as a new
  // rule-set version; the old one is retired but kept, so earlier check results still point at it.
  for (const template of MARKET_TEMPLATES) {
    const { code, name, languages, sourceNotes } = template;
    const market = await db.market.upsert({
      where: { code },
      update: { name, languages: [...languages] },
      create: { code, name, languages: [...languages] },
    });
    const latest = await db.ruleSet.findFirst({ where: { marketId: market.id }, orderBy: { version: "desc" } });
    const current = (latest?.rules as { templateVersion?: number } | null)?.templateVersion ?? 0;
    if (latest && current >= TEMPLATE_VERSION) continue;
    await db.$transaction(async (tx) => {
      await tx.ruleSet.updateMany({ where: { marketId: market.id, status: "PUBLISHED" }, data: { status: "RETIRED" } });
      await tx.ruleSet.create({
        data: {
          marketId: market.id,
          version: (latest?.version ?? 0) + 1,
          status: "PUBLISHED",
          publishedAt: new Date(),
          sourceNotes: `${sourceNotes} Checks guide compliance; OLIVED review and the destination's regulatory sign-off are required before printing.`,
          rules: rulesFor(template),
        },
      });
    });
  }
}
