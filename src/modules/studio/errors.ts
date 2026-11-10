import type { ErrorRequestHandler } from "express";
import { z } from "zod";
import { Prisma } from "../../generated/prisma/client.js";
import { logger } from "../../shared/logger.js";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const isUniqueViolation = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof z.ZodError) {
    const fields = Object.fromEntries(err.issues.map((i) => [i.path.join("."), i.message]));
    res.status(400).json({ error: "Please check the highlighted fields.", fields });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  // Errors raised by body parsing, such as invalid JSON or a body that is too large.
  const status = (err as { status?: unknown }).status;
  if (typeof status === "number" && status >= 400 && status < 500) {
    res.status(status).json({ error: "The request could not be read." });
    return;
  }
  logger.error("[studio] Unexpected error:", err);
  res.status(500).json({ error: "Something went wrong. Please try again." });
};
