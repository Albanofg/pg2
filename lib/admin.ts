/**
 * Admin allowlist. Pure (no node/server-only imports) so both edge middleware and
 * node route handlers can use it. Admins are set via the ADMIN_EMAILS env var
 * (comma-separated) or fall back to the built-in list.
 */

const DEFAULT_ADMINS = [
  "albano@patentgeyser.com",
  "albano@bookingboostpro.com",
  "tim.bratton@gmail.com",
  "tim@patentgeyser.com",
];

export function adminEmails(): string[] {
  const env = process.env.ADMIN_EMAILS;
  const list = env && env.trim() ? env.split(",") : DEFAULT_ADMINS;
  return list.map((e) => e.trim().toLowerCase()).filter(Boolean);
}

export function isAdminEmail(email: string | undefined | null): boolean {
  if (!email) return false;
  return adminEmails().includes(email.trim().toLowerCase());
}
