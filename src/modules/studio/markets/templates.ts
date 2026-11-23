/**
 * Market label templates for OLIVED Studio.
 *
 * Each market is the content of the supplied ORZETA Marasca 750 mL label artwork for that country
 * ("cataloge olived", 2026): the legal wording in each required language, the nutrition table, the
 * date formats and placeholders, and the checks that the market's rules imply. South Korea is a
 * draft built from the label photos and Korean labelling practice, to verify before use.
 *
 * Copy may contain tokens filled from the chosen bottle: {ml} (volume in mL), {flOz} (US fluid
 * ounces), {servingsTbsp} (US servings of one tablespoon) and {servings15} (servings of 15 mL).
 * Anything in [square brackets] is a placeholder the client must replace.
 *
 * Bump TEMPLATE_VERSION after changing anything here: the seed then publishes a new rule-set
 * version for every market, and earlier validation results keep pointing at the version they used.
 */
import type { Check, Rules } from "../designs/validate.js";

export const TEMPLATE_VERSION = 3;

type Field = { key: string; label: string };
type MarketTemplate = {
  code: string;
  name: string;
  languages: string[];
  /** Official source of the rules, shown to reviewers. */
  source: string | null;
  sourceNotes: string;
  /** Not verified yet: shown with a warning, and its checks are advisory. */
  draft?: boolean;
  fields: Field[];
  copy: Record<string, string>;
  checks: Check[];
};

const PRODUCER_ADDRESS = "Olived SARL, Route Saltania, km 4.5, Sfax";

// Placeholders the client must replace, shared across markets.
const LOT = "[XXXXX]";
const BARCODE = "[GTIN barcode: one per reference]";

// Fields every market asks for; each market adds its own.
const base: Field[] = [
  { key: "brandName", label: "Brand name" },
  { key: "productName", label: "Product designation" },
  { key: "origin", label: "Country of origin" },
  { key: "netQuantity", label: "Net quantity" },
  { key: "ingredients", label: "Ingredients" },
  { key: "storage", label: "Storage statement" },
  { key: "producer", label: "Producer and bottler" },
  { key: "bestBefore", label: "Best before or expiry date" },
  { key: "lot", label: "Lot number" },
  { key: "importer", label: "Importer name and address" },
  { key: "nutrition", label: "Nutrition table" },
];

/** A required check for every listed field. */
const requireAll = (fields: Field[], except: string[] = []): Check[] =>
  fields.filter(({ key }) => !except.includes(key)).map(({ key, label }) => ({ kind: "required", field: key, label }));

const barcodeCheck: Check = {
  kind: "required", field: "barcode", label: "Barcode",
  severity: "warning", message: "Most retailers need a GTIN barcode. Add one before printing.",
};

/** The barcode: present (warning), and once entered a valid GTIN, with OLIVED's GS1 Tunisia prefix on OLIVED brands. */
const barcodeChecks: Check[] = [
  barcodeCheck,
  { kind: "gtin", field: "barcode", label: "Barcode number", brandPrefix: "619" },
];

// --- European Union: Regulation (EU) 2022/2104, with Regulation (EU) No 1169/2011 ---------------

const EU_SOURCE = "https://eur-lex.europa.eu/eli/reg_del/2022/2104/oj";
const FIRST_COLD_PRESSING = "first cold press|premi[eè]re pression [àa] froid|erste kaltpressung|primera presi[oó]n en fr[ií]o|prima spremitura a freddo";
// Whole words only: “Säure” must not match “Fettsäuren” in the German nutrition table.
const ACIDITY = "\\bacidit[yéè]|\\bacidez|s[äa]uregehalt|(^|[\\s(])s[äa]ure\\b";
const TASTE_TERMS = "fruity|fruit[ée]|fruchtig|bitter|amer|amertume|pungent|piquant|scharf|frutado|amargo|picante";
const HARVEST = "harvest|r[ée]colte|ernte|campa[ñn]a|cosecha";

/** The checks every EU market shares. `name` and `statement` are the wording in its main language. */
function euChecks(language: { name: string; statement: string; heat: string; light: string; origin: string }): Check[] {
  return [
    {
      kind: "contains", field: "productName", label: "Legal name in the national language", any: [language.name],
      message: `The legal name must read "${language.name}" in the national language (Reg. 2022/2104, art. 6).`,
    },
    {
      kind: "contains", field: "categoryStatement", label: "Category statement", any: [language.statement],
      message: "The official category statement is required, word for word (Reg. 2022/2104, art. 6.2).",
    },
    {
      kind: "contains", field: "storage", label: "Storage away from heat and light", all: [language.heat, language.light],
      message: "Storage conditions must mention protection from heat and light (Reg. 2022/2104, art. 7).",
    },
    {
      kind: "contains", field: "origin", label: "Origin: Tunisia", any: [language.origin],
      message: "Extra virgin olive oil must show its place of origin (Reg. 2022/2104, art. 8).",
    },
    {
      kind: "samePanel", fields: ["productName", "origin"], panel: "front", label: "Name and origin on the front",
      message: "The legal name and the origin must be together on the front panel (Reg. 2022/2104, art. 5.2).",
    },
    {
      kind: "forbidden", pattern: FIRST_COLD_PRESSING, label: "No “first cold pressing”",
      message: "“First cold pressing” is reserved for oil from traditional hydraulic presses. Use “Cold extraction” for OLIVED oil (art. 10).",
    },
    {
      kind: "requiresAlso", pattern: ACIDITY, fields: ["peroxides", "waxes", "uvAbsorbance"], label: "Acidity claim",
      message: "An acidity claim must also show the peroxide value, wax content and UV absorbance, in the same size and on the same panel (art. 10d).",
    },
    {
      kind: "advisory", pattern: TASTE_TERMS, label: "Taste descriptions",
      message: "Taste terms (fruity, bitter, pungent…) are allowed only with an official panel test. Keep the test report (art. 10c).",
    },
    {
      kind: "advisory", pattern: HARVEST, label: "Harvest year",
      message: "A harvest year is allowed only if all the oil comes from that harvest (art. 11).",
    },
    {
      kind: "pattern", field: "bestBefore", label: "Best-before date format", pattern: "\\b(0[1-9]|1[0-2])/20\\d\\d\\b",
      severity: "warning", message: "Write the date as month/year, for example 05/2028.",
    },
    { kind: "minTextHeight", mm: 1.2, label: "Text height", message: "Mandatory text needs an x-height of at least 1.2 mm (Reg. 1169/2011, art. 13)." },
  ];
}

/**
 * Tunisian control bodies whose EU recognition changed. INNORPI's withdrawal is confirmed by
 * Implementing Regulation (EU) 2026/1789 (applies from 26 July 2026). Sources disagree on CERES, so it
 * is a warning until the Official Journal text is checked.
 */
const TN_CONTROL_BODIES = {
  withdrawn: [{ code: "TN-BIO-007", name: "INNORPI", since: "Reg. (EU) 2026/1789" }],
  toConfirm: [{ code: "TN-BIO-009", name: "CERES" }],
};

const organicEu = (code: string, nonEu: string, tunisianCode = true): Check[] => [
  {
    kind: "required", field: "organicControl", label: "Organic control body", when: { organic: true },
    message: `Organic oil needs the control body code (${code}) and “${nonEu}” under the EU organic logo (Reg. 2018/848).`,
  },
  ...(tunisianCode ? [{
    kind: "controlBody" as const, field: "organicControl", label: "Organic control body code", when: { organic: true }, ...TN_CONTROL_BODIES,
  }] : []),
];

const nutritionEu = (labels: [string, string, string, string, string, string, string, string, string], decimal: string) =>
  [
    labels[0],
    labels[1],
    `${labels[2]}\t3389 kJ / 824 kcal`,
    `${labels[3]}\t91${decimal}6 g`,
    `${labels[4]}\t13${decimal}1 g`,
    `${labels[5]}\t0 g`,
    `${labels[6]}\t0 g`,
    `${labels[7]}\t0 g`,
    `${labels[8]}\t0 g`,
  ].join("\n");

const france: MarketTemplate = {
  code: "FR",
  name: "France",
  languages: ["fr", "en"],
  source: EU_SOURCE,
  sourceNotes: "ORZETA Grove Marasca 750 mL France label (2026) · Reg. (EU) 2022/2104 and 1169/2011.",
  fields: [...base, { key: "categoryStatement", label: "Category statement" }, { key: "claim", label: "Claim (optional)" }],
  copy: {
    productName: "Extra virgin olive oil\nHuile d’olive vierge extra",
    origin: "Origin: Tunisia\nOrigine : Tunisie",
    claim: "Cold extraction\nExtraction à froid",
    categoryStatement: "Extra virgin olive oil: superior category olive oil obtained directly from olives and solely by mechanical means\nHuile d’olive vierge extra : huile d’olive de catégorie supérieure obtenue directement des olives et uniquement par des procédés mécaniques",
    ingredients: "INGREDIENTS: Extra virgin olive oil.\nINGRÉDIENTS : Huile d’olive vierge extra.",
    storage: "Store away from heat and light. Reseal tightly after use.\nÀ conserver à l’abri de la chaleur et de la lumière. Bien refermer après usage.",
    producer: `Produced and bottled by / Produit et conditionné par : ${PRODUCER_ADDRESS}, Tunisia / Tunisie`,
    bestBefore: "Best before end / À consommer de préférence avant fin : [MM/AAAA]",
    lot: `Lot : ${LOT}`,
    importer: "EU importer / Importateur UE :\n[Exploitant responsable établi dans l’UE : nom et adresse]",
    netQuantity: "{ml} mL ℮",
    nutrition: nutritionEu([
      "Nutrition declaration / Déclaration nutritionnelle", "per / pour 100 mL", "Energy / Énergie", "Fat / Matières grasses",
      "of which saturates / dont acides gras saturés", "Carbohydrate / Glucides", "of which sugars / dont sucres", "Protein / Protéines", "Salt / Sel",
    ], ","),
    organicControl: "[Code de l’organisme de contrôle : TN-BIO-XXX]\nAgriculture non UE",
    barcode: BARCODE,
  },
  checks: [],
};
france.checks = [
  ...requireAll(france.fields, ["claim"]),
  ...euChecks({
    name: "huile d'olive vierge extra",
    statement: "huile d'olive de catégorie supérieure obtenue directement des olives et uniquement par des procédés mécaniques",
    heat: "chaleur", light: "lumière", origin: "tunisie",
  }),
  ...organicEu("TN-BIO-XXX", "Agriculture non UE"),
  ...barcodeChecks,
];

const germany: MarketTemplate = {
  code: "DE",
  name: "Germany",
  languages: ["de", "en"],
  source: EU_SOURCE,
  sourceNotes: "ORZETA Sun Marasca 750 mL Germany label (2026) · Reg. (EU) 2022/2104 and 1169/2011.",
  fields: [...base, { key: "categoryStatement", label: "Category statement" }, { key: "claim", label: "Claim (optional)" }],
  copy: {
    productName: "Natives Olivenöl extra\nExtra virgin olive oil",
    origin: "Ursprung: Tunesien\nOrigin: Tunisia",
    claim: "Kaltextraktion\nCold extraction",
    categoryStatement: "Natives Olivenöl extra: Olivenöl der ersten Güteklasse – direkt aus Oliven ausschließlich mit mechanischen Verfahren gewonnen\nExtra virgin olive oil: superior category olive oil obtained directly from olives and solely by mechanical means",
    ingredients: "Zutaten: natives Olivenöl extra.\nIngredients: extra virgin olive oil.",
    storage: "Vor Licht und Wärme geschützt aufbewahren. Nach dem Öffnen gut verschließen.\nStore away from heat and light. Reseal tightly after use.",
    producer: `Hergestellt und abgefüllt von / Produced and bottled by: ${PRODUCER_ADDRESS}, Tunesien / Tunisia`,
    bestBefore: "Mindestens haltbar bis Ende / Best before end: [MM/JJJJ]",
    lot: `Los / Lot: ${LOT}`,
    importer: "Importeur in der EU / EU importer:\n[Lebensmittelunternehmer in der EU: Name und Anschrift]",
    netQuantity: "{ml} ml ℮",
    nutrition: nutritionEu([
      "Nährwertangaben / Nutrition declaration", "je / per 100 ml", "Brennwert / Energy", "Fett / Fat",
      "davon gesättigte Fettsäuren / of which saturates", "Kohlenhydrate / Carbohydrate", "davon Zucker / of which sugars", "Eiweiß / Protein", "Salz / Salt",
    ], ","),
    organicControl: "[Code der Kontrollstelle: TN-BIO-XXX]\nNicht-EU-Landwirtschaft",
    barcode: BARCODE,
  },
  checks: [],
};
germany.checks = [
  ...requireAll(germany.fields, ["claim"]),
  ...euChecks({
    name: "natives olivenöl extra",
    statement: "direkt aus oliven ausschließlich mit mechanischen verfahren gewonnen",
    heat: "wärme", light: "licht", origin: "tunesien",
  }),
  ...organicEu("TN-BIO-XXX", "Nicht-EU-Landwirtschaft"),
  ...barcodeChecks,
];

// --- United Kingdom: retained olive oil marketing standards ---------------------------------------

const unitedKingdom: MarketTemplate = {
  code: "GB",
  name: "United Kingdom",
  languages: ["en"],
  source: "https://www.gov.uk/guidance/olive-oil-regulations-and-inspections",
  sourceNotes: "ORZETA Grove Marasca 750 mL United Kingdom label (2026) · UK olive oil marketing standards.",
  fields: [...base, { key: "categoryStatement", label: "Category statement" }, { key: "claim", label: "Claim (optional)" }],
  copy: {
    productName: "Extra virgin olive oil",
    origin: "Origin: Tunisia",
    claim: "Cold extraction",
    categoryStatement: "Extra virgin olive oil: superior category olive oil obtained directly from olives and solely by mechanical means",
    ingredients: "INGREDIENTS: Extra virgin olive oil.",
    storage: "Store away from heat and light. Reseal tightly after use.",
    producer: `Produced and bottled by: ${PRODUCER_ADDRESS}, Tunisia`,
    bestBefore: "Best before end: [MM/YYYY]",
    lot: `Lot: ${LOT}`,
    importer: "UK importer:\n[UK importer: company name and full UK address]",
    netQuantity: "{ml} ml",
    nutrition: nutritionEu([
      "Nutrition declaration", "per 100 ml", "Energy", "Fat", "of which saturates", "Carbohydrate", "of which sugars", "Protein", "Salt",
    ], "."),
    organicControl: "[Organic control body code]\nNon-UK Agriculture",
    barcode: BARCODE,
  },
  checks: [],
};
unitedKingdom.checks = [
  ...requireAll(unitedKingdom.fields, ["claim"]),
  ...euChecks({
    name: "extra virgin olive oil",
    statement: "superior category olive oil obtained directly from olives and solely by mechanical means",
    heat: "heat", light: "light", origin: "tunisia",
  }),
  ...organicEu("the UK-approved control body", "Non-UK Agriculture", false),
  ...barcodeChecks,
];

// --- North America --------------------------------------------------------------------------------

const unitedStates: MarketTemplate = {
  code: "US",
  name: "United States",
  languages: ["en"],
  source: "https://www.fda.gov/regulatory-information/search-fda-guidance-documents/guidance-industry-food-labeling-guide",
  sourceNotes: "ORZETA Grove Marasca 750 mL United States label (2026) · FDA Food Labeling Guide, CBP country-of-origin marking.",
  fields: [...base, { key: "claim", label: "Claim (optional)" }],
  copy: {
    productName: "Extra Virgin Olive Oil",
    origin: "Product of Tunisia",
    claim: "Cold extracted",
    ingredients: "INGREDIENTS: Extra Virgin Olive Oil.",
    storage: "Store in a cool, dark place.",
    producer: `Manufactured by: ${PRODUCER_ADDRESS}, Tunisia`,
    bestBefore: "Best By: [MM/DD/YYYY]",
    lot: `Lot: ${LOT}`,
    importer: "Distributed by:\n[US importer: company name, full US address]",
    netQuantity: "{flOz} FL OZ ({ml} mL)",
    nutrition: [
      "Nutrition Facts",
      "about {servingsTbsp} servings per container",
      "Serving size\t1 Tbsp (14g)",
      "Calories\t120",
      "\t% Daily Value*",
      "Total Fat 14g\t18%",
      "Saturated Fat 2g\t10%",
      "Trans Fat 0g\t",
      "Sodium 0mg\t0%",
      "Total Carbohydrate 0g\t0%",
      "Protein 0g\t",
      "Vitamin E 1.5mg\t10%",
      "Not a significant source of cholesterol, dietary fiber, total sugars, added sugars, vitamin D, calcium, iron and potassium.",
      "*%DV = %Daily Value.",
    ].join("\n"),
    organicControl: "Certified organic by [certifying agent]",
    barcode: BARCODE,
  },
  checks: [],
};
unitedStates.checks = [
  ...requireAll(unitedStates.fields, ["claim"]),
  {
    kind: "contains", field: "netQuantity", label: "Net quantity in fl oz and mL", all: ["fl oz", "ml"],
    message: "The net quantity must be in US customary units (fl oz) and metric units (mL).",
  },
  {
    kind: "samePanel", fields: ["productName", "netQuantity"], panel: "front", label: "Name and net quantity on the front",
    message: "The product name and net quantity belong on the principal display panel (the front).",
  },
  {
    kind: "contains", field: "origin", label: "Country of origin", any: ["tunisia"],
    message: "The country of origin must be conspicuous, for example “Product of Tunisia” (US Customs).",
  },
  {
    kind: "contains", field: "nutrition", label: "Nutrition Facts panel", any: ["nutrition facts"],
    message: "US labels need a Nutrition Facts panel.",
  },
  {
    kind: "forbidden", pattern: FIRST_COLD_PRESSING, label: "No “first cold pressed”", severity: "warning",
    message: "“First cold pressed” describes traditional presses and is challenged by US industry standards. Prefer “Cold extracted”.",
  },
  {
    kind: "required", field: "organicControl", label: "Organic certifier", when: { organic: true },
    message: "USDA organic products must name the certifying agent: “Certified organic by …”.",
  },
  { kind: "minTextHeight", mm: 1.6, label: "Text height", message: "Mandatory text should be at least 1/16 inch (1.6 mm) high, measured on a lowercase letter (21 CFR 101.2)." },
  ...barcodeChecks,
];

const canada: MarketTemplate = {
  code: "CA",
  name: "Canada",
  languages: ["en", "fr"],
  source: "https://inspection.canada.ca/en/food-labels/labelling/industry/fats-and-oils",
  sourceNotes: "ORZETA Grove Marasca 750 mL Canada label (2026) · Safe Food for Canadians Regulations, CFIA labelling guidance.",
  fields: [...base, { key: "productNameFr", label: "French product designation" }, { key: "claim", label: "Claim (optional)" }],
  copy: {
    productName: "Extra virgin olive oil",
    productNameFr: "Huile d’olive extra vierge",
    origin: "Product of Tunisia\nProduit de Tunisie",
    claim: "Cold extracted\nExtraite à froid",
    ingredients: "INGREDIENTS/INGRÉDIENTS: Extra virgin olive oil / Huile d’olive extra vierge.",
    storage: "Keep in a cool, dark place / Conserver au frais et à l’abri de la lumière",
    producer: `Manufactured by/Fabriqué par: ${PRODUCER_ADDRESS}, Tunisia/Tunisie`,
    bestBefore: "Best before/Meilleur avant: [AA MO JJ]",
    lot: `Lot: ${LOT}`,
    importer: "Distributed by/Distribué par:\n[Canadian importer: company name, full address]",
    netQuantity: "{ml} mL",
    nutrition: [
      "Nutrition Facts / Valeur nutritive",
      "Per 1 tbsp (15 mL) / pour 1 c. à soupe (15 mL)",
      "Calories 120\t% Daily Value* / % valeur quotidienne*",
      "Fat / Lipides 14 g\t18 %",
      "Saturated / saturés 2 g + Trans / trans 0 g\t10 %",
      "Carbohydrate / Glucides 0 g\t0 %",
      "Sodium 0 mg\t0 %",
      "Protein / Protéines 0 g\t",
      "*5% or less is a little, 15% or more is a lot / *5 % ou moins c’est peu, 15 % ou plus c’est beaucoup.",
      "Not a significant source of fibre, sugars, cholesterol, potassium, calcium or iron / Source négligeable de fibres, de sucres, de cholestérol, de potassium, de calcium ou de fer.",
    ].join("\n"),
    organicControl: "Certified organic by / Certifié biologique par : [certification body]",
    barcode: BARCODE,
  },
  checks: [],
};
canada.checks = [
  ...requireAll(canada.fields, ["claim"]),
  {
    kind: "contains", field: "productNameFr", label: "French common name", any: ["huile d'olive"],
    message: "The common name must also be in French (Safe Food for Canadians Regulations).",
  },
  {
    kind: "samePanel", fields: ["productName", "productNameFr", "netQuantity"], panel: "front", label: "Bilingual name and net quantity on the front",
    message: "The common name in both languages and the net quantity belong on the principal display panel.",
  },
  {
    kind: "contains", field: "nutrition", label: "Bilingual Nutrition Facts table", all: ["nutrition facts", "valeur nutritive"],
    message: "Canadian labels need a bilingual Nutrition Facts / Valeur nutritive table.",
  },
  {
    kind: "contains", field: "origin", label: "Country of origin", any: ["tunisia"],
    message: "Imported foods must show the country of origin, for example “Product of Tunisia / Produit de Tunisie”.",
  },
  {
    kind: "required", field: "organicControl", label: "Organic certification body", when: { organic: true },
    message: "Organic products must name the certification body that verified them (Canada Organic Regime).",
  },
  { kind: "minTextHeight", mm: 1.6, label: "Text height", message: "The common name and net quantity need letters at least 1.6 mm high on a panel this size (CFIA)." },
  ...barcodeChecks,
];

// --- Gulf countries: GSO 9 (Arabic required) ------------------------------------------------------

function gulf(code: string, name: string): MarketTemplate {
  const fields = [
    ...base,
    { key: "productNameAr", label: "Arabic product designation" },
    { key: "productionDate", label: "Production date" },
    { key: "claim", label: "Claim (optional)" },
  ];
  return {
    code,
    name,
    languages: ["ar", "en"],
    source: "https://dgsm.gso.org.sa/store/standards/GSO:810825?lang=en",
    sourceNotes: `ORZETA Grove Marasca 750 mL ${name} label (2026) · GSO 9 labelling of prepackaged foods: Arabic required.`,
    fields,
    copy: {
      productName: "Extra virgin olive oil",
      productNameAr: "زيت زيتون بكر ممتاز",
      origin: "Product of Tunisia\nبلد المنشأ: تونس",
      ingredients: "INGREDIENTS: Extra virgin olive oil.\nالمكونات: زيت زيتون بكر ممتاز.",
      storage: "Storage: keep in a cool place away from light and heat.\nطريقة الحفظ: يحفظ في مكان بارد بعيداً عن الضوء والحرارة.",
      producer: `Produced and packed by: ${PRODUCER_ADDRESS}, Tunisia\nالمنتج والمعبئ: شركة أوليفد، صفاقس، تونس.`,
      productionDate: "Production date: [DD/MM/YYYY]\nتاريخ الإنتاج: [يوم/شهر/سنة]",
      bestBefore: "Expiry date: [DD/MM/YYYY]\nتاريخ الانتهاء: [يوم/شهر/سنة]",
      lot: `Lot: ${LOT}`,
      importer: "Importer / المستورد:\n[Importer name and address]\n[اسم وعنوان المستورد]",
      netQuantity: "{ml} mL\nالحجم الصافي: {ml} مل",
      nutrition: [
        "Nutrition facts / القيمة الغذائية",
        "per 100 mL / لكل 100 مل",
        "Energy / الطاقة\t824 kcal / 3389 kJ",
        "Total fat / الدهون الكلية\t91.6 g",
        "Saturated fat / الدهون المشبعة\t13.1 g",
        "Trans fat / الدهون المتحولة\t0 g",
        "Cholesterol / الكوليسترول\t0 mg",
        "Sodium / الصوديوم\t0 mg",
        "Carbohydrate / الكربوهيدرات\t0 g",
        "Sugars / السكريات\t0 g",
        "Protein / البروتين\t0 g",
      ].join("\n"),
      barcode: BARCODE,
    },
    checks: [
      ...requireAll(fields, ["claim"]),
      {
        kind: "script", script: "arabic", label: "Arabic text",
        fields: ["productNameAr", "origin", "ingredients", "storage", "producer", "productionDate", "bestBefore", "importer", "netQuantity", "nutrition"],
        message: "This information must also be written in Arabic, with the same meaning as any other language (GSO 9).",
      },
      {
        kind: "samePanel", fields: ["productName", "productNameAr"], panel: "front", label: "Arabic and English name on the front",
        message: "The product name in Arabic belongs on the front panel with the English name.",
      },
      {
        kind: "pattern", field: "bestBefore", label: "Expiry date format", pattern: "\\b\\d{2}/\\d{2}/20\\d\\d\\b",
        severity: "warning", message: "Write the expiry date as day/month/year, for example 31/05/2028.",
      },
      {
        kind: "advisory", pattern: "organic|عضوي|bio", label: "Organic claim",
        message: "Organic claims need certification recognised in the destination country and its approved mark.",
      },
      ...barcodeChecks,
    ],
  };
}

// --- Asia and Eurasia -----------------------------------------------------------------------------

const japan: MarketTemplate = {
  code: "JP",
  name: "Japan",
  languages: ["ja"],
  source: "https://www.caa.go.jp/en/policy/food_labeling/",
  sourceNotes: "ORZETA Grove Marasca 750 mL Japan label (2026) · Food Labeling Standards (Consumer Affairs Agency).",
  fields: [...base],
  copy: {
    productName: "Extra virgin olive oil\nエキストラバージンオリーブオイル",
    origin: "チュニジア産",
    ingredients: "名称：食用オリーブ油\n原材料名：食用オリーブ油",
    storage: "保存方法：直射日光、高温多湿を避けて保存してください。",
    producer: "原産国名：チュニジア\n製造者：Olived SARL（チュニジア）",
    bestBefore: "賞味期限：[YYYY.MM.DD]",
    lot: `ロット：${LOT}`,
    importer: "輸入者：\n[輸入者の氏名又は名称及び住所]",
    netQuantity: "内容量：{ml}ml",
    nutrition: [
      "栄養成分表示",
      "100mlあたり",
      "エネルギー\t824 kcal",
      "たんぱく質\t0 g",
      "脂質\t91.6 g",
      "－飽和脂肪酸\t13.1 g",
      "炭水化物\t0 g",
      "食塩相当量\t0 g",
      "この表示値は、目安です。",
    ].join("\n"),
    barcode: BARCODE,
  },
  checks: [],
};
japan.checks = [
  ...requireAll(japan.fields),
  {
    kind: "script", script: "japanese", label: "Japanese text",
    fields: ["ingredients", "storage", "producer", "bestBefore", "importer", "netQuantity", "nutrition"],
    message: "Mandatory information must be in Japanese.",
  },
  {
    kind: "contains", field: "ingredients", label: "名称 (product name line)", any: ["名称"],
    message: "The back label must start with 名称 (the product's common name).",
  },
  {
    kind: "contains", field: "nutrition", label: "栄養成分表示", any: ["栄養成分表示"],
    message: "Japanese labels need the 栄養成分表示 nutrition table.",
  },
  {
    kind: "contains", field: "importer", label: "輸入者 (importer)", any: ["輸入者"],
    message: "Imported foods must name the Japanese importer (輸入者).",
  },
  ...barcodeChecks,
];

const russia: MarketTemplate = {
  code: "RU",
  name: "Russia",
  languages: ["ru"],
  source: null,
  sourceNotes: "ORZETA Grove Marasca 750 mL Russia label (2026) · EAEU TR TS 022/2011 labelling; EAC mark and Chestny ZNAK DataMatrix code.",
  fields: [...base, { key: "productionDate", label: "Production date" }, { key: "marks", label: "EAC mark and DataMatrix code" }, { key: "claim", label: "Claim (optional)" }],
  copy: {
    productName: "Масло оливковое нерафинированное\nExtra Virgin",
    origin: "Страна происхождения: Тунис",
    claim: "Холодная экстракция",
    ingredients: "Состав: масло оливковое нерафинированное Extra Virgin.",
    storage: "Условия хранения: хранить в защищённом от света месте, вдали от источников тепла. После вскрытия плотно закрывать.",
    producer: `Изготовитель: ${PRODUCER_ADDRESS}, Тунис.`,
    productionDate: "Дата изготовления: [ДД.ММ.ГГГГ]",
    bestBefore: "Годен до: [ДД.ММ.ГГГГ]",
    lot: `Партия: ${LOT}`,
    importer: "Импортёр / организация, принимающая претензии:\n[Наименование и адрес импортёра в России]",
    netQuantity: "{ml} мл",
    nutrition: [
      "Пищевая ценность",
      "в 100 мл продукта",
      "Энергетическая ценность\t3389 кДж / 824 ккал",
      "Жиры\t91,6 г",
      "в т. ч. насыщенные жирные кислоты\t13,1 г",
      "Белки\t0 г",
      "Углеводы\t0 г",
    ].join("\n"),
    marks: "[EAC mark and Chestny ZNAK DataMatrix code]",
    barcode: BARCODE,
  },
  checks: [],
};
russia.checks = [
  ...requireAll(russia.fields, ["claim"]),
  {
    kind: "script", script: "cyrillic", label: "Russian text",
    fields: ["productName", "origin", "ingredients", "storage", "producer", "productionDate", "bestBefore", "importer", "nutrition"],
    message: "Mandatory information must be in Russian.",
  },
  ...barcodeChecks,
];

const taiwan: MarketTemplate = {
  code: "TW",
  name: "Taiwan",
  languages: ["zh-Hant"],
  source: null,
  sourceNotes: "ORZETA Grove Marasca 750 mL Taiwan label (2026) · Act Governing Food Safety and Sanitation, labelling articles.",
  fields: [...base],
  copy: {
    productName: "Extra virgin olive oil\n特級初榨橄欖油",
    origin: "原產地：突尼西亞",
    ingredients: "品名：特級初榨橄欖油\n成分：特級初榨橄欖油",
    storage: "保存方式：請置於陰涼處，避免陽光直射。",
    producer: "製造廠商：Olived SARL（突尼西亞）",
    bestBefore: "有效日期：[西元年/月/日]",
    lot: `批號：${LOT}`,
    importer: "進口商名稱、電話及地址：\n[進口商名稱、電話及地址]",
    netQuantity: "容量：{ml}毫升",
    nutrition: [
      "營養標示",
      "每一份量 15 毫升",
      "本包裝含 {servings15} 份",
      "\t每份 / 每100毫升",
      "熱量\t124 大卡 / 824 大卡",
      "蛋白質\t0 公克 / 0 公克",
      "脂肪\t13.7 公克 / 91.6 公克",
      "飽和脂肪\t2.0 公克 / 13.1 公克",
      "反式脂肪\t0 公克 / 0 公克",
      "碳水化合物\t0 公克 / 0 公克",
      "糖\t0 公克 / 0 公克",
      "鈉\t0 毫克 / 0 毫克",
    ].join("\n"),
    barcode: BARCODE,
  },
  checks: [],
};
taiwan.checks = [
  ...requireAll(taiwan.fields),
  {
    kind: "script", script: "chinese", label: "Traditional Chinese text",
    fields: ["ingredients", "storage", "producer", "bestBefore", "importer", "netQuantity", "nutrition"],
    message: "Mandatory information must be in Traditional Chinese.",
  },
  {
    kind: "contains", field: "importer", label: "Importer phone and address", any: ["電話"],
    message: "Taiwan requires the importer's name, telephone number and address.",
  },
  ...barcodeChecks,
];

const southKorea: MarketTemplate = {
  code: "KR",
  name: "South Korea",
  languages: ["ko"],
  source: null,
  draft: true,
  sourceNotes: "DRAFT · Built from the ORZETA South Korea label photos and Korean food labelling practice (MFDS). Wording to verify with a Korean importer before use.",
  fields: [...base, { key: "foodType", label: "Food type (식품유형)" }],
  copy: {
    productName: "Extra virgin olive oil\n엑스트라버진 올리브유",
    foodType: "식품유형: 올리브유",
    origin: "원산지: 튀니지",
    ingredients: "원재료명: 올리브유(엑스트라버진) 100%",
    storage: "보관방법: 직사광선을 피하고 서늘한 곳에 보관하십시오.",
    producer: "제조원: Olived SARL (튀니지)",
    bestBefore: "소비기한: [YYYY.MM.DD]까지",
    lot: `LOT: ${LOT}`,
    importer: "수입판매원:\n[상호 및 주소]\n부정·불량식품 신고는 국번없이 1399",
    netQuantity: "내용량: {ml} mL",
    nutrition: [
      "영양정보",
      "100 mL당",
      "열량\t824 kcal",
      "나트륨\t0 mg",
      "탄수화물\t0 g",
      "당류\t0 g",
      "지방\t91.6 g",
      "트랜스지방\t0 g",
      "포화지방\t13.1 g",
      "콜레스테롤\t0 mg",
      "단백질\t0 g",
    ].join("\n"),
    barcode: BARCODE,
  },
  checks: [],
};
southKorea.checks = [
  ...requireAll(southKorea.fields),
  {
    kind: "script", script: "korean", label: "Korean text", severity: "warning",
    fields: ["productName", "foodType", "origin", "ingredients", "storage", "bestBefore", "importer", "netQuantity", "nutrition"],
    message: "Mandatory information should be in Korean.",
  },
  {
    kind: "contains", field: "importer", label: "Report line 1399", any: ["1399"], severity: "warning",
    message: "Korean labels usually carry the food-safety report line “부정·불량식품 신고는 국번없이 1399”.",
  },
  ...barcodeChecks,
];

const otherDestination: MarketTemplate = {
  code: "OTHER",
  name: "Other destination",
  languages: [],
  source: null,
  sourceNotes: "Generic English template. Check the destination's own labelling rules before printing.",
  fields: [...base, { key: "destinationCountry", label: "Destination country or territory" }],
  copy: {
    productName: "Extra virgin olive oil",
    origin: "Product of Tunisia",
    ingredients: "INGREDIENTS: Extra virgin olive oil.",
    storage: "Store away from heat and light. Reseal tightly after use.",
    producer: `Produced and bottled by: ${PRODUCER_ADDRESS}, Tunisia`,
    bestBefore: "Best before: [date]",
    lot: `Lot: ${LOT}`,
    importer: "Importer:\n[Importer name and address]",
    netQuantity: "{ml} mL",
    nutrition: nutritionEu([
      "Nutrition declaration", "per 100 mL", "Energy", "Fat", "of which saturates", "Carbohydrate", "of which sugars", "Protein", "Salt",
    ], "."),
    destinationCountry: "[Country or territory]",
    barcode: BARCODE,
  },
  checks: [],
};
otherDestination.checks = [...requireAll(otherDestination.fields), ...barcodeChecks];

export const MARKET_TEMPLATES: MarketTemplate[] = [
  germany,
  france,
  unitedKingdom,
  unitedStates,
  canada,
  gulf("SA", "Saudi Arabia"),
  gulf("AE", "United Arab Emirates"),
  gulf("KW", "Kuwait"),
  gulf("QA", "Qatar"),
  russia,
  japan,
  taiwan,
  southKorea,
  otherDestination,
];

/** The RuleSet.rules value published for a market. */
export function rulesFor(template: MarketTemplate): Rules {
  return {
    templateVersion: TEMPLATE_VERSION,
    referenceOnly: true,
    draft: template.draft ?? false,
    source: template.source,
    languages: template.languages,
    requiredFields: template.fields,
    copy: template.copy,
    checks: template.checks,
  };
}
