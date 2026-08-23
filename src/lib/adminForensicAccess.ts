import { requireAdminRequest } from "@/lib/adminAuth";

export function readAdminDebugToken(req: Request): string {
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  return bearer || req.headers.get("x-admin-debug-token")?.trim() || "";
}

export function hasValidAdminDebugToken(req: Request): boolean {
  const expected = process.env.ADMIN_DEBUG_TOKEN?.trim() ?? "";
  if (!expected) return process.env.NODE_ENV !== "production";
  return readAdminDebugToken(req) === expected;
}

export async function requireForensicAdminAccess(req: Request): Promise<boolean> {
  if (!(await requireAdminRequest(req))) return false;
  return hasValidAdminDebugToken(req);
}
