import { z } from "zod";

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a colour like #1c1a16");

export const designContentSchema = z.object({
  fields: z.record(z.string().max(60), z.string().trim().max(2000)),
  colors: z.object({ primary: hexColor, secondary: hexColor }),
});

export type DesignContent = z.infer<typeof designContentSchema>;

/** The shape of RuleSet.rules. New kinds of check go here and in checkDesign. */
export const rulesSchema = z.object({
  requiredFields: z.array(z.object({ key: z.string(), label: z.string() })),
});

export type Rules = z.infer<typeof rulesSchema>;
export type Issue = { field: string; message: string };

export function checkDesign(content: DesignContent, rules: Rules): Issue[] {
  return rules.requiredFields
    .filter(({ key }) => !content.fields[key]?.trim())
    .map(({ key, label }) => ({ field: key, message: `${label} is required for this market.` }));
}
