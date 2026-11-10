import { z } from "zod";

/** Removes line breaks and control characters from single-line fields (defence against header injection). */
const singleLine = (max: number) =>
  z
    .string()
    .transform((v) => v.replace(/[\r\n\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").trim())
    .pipe(z.string().max(max, `Must be ${max} characters or fewer`));

const optionalLine = (max: number) => singleLine(max).optional().default("");

/** Multi-line text: keeps line breaks, strips other control characters. */
const multiLine = (max: number) =>
  z
    .string()
    .transform((v) => v.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").trim())
    .pipe(z.string().max(max, `Must be ${max} characters or fewer`))
    .optional()
    .default("");

export const ENQUIRY_SOURCES = ["home", "contact", "bulk"] as const;
export const INTERESTS = ["bulk", "packaged", "distributor"] as const;

export const enquirySchema = z
  .object({
    source: z.enum(ENQUIRY_SOURCES),
    fullName: singleLine(120).pipe(z.string().min(1, "Full name is required")),
    company: singleLine(160).pipe(z.string().min(1, "Company is required")),
    email: singleLine(254).pipe(z.email("A valid email is required")),
    phone: optionalLine(40),
    country: singleLine(120).pipe(z.string().min(1, "Country is required")),
    interests: z.array(z.enum(INTERESTS)).max(INTERESTS.length).optional().default([]),
    volume: optionalLine(80),
    oilCategory: optionalLine(80),
    organicPreference: optionalLine(40),
    format: optionalLine(60),
    targetSpec: optionalLine(300),
    message: multiLine(5000),
    /** Honeypot — must stay empty. Checked before validation in the route. */
    website: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    const required = (field: keyof typeof data, message: string) => {
      const value = data[field];
      if (typeof value !== "string" || value === "") {
        ctx.addIssue({ code: "custom", path: [field], message });
      }
    };

    if (data.source === "contact" && data.interests.length === 0) {
      ctx.addIssue({ code: "custom", path: ["interests"], message: "Select at least one enquiry type" });
    }

    if (data.source === "bulk") {
      required("oilCategory", "Olive oil category is required");
      required("organicPreference", "Select conventional or organic");
      required("volume", "Estimated volume is required");
      required("format", "Preferred format is required");
      required("targetSpec", "Target specification is required");
      required("message", "Message is required");
    }
  });

export type Enquiry = z.infer<typeof enquirySchema>;

/** Turns zod issues into `{ field: firstMessage }` for the frontend. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}
