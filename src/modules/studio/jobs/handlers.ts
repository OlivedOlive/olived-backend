import { z } from "zod";
import { checkDesign, contextFor, designContentSchema, passes, rulesSchema } from "../designs/validate.js";
import type { JobHandler } from "./queue.js";
import { logger } from "../../../shared/logger.js";

const validatePayload = z.object({ versionId: z.string() });

/** Checks a submitted version against the market's latest published rules. */
const validateDesign: JobHandler = async (payload, db) => {
  const { versionId } = validatePayload.parse(payload);
  const version = await db.designVersion.findUnique({
    where: { id: versionId },
    include: { design: { include: { template: { include: { variant: { include: { product: true } } } } } } },
  });
  if (!version) return; // A deleted design has no artwork left to validate.
  const ruleSet = await db.ruleSet.findFirst({
    where: { marketId: version.design.marketId, status: "PUBLISHED" },
    orderBy: { version: "desc" },
  });
  if (!ruleSet) throw new Error(`Market ${version.design.marketId} has no published rules`);

  const issues = checkDesign(
    designContentSchema.parse(version.content), rulesSchema.parse(ruleSet.rules), contextFor(version.design.template),
  );
  // Warnings are kept for the reviewer but do not send the design back.
  const passed = passes(issues);
  logger.info(
    `[worker] Market check for design ${version.designId}: ${passed ? "passed" : `${issues.length} problem(s): ${issues.map((i) => i.field).join(", ")}`}`,
  );

  await db.$transaction(async (tx) => {
    await tx.validationResult.create({ data: { versionId, ruleSetId: ruleSet.id, passed, issues } });
    if (!passed) {
      await tx.design.updateMany({
        where: { id: version.designId, status: "SUBMITTED" },
        data: { status: "CHANGES_REQUESTED" },
      });
    }
  });
};

export const handlers = { "design.validate": validateDesign };
