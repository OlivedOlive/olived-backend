import type { Db } from "../src/modules/studio/db.js";

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

const eu = "https://eur-lex.europa.eu/eli/reg_del/2022/2104/oj";
const markets = [
  ["DE", "Germany", ["de", "en"], eu],
  ["FR", "France", ["fr", "en"], eu],
  ["GB", "United Kingdom", ["en"], "https://www.gov.uk/guidance/olive-oil-regulations-and-inspections"],
  ["US", "United States", ["en"], "https://www.fda.gov/regulatory-information/search-fda-guidance-documents/guidance-industry-food-labeling-guide"],
  ["CA", "Canada", ["en", "fr"], "https://inspection.canada.ca/en/food-labels/labelling/industry/fats-and-oils"],
  ["SA", "Saudi Arabia", ["ar", "en"], "https://oldsfda.sfda.gov.sa/en/faq/60223"],
  ["AE", "United Arab Emirates", ["ar", "en"], null],
  ["KW", "Kuwait", ["ar", "en"], null],
  ["QA", "Qatar", ["ar", "en"], null],
  ["RU", "Russia", ["ru"], null],
  ["JP", "Japan", ["ja"], "https://www.caa.go.jp/en/policy/food_labeling/"],
  ["TW", "Taiwan", ["zh-Hant"], null],
  ["OTHER", "Other destination", [], null],
] as const;

const marketFields: Record<string, { key: string; label: string }[]> = {
  CA: [{ key: "productNameFr", label: "French product designation" }],
  SA: [{ key: "productNameAr", label: "Arabic product designation" }],
  AE: [{ key: "productNameAr", label: "Arabic product designation" }],
  KW: [{ key: "productNameAr", label: "Arabic product designation" }],
  QA: [{ key: "productNameAr", label: "Arabic product designation" }],
  OTHER: [{ key: "destinationCountry", label: "Destination country or territory" }],
};

export async function seedStudioCatalog(db: Db) {
  for (const { slug, name, description, formats: available } of products) {
    const product = await db.product.upsert({
      where: { slug }, update: {}, create: { slug, name, description },
    });
    for (const format of available) {
      for (const [volumeMl, caseCount] of format.volumes) {
        const sku = `${slug}-${format.name.toLowerCase().replace(" ", "-")}-${volumeMl}`;
        const variant = await db.productVariant.upsert({
          where: { sku }, update: {}, create: { sku, productId: product.id, volumeMl, name: `${format.name} · ${volumeMl} mL` },
        });
        if (await db.packagingTemplate.findFirst({ where: { variantId: variant.id } })) continue;
        const reference = format.name === "Marasca glass" && volumeMl === 750;
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

  for (const [code, name, languages, source] of markets) {
    const market = await db.market.upsert({
      where: { code },
      update: {},
      create: { code, name, languages: [...languages] },
    });
    const existing = await db.ruleSet.findFirst({ where: { marketId: market.id }, orderBy: { version: "desc" } });
    const replaceSample = code === "CA" && existing?.version === 1 && existing.sourceNotes?.startsWith("SAMPLE ONLY");
    if (existing && !replaceSample) continue;
    await db.$transaction(async (tx) => {
      if (replaceSample) await tx.market.update({ where: { id: market.id }, data: { name, languages: [...languages] } });
      await tx.ruleSet.create({
        data: {
          marketId: market.id,
          version: replaceSample ? 2 : 1,
          status: "PUBLISHED",
          publishedAt: new Date(),
          sourceNotes: "OLIVED label artwork references. Completeness checklist only. Regulatory and printer sign-off required.",
          rules: {
            referenceOnly: true,
            source,
            languages: [...languages],
            requiredFields: [
              { key: "brandName", label: "Brand name" },
              { key: "productName", label: "Product designation" },
              { key: "netQuantity", label: "Net quantity" },
              { key: "origin", label: "Country of origin" },
              { key: "importer", label: "Importer name and address" },
              { key: "storage", label: "Storage statement" },
              ...(marketFields[code] ?? []),
            ],
          },
        },
      });
    });
  }
}
