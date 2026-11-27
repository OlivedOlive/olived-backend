import { z } from "zod";

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a colour like #1c1a16");
const panelKeys = z.enum(["front", "back", "left", "right", "top", "bottom"]);
const panel = z.object({
  text: z.string().max(500),
  x: z.number().min(5).max(95),
  y: z.number().min(5).max(95),
  size: z.number().min(4).max(22),
});
const component = z.partialRecord(panelKeys, panel);

/**
 * Where an image comes from: a company upload, an OLIVED brand mark shipped with the Studio, or (for
 * designs made before uploads existed) a small embedded image.
 */
const imageSource = z.string().max(80000).regex(
  /^(\/api\/studio\/assets\/[a-z0-9]{20,40}|\/studio\/labels\/[a-z0-9-]+\.(png|webp)|\/_next\/static\/media\/[\w.-]+\.(png|webp|jpg|svg)|data:image\/(?:png|jpeg|webp);base64,[a-zA-Z0-9+/]+={0,2})$/,
  "Choose an image from your library.",
);

/** One element of the label, positioned in millimetres from the top-left corner of the unit label. */
const element = z.object({
  id: z.string().min(1).max(40),
  type: z.enum(["text", "field", "image", "shape"]),
  name: z.string().max(60).optional(),
  x: z.number().min(-100).max(700),
  y: z.number().min(-100).max(700),
  w: z.number().min(.5).max(700),
  h: z.number().min(.5).max(700),
  rotation: z.number().min(-360).max(360).optional(),
  locked: z.boolean().optional(),
  hidden: z.boolean().optional(),
  opacity: z.number().min(0).max(1).optional(),
  // Text and fields. A field element prints the design's field of that key.
  text: z.string().max(2000).optional(),
  field: z.string().max(60).optional(),
  font: z.string().max(40).optional(),
  /** Point size. */
  size: z.number().min(3).max(300).optional(),
  weight: z.union([z.literal(400), z.literal(500), z.literal(600), z.literal(700)]).optional(),
  italic: z.boolean().optional(),
  color: hexColor.optional(),
  align: z.enum(["left", "center", "right"]).optional(),
  lineHeight: z.number().min(.7).max(3).optional(),
  tracking: z.number().min(-.1).max(.6).optional(),
  uppercase: z.boolean().optional(),
  /** Draw "label<TAB>value" rows as a two-column table, like a nutrition panel. */
  table: z.boolean().optional(),
  // Boxes and shapes.
  fill: hexColor.optional(),
  stroke: hexColor.optional(),
  strokeWidth: z.number().min(0).max(20).optional(),
  radius: z.number().min(0).max(100).optional(),
  padding: z.number().min(0).max(20).optional(),
  shape: z.enum(["rect", "ellipse", "line"]).optional(),
  // Images.
  src: imageSource.optional(),
  // Barcodes (the barcode field holding a GTIN): bar height in millimetres, and how the digits are set.
  barHeight: z.number().min(2).max(60).optional(),
  barcodeStyle: z.enum(["gs1", "simple"]).optional(),
});

const layout = z.object({
  elements: z.array(element).max(150),
  /** Background of each panel of the unit label; the design's primary colour where unset. */
  backgrounds: z.partialRecord(z.enum(["back", "front", "right"]), hexColor).optional(),
});

export const designContentSchema = z.object({
  fields: z.record(z.string().max(60), z.string().trim().max(2000)),
  colors: z.object({ primary: hexColor, secondary: hexColor }),
  artwork: z.object({
    font: z.enum(["serif", "sans", "mono"]),
    logo: z.string().max(80000).regex(/^data:image\/(?:png|jpeg|webp);base64,[a-zA-Z0-9+/]+={0,2}$/).optional(),
    logoPlacement: z.object({
      x: z.number().min(15).max(85),
      y: z.number().min(0).max(80),
      size: z.number().min(8).max(70),
    }).optional(),
    labelFit: z.object({
      offset: z.number().min(0).max(55),
      height: z.number().min(30).max(90),
    }).refine(({ offset, height }) => offset + height <= 100).optional(),
    panels: z.partialRecord(z.enum(["unit", "retail", "case"]), component),
    /** The client's own arrangement of the unit label. Without it, the label follows the market template. */
    layout: z.object({ unit: layout.optional() }).optional(),
  }).optional(),
});

export type LabelElement = z.infer<typeof element>;

export type DesignContent = z.infer<typeof designContentSchema>;

// ---- Market checks --------------------------------------------------------------------------------

const severity = z.enum(["error", "warning"]).optional();
const common = {
  label: z.string(),
  message: z.string().optional(),
  severity,
  /** Only for organic products. */
  when: z.object({ organic: z.boolean() }).optional(),
};

/**
 * The kinds of check a market's rule set can contain. Each is a fact a label must satisfy, so adding a
 * market is data, not code. Errors block submission; warnings are shown but do not.
 */
export const checkSchema = z.discriminatedUnion("kind", [
  /** The field is filled in and has no [placeholder] left. */
  z.object({ kind: z.literal("required"), field: z.string(), ...common }),
  /** The field contains one of `any`, and/or every one of `all` (case and apostrophes ignored). */
  z.object({ kind: z.literal("contains"), field: z.string(), any: z.array(z.string()).optional(), all: z.array(z.string()).optional(), ...common }),
  /** The field matches a regular expression, for example a date format. */
  z.object({ kind: z.literal("pattern"), field: z.string(), pattern: z.string(), ...common }),
  /** These fields are written in a script, for example Arabic. */
  z.object({ kind: z.literal("script"), fields: z.array(z.string()), script: z.enum(["arabic", "cyrillic", "japanese", "chinese", "korean"]), ...common }),
  /** These fields appear on one panel of the unit label. */
  z.object({ kind: z.literal("samePanel"), fields: z.array(z.string()), panel: panelKeys, ...common }),
  /** Wording that may not appear anywhere on the packaging. */
  z.object({ kind: z.literal("forbidden"), pattern: z.string(), ...common }),
  /** Wording that is allowed only together with other fields. */
  z.object({ kind: z.literal("requiresAlso"), pattern: z.string(), fields: z.array(z.string()), ...common }),
  /** Wording that is allowed under conditions OLIVED staff must confirm. Always a warning. */
  z.object({ kind: z.literal("advisory"), pattern: z.string(), ...common }),
  /** Mandatory text on the unit label is at least this tall (x-height, in millimetres). */
  z.object({ kind: z.literal("minTextHeight"), mm: z.number().positive(), ...common }),
  /**
   * A barcode number, once entered, is a valid GTIN (8, 12, 13 or 14 digits with a correct check digit).
   * OLIVED's own brands should use OLIVED's GS1 numbers, which start with `brandPrefix`.
   */
  z.object({ kind: z.literal("gtin"), field: z.string(), brandPrefix: z.string().optional(), ...common }),
  /** An organic control-body code such as TN-BIO-001, refusing bodies that lost recognition. */
  z.object({
    kind: z.literal("controlBody"), field: z.string(),
    withdrawn: z.array(z.object({ code: z.string(), name: z.string(), since: z.string() })),
    toConfirm: z.array(z.object({ code: z.string(), name: z.string() })).optional(),
    ...common,
  }),
]);

export type Check = z.infer<typeof checkSchema>;

/** The shape of RuleSet.rules. Version 1 rule sets only have requiredFields. */
export const rulesSchema = z.object({
  templateVersion: z.number().optional(),
  referenceOnly: z.boolean().optional(),
  draft: z.boolean().optional(),
  source: z.string().nullable().optional(),
  languages: z.array(z.string()).optional(),
  requiredFields: z.array(z.object({ key: z.string(), label: z.string() })),
  copy: z.record(z.string(), z.string()).optional(),
  checks: z.array(checkSchema).optional(),
});

export type Rules = z.infer<typeof rulesSchema>;
export type Issue = { field: string; message: string; severity?: "error" | "warning" };
export type CheckResult = {
  label: string;
  status: "pass" | "error" | "warning" | "unverified";
  message: string;
  field?: string;
  /** "notPlaced": the field has its text but no block on the label, so the Studio can offer to add it back. */
  code?: "notPlaced";
};

/**
 * Where the product will be sold. Asked for on every design, on top of the market's own rules, so a
 * reviewer always knows the destination. Always checked: leaving the fields out does not skip them.
 */
export const SALES_FIELDS = [
  { key: "saleLocation", label: "Sales location or retailer" },
  { key: "salesChannel", label: "Sales channel" },
] as const;

/** What a check needs to know about the packaging, beyond the design content. */
export type CheckContext = {
  /** The product is organic: organic-only checks apply. */
  organic: boolean;
  /** An OLIVED brand (ORZETA, Oussoul), as opposed to a client's private label. */
  olivedBrand?: boolean;
  /** Width of one wrap panel of the unit label in millimetres, or null when the size is not confirmed. */
  panelWidthMm: number | null;
  /** Size of the unit label in millimetres, confirmed or illustrative, which element positions refer to. */
  label?: { width: number; height: number };
};

/**
 * Text size of a wrap panel drawn from the template, as a percentage of the panel width. Kept equal to
 * TEMPLATE_TEXT_SIZE in the frontend (src/lib/studio/label-artwork.ts).
 */
export const TEMPLATE_TEXT_SIZE = 6.2;
/**
 * x-height as a share of the font size, per typeface of the editor (src/lib/studio/fonts.ts), on the
 * conservative side. Unknown typefaces use the smallest value.
 */
const X_HEIGHT: Record<string, number> = {
  serif: .46, sans: .51, mono: .42,
  "roboto-condensed": .52, inter: .54, montserrat: .52, oswald: .57, cormorant: .40, playfair: .51, lora: .5,
  "great-vibes": .3, "noto-sans-arabic": .5, "noto-naskh-arabic": .45,
};
const xHeight = (font: string | undefined) => X_HEIGHT[font ?? "serif"] ?? .3;
const PT_TO_MM = 25.4 / 72;
/** Distance from the label edge that printing may trim or a seam may hide. */
const SAFE_MARGIN_MM = 2;

const PLACEHOLDER = /\[[^\]]+\]/;
const SCRIPTS = {
  arabic: /[؀-ۿ]/,
  cyrillic: /[Ѐ-ӿ]/,
  japanese: /[぀-ヿ一-鿿]/,
  chinese: /[一-鿿]/,
  korean: /[가-힯]/,
} as const;

/** True when the last digit of a GTIN is its GS1 check digit. */
export function validGtin(digits: string) {
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(digits)) return false;
  const body = digits.slice(0, -1).split("").reverse();
  const sum = body.reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === Number(digits.at(-1));
}

const normalize = (value: string) => value.normalize("NFC").replace(/[’‘`]/g, "'").replace(/\s+/g, " ").toLowerCase();

/** The packaging context of a stored design: organic product, and the label's confirmed size. */
export function contextFor(template: { widthMm: unknown; heightMm?: unknown; zones: unknown; variant?: { product?: { slug?: string } } }): CheckContext {
  const zones = (template.zones ?? {}) as { geometry?: string };
  const width = Number(template.widthMm);
  const height = Number(template.heightMm);
  const slug = template.variant?.product?.slug ?? "";
  return {
    organic: slug.includes("organic"),
    olivedBrand: slug.startsWith("orzeta") || slug.startsWith("oussoul"),
    // Only the supplier-confirmed artwork is real. Illustrative sizes cannot prove a text height.
    panelWidthMm: zones.geometry === "artwork-reference" && width > 0 ? width / 3 : null,
    ...(width > 0 && height > 0 ? { label: { width, height } } : {}),
  };
}

/** Every text that will be printed: the fields and any panel text a client wrote themselves. */
function printedText(content: DesignContent) {
  const panels = Object.values(content.artwork?.panels ?? {}).flatMap((part) => Object.values(part ?? {}));
  return [...Object.values(content.fields), ...panels.map((p) => p?.text ?? "")].join("\n");
}

/** The client's own text for a unit-label panel, or undefined when the panel is drawn from the template. */
const customPanel = (content: DesignContent, face: string) =>
  content.artwork?.panels.unit?.[face as keyof NonNullable<NonNullable<DesignContent["artwork"]>["panels"]["unit"]>];

/** Runs every check of the market and reports each one, passed or not, for the live checklist. */
/** The panel of the unit label an element sits on, judged by its centre: back, front or right third. */
export function panelOf(element: { x: number; w: number }, labelWidth: number): "back" | "front" | "right" {
  const centre = (element.x + element.w / 2) / labelWidth;
  return centre < 1 / 3 ? "back" : centre < 2 / 3 ? "front" : "right";
}

/** Layout problems any printed label has, whatever the market: text cut at a fold or the trim. */
function layoutResults(elements: LabelElement[], label: { width: number; height: number }): CheckResult[] {
  const textual = elements.filter((e) => !e.hidden && (e.type === "text" || e.type === "field") && !e.rotation);
  const name = (e: LabelElement) => e.name ?? (e.field ? `the ${e.field} block` : "a text block");
  const folds = [label.width / 3, label.width * 2 / 3];
  const crossing = textual.filter((e) => folds.some((fold) => e.x < fold - .3 && e.x + e.w > fold + .3));
  const outside = textual.filter((e) => e.x < SAFE_MARGIN_MM || e.y < SAFE_MARGIN_MM
    || e.x + e.w > label.width - SAFE_MARGIN_MM || e.y + e.h > label.height - SAFE_MARGIN_MM);
  return [
    crossing.length
      ? { label: "Text across a fold", status: "warning", message: `${crossing.map(name).join(", ")} crosses the edge between two panels and will wrap round the bottle.`, field: crossing[0]!.field }
      : { label: "Text across a fold", status: "pass", message: "" },
    outside.length
      ? { label: "Safety margin", status: "warning", message: `${outside.map(name).join(", ")} is within ${SAFE_MARGIN_MM} mm of the label edge and may be trimmed.`, field: outside[0]!.field }
      : { label: "Safety margin", status: "pass", message: "" },
  ];
}

export function evaluateChecks(content: DesignContent, rules: Rules, context: CheckContext): CheckResult[] {
  const fields = content.fields;
  // The client's own arrangement, when they made one, decides placement and text size.
  const elements = (content.artwork?.layout?.unit?.elements ?? []).filter((e) => !e.hidden);
  const arranged = Boolean(content.artwork?.layout?.unit) && Boolean(context.label);
  // The brand name may be shown as a logo instead of text.
  const placed = (key: string) => elements.find((e) => e.type === "field" && e.field === key)
    ?? (key === "brandName" ? elements.find((e) => e.type === "image" || (e.type === "text" && normalize(e.text ?? "").includes(normalize(fields.brandName ?? "")))) : undefined);
  const value = (key: string) => fields[key]?.trim() ?? "";
  const filled = (key: string) => Boolean(value(key)) && !PLACEHOLDER.test(value(key));
  const labelOf = (key: string) => rules.requiredFields.find((f) => f.key === key)?.label ?? key;
  const text = printedText(content);
  const checks: Check[] = rules.checks ?? rules.requiredFields.map(({ key, label }) => ({ kind: "required", field: key, label }));
  const results: CheckResult[] = [];

  for (const check of checks) {
    if (check.when?.organic && !context.organic) continue;
    const fail = (message: string, field?: string): CheckResult => ({
      label: check.label, status: check.kind === "advisory" ? "warning" : check.severity ?? "error", message: check.message ?? message, field,
    });
    const pass = (field?: string): CheckResult => ({ label: check.label, status: "pass", message: "", field });

    switch (check.kind) {
      case "required": {
        const placeholder = value(check.field).match(PLACEHOLDER)?.[0];
        if (!filled(check.field)) {
          results.push(fail(placeholder ? `${check.label}: replace ${placeholder}.` : `${check.label} is required for this market.`, check.field));
        } else if (arranged && !placed(check.field) && check.field !== "destinationCountry") {
          results.push({ label: check.label, status: check.severity ?? "error", field: check.field, code: "notPlaced",
            message: `${check.label} is filled in but not on the label. Add it back to the label.` });
        } else {
          results.push(pass(check.field));
        }
        break;
      }
      case "contains": {
        const haystack = normalize(value(check.field));
        const ok = (check.any ?? []).length === 0 || check.any!.some((term) => haystack.includes(normalize(term)));
        const all = (check.all ?? []).every((term) => haystack.includes(normalize(term)));
        results.push(ok && all ? pass(check.field) : fail(`${check.label} is missing.`, check.field));
        break;
      }
      case "pattern":
        results.push(new RegExp(check.pattern, "iu").test(value(check.field)) || !filled(check.field)
          ? pass(check.field) : fail(`${check.label} does not match.`, check.field));
        break;
      case "script": {
        const missing = check.fields.filter((key) => value(key) && !SCRIPTS[check.script].test(value(key)));
        results.push(missing.length === 0 ? pass() : fail(`${check.label} is missing in: ${missing.map(labelOf).join(", ")}.`, missing[0]));
        break;
      }
      case "samePanel": {
        if (arranged) {
          const elsewhere = check.fields.filter((key) => {
            const own = placed(key);
            return own && panelOf(own, context.label!.width) !== check.panel;
          });
          results.push(elsewhere.length === 0 ? pass() : fail(`Move to the ${check.panel} panel: ${elsewhere.map(labelOf).join(", ")}.`, elsewhere[0]));
          break;
        }
        // A panel drawn from the template places these fields itself; a client's own text must include them.
        const own = customPanel(content, check.panel);
        const panelText = own ? normalize(own.text) : null;
        const missing = panelText === null ? [] : check.fields.filter((key) => {
          const firstLine = normalize(value(key).split("\n")[0] ?? "");
          return firstLine && !panelText.includes(firstLine);
        });
        results.push(missing.length === 0 ? pass() : fail(`Missing from the ${check.panel} panel: ${missing.map(labelOf).join(", ")}.`, missing[0]));
        break;
      }
      case "forbidden":
        results.push(new RegExp(check.pattern, "iu").test(text) ? fail(`${check.label}: remove this wording.`) : pass());
        break;
      case "requiresAlso": {
        const used = new RegExp(check.pattern, "iu").test(text);
        const missing = check.fields.filter((key) => !filled(key));
        results.push(!used || missing.length === 0 ? pass() : fail(`${check.label} needs: ${missing.join(", ")}.`, missing[0]));
        break;
      }
      case "advisory":
        if (new RegExp(check.pattern, "iu").test(text)) results.push(fail(check.label));
        break;
      case "gtin": {
        // Only a number the client typed is checked; an empty field or placeholder is the barcode check's job.
        const number = value(check.field).replace(/[\s-]/g, "").match(/\d{8,14}/)?.[0];
        if (!number) {
          results.push(pass(check.field));
        } else if (!validGtin(number)) {
          results.push({ label: check.label, status: "error", field: check.field,
            message: `${number} is not a valid GTIN: check the number of digits and the last (check) digit.` });
        } else if (check.brandPrefix && context.olivedBrand && !number.replace(/^0+/, "").replace(/^\d(?=\d{13}$)/, "").startsWith(check.brandPrefix)) {
          results.push({ label: check.label, status: "warning", field: check.field,
            message: `OLIVED brands use OLIVED's GS1 Tunisia numbers, which start with ${check.brandPrefix}. Check this barcode.` });
        } else {
          results.push(pass(check.field));
        }
        break;
      }
      case "controlBody": {
        const text = value(check.field);
        const code = text.toUpperCase().match(/\b[A-Z]{2}-BIO-\d{3}\b/)?.[0];
        const withdrawn = code && check.withdrawn.find((body) => body.code === code);
        const toConfirm = code && check.toConfirm?.find((body) => body.code === code);
        if (!filled(check.field)) {
          results.push(pass(check.field)); // The required check reports the empty field.
        } else if (!code) {
          results.push(fail("Write the control body code, for example TN-BIO-001.", check.field));
        } else if (withdrawn) {
          results.push({ label: check.label, status: "error", field: check.field,
            message: `${withdrawn.name} (${code}) is no longer recognised by the EU for organic imports (${withdrawn.since}). Use your current certifier's code.` });
        } else if (toConfirm) {
          results.push({ label: check.label, status: "warning", field: check.field,
            message: `Confirm that ${toConfirm.name} (${code}) is still recognised by the EU before printing.` });
        } else {
          results.push(pass(check.field));
        }
        break;
      }
      case "minTextHeight": {
        if (arranged) {
          // Point sizes are absolute, so the height is known even before the supplier confirms the label size.
          const mandatory = new Set(checks.filter((c) => c.kind === "required").map((c) => (c as { field: string }).field));
          const small = elements.filter((e) => e.type === "field" && e.field && mandatory.has(e.field)
            && (e.size ?? 8) * PT_TO_MM * xHeight(e.font) < check.mm);
          // Name the blocks and the size they need, then the rule itself.
          results.push(small.length === 0 ? pass() : {
            label: check.label, status: check.severity ?? "error", field: small[0]!.field,
            message: `Too small: ${small.map((e) => labelOf(e.field!)).join(", ")}. Use at least ${Math.ceil(check.mm / PT_TO_MM / xHeight(small[0]!.font))} pt in this typeface. ${check.message ?? ""}`.trim(),
          });
          break;
        }
        if (context.panelWidthMm === null) {
          results.push({
            label: check.label, status: "unverified",
            message: "Text height is checked once the supplier dimensions for this bottle size are loaded.",
          });
          break;
        }
        const ratio = xHeight(content.artwork?.font);
        const tooSmall = (["back", "front", "right"] as const).filter((face) => {
          const size = customPanel(content, face)?.size ?? TEMPLATE_TEXT_SIZE;
          return context.panelWidthMm! * size / 100 * ratio < check.mm;
        });
        results.push(tooSmall.length === 0 ? pass() : fail(`Text is too small on the ${tooSmall.join(", ")} panel.`));
        break;
      }
    }
  }

  if (arranged) results.push(...layoutResults(elements, context.label!));

  for (const { key, label } of SALES_FIELDS) {
    results.push(filled(key)
      ? { label, status: "pass", message: "", field: key }
      : { label, status: "error", message: `${label} is required for this market.`, field: key });
  }
  return results;
}

/** The problems found in a design: errors block submission, warnings are shown to the reviewer. */
export function checkDesign(content: DesignContent, rules: Rules, context: CheckContext = { organic: false, panelWidthMm: null }): Issue[] {
  return evaluateChecks(content, rules, context)
    .filter((result): result is CheckResult & { status: "error" | "warning" } => result.status === "error" || result.status === "warning")
    .map(({ field, message, status }) => ({ field: field ?? "", message, ...(status === "warning" ? { severity: "warning" as const } : {}) }));
}

/** True when nothing blocks submission: warnings alone do not. */
export const passes = (issues: Issue[]) => issues.every((issue) => issue.severity === "warning");
