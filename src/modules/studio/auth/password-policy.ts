/**
 * Passwords that meet the length rule but are guessed first by attackers. Kept short on purpose:
 * the length rule and the per-account lockout do most of the work.
 */
const COMMON = new Set([
  "1234567890",
  "12345678910",
  "0123456789",
  "1111111111",
  "0000000000",
  "qwertyuiop",
  "azertyuiop",
  "password12",
  "password123",
  "password1234",
  "motdepasse",
  "motdepasse1",
  "iloveyou12",
  "abcdefghij",
  "abc1234567",
  "1q2w3e4r5t",
  "qwerty1234",
  "azerty1234",
  "welcome123",
  "admin12345",
  "letmein123",
  "olived1234",
  "olivedstudio",
  "oliveoil123",
]);

/** Returns why a password is too easy to guess, or null when it is acceptable. */
export function weakPasswordReason(password: string, person: { email: string; name: string }): string | null {
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return "This password is too common. Choose another one.";
  if (/^\d+$/.test(password)) return "Use letters too, not only numbers.";
  if (new Set(lower).size < 4) return "Use more different characters.";

  const emailName = person.email.split("@")[0]?.toLowerCase() ?? "";
  const words = [emailName, ...person.name.toLowerCase().split(/\s+/)].filter((w) => w.length >= 4);
  if (words.some((w) => lower.includes(w))) return "Do not use your name or email in your password.";
  return null;
}
