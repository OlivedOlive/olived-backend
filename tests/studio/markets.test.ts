import { describe, expect, it } from "vitest";
import { type CheckContext, type DesignContent, evaluateChecks, passes, checkDesign, rulesSchema, validGtin } from "../../src/modules/studio/designs/validate.js";
import { MARKET_TEMPLATES, rulesFor } from "../../src/modules/studio/markets/templates.js";

const colors = { primary: "#1c1a16", secondary: "#e8d9bc" };
const sales = { saleLocation: "Paris", salesChannel: "Retail" };
const label750: CheckContext = { organic: false, panelWidthMm: 170 / 3 };

/** The template copy for a 750 mL bottle, as the editor fills it in. */
function fill(copy: Record<string, string>, ml = 750) {
  const tokens: Record<string, string> = {
    ml: String(ml), flOz: (ml / 29.5735).toFixed(1), servingsTbsp: String(Math.round(ml / 14.79)), servings15: String(Math.round(ml / 15)),
  };
  return Object.fromEntries(Object.entries(copy).map(([key, text]) => [key, text.replace(/\{(\w+)\}/g, (_, token) => tokens[token] ?? `{${token}}`)]));
}

/** A client's finished label: template copy with every placeholder replaced. */
function finished(code: string, extra: Record<string, string> = {}): DesignContent {
  const template = MARKET_TEMPLATES.find((t) => t.code === code)!;
  const fields = Object.fromEntries(Object.entries(fill(template.copy)).map(([key, text]) => [
    key,
    text
      .replace(/\[(MM\/AAAA|MM\/JJJJ|MM\/YYYY)\]/g, "05/2028")
      .replace(/\[(DD\/MM\/YYYY|يوم\/شهر\/سنة)\]/g, "31/05/2028")
      .replace(/\[[^\]]*BIO[^\]]*\]/g, "TN-BIO-001")
      .replace(/\[[^\]]+\]/g, "ACME Imports, 1 Main Street 電話 1399"),
  ]));
  return { fields: { ...fields, brandName: "ORZETA", ...sales, ...extra }, colors };
}

const rules = (code: string) => rulesSchema.parse(rulesFor(MARKET_TEMPLATES.find((t) => t.code === code)!));
const errors = (code: string, content: DesignContent, context = label750) =>
  evaluateChecks(content, rules(code), context).filter((r) => r.status === "error");

describe("market templates", () => {
  it("are valid rule sets with a unique code each", () => {
    const codes = MARKET_TEMPLATES.map((t) => t.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const template of MARKET_TEMPLATES) expect(() => rulesSchema.parse(rulesFor(template))).not.toThrow();
  });

  it.each(MARKET_TEMPLATES.map((t) => t.code))("%s: a finished label passes its own checks", (code) => {
    expect(errors(code, finished(code))).toEqual([]);
    expect(errors(code, finished(code), { organic: true, panelWidthMm: 170 / 3 })).toEqual([]);
  });

  it.each(MARKET_TEMPLATES.map((t) => t.code))("%s: the template as delivered asks for its placeholders", (code) => {
    const template = MARKET_TEMPLATES.find((t) => t.code === code)!;
    const content = { fields: { ...fill(template.copy), brandName: "ORZETA", ...sales }, colors };
    const messages = errors(code, content).map((r) => r.message).join(" ");
    expect(messages).toContain("replace [");
  });

  it("fills the volume into the copy", () => {
    const us = fill(MARKET_TEMPLATES.find((t) => t.code === "US")!.copy);
    expect(us.netQuantity).toBe("25.4 FL OZ (750 mL)");
    expect(us.nutrition).toContain("about 51 servings per container");
    expect(fill(MARKET_TEMPLATES.find((t) => t.code === "TW")!.copy).nutrition).toContain("本包裝含 50 份");
  });

  it("marks South Korea as a draft", () => {
    expect(rules("KR").draft).toBe(true);
    expect(rules("FR").draft).toBe(false);
  });
});

describe("check kinds", () => {
  it("refuses “first cold pressing” in the EU, wherever it is written", () => {
    const issues = errors("FR", finished("FR", { claim: "First cold pressing" }));
    expect(issues.map((i) => i.label)).toContain("No “first cold pressing”");
    // The same wording only warns in the US.
    expect(errors("US", finished("US", { claim: "First cold pressed" }))).toEqual([]);
  });

  it("allows an acidity claim only with peroxides, waxes and UV absorbance", () => {
    const claim = { claim: "Acidity ≤ 0.3 %" };
    expect(errors("DE", finished("DE", claim)).map((i) => i.label)).toEqual(["Acidity claim"]);
    expect(errors("DE", finished("DE", { ...claim, peroxides: "≤ 10 mEq O2/kg", waxes: "≤ 100 mg/kg", uvAbsorbance: "K232 ≤ 2.0" }))).toEqual([]);
  });

  it("warns about taste terms without blocking submission", () => {
    const issues = checkDesign(finished("FR", { claim: "Fruité intense" }), rules("FR"), label750);
    expect(issues).toEqual([expect.objectContaining({ severity: "warning" })]);
    expect(passes(issues)).toBe(true);
  });

  it("needs the exact EU category statement", () => {
    const content = finished("FR", { categoryStatement: "A superior olive oil" });
    expect(errors("FR", content).map((i) => i.label)).toEqual(["Category statement"]);
  });

  it("checks that a client's own front panel still shows the name and origin", () => {
    const content = finished("FR");
    content.artwork = { font: "serif", panels: { unit: { front: { text: "ORZETA\nHuile d’olive vierge extra", x: 50, y: 50, size: 8 } } } };
    expect(errors("FR", content).map((i) => i.message)).toEqual([
      "The legal name and the origin must be together on the front panel (Reg. 2022/2104, art. 5.2).",
    ]);
  });

  it("measures text height on the confirmed 170 mm label", () => {
    const small = finished("FR");
    small.artwork = { font: "serif", panels: { unit: { back: { text: small.fields.storage!, x: 50, y: 50, size: 4 } } } };
    expect(errors("FR", small).map((i) => i.label)).toContain("Text height");
    expect(errors("FR", finished("FR"))).toEqual([]);
    // Without supplier dimensions the height cannot be proven, so it is reported, not failed.
    const unknown = evaluateChecks(small, rules("FR"), { organic: false, panelWidthMm: null });
    expect(unknown.find((r) => r.label === "Text height")?.status).toBe("unverified");
  });

  it("needs Arabic on Gulf labels", () => {
    const content = finished("SA", { ingredients: "INGREDIENTS: Extra virgin olive oil." });
    expect(errors("SA", content).map((i) => i.message)).toEqual([
      "This information must also be written in Arabic, with the same meaning as any other language (GSO 9).",
    ]);
  });

  it("needs both fl oz and mL in the US", () => {
    expect(errors("US", finished("US", { netQuantity: "750 mL" })).map((i) => i.label)).toEqual(["Net quantity in fl oz and mL"]);
  });

  it("applies organic rules only to organic products", () => {
    const content = finished("US", { organicControl: "" });
    expect(errors("US", content)).toEqual([]);
    expect(errors("US", content, { organic: true, panelWidthMm: null }).map((i) => i.label)).toEqual(["Organic certifier"]);
  });

  it("still reads version 1 rule sets", () => {
    const v1 = rulesSchema.parse({ requiredFields: [{ key: "brandName", label: "Brand name" }] });
    expect(checkDesign({ fields: { ...sales }, colors }, v1)).toEqual([
      { field: "brandName", message: "Brand name is required for this market." },
    ]);
  });
});

describe("barcodes", () => {
  const status = (code: string, barcode: string, olivedBrand: boolean) =>
    evaluateChecks(finished(code, { barcode }), rules(code), { ...label750, olivedBrand }).find((r) => r.label === "Barcode number");

  it("knows a valid GTIN from a mistyped one", () => {
    expect(validGtin("4006381333931")).toBe(true);
    expect(validGtin("6191234567897")).toBe(true);
    expect(validGtin("16191234567894")).toBe(true);
    expect(validGtin("6191234567890")).toBe(false);
    expect(validGtin("619123")).toBe(false);
  });

  it("refuses a barcode with a wrong check digit", () => {
    expect(status("FR", "6191234567890", true)).toMatchObject({ status: "error" });
    expect(errors("FR", finished("FR", { barcode: "619 1234 56789 0" })).map((i) => i.label)).toEqual(["Barcode number"]);
  });

  it("expects OLIVED's 619 prefix on OLIVED brands only", () => {
    expect(status("US", "6191234567897", true)?.status).toBe("pass");
    expect(status("US", "16191234567894", true)?.status).toBe("pass");
    expect(status("US", "4006381333931", true)).toMatchObject({ status: "warning" });
    // A private-label client uses its own GS1 numbers.
    expect(status("US", "4006381333931", false)?.status).toBe("pass");
  });

  it("leaves an empty barcode to the barcode reminder", () => {
    expect(status("FR", "[GTIN barcode: one per reference]", true)?.status).toBe("pass");
  });
});

describe("organic control body", () => {
  const organic: CheckContext = { organic: true, panelWidthMm: 170 / 3 };
  const result = (code: string, organicControl: string) =>
    evaluateChecks(finished(code, { organicControl }), rules(code), organic).find((r) => r.label === "Organic control body code");

  it("accepts a recognised Tunisian code", () => {
    expect(result("FR", "TN-BIO-001\nAgriculture non UE")?.status).toBe("pass");
  });

  it("refuses INNORPI, which lost EU recognition", () => {
    expect(result("DE", "TN-BIO-007\nNicht-EU-Landwirtschaft")).toMatchObject({ status: "error", message: expect.stringContaining("2026/1789") });
  });

  it("asks to confirm CERES, whose status is unclear", () => {
    expect(result("FR", "TN-BIO-009\nAgriculture non UE")?.status).toBe("warning");
  });

  it("needs a code, not only a name", () => {
    expect(result("FR", "Ecocert\nAgriculture non UE")).toMatchObject({ status: "error" });
  });

  it("does not apply to other oils, or outside the EU code system", () => {
    expect(evaluateChecks(finished("FR", { organicControl: "TN-BIO-007" }), rules("FR"), label750).some((r) => r.label === "Organic control body code")).toBe(false);
    expect(rules("GB").checks?.some((c) => c.kind === "controlBody")).toBe(false);
  });
});

describe("a client's own layout", () => {
  const context: CheckContext = { organic: false, panelWidthMm: null, label: { width: 170, height: 171 } };
  const field = (key: string, x: number, extra: Record<string, unknown> = {}) =>
    ({ id: key, type: "field" as const, field: key, x, y: 20, w: 50, h: 20, size: 9, font: "roboto-condensed", ...extra });
  /** Every field of the market placed on the label, back panel first, name and origin on the front. */
  function arranged(code: string, change: (elements: ReturnType<typeof field>[]) => void = () => {}) {
    const content = finished(code);
    const front = ["productName", "productNameFr", "productNameAr", "origin", "netQuantity", "claim"];
    const elements = Object.keys(content.fields)
      .filter((key) => !["saleLocation", "salesChannel", "brandName"].includes(key))
      .map((key) => field(key, front.includes(key) ? 62 : key === "nutrition" || key === "categoryStatement" ? 118 : 5));
    change(elements);
    content.artwork = { font: "serif", panels: {}, layout: { unit: { elements: [{ id: "logo", type: "image", x: 70, y: 5, w: 30, h: 20, src: "/studio/labels/mark-grove.png" }, ...elements] } } };
    return content;
  }
  const errorsOf = (code: string, content: DesignContent) => evaluateChecks(content, rules(code), context).filter((r) => r.status === "error");

  it("passes when every field is placed, large enough and on the right panel", () => {
    expect(errorsOf("FR", arranged("FR"))).toEqual([]);
  });

  it("needs every filled-in field on the label", () => {
    const content = arranged("FR", (elements) => elements.splice(elements.findIndex((e) => e.field === "importer"), 1));
    expect(errorsOf("FR", content).map((r) => r.message)).toEqual([
      "Importer name and address is filled in but not placed on the label. Add it from the fields list.",
    ]);
  });

  it("checks the panel each element actually sits on", () => {
    const content = arranged("FR", (elements) => { elements.find((e) => e.field === "origin")!.x = 5; });
    expect(errorsOf("FR", content).map((r) => r.message)).toEqual([
      "The legal name and the origin must be together on the front panel (Reg. 2022/2104, art. 5.2).",
    ]);
  });

  it("measures text height from each element's point size, even on an unconfirmed label size", () => {
    const content = arranged("US", (elements) => { elements.find((e) => e.field === "importer")!.size = 6; });
    expect(errorsOf("US", content).map((r) => r.label)).toEqual(["Text height"]);
    expect(errorsOf("US", content)[0]!.message).toContain("Importer name and address");
  });

  it("warns about text across a fold or near the edge, without blocking", () => {
    const content = arranged("FR", (elements) => {
      elements.find((e) => e.field === "storage")!.x = 40; // spans the fold at 56.7 mm
      elements.find((e) => e.field === "lot")!.x = 0.5;
    });
    const warnings = evaluateChecks(content, rules("FR"), context).filter((r) => r.status === "warning").map((r) => r.label);
    expect(warnings).toEqual(expect.arrayContaining(["Text across a fold", "Safety margin"]));
    expect(passes(checkDesign(content, rules("FR"), context))).toBe(true);
  });

  it("accepts the brand as a logo instead of text", () => {
    const content = arranged("FR");
    expect(evaluateChecks(content, rules("FR"), context).find((r) => r.field === "brandName")?.status).toBe("pass");
  });
});

