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
  }).optional(),
});

export type DesignContent = z.infer<typeof designContentSchema>;

/** The shape of RuleSet.rules. New kinds of check go here and in checkDesign. */
export const rulesSchema = z.object({
  requiredFields: z.array(z.object({ key: z.string(), label: z.string() })),
});

export type Rules = z.infer<typeof rulesSchema>;
export type Issue = { field: string; message: string };

export function checkDesign(content: DesignContent, rules: Rules): Issue[] {
  const salesFields = [
    { key: "saleLocation", label: "Sales location or retailer" },
    { key: "salesChannel", label: "Sales channel" },
  ].filter(({ key }) => Object.hasOwn(content.fields, key));
  return [...rules.requiredFields, ...salesFields]
    .filter(({ key }) => {
      const value = content.fields[key]?.trim();
      return !value || /^\[.+\]$/.test(value);
    })
    .map(({ key, label }) => ({ field: key, message: `${label} is required for this market.` }));
}
