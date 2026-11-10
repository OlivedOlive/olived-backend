import { createHash, randomBytes } from "node:crypto";
import type { RequestHandler, Response } from "express";
import { parseCookie } from "cookie";
import type { Config } from "../../../config.js";
import type { Db } from "../db.js";
import { HttpError } from "../errors.js";
import type { Role } from "../../../generated/prisma/client.js";

export const SESSION_COOKIE = "olived_studio_session";

export type Auth = {
  sessionId: string;
  user: { id: string; email: string; name: string };
  organization: { id: string; name: string };
  role: Role;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: Auth;
    }
  }
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

const sessionLength = (config: Config) => config.SESSION_DAYS * 24 * 60 * 60 * 1000;

/** The login cookie. It has an expiry date, so it survives closing the browser. */
function setSessionCookie(config: Config, res: Response, token: string) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.COOKIE_SECURE,
    path: "/",
    maxAge: sessionLength(config),
  });
}

/**
 * Logins are rows in the sessions table, so they survive restarts of this server.
 * They last SESSION_DAYS and are renewed while used (see loadAuth).
 */
export async function startSession(db: Db, config: Config, res: Response, userId: string) {
  const token = randomBytes(32).toString("base64url");
  await db.session.create({
    data: { tokenHash: hashToken(token), userId, expiresAt: new Date(Date.now() + sessionLength(config)) },
  });
  setSessionCookie(config, res, token);
}

export function clearSessionCookie(config: Config, res: Response) {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.COOKIE_SECURE,
    path: "/",
  });
}

/**
 * Sets req.auth when the request has a valid session. A session past half its life is renewed,
 * so someone who keeps using the studio stays logged in; it only ends after SESSION_DAYS unused,
 * or on log out.
 */
export function loadAuth(db: Db, config: Config): RequestHandler {
  return async (req, res, next) => {
    const token = parseCookie(req.headers.cookie ?? "")[SESSION_COOKIE];
    if (!token) return next();

    const session = await db.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: {
        user: {
          include: {
            memberships: { include: { organization: true }, orderBy: { createdAt: "asc" }, take: 1 },
          },
        },
      },
    });
    const membership = session?.user.memberships[0];
    if (session && membership && session.expiresAt > new Date()) {
      const length = sessionLength(config);
      if (session.expiresAt.getTime() - Date.now() < length / 2) {
        await db.session.update({ where: { id: session.id }, data: { expiresAt: new Date(Date.now() + length) } });
        setSessionCookie(config, res, token);
      }
      const { id, email, name } = session.user;
      req.auth = {
        sessionId: session.id,
        user: { id, email, name },
        organization: { id: membership.organization.id, name: membership.organization.name },
        role: membership.role,
      };
    }
    next();
  };
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.auth) throw new HttpError(401, "Please log in.");
  next();
};

export const requireReviewer: RequestHandler = (req, _res, next) => {
  if (!req.auth) throw new HttpError(401, "Please log in.");
  if (req.auth.role !== "OLIVED_REVIEWER" && req.auth.role !== "OLIVED_ADMIN") {
    throw new HttpError(403, "This page is for the OLIVED team.");
  }
  next();
};

/** The session of a route behind requireAuth. */
export function authOf(req: { auth?: Auth }): Auth {
  if (!req.auth) throw new HttpError(401, "Please log in.");
  return req.auth;
}
