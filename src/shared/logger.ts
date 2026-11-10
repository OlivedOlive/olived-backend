import type { RequestHandler } from "express";

export type Log = Pick<Console, "info" | "warn" | "error">;

// Colours only when printing to a terminal, so log files stay plain text.
const tty = process.stdout.isTTY;
const paint = (code: number, text: string) => (tty ? `\x1b[${code}m${text}\x1b[0m` : text);
export const color = {
  dim: (t: string) => paint(2, t),
  green: (t: string) => paint(32, t),
  yellow: (t: string) => paint(33, t),
  red: (t: string) => paint(31, t),
  cyan: (t: string) => paint(36, t),
};

const time = () => color.dim(new Date().toLocaleTimeString("en-GB"));

/** Prints to the terminal with the time in front. Quiet while the tests run. */
export const logger: Log =
  process.env.NODE_ENV === "test"
    ? { info() {}, warn() {}, error() {} }
    : {
        info: (...args) => console.info(time(), ...args),
        warn: (...args) => console.warn(time(), ...args),
        error: (...args) => console.error(time(), ...args),
      };

/** One line per request: method, address, status, duration and who made it. Never the body. */
export function requestLogger(log: Log): RequestHandler {
  return (req, res, next) => {
    const start = performance.now();
    res.on("finish", () => {
      const ms = Math.round(performance.now() - start);
      const { statusCode: status } = res;
      const paintStatus = status >= 500 ? color.red : status >= 400 ? color.yellow : color.green;
      const who = req.auth ? color.cyan(` ${req.auth.user.email}`) : "";
      const line = `${req.method} ${req.originalUrl} ${paintStatus(String(status))} ${color.dim(`${ms} ms`)}${who}`;
      if (status >= 500) log.error(line);
      else log.info(line);
    });
    next();
  };
}
