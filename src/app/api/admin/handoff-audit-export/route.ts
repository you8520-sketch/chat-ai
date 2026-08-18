import { NextResponse } from "next/server";

import {
  authorizeHandoffAuditExport,
  exportProductionHandoffAuditSnapshot,
  isHandoffAuditExportEnabled,
  isLiveProductionDatabase,
  parseHandoffAuditExportMode,
  resolveHandoffAuditAdminPersonaCandidates,
  resolveHandoffAuditCharacterCandidates,
  snapshotPublicLogLine,
  writeHandoffAuditSnapshotPrivate,
  type HandoffAuditExportMode,
} from "@/lib/handoffAuditExport";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ExportBody = {
  mode?: string;
  name?: string;
  characterId?: number;
  personaId?: number;
};

const NO_STORE = { "Cache-Control": "no-store" };

function json(status: number, body: unknown): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

function deny(): NextResponse {
  return json(403, { error: "handoff audit export denied" });
}

function handleMode(mode: HandoffAuditExportMode, body: ExportBody): NextResponse {
  switch (mode) {
    case "resolve-character": {
      const name = typeof body.name === "string" ? body.name : "";
      if (!name.trim()) {
        return json(400, { error: "name is required" });
      }
      const candidates = resolveHandoffAuditCharacterCandidates(name);
      console.log(
        `[handoff-audit-export] mode=resolve-character name_chars=${name.trim().length} matches=${candidates.length}`
      );
      if (candidates.length > 1) {
        return json(200, {
          ok: true,
          mode,
          stop: true,
          reason: "multiple_exact_name_matches",
          candidates,
        });
      }
      return json(200, {
        ok: true,
        mode,
        stop: false,
        candidates,
      });
    }
    case "resolve-admin-personas": {
      const candidates = resolveHandoffAuditAdminPersonaCandidates();
      console.log(`[handoff-audit-export] mode=resolve-admin-personas matches=${candidates.length}`);
      return json(200, {
        ok: true,
        mode,
        candidates,
      });
    }
    case "snapshot": {
      const characterId = Number(body.characterId);
      const personaId = Number(body.personaId);
      if (!Number.isInteger(characterId) || characterId <= 0) {
        return json(400, { error: "characterId is required" });
      }
      if (!Number.isInteger(personaId) || personaId <= 0) {
        return json(400, { error: "personaId is required" });
      }
      try {
        const snapshot = exportProductionHandoffAuditSnapshot({ characterId, personaId });
        console.log(snapshotPublicLogLine(snapshot));
        let privateDir: string | null = null;
        if (isLiveProductionDatabase()) {
          try {
            privateDir = writeHandoffAuditSnapshotPrivate(snapshot);
          } catch {
            console.log("[handoff-audit-export] persist_failed");
          }
        }
        return json(200, {
          ok: true,
          mode,
          snapshot,
          privateDir,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "export failed";
        const status = /not found|loader miss|not an admin/i.test(message) ? 404 : 500;
        return json(status, { error: message });
      }
    }
    default: {
      const _exhaustive: never = mode;
      return json(400, { error: `unhandled mode: ${String(_exhaustive)}` });
    }
  }
}

export async function GET() {
  return json(405, { error: "method not allowed" });
}

export async function POST(req: Request) {
  if (!isHandoffAuditExportEnabled() || !authorizeHandoffAuditExport(req)) {
    return deny();
  }

  let body: ExportBody = {};
  try {
    const parsed = (await req.json()) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      body = parsed as ExportBody;
    }
  } catch {
    return json(400, { error: "invalid json" });
  }

  const mode = parseHandoffAuditExportMode(typeof body.mode === "string" ? body.mode : null);
  if (!mode) {
    return json(400, { error: "unknown mode" });
  }
  return handleMode(mode, body);
}
