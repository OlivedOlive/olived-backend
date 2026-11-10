import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { Enquiry } from "./enquiry-schema.js";

export interface StoredEnquiry extends Omit<Enquiry, "website"> {
  id: string;
  receivedAt: string;
  ip?: string;
}

export interface EnquiryStore {
  save(enquiry: StoredEnquiry): Promise<void>;
}

/** Appends one JSON object per line. Simple, durable, and easy to import into a CRM later. */
export function createFileStore(dataDir: string): EnquiryStore {
  const file = path.resolve(dataDir, "enquiries.jsonl");
  let ready: Promise<unknown> | undefined;

  return {
    async save(enquiry) {
      ready ??= mkdir(path.dirname(file), { recursive: true });
      await ready;
      await appendFile(file, JSON.stringify(enquiry) + "\n", "utf8");
    },
  };
}
